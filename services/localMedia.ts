import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import {
  deleteLocalDeviceTrackRecord,
  getAppSetting,
  getLocalDeviceTracks,
  isLocalDeviceTrackId,
  LOCAL_TRACK_ID_PREFIX,
  LocalDeviceTrack,
  LocalDeviceTrackUpsertInput,
  markLocalTrackCorrupted,
  restoreAllHiddenLocalTracks,
  setAppSetting,
  setLocalTrackHidden,
  syncLocalDeviceTracks,
  updateLocalTrackMetadata,
} from './database';
import { deleteLocalTrackCover, saveLocalTrackCover } from './storage';
import { extractTrackMetadata } from './trackMetadata';

export { isLocalDeviceTrackId, LOCAL_TRACK_ID_PREFIX };
export type { LocalDeviceTrack };

export type DownloadsSortMode = 'recent' | 'title' | 'artist';

const LOCAL_MEDIA_ENABLED_KEY = 'local_media_enabled';
const LOCAL_MEDIA_EXCLUDED_FOLDERS_KEY = 'local_media_excluded_folders';
const DOWNLOADS_SORT_MODE_KEY = 'downloads_sort_mode';

/**
 * Pastas de ruído padrão filtradas na primeira ativação (usuário pode reabilitar a qualquer momento).
 */
export const DEFAULT_EXCLUDED_LOCAL_FOLDERS = [
  'WhatsApp Voice Notes',
  'WhatsApp Audio',
  'Call',
  'Call Recordings',
  'Voice Recorder',
] as const;

const PLACEHOLDER_META_REGEX =
  /^(?:<unknown>|unknown(?:\s+artist|\s+album)?|desconhecido|artista\s+desconhecido|null|undefined|none|n\/a|\?+|-+)$/i;

const AUDIO_EXT_REGEX = /\.(?:mp3|m4a|aac|flac|ogg|opus|wav|wma|webm|3gp|amr|alac|aiff)$/i;
const TRACK_NUMBER_PREFIX_REGEX = /^\s*(?:\d{1,3}\s*(?:[-.)]\s+|_+)|\[\d{1,3}\]\s*)/;
const DOWNLOAD_JUNK_TAGS_REGEX =
  /\s*(?:\[[^\]]*(?:kbps|mp3|flac|m4a|official|audio|video|lyric|hd|4k|hq|320k|256k|192k|128k|youtube|ytmp3|snaptube|spotidown)[^\]]*\]|\([^)]*(?:kbps|mp3|flac|m4a|official(?:\s+(?:music\s*)?(?:audio|video))?|lyric\s*video|áudio\s*oficial|vídeo\s*oficial|clipe\s*oficial|320k|256k|192k|128k|youtube|ytmp3|snaptube|mp3_\d+k)[^)]*\))/gi;

export interface RawScannedLocalAudio {
  id: string;
  mediaStoreId: string;
  contentUri: string;
  fileName: string;
  folderName: string;
  relativePath: string;
  mimeType?: string;
  fileSize: number;
  dateModified: number;
  unchanged?: boolean;
  isCorrupted?: boolean;
  corruptionReason?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number;
  artworkUri?: string | null;
}

export interface NativeLocalMediaSpec {
  scanDeviceAudio: (cachedSignaturesJson: string | null) => Promise<RawScannedLocalAudio[]>;
  verifyTrackPlayable: (
    contentUri: string,
    mediaStoreId: string
  ) => Promise<{
    isCorrupted: boolean;
    corruptionReason: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    duration: number;
    artworkUri: string | null;
  }>;
  requestDeleteMedia: (contentUri: string) => Promise<{
    deleted: boolean;
    cancelled: boolean;
  }>;
}

function getNativeLocalMedia(): NativeLocalMediaSpec | null {
  if (Platform.OS !== 'android') return null;
  const mod = (NativeModules as Record<string, unknown> | undefined)?.SonaryLocalMedia;
  if (mod && typeof mod === 'object' && typeof (mod as any).scanDeviceAudio === 'function') {
    return mod as NativeLocalMediaSpec;
  }
  return null;
}

