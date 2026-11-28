import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  createPlaylistWithTracks,
  DatabaseBackupHistoryItem,
  DatabaseBackupOfflineRef,
  DatabaseBackupPlaylist,
  DatabaseUserSnapshot,
  exportUserDatabaseSnapshot,
  FAVORITES_PLAYLIST_ID,
  getDownloadedTrackIds,
  getPlaybackHistory,
  getPlaylistById,
  getPlaylists,
  importUserDatabaseSnapshot,
  ImportSnapshotStats,
  isLocalDeviceTrackId,
  PlaylistSummary,
} from './database';
import {
  deletePlaylistCover,
  enqueuePlaylistDownload,
  ensureStorageDirectories,
  getDownloadQueue,
  isTrackDownloaded,
  PLAYLIST_COVERS_DIRECTORY,
} from './storage';
import { formatDurationSeconds } from './trackMetadata';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require('../app.json') as {
  expo?: { version?: string };
};

export const BACKUP_APP_ID = 'sonary-pro';
export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_CUSTOM_COVER_BASE64_CHARS = 700_000; // ~512 KB binário
export const MAX_PLAYLISTS = 200;
export const MAX_TRACKS_PER_PLAYLIST = 5000;
export const MAX_PLAYBACK_HISTORY = 500;
export const MAX_SEARCH_HISTORY_ITEMS = 12;
export const MAX_OFFLINE_REFS = 5000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const STRICT_BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

export interface SonaryBackupTrackV1 {
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  position: number;
  addedAt: number;
}

export interface SonaryBackupPlaylistV1 {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: number;
  updatedAt: number;
  customCoverBase64?: string | null;
  tracks: SonaryBackupTrackV1[];
}

export interface SonaryBackupV1 {
  app: typeof BACKUP_APP_ID;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  appVersion: string;
  exportedAt: number;
  data: {
    playlists: SonaryBackupPlaylistV1[];
    playbackHistory: DatabaseBackupHistoryItem[];
    searchHistory: string[];
    offlineTrackRefs: DatabaseBackupOfflineRef[];
  };
}

export interface LocalBackupSummary {
  userPlaylistCount: number;
  favoritesCount: number;
  playbackHistoryCount: number;
}

export interface BackupPreviewSummary {
  appVersion: string;
  exportedAt: number;
  userPlaylistCount: number;
  favoritesCount: number;
  totalPlaylistTracks: number;
  playbackHistoryCount: number;
  searchHistoryCount: number;
  customCoverCount: number;
  offlineTotalCount: number;
  offlineMissingCount: number;
}

export type ImportBackupMode = 'merge' | 'replace';

export interface ExportBackupResult {
  fileName: string;
  fileUri: string;
  sizeBytes: number;
  shared: boolean;
}

export interface PickedBackupResult {
  fileName: string;
  sizeBytes: number;
  backup: SonaryBackupV1;
  preview: BackupPreviewSummary;
}

export interface RestoreBackupOptions {
  mode: ImportBackupMode;
  enqueueOfflineDownloads?: boolean;
}

export interface RestoreBackupResult {
  mode: ImportBackupMode;
  stats: ImportSnapshotStats;
  restoredCoversCount: number;
  enqueuedOfflineCount: number;
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

function sanitizeText(value: unknown, maxLen: number, fallback: string = ''): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function sanitizeOptionalText(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = sanitizeText(value, maxLen, '');
  return cleaned || null;
}

function sanitizeTimestamp(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function sanitizeDuration(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(86400, Math.floor(num));
}

function sanitizeHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return trimmed;
    }
    return '';
  } catch {
    return '';
  }
}

function buildHttpThumbnailLookup(
  playlists: Array<{ tracks: Array<{ trackId: string; thumbnailUrl?: string }> }>,
  playbackHistory: Array<{ trackId: string; thumbnailUrl?: string }>
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const pl of playlists) {
    for (const t of pl.tracks) {
      if (!t.trackId || lookup.has(t.trackId)) continue;
      const safe = sanitizeHttpUrl(t.thumbnailUrl);
      if (safe) lookup.set(t.trackId, safe);
    }
  }
  for (const h of playbackHistory) {
    if (!h.trackId || lookup.has(h.trackId)) continue;
    const safe = sanitizeHttpUrl(h.thumbnailUrl);
    if (safe) lookup.set(h.trackId, safe);
  }
  return lookup;
}

function resolveHttpThumbnailForTrack(
  trackId: string,
  rawUrl: unknown,
  lookup: Map<string, string>
): string {
  const direct = sanitizeHttpUrl(rawUrl);
  if (direct) return direct;
  const fromLookup = lookup.get(trackId);
  if (fromLookup) return fromLookup;
  if (YOUTUBE_VIDEO_ID_REGEX.test(trackId)) {
    return `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`;
  }
  return '';
}

function sanitizeSafeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === FAVORITES_PLAYLIST_ID) return FAVORITES_PLAYLIST_ID;
  if (!SAFE_ID_REGEX.test(trimmed)) return null;
  return trimmed;
}

/**
 * Valida se uma string base64 representa uma imagem JPEG ou PNG real (magic bytes),
 * respeitando tamanho máximo e alfabeto base64 estrito.
 */
export function validateImageBase64(raw: unknown): { base64: string; ext: 'jpg' | 'png' } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, '');
  if (!trimmed || trimmed.length < 16 || trimmed.length > MAX_CUSTOM_COVER_BASE64_CHARS) {
    return null;
  }
  if (trimmed.length % 4 !== 0 || !STRICT_BASE64_REGEX.test(trimmed)) {
    return null;
  }
  // JPEG magic bytes FF D8 FF -> '/9j/'; PNG magic bytes 89 50 4E 47 0D 0A 1A 0A -> 'iVBORw0KGgo'
  if (trimmed.startsWith('/9j/')) {
    return { base64: trimmed, ext: 'jpg' };
  }
  if (trimmed.startsWith('iVBORw0KGgo')) {
    return { base64: trimmed, ext: 'png' };
  }
  return null;
}

function parseJsonSafely(rawJson: string): unknown {
  if (typeof rawJson !== 'string' || !rawJson.trim()) {
    throw new BackupValidationError('Arquivo de backup vazio.');
  }
  if (rawJson.length > MAX_BACKUP_FILE_BYTES) {
    throw new BackupValidationError('Arquivo de backup excede o limite máximo permitido (15 MB).');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) {
        return undefined;
      }
      return value;
    });
  } catch {
    throw new BackupValidationError('Arquivo JSON inválido ou corrompido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupValidationError('Estrutura do arquivo de backup inválida.');
  }
  return parsed;
}

/**
 * Valida estritamente e normaliza um JSON de backup (fronteira de confiança).
 * Rejeita arquivos corrompidos, versões desconhecidas, URLs perigosas e covers inválidos.
 */
export function validateAndNormalizeBackupJson(rawJson: string): SonaryBackupV1 {
  const root = parseJsonSafely(rawJson) as Record<string, unknown>;

  if (root.app !== BACKUP_APP_ID) {
    throw new BackupValidationError('Este arquivo não é um backup válido do Sonary.');
  }
  if (root.type === PLAYLIST_EXPORT_TYPE) {
    throw new BackupValidationError(
      'Este arquivo é uma playlist individual. Use o botão "Importar" na aba Playlists.'
    );
  }
  if (root.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `Versão de backup não suportada (v${String(root.schemaVersion ?? '?')}). Atualize o Sonary.`
    );
  }
  if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data)) {
    throw new BackupValidationError('Seção de dados do backup ausente ou inválida.');
  }

  const now = Date.now();
  const dataObj = root.data as Record<string, unknown>;

  if (!Array.isArray(dataObj.playlists)) {
    throw new BackupValidationError('Lista de playlists inválida no backup.');
  }
  if (dataObj.playlists.length > MAX_PLAYLISTS) {
    throw new BackupValidationError(`Backup excede o limite máximo de ${MAX_PLAYLISTS} playlists.`);
  }

  const seenPlaylistIds = new Set<string>();
  const playlists: SonaryBackupPlaylistV1[] = [];

  for (const rawPl of dataObj.playlists) {
    if (!rawPl || typeof rawPl !== 'object' || Array.isArray(rawPl)) continue;
    const plObj = rawPl as Record<string, unknown>;
    const id = sanitizeSafeId(plObj.id);
    if (!id || seenPlaylistIds.has(id)) continue;
    seenPlaylistIds.add(id);

    const isSystem = id === FAVORITES_PLAYLIST_ID;
    const name = isSystem
      ? 'Músicas Curtidas'
      : sanitizeText(plObj.name, 200, 'Minha Playlist');
    const description = sanitizeOptionalText(plObj.description, 1000);
    const createdAt = sanitizeTimestamp(plObj.createdAt, now);
    const updatedAt = sanitizeTimestamp(plObj.updatedAt, createdAt);

    let customCoverBase64: string | null = null;
    if (!isSystem && typeof plObj.customCoverBase64 === 'string') {
      const validImg = validateImageBase64(plObj.customCoverBase64);
      if (validImg) {
        customCoverBase64 = validImg.base64;
      }
    }

    const rawTracks = Array.isArray(plObj.tracks) ? plObj.tracks : [];
    if (rawTracks.length > MAX_TRACKS_PER_PLAYLIST) {
      throw new BackupValidationError(
        `Playlist "${name}" excede o limite de ${MAX_TRACKS_PER_PLAYLIST} faixas.`
      );
    }

    const seenTrackIds = new Set<string>();
    const tracks: SonaryBackupTrackV1[] = [];
    for (let idx = 0; idx < rawTracks.length; idx += 1) {
      const rawTrack = rawTracks[idx];
      if (!rawTrack || typeof rawTrack !== 'object' || Array.isArray(rawTrack)) continue;
      const tObj = rawTrack as Record<string, unknown>;
      const trackId = sanitizeSafeId(tObj.trackId ?? tObj.id);
      if (!trackId || isLocalDeviceTrackId(trackId) || seenTrackIds.has(trackId)) continue;
      seenTrackIds.add(trackId);

      const posNum = Number(tObj.position);
      tracks.push({
        trackId,
        title: sanitizeText(tObj.title, 200, 'Música'),
        artist: sanitizeText(tObj.artist, 200, 'Artista'),
        duration: sanitizeDuration(tObj.duration),
        thumbnailUrl: sanitizeHttpUrl(tObj.thumbnailUrl),
        position: Number.isFinite(posNum) && posNum >= 0 ? Math.floor(posNum) : idx,
        addedAt: sanitizeTimestamp(tObj.addedAt, now),
      });
    }

    playlists.push({
      id,
      name,
      description,
      isSystem,
      createdAt,
      updatedAt,
      customCoverBase64,
      tracks,
    });
  }

  // Histórico de reprodução
  const rawHistory = Array.isArray(dataObj.playbackHistory) ? dataObj.playbackHistory : [];
  const seenHistoryIds = new Set<string>();
  const playbackHistory: DatabaseBackupHistoryItem[] = [];
  for (const rawH of rawHistory) {
    if (playbackHistory.length >= MAX_PLAYBACK_HISTORY) break;
    if (!rawH || typeof rawH !== 'object' || Array.isArray(rawH)) continue;
    const hObj = rawH as Record<string, unknown>;
    const trackId = sanitizeSafeId(hObj.trackId ?? hObj.id);
    if (!trackId || isLocalDeviceTrackId(trackId) || seenHistoryIds.has(trackId)) continue;
    seenHistoryIds.add(trackId);

    playbackHistory.push({
      trackId,
      title: sanitizeText(hObj.title, 200, 'Música'),
      artist: sanitizeText(hObj.artist, 200, 'Artista'),
      duration: sanitizeDuration(hObj.duration),
      thumbnailUrl: sanitizeHttpUrl(hObj.thumbnailUrl),
      playedAt: sanitizeTimestamp(hObj.playedAt, now),
    });
  }

  // Histórico de buscas
  const rawSearch = Array.isArray(dataObj.searchHistory) ? dataObj.searchHistory : [];
  const seenSearch = new Set<string>();
  const searchHistory: string[] = [];
  for (const rawTerm of rawSearch) {
    if (searchHistory.length >= MAX_SEARCH_HISTORY_ITEMS) break;
    const term = sanitizeText(rawTerm, 120, '');
    const key = term.toLowerCase();
    if (!term || seenSearch.has(key)) continue;
    seenSearch.add(key);
    searchHistory.push(term);
  }

  // Lista leve de faixas offline
  const rawOffline = Array.isArray(dataObj.offlineTrackRefs) ? dataObj.offlineTrackRefs : [];
  const seenOffline = new Set<string>();
  const offlineTrackRefs: DatabaseBackupOfflineRef[] = [];
  for (const rawOff of rawOffline) {
    if (offlineTrackRefs.length >= MAX_OFFLINE_REFS) break;
    if (!rawOff || typeof rawOff !== 'object' || Array.isArray(rawOff)) continue;
    const oObj = rawOff as Record<string, unknown>;
    const id = sanitizeSafeId(oObj.id ?? oObj.trackId);
    if (!id || isLocalDeviceTrackId(id) || seenOffline.has(id)) continue;
    seenOffline.add(id);

    offlineTrackRefs.push({
      id,
      title: sanitizeText(oObj.title, 200, 'Música'),
      artist: sanitizeText(oObj.artist, 200, 'Artista'),
      duration: sanitizeDuration(oObj.duration),
      thumbnailUrl: sanitizeHttpUrl(oObj.thumbnailUrl),
    });
  }

  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: sanitizeText(root.appVersion, 32, '1.0.0'),
    exportedAt: sanitizeTimestamp(root.exportedAt, now),
    data: {
      playlists,
      playbackHistory,
      searchHistory,
      offlineTrackRefs,
    },
  };
}