export function isLocalMediaModuleAvailable(): boolean {
  return getNativeLocalMedia() !== null;
}

function getRequiredAudioPermission(): string {
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version || '0'), 10);
  if (apiLevel >= 33) {
    return (
      (PermissionsAndroid.PERMISSIONS as Record<string, string>).READ_MEDIA_AUDIO ||
      'android.permission.READ_MEDIA_AUDIO'
    );
  }
  return (
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE ||
    'android.permission.READ_EXTERNAL_STORAGE'
  );
}

export async function checkLocalAudioPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const permission = getRequiredAudioPermission();
    if (typeof PermissionsAndroid.check === 'function') {
      return await PermissionsAndroid.check(permission as any);
    }
    return false;
  } catch {
    return false;
  }
}

export async function requestLocalAudioPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const permission = getRequiredAudioPermission();
    const granted = await PermissionsAndroid.request(permission as any, {
      title: 'Acessar músicas do dispositivo',
      message:
        'O Sonary precisa de permissão para encontrar e reproduzir arquivos de áudio já salvos no seu aparelho.',
      buttonPositive: 'Permitir',
      buttonNegative: 'Agora não',
    });
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function isUsableMetaValue(value?: string | null): value is string {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_META_REGEX.test(trimmed);
}

/**
 * Limpa o nome de um arquivo de áudio para extrair título/artista legíveis
 * quando as tags ID3/MP4/Vorbis estão ausentes ou poluídas.
 */
export function cleanAudioFileName(fileName: string): string {
  let cleaned = String(fileName || '')
    .trim()
    .replace(AUDIO_EXT_REGEX, '')
    .replace(DOWNLOAD_JUNK_TAGS_REGEX, '')
    .replace(TRACK_NUMBER_PREFIX_REGEX, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    cleaned = String(fileName || '').replace(AUDIO_EXT_REGEX, '').trim() || 'Áudio local';
  }
  return cleaned;
}

/**
 * Resolve título e artista limpos para um arquivo local com cadeia de fallback:
 * 1. Tags reais (MediaMetadataRetriever / MediaStore), ignorando `<unknown>`
 * 2. Parser de nome do arquivo ("Artista - Música" via extractTrackMetadata)
 * 3. Nome limpo do arquivo + "Artista desconhecido"
 */
export function resolveLocalTrackMetadata(input: {
  title?: string | null;
  artist?: string | null;
  fileName: string;
}): { title: string; artist: string } {
  const cleanedFileName = cleanAudioFileName(input.fileName);
  const hasRealTitle = isUsableMetaValue(input.title);
  const hasRealArtist = isUsableMetaValue(input.artist);

  if (hasRealTitle && hasRealArtist) {
    return {
      title: input.title!.trim(),
      artist: input.artist!.trim(),
    };
  }

  const fromName = extractTrackMetadata(cleanedFileName, hasRealArtist ? input.artist! : '');
  const looksLikeSplitFromName =
    cleanedFileName.includes(' - ') ||
    cleanedFileName.includes(' – ') ||
    cleanedFileName.includes(' — ');

  let finalTitle = hasRealTitle
    ? input.title!.trim()
    : looksLikeSplitFromName && fromName.cleanTitle
      ? fromName.cleanTitle
      : cleanedFileName;

  let finalArtist = hasRealArtist
    ? input.artist!.trim()
    : looksLikeSplitFromName &&
        fromName.primaryArtist &&
        fromName.primaryArtist !== 'Artista'
      ? fromName.primaryArtist
      : 'Artista desconhecido';

  if (!hasRealArtist && hasRealTitle && /\s+[-–—]\s+/.test(input.title!)) {
    const fromTitleTag = extractTrackMetadata(input.title!, '');
    if (fromTitleTag.primaryArtist && fromTitleTag.primaryArtist !== 'Artista') {
      finalArtist = fromTitleTag.primaryArtist;
      finalTitle = fromTitleTag.cleanTitle || finalTitle;
    }
  }

  return {
    title: finalTitle || cleanedFileName || 'Áudio local',
    artist: finalArtist || 'Artista desconhecido',
  };
}