async function getVerifiedDownloadedTrackIds(trackIds: string[]): Promise<Set<string>> {
  if (trackIds.length === 0) return new Set<string>();
  const dbDownloaded = Array.from(await getDownloadedTrackIds(trackIds));
  const verified = new Set<string>();
  const CHUNK_SIZE = 32;
  for (let i = 0; i < dbDownloaded.length; i += CHUNK_SIZE) {
    const chunk = dbDownloaded.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (id) => {
        if (await isTrackDownloaded(id).catch(() => false)) {
          verified.add(id);
        }
      })
    );
  }
  return verified;
}

/**
 * Calcula um resumo de pré-visualização do backup (incluindo quantas faixas offline faltam baixar).
 */
export async function getBackupPreview(backup: SonaryBackupV1): Promise<BackupPreviewSummary> {
  let userPlaylistCount = 0;
  let favoritesCount = 0;
  let totalPlaylistTracks = 0;
  let customCoverCount = 0;

  for (const pl of backup.data.playlists) {
    totalPlaylistTracks += pl.tracks.length;
    if (pl.id === FAVORITES_PLAYLIST_ID) {
      favoritesCount = pl.tracks.length;
    } else {
      userPlaylistCount += 1;
      if (pl.customCoverBase64) {
        customCoverCount += 1;
      }
    }
  }

  const offlineIds = backup.data.offlineTrackRefs.map((t) => t.id);
  const alreadyDownloaded = await getVerifiedDownloadedTrackIds(offlineIds);
  const activeQueuedIds = new Set(
    getDownloadQueue()
      .filter((i) => i.status === 'pending' || i.status === 'downloading')
      .map((i) => i.track.id)
  );
  const offlineMissingCount = offlineIds.filter(
    (id) => !alreadyDownloaded.has(id) && !activeQueuedIds.has(id)
  ).length;

  return {
    appVersion: backup.appVersion,
    exportedAt: backup.exportedAt,
    userPlaylistCount,
    favoritesCount,
    totalPlaylistTracks,
    playbackHistoryCount: backup.data.playbackHistory.length,
    searchHistoryCount: backup.data.searchHistory.length,
    customCoverCount,
    offlineTotalCount: backup.data.offlineTrackRefs.length,
    offlineMissingCount,
  };
}

/**
 * Monta o payload completo de backup lendo o SQLite e embutindo capas customizadas em base64.
 */
export async function buildBackupPayload(): Promise<SonaryBackupV1> {
  const snapshot = await exportUserDatabaseSnapshot();
  const base64Encoding = FileSystem.EncodingType?.Base64 ?? ('base64' as FileSystem.EncodingType);

  const playlists: SonaryBackupPlaylistV1[] = [];
  for (const pl of snapshot.playlists) {
    let customCoverBase64: string | null = null;
    if (
      !pl.isSystem &&
      pl.customCoverUri &&
      pl.customCoverUri.startsWith(PLAYLIST_COVERS_DIRECTORY)
    ) {
      try {
        const info = await FileSystem.getInfoAsync(pl.customCoverUri);
        if (info.exists && (!info.size || info.size <= 512 * 1024)) {
          const rawB64 = await FileSystem.readAsStringAsync(pl.customCoverUri, {
            encoding: base64Encoding,
          });
          const valid = validateImageBase64(rawB64);
          if (valid) {
            customCoverBase64 = valid.base64;
          }
        }
      } catch {
        // Ignora capa local corrompida ou ausente; não bloqueia o backup
      }
    }

    playlists.push({
      id: pl.id,
      name: pl.name,
      description: pl.description,
      isSystem: pl.isSystem,
      createdAt: pl.createdAt,
      updatedAt: pl.updatedAt,
      customCoverBase64,
      tracks: pl.tracks
        .filter((t) => !isLocalDeviceTrackId(t.trackId))
        .map((t, idx) => ({
          trackId: t.trackId,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
          thumbnailUrl: sanitizeHttpUrl(t.thumbnailUrl),
          position: idx,
          addedAt: t.addedAt,
        })),
    });
  }

  const thumbLookup = buildHttpThumbnailLookup(playlists, snapshot.playbackHistory);

  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: appJson?.expo?.version || '1.0.0',
    exportedAt: Date.now(),
    data: {
      playlists,
      playbackHistory: snapshot.playbackHistory
        .filter((h) => !isLocalDeviceTrackId(h.trackId))
        .map((h) => ({
          ...h,
          thumbnailUrl: sanitizeHttpUrl(h.thumbnailUrl),
        })),
      searchHistory: snapshot.searchHistory.slice(0, MAX_SEARCH_HISTORY_ITEMS),
      offlineTrackRefs: snapshot.offlineTrackRefs
        .filter((o) => !isLocalDeviceTrackId(o.id))
        .map((o) => ({
          ...o,
          thumbnailUrl: resolveHttpThumbnailForTrack(o.id, o.thumbnailUrl, thumbLookup),
        })),
    },
  };
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

/**
 * Retorna resumo rápido dos dados locais atuais (playlists, curtidas e histórico).
 */
export async function getLocalBackupSummary(): Promise<LocalBackupSummary> {
  const [playlists, history] = await Promise.all([
    getPlaylists(),
    getPlaybackHistory(MAX_PLAYBACK_HISTORY),
  ]);
  let userPlaylistCount = 0;
  let favoritesCount = 0;
  for (const pl of playlists) {
    if (pl.id === FAVORITES_PLAYLIST_ID || pl.isSystem) {
      favoritesCount = pl.trackCount;
    } else {
      userPlaylistCount += 1;
    }
  }
  return {
    userPlaylistCount,
    favoritesCount,
    playbackHistoryCount: history.length,
  };
}

function formatBackupFileName(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `sonary-backup-${yyyy}-${mm}-${dd}.json`;
}

async function exportViaAndroidSaf(
  fileName: string,
  serialized: string,
  utf8Encoding: FileSystem.EncodingType
): Promise<string | null> {
  const saf = (FileSystem as unknown as { StorageAccessFramework?: any }).StorageAccessFramework;
  if (Platform.OS !== 'android' || !saf?.requestDirectoryPermissionsAsync) {
    return null;
  }
  const perms = await saf.requestDirectoryPermissionsAsync();
  if (perms?.granted && perms.directoryUri) {
    const destUri = await saf.createFileAsync(
      perms.directoryUri,
      fileName,
      'application/json'
    );
    await FileSystem.writeAsStringAsync(destUri, serialized, {
      encoding: utf8Encoding,
    });
    return destUri;
  }
  return null;
}

async function prepareSerializedBackup(): Promise<{
  fileName: string;
  serialized: string;
  sizeBytes: number;
  utf8Encoding: FileSystem.EncodingType;
}> {
  const payload = await buildBackupPayload();
  const serialized = JSON.stringify(payload, null, 2);
  const fileName = formatBackupFileName(new Date(payload.exportedAt));
  const utf8Encoding = FileSystem.EncodingType?.UTF8 ?? ('utf8' as FileSystem.EncodingType);
  return {
    fileName,
    serialized,
    sizeBytes: utf8ByteLength(serialized),
    utf8Encoding,
  };
}

/**
 * Salva o arquivo JSON de backup diretamente em uma pasta escolhida pelo usuário no dispositivo (Android SAF).
 * Em plataformas sem SAF (ex.: iOS), delega ao Share Sheet nativo (que inclui "Salvar em Arquivos").
 */
export async function saveBackupToDevice(): Promise<ExportBackupResult> {
  const saf = (FileSystem as unknown as { StorageAccessFramework?: any }).StorageAccessFramework;
  if (Platform.OS !== 'android' || !saf?.requestDirectoryPermissionsAsync) {
    return exportBackupToFile();
  }

  const { fileName, serialized, sizeBytes, utf8Encoding } = await prepareSerializedBackup();
  const destUri = await exportViaAndroidSaf(fileName, serialized, utf8Encoding);

  return {
    fileName,
    fileUri: destUri || '',
    sizeBytes,
    shared: Boolean(destUri),
  };
}

/**
 * Gera o arquivo JSON de backup e aciona o compartilhamento nativo (ou Android SAF como fallback).
 */