export async function isLocalMediaEnabled(): Promise<boolean> {
  try {
    const val = await getAppSetting(LOCAL_MEDIA_ENABLED_KEY);
    return val === '1';
  } catch {
    return false;
  }
}

export async function setLocalMediaEnabled(enabled: boolean): Promise<void> {
  await setAppSetting(LOCAL_MEDIA_ENABLED_KEY, enabled ? '1' : '0');
}

export async function getExcludedLocalFolders(): Promise<string[]> {
  try {
    const raw = await getAppSetting(LOCAL_MEDIA_EXCLUDED_FOLDERS_KEY);
    if (raw === null) {
      return [...DEFAULT_EXCLUDED_LOCAL_FOLDERS];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
    return [...DEFAULT_EXCLUDED_LOCAL_FOLDERS];
  } catch {
    return [...DEFAULT_EXCLUDED_LOCAL_FOLDERS];
  }
}

export async function setExcludedLocalFolders(folders: string[]): Promise<void> {
  const unique = Array.from(new Set(folders.map((f) => f.trim()).filter(Boolean)));
  await setAppSetting(LOCAL_MEDIA_EXCLUDED_FOLDERS_KEY, JSON.stringify(unique));
}

export async function getDownloadsSortMode(): Promise<DownloadsSortMode> {
  try {
    const raw = await getAppSetting(DOWNLOADS_SORT_MODE_KEY);
    if (raw === 'title' || raw === 'artist' || raw === 'recent') {
      return raw;
    }
    return 'recent';
  } catch {
    return 'recent';
  }
}

export async function setDownloadsSortMode(mode: DownloadsSortMode): Promise<void> {
  await setAppSetting(DOWNLOADS_SORT_MODE_KEY, mode);
}

export interface LocalFolderInfo {
  folderName: string;
  validCount: number;
  corruptedCount: number;
  totalCount: number;
  isExcluded: boolean;
}

export function buildLocalFoldersSummary(
  tracks: LocalDeviceTrack[],
  excludedFolders: string[]
): LocalFolderInfo[] {
  const excludedLower = new Set(excludedFolders.map((f) => f.toLowerCase()));
  const byFolder = new Map<string, LocalFolderInfo>();

  for (const track of tracks) {
    const folder = track.folderName || 'Armazenamento';
    let entry = byFolder.get(folder);
    if (!entry) {
      entry = {
        folderName: folder,
        validCount: 0,
        corruptedCount: 0,
        totalCount: 0,
        isExcluded: excludedLower.has(folder.toLowerCase()),
      };
      byFolder.set(folder, entry);
    }
    entry.totalCount += 1;
    if (track.isCorrupted) {
      entry.corruptedCount += 1;
    } else {
      entry.validCount += 1;
    }
  }

  return Array.from(byFolder.values()).sort((a, b) => {
    if (a.isExcluded !== b.isExcluded) return a.isExcluded ? 1 : -1;
    return b.totalCount - a.totalCount || a.folderName.localeCompare(b.folderName);
  });
}

export interface LocalMediaScanResult {
  tracks: LocalDeviceTrack[];
  validCount: number;
  corruptedCount: number;
  folders: LocalFolderInfo[];
  scannedAt: number;
}

/**
 * Executa varredura incremental via MediaStore nativo, normaliza metadados faltantes,
 * detecta arquivos corrompidos e sincroniza o catálogo no SQLite.
 */
export async function scanAndSyncLocalDeviceAudio(): Promise<LocalMediaScanResult> {
  const excludedFolders = await getExcludedLocalFolders();
  const nativeMod = getNativeLocalMedia();
  if (!nativeMod) {
    const existing = await getLocalDeviceTracks({ includeHidden: false, includeCorrupted: true });
    return {
      tracks: existing,
      validCount: existing.filter((t) => !t.isCorrupted).length,
      corruptedCount: existing.filter((t) => t.isCorrupted).length,
      folders: buildLocalFoldersSummary(existing, excludedFolders),
      scannedAt: Date.now(),
    };
  }

  const existingAll = await getLocalDeviceTracks({ includeHidden: true, includeCorrupted: true });
  const existingById = new Map<string, LocalDeviceTrack>(existingAll.map((t) => [t.id, t]));
  const cachedSignatures: Record<string, { dateModified: number; fileSize: number }> = {};
  for (const track of existingAll) {
    cachedSignatures[track.id] = {
      dateModified: track.dateModified,
      fileSize: track.fileSize,
    };
  }

  const rawItems = await nativeMod.scanDeviceAudio(
    Object.keys(cachedSignatures).length > 0 ? JSON.stringify(cachedSignatures) : null
  );
  const now = Date.now();

  const upsertRows: LocalDeviceTrackUpsertInput[] = [];
  for (const item of rawItems || []) {
    if (!item || !item.id || !item.contentUri) continue;
    const prev = existingById.get(item.id);
    if (item.unchanged && prev) {
      upsertRows.push({
        id: prev.id,
        mediaStoreId: prev.mediaStoreId,
        contentUri: item.contentUri || prev.contentUri,
        fileName: item.fileName || prev.fileName,
        folderName: item.folderName || prev.folderName,
        relativePath: item.relativePath || prev.relativePath,
        mimeType: item.mimeType || prev.mimeType,
        fileSize: item.fileSize ?? prev.fileSize,
        dateModified: item.dateModified ?? prev.dateModified,
        title: prev.rawTitle,
        artist: prev.rawArtist,
        album: prev.album,
        duration: prev.duration,
        artworkUri: prev.artworkUri,
        isCorrupted: prev.isCorrupted,
        corruptionReason: prev.corruptionReason,
        scannedAt: now,
      });
      continue;
    }

    const resolved = resolveLocalTrackMetadata({
      title: item.title,
      artist: item.artist,
      fileName: item.fileName || item.id,
    });

    upsertRows.push({
      id: item.id,
      mediaStoreId: item.mediaStoreId,
      contentUri: item.contentUri,
      fileName: item.fileName || item.id,
      folderName: item.folderName || 'Armazenamento',
      relativePath: item.relativePath || '',
      mimeType: item.mimeType || '',
      fileSize: Number(item.fileSize || 0),
      dateModified: Number(item.dateModified || 0),
      title: resolved.title,
      artist: resolved.artist,
      album: isUsableMetaValue(item.album) ? item.album.trim() : null,
      duration: Math.max(0, Math.floor(Number(item.duration || 0))),
      artworkUri: item.artworkUri || null,
      isCorrupted: Boolean(item.isCorrupted),
      corruptionReason: item.isCorrupted
        ? item.corruptionReason || 'Arquivo corrompido ou formato incompatível'
        : null,
      scannedAt: now,
    });
  }

  const synced = await syncLocalDeviceTracks(upsertRows);
  return {
    tracks: synced,
    validCount: synced.filter((t) => !t.isCorrupted).length,
    corruptedCount: synced.filter((t) => t.isCorrupted).length,
    folders: buildLocalFoldersSummary(synced, excludedFolders),
    scannedAt: now,
  };
}

/**
 * Revalida um arquivo local individualmente para checar se voltou a ficar legível ou segue corrompido.
 */
export async function revalidateLocalTrack(
  track: LocalDeviceTrack
): Promise<{ isCorrupted: boolean; corruptionReason: string | null }> {
  const nativeMod = getNativeLocalMedia();
  if (!nativeMod) {
    return {
      isCorrupted: track.isCorrupted,
      corruptionReason: track.corruptionReason,
    };
  }
  const result = await nativeMod.verifyTrackPlayable(track.contentUri, track.mediaStoreId);
  const isCorrupted = Boolean(result?.isCorrupted);
  const reason = isCorrupted
    ? result?.corruptionReason || 'Arquivo corrompido ou formato incompatível'
    : null;
  if (!isCorrupted) {
    const resolved = resolveLocalTrackMetadata({
      title: result?.title,
      artist: result?.artist,
      fileName: track.fileName || track.id,
    });
    await markLocalTrackCorrupted(track.id, false, null, {
      title: resolved.title,
      artist: resolved.artist,
      album: isUsableMetaValue(result?.album) ? result!.album!.trim() : track.album,
      duration: Math.max(0, Math.floor(Number(result?.duration || 0))),
      artworkUri: result?.artworkUri ?? track.artworkUri,
    });
  } else {
    await markLocalTrackCorrupted(track.id, true, reason);
  }
  return { isCorrupted, corruptionReason: reason };
}

/**
 * Salva edição manual de Título, Artista e Capa (opcional) de uma música local no SQLite.
 */
export async function saveLocalTrackMetadataEdit(
  track: LocalDeviceTrack,
  payload: {
    title?: string | null;
    artist?: string | null;
    customCoverSourceUri?: string;
    resetCustomCover?: boolean;
    resetAllMetadata?: boolean;
  }
): Promise<LocalDeviceTrack | null> {
  if (payload.resetAllMetadata) {
    if (track.customArtworkUri) {
      await deleteLocalTrackCover(track.customArtworkUri).catch(() => {});
    }
    return updateLocalTrackMetadata(track.id, {
      customTitle: null,
      customArtist: null,
      customArtworkUri: null,
    });
  }

  let nextCoverUri: string | null | undefined = undefined;
  if (payload.resetCustomCover) {
    if (track.customArtworkUri) {
      await deleteLocalTrackCover(track.customArtworkUri).catch(() => {});
    }
    nextCoverUri = null;
  } else if (payload.customCoverSourceUri) {
    nextCoverUri = await saveLocalTrackCover(track.id, payload.customCoverSourceUri);
  }

  return updateLocalTrackMetadata(track.id, {
    customTitle: payload.title !== undefined ? payload.title : undefined,
    customArtist: payload.artist !== undefined ? payload.artist : undefined,
    customArtworkUri: nextCoverUri,
  });
}

/**
 * Oculta a faixa local da biblioteca do Sonary sem tocar no arquivo físico do celular.
 */
export async function hideLocalTrackFromLibrary(trackId: string): Promise<void> {
  await setLocalTrackHidden(trackId, true);
}

/**
 * Restaura todas as faixas locais ocultadas manualmente.
 */
export async function restoreHiddenLocalTracks(): Promise<void> {
  await restoreAllHiddenLocalTracks();
}

/**
 * Solicita ao Android (via diálogo nativo de confirmação) a exclusão física do arquivo no dispositivo.
 * Só remove o registro do SQLite se a exclusão física for confirmada e bem-sucedida.
 */
export async function deleteLocalTrackFromDevice(
  track: LocalDeviceTrack
): Promise<{ deleted: boolean; cancelled: boolean }> {
  const nativeMod = getNativeLocalMedia();
  if (!nativeMod) {
    throw new Error('Exclusão física disponível apenas no aplicativo Android instalado.');
  }
  const result = await nativeMod.requestDeleteMedia(track.contentUri);
  if (result?.deleted) {
    if (track.customArtworkUri) {
      await deleteLocalTrackCover(track.customArtworkUri).catch(() => {});
    }
    await deleteLocalDeviceTrackRecord(track.id);
    return { deleted: true, cancelled: false };
  }
  return { deleted: false, cancelled: Boolean(result?.cancelled) };
}