export async function exportBackupToFile(): Promise<ExportBackupResult> {
  const { fileName, serialized, sizeBytes, utf8Encoding } = await prepareSerializedBackup();
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  const fileUri = `${baseDir}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, serialized, {
    encoding: utf8Encoding,
  });

  let shared = false;
  let finalUri = fileUri;
  const canShare = await Sharing.isAvailableAsync().catch(() => false);
  if (canShare) {
    try {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: 'Exportar backup do Sonary',
        UTI: 'public.json',
      });
      shared = true;
    } catch (err) {
      const savedUri = await exportViaAndroidSaf(fileName, serialized, utf8Encoding);
      if (savedUri) {
        shared = true;
        finalUri = savedUri;
      } else {
        throw err;
      }
    }
  } else {
    const savedUri = await exportViaAndroidSaf(fileName, serialized, utf8Encoding);
    if (savedUri) {
      shared = true;
      finalUri = savedUri;
    }
  }

  return {
    fileName,
    fileUri: finalUri,
    sizeBytes,
    shared,
  };
}

/**
 * Abre o seletor de documentos nativo, valida tamanho/schema e retorna o backup pronto para preview.
 */
export async function pickBackupFile(): Promise<PickedBackupResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled || !picked.assets || picked.assets.length === 0) {
    return null;
  }

  const asset = picked.assets[0];
  if (!asset?.uri) {
    throw new BackupValidationError('Não foi possível acessar o arquivo selecionado.');
  }

  if (typeof asset.size === 'number' && asset.size > MAX_BACKUP_FILE_BYTES) {
    throw new BackupValidationError('Arquivo excede o limite máximo permitido (15 MB).');
  }

  const info = await FileSystem.getInfoAsync(asset.uri);
  if (info.exists && typeof info.size === 'number' && info.size > MAX_BACKUP_FILE_BYTES) {
    throw new BackupValidationError('Arquivo excede o limite máximo permitido (15 MB).');
  }

  const utf8Encoding = FileSystem.EncodingType?.UTF8 ?? ('utf8' as FileSystem.EncodingType);
  const rawJson = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: utf8Encoding,
  });

  const backup = validateAndNormalizeBackupJson(rawJson);
  const preview = await getBackupPreview(backup);

  return {
    fileName: asset.name || 'sonary-backup.json',
    sizeBytes: utf8ByteLength(rawJson),
    backup,
    preview,
  };
}

/**
 * Restaura um backup validado no SQLite e no storage de capas com rollback em caso de erro.
 */
export async function restoreBackup(
  backup: SonaryBackupV1,
  options: RestoreBackupOptions
): Promise<RestoreBackupResult> {
  await ensureStorageDirectories();
  const base64Encoding = FileSystem.EncodingType?.Base64 ?? ('base64' as FileSystem.EncodingType);
  const createdCoverUris: string[] = [];
  let restoredCoversCount = 0;

  try {
    const dbPlaylists: DatabaseBackupPlaylist[] = [];

    for (const pl of backup.data.playlists) {
      let customCoverUri: string | null = null;
      if (!pl.isSystem && pl.customCoverBase64) {
        const valid = validateImageBase64(pl.customCoverBase64);
        if (valid) {
          const safeId = pl.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          const destUri = `${PLAYLIST_COVERS_DIRECTORY}${safeId}_${Date.now()}_${restoredCoversCount}.${valid.ext}`;
          await FileSystem.writeAsStringAsync(destUri, valid.base64, {
            encoding: base64Encoding,
          });
          createdCoverUris.push(destUri);
          customCoverUri = destUri;
          restoredCoversCount += 1;
        }
      }

      dbPlaylists.push({
        id: pl.id,
        name: pl.name,
        description: pl.description,
        isSystem: pl.isSystem,
        customCoverUri,
        createdAt: pl.createdAt,
        updatedAt: pl.updatedAt,
        tracks: pl.tracks,
      });
    }

    const dbSnapshot: DatabaseUserSnapshot = {
      playlists: dbPlaylists,
      playbackHistory: backup.data.playbackHistory,
      searchHistory: backup.data.searchHistory,
      offlineTrackRefs: backup.data.offlineTrackRefs,
    };

    const stats = await importUserDatabaseSnapshot(dbSnapshot, options.mode);

    // Limpa capas antigas substituídas (replace e merge) e capas recém-gravadas não adotadas no merge
    for (const oldUri of stats.removedCustomCoverUris) {
      if (!createdCoverUris.includes(oldUri)) {
        await deletePlaylistCover(oldUri).catch(() => {});
      }
    }
    for (const unusedUri of stats.unusedCustomCoverUris) {
      await deletePlaylistCover(unusedUri).catch(() => {});
    }
    if (options.mode === 'replace') {
      try {
        const existingFiles = await FileSystem.readDirectoryAsync(PLAYLIST_COVERS_DIRECTORY);
        const keepSet = new Set(createdCoverUris);
        for (const filename of existingFiles) {
          const fullUri = `${PLAYLIST_COVERS_DIRECTORY}${filename}`;
          if (!keepSet.has(fullUri)) {
            await deletePlaylistCover(fullUri).catch(() => {});
          }
        }
      } catch {
        // Ignora erro de listagem de diretório para não falhar restauração já confirmada
      }
    }
    const adoptedCoversCount = Math.max(0, restoredCoversCount - stats.unusedCustomCoverUris.length);

    let enqueuedOfflineCount = 0;
    if (options.enqueueOfflineDownloads && backup.data.offlineTrackRefs.length > 0) {
      const cloudOfflineRefs = backup.data.offlineTrackRefs.filter(
        (t) => !isLocalDeviceTrackId(t.id)
      );
      const offlineIds = cloudOfflineRefs.map((t) => t.id);
      const alreadyDownloaded = await getVerifiedDownloadedTrackIds(offlineIds);
      const activeQueuedIds = new Set(
        getDownloadQueue()
          .filter((i) => i.status === 'pending' || i.status === 'downloading')
          .map((i) => i.track.id)
      );
      const thumbLookup = buildHttpThumbnailLookup(
        backup.data.playlists,
        backup.data.playbackHistory
      );
      const missingTracks = cloudOfflineRefs
        .filter((t) => !alreadyDownloaded.has(t.id) && !activeQueuedIds.has(t.id))
        .map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
          formattedDuration: formatDurationSeconds(t.duration),
          thumbnailUrl: resolveHttpThumbnailForTrack(t.id, t.thumbnailUrl, thumbLookup),
        }));
      if (missingTracks.length > 0) {
        const res = enqueuePlaylistDownload(missingTracks);
        enqueuedOfflineCount = res.enqueuedCount;
      }
    }

    return {
      mode: options.mode,
      stats,
      restoredCoversCount: adoptedCoversCount,
      enqueuedOfflineCount,
    };
  } catch (err) {
    // Rollback de capas gravadas em disco caso a transação do SQLite falhe
    for (const uri of createdCoverUris) {
      await deletePlaylistCover(uri).catch(() => {});
    }
    throw err;
  }
}

/* ==========================================================================
   EXPORTAÇÃO & IMPORTAÇÃO DE PLAYLIST INDIVIDUAL (JSON v1)
   ========================================================================== */

export const PLAYLIST_EXPORT_TYPE = 'playlist';
export const PLAYLIST_EXPORT_SCHEMA_VERSION = 1;
export const MAX_PLAYLIST_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface SonaryPlaylistExportV1 {
  app: typeof BACKUP_APP_ID;
  type: typeof PLAYLIST_EXPORT_TYPE;
  schemaVersion: typeof PLAYLIST_EXPORT_SCHEMA_VERSION;
  appVersion: string;
  exportedAt: number;
  playlist: {
    name: string;
    description: string | null;
    customCoverBase64?: string | null;
    tracks: SonaryBackupTrackV1[];
  };
}

export interface PlaylistImportPreview {
  appVersion: string;
  exportedAt: number;
  name: string;
  description: string | null;
  trackCount: number;
  totalDuration: number;
  hasCustomCover: boolean;
  customCoverDataUri: string | null;
  coverThumbnails: string[];
  offlineMissingCount: number;
}

export interface PickedPlaylistResult {
  fileName: string;
  sizeBytes: number;
  exported: SonaryPlaylistExportV1;
  preview: PlaylistImportPreview;
}

export interface ImportPlaylistOptions {
  nameOverride?: string;
  enqueueOfflineDownloads?: boolean;
}

export interface ImportPlaylistResult {
  playlist: PlaylistSummary;
  restoredCustomCover: boolean;
  enqueuedOfflineCount: number;
}

export function formatPlaylistExportFileName(playlistName: string): string {
  const normalized = String(playlistName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized ? `sonary-playlist-${normalized}.json` : 'sonary-playlist.json';
}

/**
 * Monta o payload JSON leve de uma única playlist (incluindo Músicas Curtidas).
 */
export async function buildPlaylistExportPayload(
  playlistId: string
): Promise<SonaryPlaylistExportV1> {
  const detail = await getPlaylistById(playlistId);
  if (!detail) {
    throw new Error('Playlist não encontrada.');
  }

  let customCoverBase64: string | null = null;
  if (
    !detail.isSystem &&
    detail.hasCustomCover &&
    detail.thumbnailUrl &&
    detail.thumbnailUrl.startsWith(PLAYLIST_COVERS_DIRECTORY)
  ) {
    try {
      const base64Encoding = FileSystem.EncodingType?.Base64 ?? ('base64' as FileSystem.EncodingType);
      const info = await FileSystem.getInfoAsync(detail.thumbnailUrl);
      if (info.exists && (!info.size || info.size <= 512 * 1024)) {
        const rawB64 = await FileSystem.readAsStringAsync(detail.thumbnailUrl, {
          encoding: base64Encoding,
        });
        const valid = validateImageBase64(rawB64);
        if (valid) {
          customCoverBase64 = valid.base64;
        }
      }
    } catch {
      // Capa corrompida/ausente não impede exportar a playlist
    }
  }

  const emptyLookup = new Map<string, string>();
  // Músicas locais do dispositivo (local_*) não podem ser exportadas para backup/compartilhamento
  const orderedTracks = [...detail.tracks]
    .filter((t) => !isLocalDeviceTrackId(t.trackId))
    .sort((a, b) => a.position - b.position);

  return {
    app: BACKUP_APP_ID,
    type: PLAYLIST_EXPORT_TYPE,
    schemaVersion: PLAYLIST_EXPORT_SCHEMA_VERSION,
    appVersion: appJson?.expo?.version || '1.0.0',
    exportedAt: Date.now(),
    playlist: {
      name: detail.name,
      description: detail.description ?? null,
      customCoverBase64,
      tracks: orderedTracks.map((t, idx) => ({
        trackId: t.trackId,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        thumbnailUrl: resolveHttpThumbnailForTrack(t.trackId, t.thumbnailUrl, emptyLookup),
        position: idx,
        addedAt: t.addedAt,
      })),
    },
  };
}

async function prepareSerializedPlaylistExport(playlistId: string): Promise<{
  fileName: string;
  serialized: string;
  sizeBytes: number;
  utf8Encoding: FileSystem.EncodingType;
}> {
  const payload = await buildPlaylistExportPayload(playlistId);
  const serialized = JSON.stringify(payload, null, 2);
  const fileName = formatPlaylistExportFileName(payload.playlist.name);
  const utf8Encoding = FileSystem.EncodingType?.UTF8 ?? ('utf8' as FileSystem.EncodingType);
  return {
    fileName,
    serialized,
    sizeBytes: utf8ByteLength(serialized),
    utf8Encoding,
  };
}

/**
 * Gera o JSON da playlist e aciona o Share Sheet nativo (com fallback para Android SAF).
 */
export async function exportPlaylistToFile(playlistId: string): Promise<ExportBackupResult> {
  const { fileName, serialized, sizeBytes, utf8Encoding } =
    await prepareSerializedPlaylistExport(playlistId);
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  const fileUri = `${baseDir}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, serialized, {
    encoding: utf8Encoding,
  });

  let shared = false;
  let finalUri = fileUri;
  const canShare = await Sharing.isAvailableAsync().catch(() => false);
  if (canShare) {
    try {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: 'Compartilhar playlist do Sonary',
        UTI: 'public.json',
      });
      shared = true;
    } catch (err) {
      const savedUri = await exportViaAndroidSaf(fileName, serialized, utf8Encoding);
      if (savedUri) {
        shared = true;
        finalUri = savedUri;
      } else {
        throw err;
      }
    }
  } else {
    const savedUri = await exportViaAndroidSaf(fileName, serialized, utf8Encoding);
    if (savedUri) {
      shared = true;
      finalUri = savedUri;
    }
  }

  return {
    fileName,
    fileUri: finalUri,
    sizeBytes,
    shared,
  };
}

/**
 * Salva o JSON da playlist diretamente em uma pasta escolhida no dispositivo (Android SAF).
 */
export async function savePlaylistToDevice(playlistId: string): Promise<ExportBackupResult> {
  const saf = (FileSystem as unknown as { StorageAccessFramework?: any }).StorageAccessFramework;
  if (Platform.OS !== 'android' || !saf?.requestDirectoryPermissionsAsync) {
    return exportPlaylistToFile(playlistId);
  }

  const { fileName, serialized, sizeBytes, utf8Encoding } =
    await prepareSerializedPlaylistExport(playlistId);
  const destUri = await exportViaAndroidSaf(fileName, serialized, utf8Encoding);

  return {
    fileName,
    fileUri: destUri || '',
    sizeBytes,
    shared: Boolean(destUri),
  };
}

/**
 * Valida estritamente e normaliza um JSON de playlist individual (fronteira de confiança).
 */
export function validateAndNormalizePlaylistJson(rawJson: string): SonaryPlaylistExportV1 {
  if (typeof rawJson === 'string' && utf8ByteLength(rawJson) > MAX_PLAYLIST_FILE_BYTES) {
    throw new BackupValidationError('Arquivo de playlist excede o limite máximo permitido (5 MB).');
  }

  const root = parseJsonSafely(rawJson) as Record<string, unknown>;

  if (root.app !== BACKUP_APP_ID) {
    throw new BackupValidationError('Este arquivo não é uma playlist válida do Sonary.');
  }

  if (root.type !== PLAYLIST_EXPORT_TYPE) {
    const dataObj = root.data as Record<string, unknown> | undefined;
    if (dataObj && typeof dataObj === 'object' && Array.isArray(dataObj.playlists)) {
      throw new BackupValidationError(
        'Este arquivo é um backup completo do Sonary. Use "Backup e dados" no menu para restaurá-lo.'
      );
    }
    throw new BackupValidationError('Este arquivo não é uma playlist válida do Sonary.');
  }

  if (root.schemaVersion !== PLAYLIST_EXPORT_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `Versão de playlist não suportada (v${String(root.schemaVersion ?? '?')}). Atualize o Sonary.`
    );
  }

  if (!root.playlist || typeof root.playlist !== 'object' || Array.isArray(root.playlist)) {
    throw new BackupValidationError('Dados da playlist ausentes ou inválidos no arquivo.');
  }

  const now = Date.now();
  const plObj = root.playlist as Record<string, unknown>;
  const name = sanitizeText(plObj.name, 200, 'Playlist Importada');
  const description = sanitizeOptionalText(plObj.description, 1000);

  let customCoverBase64: string | null = null;
  if (typeof plObj.customCoverBase64 === 'string') {
    const validImg = validateImageBase64(plObj.customCoverBase64);
    if (validImg) {
      customCoverBase64 = validImg.base64;
    }
  }

  if (!Array.isArray(plObj.tracks)) {
    throw new BackupValidationError('Lista de faixas inválida no arquivo da playlist.');
  }
  if (plObj.tracks.length > MAX_TRACKS_PER_PLAYLIST) {
    throw new BackupValidationError(
      `Playlist "${name}" excede o limite de ${MAX_TRACKS_PER_PLAYLIST} faixas.`
    );
  }

  const seenTrackIds = new Set<string>();
  const tracks: SonaryBackupTrackV1[] = [];
  for (let idx = 0; idx < plObj.tracks.length; idx += 1) {
    const rawTrack = plObj.tracks[idx];
    if (!rawTrack || typeof rawTrack !== 'object' || Array.isArray(rawTrack)) continue;
    const tObj = rawTrack as Record<string, unknown>;
    const trackId = sanitizeSafeId(tObj.trackId ?? tObj.id);
    if (!trackId || isLocalDeviceTrackId(trackId) || seenTrackIds.has(trackId)) continue;
    seenTrackIds.add(trackId);

    const posNum = Number(tObj.position);
    tracks.push({
      trackId,
      title: sanitizeText(tObj.title, 200, 'Música'),
      artist: sanitizeText(tObj.artist, 200, 'Artista'),
      duration: sanitizeDuration(tObj.duration),
      thumbnailUrl: sanitizeHttpUrl(tObj.thumbnailUrl),
      position: Number.isFinite(posNum) && posNum >= 0 ? Math.floor(posNum) : idx,
      addedAt: sanitizeTimestamp(tObj.addedAt, now),
    });
  }

  return {
    app: BACKUP_APP_ID,
    type: PLAYLIST_EXPORT_TYPE,
    schemaVersion: PLAYLIST_EXPORT_SCHEMA_VERSION,
    appVersion: sanitizeText(root.appVersion, 32, '1.0.0'),
    exportedAt: sanitizeTimestamp(root.exportedAt, now),
    playlist: {
      name,
      description,
      customCoverBase64,
      tracks,
    },
  };
}

/**
 * Calcula pré-visualização da playlist antes da importação.
 */
export async function getPlaylistImportPreview(
  exported: SonaryPlaylistExportV1
): Promise<PlaylistImportPreview> {
  const { playlist } = exported;
  const trackIds = playlist.tracks.map((t) => t.trackId);
  const alreadyDownloaded = await getVerifiedDownloadedTrackIds(trackIds);
  const activeQueuedIds = new Set(
    getDownloadQueue()
      .filter((i) => i.status === 'pending' || i.status === 'downloading')
      .map((i) => i.track.id)
  );
  const offlineMissingCount = trackIds.filter(
    (id) => !alreadyDownloaded.has(id) && !activeQueuedIds.has(id)
  ).length;

  const validCover = playlist.customCoverBase64
    ? validateImageBase64(playlist.customCoverBase64)
    : null;
  const customCoverDataUri = validCover
    ? `data:image/${validCover.ext === 'png' ? 'png' : 'jpeg'};base64,${validCover.base64}`
    : null;
  const coverThumbnails = customCoverDataUri
    ? []
    : [...playlist.tracks]
        .sort((a, b) => a.position - b.position)
        .map((t) => t.thumbnailUrl)
        .filter((uri): uri is string => Boolean(uri))
        .slice(0, 4);
  const totalDuration = playlist.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);

  return {
    appVersion: exported.appVersion,
    exportedAt: exported.exportedAt,
    name: playlist.name,
    description: playlist.description,
    trackCount: playlist.tracks.length,
    totalDuration,
    hasCustomCover: Boolean(customCoverDataUri),
    customCoverDataUri,
    coverThumbnails,
    offlineMissingCount,
  };
}

/**
 * Abre o seletor de documentos nativo, valida tamanho/schema e retorna a playlist para preview.
 */
export async function pickPlaylistFile(): Promise<PickedPlaylistResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled || !picked.assets || picked.assets.length === 0) {
    return null;
  }

  const asset = picked.assets[0];
  if (!asset?.uri) {
    throw new BackupValidationError('Não foi possível acessar o arquivo selecionado.');
  }

  if (typeof asset.size === 'number' && asset.size > MAX_PLAYLIST_FILE_BYTES) {
    throw new BackupValidationError('Arquivo excede o limite máximo permitido (5 MB).');
  }

  const info = await FileSystem.getInfoAsync(asset.uri);
  if (info.exists && typeof info.size === 'number' && info.size > MAX_PLAYLIST_FILE_BYTES) {
    throw new BackupValidationError('Arquivo excede o limite máximo permitido (5 MB).');
  }

  const utf8Encoding = FileSystem.EncodingType?.UTF8 ?? ('utf8' as FileSystem.EncodingType);
  const rawJson = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: utf8Encoding,
  });

  const exported = validateAndNormalizePlaylistJson(rawJson);
  const preview = await getPlaylistImportPreview(exported);

  return {
    fileName: asset.name || 'sonary-playlist.json',
    sizeBytes: utf8ByteLength(rawJson),
    exported,
    preview,
  };
}

/**
 * Cria sempre uma nova playlist a partir de um JSON validado, com rollback de capa em caso de erro.
 */
export async function importPlaylistFromExport(
  exported: SonaryPlaylistExportV1,
  options: ImportPlaylistOptions = {}
): Promise<ImportPlaylistResult> {
  await ensureStorageDirectories();
  const base64Encoding = FileSystem.EncodingType?.Base64 ?? ('base64' as FileSystem.EncodingType);
  let createdCoverUri: string | null = null;

  let playlist: PlaylistSummary;
  try {
    if (exported.playlist.customCoverBase64) {
      const valid = validateImageBase64(exported.playlist.customCoverBase64);
      if (valid) {
        const destUri = `${PLAYLIST_COVERS_DIRECTORY}imp_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 8)}.${valid.ext}`;
        await FileSystem.writeAsStringAsync(destUri, valid.base64, {
          encoding: base64Encoding,
        });
        createdCoverUri = destUri;
      }
    }

    const finalName =
      typeof options.nameOverride === 'string' && options.nameOverride.trim()
        ? sanitizeText(options.nameOverride, 200, exported.playlist.name)
        : exported.playlist.name;

    playlist = await createPlaylistWithTracks({
      name: finalName,
      description: exported.playlist.description,
      customCoverUri: createdCoverUri,
      tracks: exported.playlist.tracks,
    });
  } catch (err) {
    if (createdCoverUri) {
      await deletePlaylistCover(createdCoverUri).catch(() => {});
    }
    throw err;
  }

  let enqueuedOfflineCount = 0;
  if (options.enqueueOfflineDownloads && exported.playlist.tracks.length > 0) {
    const trackIds = exported.playlist.tracks.map((t) => t.trackId);
    const alreadyDownloaded = await getVerifiedDownloadedTrackIds(trackIds);
    const activeQueuedIds = new Set(
      getDownloadQueue()
        .filter((i) => i.status === 'pending' || i.status === 'downloading')
        .map((i) => i.track.id)
    );
    const emptyLookup = new Map<string, string>();
    const missingTracks = exported.playlist.tracks
      .filter((t) => !alreadyDownloaded.has(t.trackId) && !activeQueuedIds.has(t.trackId))
      .map((t) => ({
        id: t.trackId,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        formattedDuration: formatDurationSeconds(t.duration),
        thumbnailUrl: resolveHttpThumbnailForTrack(t.trackId, t.thumbnailUrl, emptyLookup),
      }));
    if (missingTracks.length > 0) {
      const res = enqueuePlaylistDownload(missingTracks);
      enqueuedOfflineCount = res.enqueuedCount;
    }
  }

  return {
    playlist,
    restoredCustomCover: Boolean(createdCoverUri),
    enqueuedOfflineCount,
  };
}
