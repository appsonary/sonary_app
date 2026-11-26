import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as api from './api';
import { TrackSummary } from './api';
import {
  saveDownloadedTrack,
  deleteDownloadedTrack as deleteDownloadedTrackFromDb,
  isDownloaded as isDownloadedInDb,
  getDownloadedTrackById,
  getDownloadedTracks,
  DownloadedTrack,
  getPersistedDownloadQueue,
  upsertPersistedDownloadQueueItem,
  upsertPersistedDownloadQueueBatch,
  updatePersistedDownloadQueueState,
  resetInterruptedDownloadsToPending,
  removePersistedDownloadQueueItem,
  clearPersistedFinishedDownloads,
  clearPersistedCompletedDownloads,
  clearPersistedActiveDownloads,
} from './database';

export type { DownloadedTrack };

/**
 * Camada de Armazenamento Local (App-Scoped Storage)
 * 
 * Utiliza FileSystem.documentDirectory para compatibilidade total com
 * Android 10+ (Scoped Storage / API 29+), garantindo isolamento de sandbox
 * e dispensando permissões invasivas como WRITE_EXTERNAL_STORAGE.
 */

const AUDIO_DIRECTORY = `${FileSystem.documentDirectory}tracks/`;
const THUMBNAIL_DIRECTORY = `${FileSystem.documentDirectory}thumbnails/`;
export const PLAYLIST_COVERS_DIRECTORY = `${FileSystem.documentDirectory}playlist_covers/`;
const MAX_LOCAL_URI_CACHE = 500;
const localUriCache = new Map<string, string | null>();
let lastFsGeneration: number | undefined = undefined;

function syncFileSystemGeneration(): void {
  const fsAny = FileSystem as { getFileSystemGeneration?: () => number };
  if (typeof fsAny.getFileSystemGeneration === 'function') {
    const gen = fsAny.getFileSystemGeneration();
    if (lastFsGeneration !== undefined && gen !== lastFsGeneration) {
      localUriCache.clear();
    }
    lastFsGeneration = gen;
  }
}

function setLocalUriCache(videoId: string, uri: string | null): void {
  localUriCache.delete(videoId);
  localUriCache.set(videoId, uri);
  if (localUriCache.size > MAX_LOCAL_URI_CACHE) {
    const oldestKey = localUriCache.keys().next().value;
    if (oldestKey !== undefined) {
      localUriCache.delete(oldestKey);
    }
  }
}

/**
 * Limpa o cache em memória de URIs locais.
 */
export function clearStorageCache(): void {
  localUriCache.clear();
}

/**
 * Garante que os diretórios locais existam na inicialização.
 */
export async function ensureStorageDirectories(): Promise<void> {
  const audioDirInfo = await FileSystem.getInfoAsync(AUDIO_DIRECTORY);
  if (!audioDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIRECTORY, { intermediates: true });
  }

  const thumbDirInfo = await FileSystem.getInfoAsync(THUMBNAIL_DIRECTORY);
  if (!thumbDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(THUMBNAIL_DIRECTORY, { intermediates: true });
  }

  const coversDirInfo = await FileSystem.getInfoAsync(PLAYLIST_COVERS_DIRECTORY);
  if (!coversDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(PLAYLIST_COVERS_DIRECTORY, { intermediates: true });
  }
}

export interface PickedCoverAsset {
  uri: string;
  width: number;
  height: number;
}

export interface CoverCropParams {
  rotation?: number;
  flipHorizontal?: boolean;
  crop?: {
    originX: number;
    originY: number;
    width: number;
    height: number;
  };
}

/**
 * Solicita permissão à galeria e abre o seletor nativo sem o editor UCrop padrão,
 * permitindo usar o recortador integrado com o visual do Sonary.
 */
export async function pickPlaylistCoverFromGallery(): Promise<PickedCoverAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error(
      'Permissão de acesso à galeria negada. Habilite nas configurações do dispositivo para escolher uma capa.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset.uri) return null;

  return {
    uri: asset.uri,
    width: asset.width || 0,
    height: asset.height || 0,
  };
}

/**
 * Aplica rotação, espelhamento e recorte 1:1 escolhidos no recortador customizado,
 * gerando uma imagem JPEG 600x600 pronta para preview ou gravação definitiva.
 */
export async function cropPlaylistCoverImage(
  sourceUri: string,
  params: CoverCropParams = {}
): Promise<string> {
  const actions: ImageManipulator.Action[] = [];

  const normalizedRot = ((params.rotation || 0) % 360 + 360) % 360;
  if (normalizedRot !== 0) {
    actions.push({ rotate: normalizedRot });
  }
  if (params.flipHorizontal) {
    actions.push({ flip: ImageManipulator.FlipType.Horizontal });
  }
  if (params.crop && params.crop.width > 0 && params.crop.height > 0) {
    actions.push({ crop: params.crop });
  }
  actions.push({ resize: { width: 600, height: 600 } });

  const manipulated = await ImageManipulator.manipulateAsync(
    sourceUri,
    actions,
    { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG }
  );

  return manipulated.uri;
}

/**
 * Redimensiona a capa selecionada para 600x600 JPEG, salva em storage app-scoped
 * e remove capas anteriores da mesma playlist.
 */
export async function savePlaylistCover(
  playlistId: string,
  sourceUri: string
): Promise<string> {
  await ensureStorageDirectories();

  const manipulated = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: 600, height: 600 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  );

  const safeId = playlistId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const destUri = `${PLAYLIST_COVERS_DIRECTORY}${safeId}_${Date.now()}.jpg`;

  // Remove capas anteriores desta playlist para evitar acúmulo em disco
  try {
    const existingFiles = await FileSystem.readDirectoryAsync(PLAYLIST_COVERS_DIRECTORY);
    for (const filename of existingFiles) {
      if (filename.startsWith(`${safeId}_`)) {
        await FileSystem.deleteAsync(`${PLAYLIST_COVERS_DIRECTORY}${filename}`, {
          idempotent: true,
        });
      }
    }
  } catch { }

  await FileSystem.moveAsync({ from: manipulated.uri, to: destUri });
  return destUri;
}

/**
 * Remove um arquivo de capa customizada local caso pertença ao diretório da app.
 */
export async function deletePlaylistCover(
  coverUri?: string | null
): Promise<void> {
  if (!coverUri || !coverUri.startsWith(PLAYLIST_COVERS_DIRECTORY)) {
    return;
  }
  await FileSystem.deleteAsync(coverUri, { idempotent: true });
}

export interface LocalDownloadedTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  localAudioUri: string;
  localArtworkUri?: string;
  fileSizeBytes: number;
  downloadedAt: number;
}

const MIN_FREE_DISK_BYTES = 25 * 1024 * 1024; // Mínimo de 25 MB livres para novo download

export class DownloadCancelledError extends Error {
  constructor(trackId?: string) {
    super(trackId ? `Download cancelado (${trackId})` : 'Download cancelado');
    this.name = 'DownloadCancelledError';
  }
}

export interface DownloadTrackFileOptions {
  onResumableCreated?: (resumable: FileSystem.DownloadResumable) => void;
  shouldAbort?: () => boolean;
}

/**
 * Realiza o download de uma faixa com suporte a Scoped Storage, gravação atômica (.part -> .m4a) e persistência SQLite.
 */
export async function downloadTrackFile(
  track: TrackSummary,
  streamUrl: string,
  onProgress?: (progressPercentage: number) => void,
  headers?: Record<string, string>,
  options?: DownloadTrackFileOptions
): Promise<LocalDownloadedTrack> {
  await ensureStorageDirectories();

  if (options?.shouldAbort?.()) {
    throw new DownloadCancelledError(track.id);
  }

  // 1. Verificação prévia de capacidade de armazenamento livre
  try {
    const freeDiskBytes = await FileSystem.getFreeDiskStorageAsync();
    if (freeDiskBytes < MIN_FREE_DISK_BYTES) {
      const freeMb = Math.round(freeDiskBytes / (1024 * 1024));
      throw new Error(
        `Espaço em disco insuficiente (${freeMb} MB disponíveis). Libere espaço para baixar músicas.`
      );
    }
  } catch (diskErr) {
    if (diskErr instanceof Error && diskErr.message.includes('Espaço em disco')) {
      throw diskErr;
    }
  }

  const partAudioUri = `${AUDIO_DIRECTORY}${track.id}.part`;
  const finalAudioUri = `${AUDIO_DIRECTORY}${track.id}.m4a`;
  const partArtworkUri = `${THUMBNAIL_DIRECTORY}${track.id}.part.jpg`;
  const finalArtworkUri = `${THUMBNAIL_DIRECTORY}${track.id}.jpg`;

  // Limpa qualquer arquivo parcial residual anterior antes de iniciar
  await FileSystem.deleteAsync(partAudioUri, { idempotent: true });

  let expectedTotalBytes = 0;

  const requestHeaders =
    headers && Object.keys(headers).length > 0 ? { ...headers } : undefined;

  // Download do arquivo de áudio gravando inicialmente no arquivo temporário .part
  const downloadResumable = FileSystem.createDownloadResumable(
    streamUrl,
    partAudioUri,
    requestHeaders ? { headers: requestHeaders } : {},
    (downloadProgress) => {
      if (downloadProgress.totalBytesExpectedToWrite > 0) {
        expectedTotalBytes = downloadProgress.totalBytesExpectedToWrite;
        if (onProgress) {
          const progress =
            downloadProgress.totalBytesWritten /
            downloadProgress.totalBytesExpectedToWrite;
          onProgress(Math.min(1, Math.max(0, progress)));
        }
      }
    }
  );
  options?.onResumableCreated?.(downloadResumable);

  if (options?.shouldAbort?.()) {
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw new DownloadCancelledError(track.id);
  }

  let downloadResult: FileSystem.FileSystemDownloadResult | undefined;
  try {
    downloadResult = await downloadResumable.downloadAsync();
  } catch (downloadErr) {
    // Garante que nenhum fragmento corrompido permaneça no disco em caso de cancelamento/falha
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    if (options?.shouldAbort?.()) {
      throw new DownloadCancelledError(track.id);
    }
    throw downloadErr;
  }

  if (options?.shouldAbort?.()) {
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw new DownloadCancelledError(track.id);
  }

  if (!downloadResult || !downloadResult.uri) {
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw new Error(`Falha no download da faixa "${track.title}" (ID: ${track.id})`);
  }

  // Validação estrita de status HTTP retornado pelo servidor
  if (downloadResult.status < 200 || downloadResult.status >= 300) {
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw new Error(
      `Servidor de mídia rejeitou a transmissão com HTTP ${downloadResult.status} (restrição de direitos autorais ou geolocalização).`
    );
  }

  // Validação estrita do arquivo temporário em disco (mínimo 10 KB para áudio válido)
  const fileInfo = await FileSystem.getInfoAsync(partAudioUri);
  if (!fileInfo.exists || fileInfo.size < 10240) {
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw new Error(
      `Arquivo baixado inválido ou vazio (${fileInfo.exists ? fileInfo.size : 0} bytes).`
    );
  }

  // Se o servidor enviou o Content-Length, garante que o arquivo não foi truncado prematuramente
  if (expectedTotalBytes > 20480 && fileInfo.size < expectedTotalBytes * 0.95) {
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw new Error(
      `Download incompleto (${fileInfo.size} de ${expectedTotalBytes} bytes recebidos).`
    );
  }

  if (options?.shouldAbort?.()) {
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw new DownloadCancelledError(track.id);
  }

  // Promove atomicamente o arquivo temporário .part para .m4a final
  await FileSystem.deleteAsync(finalAudioUri, { idempotent: true });
  await FileSystem.moveAsync({
    from: partAudioUri,
    to: finalAudioUri,
  });

  // Download do thumbnail para cache offline permanente com gravação segura
  let savedArtworkUri: string | undefined = undefined;
  if (track.thumbnailUrl) {
    try {
      await FileSystem.deleteAsync(partArtworkUri, { idempotent: true });
      await FileSystem.downloadAsync(track.thumbnailUrl, partArtworkUri);
      const artInfo = await FileSystem.getInfoAsync(partArtworkUri);
      if (artInfo.exists && artInfo.size > 100) {
        await FileSystem.deleteAsync(finalArtworkUri, { idempotent: true });
        await FileSystem.moveAsync({
          from: partArtworkUri,
          to: finalArtworkUri,
        });
        savedArtworkUri = finalArtworkUri;
      } else {
        await FileSystem.deleteAsync(partArtworkUri, { idempotent: true });
      }
    } catch {
      await FileSystem.deleteAsync(partArtworkUri, { idempotent: true });
      // Falha de thumbnail não deve abortar o download do áudio
    }
  }

  const downloadedAt = Date.now();
  const safeTitle = track.title || 'Música';
  const safeArtist = track.artist || 'Artista';
  const safeDuration =
    typeof track.duration === 'number' && Number.isFinite(track.duration)
      ? track.duration
      : 0;
  const safeThumbnail = savedArtworkUri || track.thumbnailUrl || '';

  // Persiste metadados no SQLite apenas após validação 100% íntegra do arquivo
  await saveDownloadedTrack({
    id: track.id,
    title: safeTitle,
    artist: safeArtist,
    duration: safeDuration,
    thumbnailUrl: safeThumbnail,
    localUri: finalAudioUri,
    downloadedAt,
  });
  setLocalUriCache(track.id, finalAudioUri);

  return {
    id: track.id,
    title: safeTitle,
    artist: safeArtist,
    duration: safeDuration,
    localAudioUri: finalAudioUri,
    localArtworkUri: savedArtworkUri,
    fileSizeBytes: fileInfo.size,
    downloadedAt,
  };
}

/**
 * Obtém a URI local de uma faixa baixada se existir em disco com integridade e no banco.
 */
export async function getLocalTrackUri(videoId: string): Promise<string | null> {
  syncFileSystemGeneration();
  if (localUriCache.has(videoId)) {
    const cached = localUriCache.get(videoId) ?? null;
    setLocalUriCache(videoId, cached);
    return cached;
  }

  const dbRecord = await getDownloadedTrackById(videoId);
  if (dbRecord && dbRecord.localUri) {
    const fileInfo = await FileSystem.getInfoAsync(dbRecord.localUri);
    if (fileInfo.exists && fileInfo.size > 10240) {
      setLocalUriCache(videoId, dbRecord.localUri);
      return dbRecord.localUri;
    }
  }

  const fallbackUri = `${AUDIO_DIRECTORY}${videoId}.m4a`;
  const info = await FileSystem.getInfoAsync(fallbackUri);
  const resolved = info.exists && info.size > 10240 ? fallbackUri : null;
  setLocalUriCache(videoId, resolved);
  return resolved;
}

/**
 * Verifica se uma faixa já existe em disco localmente com integridade (>10KB).
 */
export async function isTrackDownloaded(videoId: string): Promise<boolean> {
  const localAudioUri = `${AUDIO_DIRECTORY}${videoId}.m4a`;
  const info = await FileSystem.getInfoAsync(localAudioUri);
  return info.exists && info.size > 10240;
}

/**
 * Registra a faixa no banco SQLite caso ela já exista em disco com integridade e ainda não esteja no banco.
 */
export async function registerLocalTrackIfMissing(track: TrackSummary): Promise<void> {
  const localUri = await getLocalTrackUri(track.id);
  if (!localUri) return;

  const inDb = await isDownloadedInDb(track.id);
  if (!inDb) {
    const localArtworkUri = `${THUMBNAIL_DIRECTORY}${track.id}.jpg`;
    const artInfo = await FileSystem.getInfoAsync(localArtworkUri);
    await saveDownloadedTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      thumbnailUrl: artInfo.exists ? localArtworkUri : track.thumbnailUrl,
      localUri,
      downloadedAt: Date.now(),
    });
  }
  setLocalUriCache(track.id, localUri);
}

/**
 * Higieniza o banco de dados e o disco, removendo registros de arquivos inexistentes
 * e eliminando arquivos órfãos (.part residuais ou .m4a não registrados no banco).
 */
export async function syncAndCleanStorage(): Promise<void> {
  await ensureStorageDirectories();

  // 1. Limpa registros no SQLite cujos arquivos não existem ou estão corrompidos
  const allTracks = await getDownloadedTracks();
  const validDbIds = new Set<string>();

  for (const track of allTracks) {
    const localAudioUri = `${AUDIO_DIRECTORY}${track.id}.m4a`;
    const info = await FileSystem.getInfoAsync(localAudioUri);
    if (!info.exists || info.size <= 10240) {
      await deleteDownloadedTrack(track.id);
    } else {
      validDbIds.add(track.id);
    }
  }

  // 2. Limpeza profunda de disco: remove resíduos (.part) e arquivos órfãos não catalogados
  try {
    const nativeMod = getNativeDownloader();
    const persistedQueue = nativeMod
      ? await nativeMod.getQueueSnapshot().catch(() => [])
      : await getPersistedDownloadQueue().catch(() => []);
    const protectedQueueIds = new Set<string>();
    for (const item of downloadQueue) {
      if (
        item.status === 'pending' ||
        item.status === 'downloading' ||
        item.status === 'completed'
      ) {
        protectedQueueIds.add(item.track.id);
      }
    }
    for (const row of persistedQueue) {
      if (
        row.status === 'pending' ||
        row.status === 'downloading' ||
        row.status === 'completed'
      ) {
        protectedQueueIds.add(row.trackId);
      }
    }

    const audioFiles = await FileSystem.readDirectoryAsync(AUDIO_DIRECTORY);
    for (const filename of audioFiles) {
      if (filename.endsWith('.part')) {
        const videoId = filename.replace('.part', '');
        if (!protectedQueueIds.has(videoId)) {
          await FileSystem.deleteAsync(`${AUDIO_DIRECTORY}${filename}`, { idempotent: true });
        }
      } else if (filename.endsWith('.m4a')) {
        const videoId = filename.replace('.m4a', '');
        if (
          !validDbIds.has(videoId) &&
          !protectedQueueIds.has(videoId) &&
          !(await isDownloadedInDb(videoId))
        ) {
          await FileSystem.deleteAsync(`${AUDIO_DIRECTORY}${filename}`, { idempotent: true });
        }
      }
    }

    const thumbFiles = await FileSystem.readDirectoryAsync(THUMBNAIL_DIRECTORY);
    for (const filename of thumbFiles) {
      if (filename.includes('.part')) {
        const videoId = filename.replace('.part.jpg', '').replace('.part', '');
        if (!protectedQueueIds.has(videoId)) {
          await FileSystem.deleteAsync(`${THUMBNAIL_DIRECTORY}${filename}`, { idempotent: true });
        }
      } else if (filename.endsWith('.jpg')) {
        const videoId = filename.replace('.jpg', '');
        if (!validDbIds.has(videoId) && !protectedQueueIds.has(videoId)) {
          await FileSystem.deleteAsync(`${THUMBNAIL_DIRECTORY}${filename}`, { idempotent: true });
        }
      }
    }
  } catch (cleanErr) {
    console.warn('[Storage] Aviso na higienização de órfãos:', cleanErr);
  } finally {
    localUriCache.clear();
  }
}

/**
 * Remove faixa baixada do armazenamento app-scoped e do banco SQLite.
 */
export async function deleteDownloadedTrack(videoId: string): Promise<void> {
  const localAudioUri = `${AUDIO_DIRECTORY}${videoId}.m4a`;
  const localArtworkUri = `${THUMBNAIL_DIRECTORY}${videoId}.jpg`;
  const partAudioUri = `${AUDIO_DIRECTORY}${videoId}.part`;

  await FileSystem.deleteAsync(localAudioUri, { idempotent: true });
  await FileSystem.deleteAsync(localArtworkUri, { idempotent: true });
  await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
  await deleteDownloadedTrackFromDb(videoId);
  localUriCache.delete(videoId);

  const prevLen = downloadQueue.length;
  downloadQueue = downloadQueue.filter(
    (item) => item.track.id !== videoId || item.status === 'downloading'
  );
  const nativeMod = getNativeDownloader();
  await enqueuePersistenceOp(() =>
    nativeMod ? nativeMod.cancelTrack(videoId) : removePersistedDownloadQueueItem(videoId)
  );
  if (downloadQueue.length !== prevLen) {
    notifyQueueListeners();
  }
}

/* ==========================================================================
   DOWNLOAD QUEUE MANAGER (GERENCIADOR DE FILA DE DOWNLOADS E BATCH)
   ========================================================================== */

export interface DownloadQueueItem {
  track: TrackSummary;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  progress: number;
  error?: string;
}

export type EnqueueResult = 'started' | 'queued' | 'already_queued';

export interface EnqueuePlaylistResult {
  enqueuedCount: number;
  alreadyQueuedCount: number;
  hadActiveBefore: boolean;
}

interface ActiveDownloadHandle {
  item: DownloadQueueItem;
  resumable: FileSystem.DownloadResumable | null;
  cancelled: boolean;
}

let downloadQueue: DownloadQueueItem[] = [];
let isProcessingQueue = false;
let activeDownloadHandle: ActiveDownloadHandle | null = null;
const queueListeners = new Set<(queue: DownloadQueueItem[]) => void>();
let queuePersistenceChain: Promise<void> = Promise.resolve();
let attachedNativeModule: NativeBackgroundDownloaderSpec | null = null;

interface NativePersistedQueueRow {
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl?: string;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  progress: number;
  error?: string | null;
  localAudioUri?: string | null;
  localArtworkUri?: string | null;
  downloadedAt?: number | null;
}

interface NativeBackgroundDownloaderSpec {
  enqueueItems: (
    items: Array<{
      trackId: string;
      title: string;
      artist: string;
      duration: number;
      thumbnailUrl: string;
      streamUrl?: string | null;
      headersJson?: string | null;
    }>
  ) => Promise<void>;
  getQueueSnapshot: () => Promise<NativePersistedQueueRow[]>;
  enqueueSync: () => Promise<void>;
  updateTrackStream?: (
    trackId: string,
    streamUrl: string,
    headersJson?: string | null
  ) => Promise<void>;
  provideResolvedStream?: (
    requestId: string,
    streamUrl: string | null,
    headersJson: string | null,
    error: string | null
  ) => Promise<void>;
  cancelTrack: (trackId: string) => Promise<void>;
  cancelAll: () => Promise<void>;
  clearFinished: () => Promise<void>;
  clearCompleted: () => Promise<void>;
  isWorkerActive?: () => Promise<boolean>;
}

const NATIVE_PRE_RESOLVE_BATCH_SIZE = 5;
const NATIVE_PRE_RESOLVE_CONCURRENCY = 2;
const inFlightNativePreResolves = new Set<string>();

function serializeStreamHeaders(stream: ResolvedDownloadStream): string | null {
  const headers: Record<string, string> = stream.headers
    ? { ...stream.headers }
    : stream.userAgent
      ? { 'User-Agent': stream.userAgent }
      : {};
  return Object.keys(headers).length > 0 ? JSON.stringify(headers) : null;
}

function preResolveNativeStreams(trackIds: string[]): void {
  const nativeMod = getNativeDownloader();
  if (!nativeMod || typeof nativeMod.updateTrackStream !== 'function') return;

  const candidates = trackIds
    .filter((id) => Boolean(id) && !inFlightNativePreResolves.has(id))
    .slice(0, NATIVE_PRE_RESOLVE_BATCH_SIZE);
  if (candidates.length === 0) return;

  let cursor = 0;
  const runWorker = async () => {
    while (cursor < candidates.length) {
      const trackId = candidates[cursor++];
      if (!trackId || inFlightNativePreResolves.has(trackId)) continue;
      inFlightNativePreResolves.add(trackId);
      try {
        const stream = await audioStreamResolver(trackId);
        if (stream?.streamUrl) {
          const headersJson = serializeStreamHeaders(stream);
          await enqueuePersistenceOp(() =>
            nativeMod.updateTrackStream!(trackId, stream.streamUrl, headersJson)
          );
        }
      } catch {
        // Worker solicitará sob demanda via needStream caso a pré-resolução falhe
      } finally {
        inFlightNativePreResolves.delete(trackId);
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(NATIVE_PRE_RESOLVE_CONCURRENCY, candidates.length) },
    () => runWorker()
  );
  void Promise.all(workers).catch(() => {});
}

function enqueuePersistenceOp(task: () => Promise<void>): Promise<void> {
  const next = queuePersistenceChain.then(task, task).catch((err) => {
    console.warn('[Storage] Erro ao persistir fila de downloads:', err);
  });
  queuePersistenceChain = next;
  return next;
}

function getNativeDownloader(): NativeBackgroundDownloaderSpec | null {
  if (Platform.OS !== 'android') return null;
  if (audioStreamResolver !== defaultAudioStreamResolver) return null;
  const mod = (NativeModules as Record<string, any> | undefined)?.SonaryBackgroundDownloader;
  if (
    mod &&
    typeof mod.enqueueSync === 'function' &&
    typeof mod.enqueueItems === 'function' &&
    typeof mod.getQueueSnapshot === 'function'
  ) {
    return mod as NativeBackgroundDownloaderSpec;
  }
  return null;
}

function attachNativeDownloadListeners(): void {
  const nativeMod = getNativeDownloader();
  if (!nativeMod || attachedNativeModule === nativeMod || typeof NativeEventEmitter !== 'function') {
    return;
  }

  attachedNativeModule = nativeMod;
  try {
    const emitter = new NativeEventEmitter(nativeMod as any);
    emitter.addListener('SonaryDownloadQueueChanged', (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      const {
        type,
        trackId,
        title,
        artist,
        duration,
        thumbnailUrl,
        progress,
        error,
        localAudioUri,
        localArtworkUri,
        downloadedAt,
      } = payload;

      if (type === 'sync') {
        void hydrateDownloadQueue();
        return;
      }

      if (type === 'needStream') {
        const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
        const forceRefresh = Boolean(payload.forceRefresh);
        if (!requestId || !trackId || typeof nativeMod.provideResolvedStream !== 'function') {
          return;
        }
        void (async () => {
          try {
            if (forceRefresh) {
              api.invalidateStreamCache(trackId);
            }
            const stream = await audioStreamResolver(trackId);
            if (!stream?.streamUrl) {
              await nativeMod.provideResolvedStream!(
                requestId,
                null,
                null,
                'URL de áudio indisponível no provedor'
              );
              return;
            }
            await nativeMod.provideResolvedStream!(
              requestId,
              stream.streamUrl,
              serializeStreamHeaders(stream),
              null
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await nativeMod
              .provideResolvedStream!(requestId, null, null, msg || 'Falha ao resolver stream')
              .catch(() => {});
          }
        })();
        return;
      }

      if (!trackId) return;

      if (type === 'progress') {
        const target = downloadQueue.find((i) => i.track.id === trackId);
        if (target) {
          target.status = 'downloading';
          target.progress = typeof progress === 'number' ? progress : target.progress;
          notifyQueueListeners();
        } else {
          void hydrateDownloadQueue();
        }
        return;
      }

      if (type === 'completed') {
        const existingTarget = downloadQueue.find((i) => i.track.id === trackId);
        const resolvedAudioUri =
          typeof localAudioUri === 'string' && localAudioUri
            ? localAudioUri
            : `${AUDIO_DIRECTORY}${trackId}.m4a`;
        const resolvedThumb =
          (typeof localArtworkUri === 'string' && localArtworkUri) ||
          (typeof thumbnailUrl === 'string' && thumbnailUrl) ||
          existingTarget?.track.thumbnailUrl ||
          '';

        void enqueuePersistenceOp(async () => {
          await saveDownloadedTrack({
            id: trackId,
            title:
              typeof title === 'string' && title
                ? title
                : existingTarget?.track.title || 'Música',
            artist:
              typeof artist === 'string' && artist
                ? artist
                : existingTarget?.track.artist || 'Artista',
            duration:
              typeof duration === 'number' && Number.isFinite(duration)
                ? duration
                : existingTarget?.track.duration || 0,
            thumbnailUrl: resolvedThumb,
            localUri: resolvedAudioUri,
            downloadedAt:
              typeof downloadedAt === 'number' && Number.isFinite(downloadedAt)
                ? downloadedAt
                : Date.now(),
          });
          setLocalUriCache(trackId, resolvedAudioUri);
          const target = downloadQueue.find((i) => i.track.id === trackId);
          if (target) {
            target.status = 'completed';
            target.progress = 1;
            target.error = undefined;
            notifyQueueListeners();
          } else {
            await hydrateDownloadQueue();
          }
        });
        return;
      }

      if (type === 'error') {
        const target = downloadQueue.find((i) => i.track.id === trackId);
        if (target) {
          target.status = 'error';
          target.error = typeof error === 'string' ? error : 'Falha no download';
          notifyQueueListeners();
        } else {
          void hydrateDownloadQueue();
        }
        return;
      }

      if (type === 'cancelled') {
        const prevLen = downloadQueue.length;
        downloadQueue = downloadQueue.filter((i) => i.track.id !== trackId);
        if (downloadQueue.length !== prevLen) {
          notifyQueueListeners();
        }
      }
    });
  } catch (err) {
    console.warn('[Storage] Falha ao registrar eventos nativos de download:', err);
  }
}

function scheduleQueueExecution(): void {
  attachNativeDownloadListeners();
  const nativeMod = getNativeDownloader();
  if (nativeMod) {
    void queuePersistenceChain.then(() => nativeMod.enqueueSync()).catch((err) => {
      console.warn('[Storage] Falha no worker nativo, executando fallback JS:', err);
      void processQueue();
    });
    return;
  }
  void processQueue();
}

/**
 * Hidrata a fila de downloads persistida (nativo `sonary_downloads.db` ou SQLite JS fallback)
 * e reconcilia faixas concluídas para `downloaded_tracks` no `sonary.db`.
 */
export async function hydrateDownloadQueue(): Promise<DownloadQueueItem[]> {
  attachNativeDownloadListeners();
  await queuePersistenceChain;

  const nativeMod = getNativeDownloader();
  let workerRunning = false;
  if (nativeMod && typeof nativeMod.isWorkerActive === 'function') {
    workerRunning = await nativeMod.isWorkerActive().catch(() => false);
  }

  if (nativeMod) {
    const rows = await nativeMod.getQueueSnapshot().catch(() => [] as NativePersistedQueueRow[]);
    for (const row of rows) {
      if (row.status === 'completed') {
        const localAudioUri = row.localAudioUri || `${AUDIO_DIRECTORY}${row.trackId}.m4a`;
        const alreadyInDb = await isDownloadedInDb(row.trackId).catch(() => false);
        if (!alreadyInDb) {
          const info = await FileSystem.getInfoAsync(localAudioUri).catch(() => ({
            exists: false,
            size: 0,
          }));
          if (info.exists && info.size > 10240) {
            await saveDownloadedTrack({
              id: row.trackId,
              title: row.title || 'Música',
              artist: row.artist || 'Artista',
              duration: row.duration || 0,
              thumbnailUrl: row.localArtworkUri || row.thumbnailUrl || '',
              localUri: localAudioUri,
              downloadedAt: row.downloadedAt || Date.now(),
            }).catch(() => {});
            setLocalUriCache(row.trackId, localAudioUri);
          }
        }
      }
    }

    const liveProgressById = new Map<string, DownloadQueueItem>();
    for (const item of downloadQueue) {
      if (item.status === 'downloading') {
        liveProgressById.set(item.track.id, item);
      }
    }

    downloadQueue = rows.map((row) => {
      const live = liveProgressById.get(row.trackId);
      const status =
        row.status === 'downloading' && !workerRunning
          ? 'pending'
          : row.status;
      return {
        track: {
          id: row.trackId,
          title: row.title || 'Música',
          artist: row.artist || 'Artista',
          duration: row.duration || 0,
          formattedDuration: formatDurationSimple(row.duration || 0),
          thumbnailUrl: row.thumbnailUrl || '',
        },
        status,
        progress:
          status === 'downloading' && live && live.progress > row.progress
            ? live.progress
            : row.progress || 0,
        error: row.error || undefined,
      };
    });

    notifyQueueListeners();

    if (downloadQueue.some((i) => i.status === 'pending')) {
      preResolveNativeStreams(
        downloadQueue.filter((i) => i.status === 'pending').map((i) => i.track.id)
      );
      scheduleQueueExecution();
    }
    return getDownloadQueue();
  }

  if (!isProcessingQueue) {
    await resetInterruptedDownloadsToPending().catch(() => {});
  }

  const rows = await getPersistedDownloadQueue().catch(() => []);
  const liveProgressById = new Map<string, DownloadQueueItem>();
  for (const item of downloadQueue) {
    if (item.status === 'downloading') {
      liveProgressById.set(item.track.id, item);
    }
  }

  downloadQueue = rows.map((row) => {
    const live = liveProgressById.get(row.trackId);
    const status =
      row.status === 'downloading' && !isProcessingQueue
        ? 'pending'
        : row.status;
    return {
      track: {
        id: row.trackId,
        title: row.title,
        artist: row.artist,
        duration: row.duration,
        formattedDuration: formatDurationSimple(row.duration),
        thumbnailUrl: row.thumbnailUrl || '',
      },
      status,
      progress:
        status === 'downloading' && live && live.progress > row.progress
          ? live.progress
          : row.progress || 0,
      error: row.error || undefined,
    };
  });

  notifyQueueListeners();

  const hasPending = downloadQueue.some((i) => i.status === 'pending');
  if (hasPending) {
    scheduleQueueExecution();
  }

  return getDownloadQueue();
}

function formatDurationSimple(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export interface ResolvedDownloadStream {
  streamUrl: string;
  headers?: Record<string, string>;
  userAgent?: string;
}

const defaultAudioStreamResolver = (id: string): Promise<ResolvedDownloadStream> =>
  api.getAudioStream(id);

let audioStreamResolver: (id: string) => Promise<ResolvedDownloadStream> =
  defaultAudioStreamResolver;

/**
 * Permite customizar ou mockar o resolvedor de stream de áudio (usado em testes).
 */
export function setAudioStreamResolver(
  resolver?: (id: string) => Promise<ResolvedDownloadStream>
): void {
  audioStreamResolver = resolver || defaultAudioStreamResolver;
}

function notifyQueueListeners() {
  const snapshot = getDownloadQueue();
  queueListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch { }
  });
}

/**
 * Inscreve um listener reativo para mudanças na fila de downloads.
 */
export function subscribeDownloadQueue(listener: (queue: DownloadQueueItem[]) => void): () => void {
  queueListeners.add(listener);
  listener(getDownloadQueue());
  return () => {
    queueListeners.delete(listener);
  };
}

/**
 * Retorna uma cópia imutável da fila atual de downloads.
 */
export function getDownloadQueue(): DownloadQueueItem[] {
  return downloadQueue.map((item) => ({ ...item }));
}

function pushOrReplacePending(track: TrackSummary): void {
  downloadQueue = downloadQueue.filter((i) => i.track.id !== track.id);
  downloadQueue.push({
    track,
    status: 'pending',
    progress: 0,
  });
}

/**
 * Enfileira uma faixa individual para download em background.
 */
export function enqueueDownload(track: TrackSummary): EnqueueResult {
  if (!track || !track.id) return 'already_queued';
  const existing = downloadQueue.find((i) => i.track.id === track.id);
  if (existing && (existing.status === 'pending' || existing.status === 'downloading')) {
    return 'already_queued';
  }
  const hadActiveOrPending = downloadQueue.some(
    (i) => i.status === 'pending' || i.status === 'downloading'
  );
  pushOrReplacePending(track);
  const nativeMod = getNativeDownloader();
  if (nativeMod) {
    enqueuePersistenceOp(() =>
      nativeMod.enqueueItems([
        {
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          thumbnailUrl: track.thumbnailUrl || '',
        },
      ])
    );
    preResolveNativeStreams([track.id]);
  } else {
    enqueuePersistenceOp(() =>
      upsertPersistedDownloadQueueItem({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        thumbnailUrl: track.thumbnailUrl,
        status: 'pending',
        progress: 0,
      })
    );
  }
  notifyQueueListeners();
  scheduleQueueExecution();
  return hadActiveOrPending ? 'queued' : 'started';
}

/**
 * Enfileira múltiplas faixas (ex: uma playlist inteira) para download sequencial.
 */
export function enqueuePlaylistDownload(tracks: TrackSummary[]): EnqueuePlaylistResult {
  if (!tracks || tracks.length === 0) {
    return { enqueuedCount: 0, alreadyQueuedCount: 0, hadActiveBefore: false };
  }
  const hadActiveBefore = downloadQueue.some(
    (i) => i.status === 'pending' || i.status === 'downloading'
  );
  let enqueuedCount = 0;
  let alreadyQueuedCount = 0;
  const persistedBatch: Array<{
    trackId: string;
    title: string;
    artist: string;
    duration: number;
    thumbnailUrl?: string;
    status: 'pending';
    progress: number;
  }> = [];

  for (const track of tracks) {
    if (!track || !track.id) continue;
    const existing = downloadQueue.find((i) => i.track.id === track.id);
    if (existing && (existing.status === 'pending' || existing.status === 'downloading')) {
      alreadyQueuedCount += 1;
      continue;
    }
    pushOrReplacePending(track);
    persistedBatch.push({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      thumbnailUrl: track.thumbnailUrl,
      status: 'pending',
      progress: 0,
    });
    enqueuedCount += 1;
  }

  if (enqueuedCount > 0) {
    const nativeMod = getNativeDownloader();
    if (nativeMod) {
      enqueuePersistenceOp(() =>
        nativeMod.enqueueItems(
          persistedBatch.map((b) => ({
            trackId: b.trackId,
            title: b.title,
            artist: b.artist,
            duration: b.duration,
            thumbnailUrl: b.thumbnailUrl || '',
          }))
        )
      );
      preResolveNativeStreams(persistedBatch.map((b) => b.trackId));
    } else {
      enqueuePersistenceOp(() => upsertPersistedDownloadQueueBatch(persistedBatch));
    }
    notifyQueueListeners();
    scheduleQueueExecution();
  }
  return { enqueuedCount, alreadyQueuedCount, hadActiveBefore };
}

/**
 * Cancela um item específico da fila (pendente, baixando, erro ou concluído).
 */
export async function cancelDownload(videoId: string): Promise<void> {
  if (!videoId) return;
  const target = downloadQueue.find((i) => i.track.id === videoId);
  const nativeMod = getNativeDownloader();
  if (!target) {
    if (nativeMod) {
      await enqueuePersistenceOp(() => nativeMod.cancelTrack(videoId));
    } else {
      await enqueuePersistenceOp(() => removePersistedDownloadQueueItem(videoId));
    }
    return;
  }

  downloadQueue = downloadQueue.filter((i) => i !== target);
  if (activeDownloadHandle && activeDownloadHandle.item === target) {
    activeDownloadHandle.cancelled = true;
    const resumable = activeDownloadHandle.resumable;
    if (resumable && typeof resumable.cancelAsync === 'function') {
      resumable.cancelAsync().catch(() => {});
    }
  }
  notifyQueueListeners();

  if (nativeMod) {
    await enqueuePersistenceOp(() => nativeMod.cancelTrack(videoId));
  } else {
    await enqueuePersistenceOp(() => removePersistedDownloadQueueItem(videoId));
  }
}

/**
 * Cancela todos os downloads pendentes e o download ativo em andamento.
 */
export async function cancelAllDownloads(): Promise<void> {
  const activeHandle = activeDownloadHandle;
  const hadAny = downloadQueue.some(
    (i) => i.status === 'pending' || i.status === 'downloading'
  );
  downloadQueue = downloadQueue.filter(
    (i) => i.status !== 'pending' && i.status !== 'downloading'
  );
  if (activeHandle) {
    activeHandle.cancelled = true;
    if (activeHandle.resumable && typeof activeHandle.resumable.cancelAsync === 'function') {
      activeHandle.resumable.cancelAsync().catch(() => {});
    }
  }
  if (hadAny || activeHandle) {
    notifyQueueListeners();
  }
  const nativeMod = getNativeDownloader();
  if (nativeMod) {
    await enqueuePersistenceOp(() => nativeMod.cancelAll());
  } else {
    await enqueuePersistenceOp(() => clearPersistedActiveDownloads());
  }
}

/**
 * Reenfileira uma faixa que falhou para nova tentativa de download.
 */
export function retryDownload(videoId: string): boolean {
  if (!videoId) return false;
  const existing = downloadQueue.find((i) => i.track.id === videoId);
  if (!existing || existing.status !== 'error') {
    return false;
  }
  pushOrReplacePending(existing.track);
  const nativeMod = getNativeDownloader();
  if (nativeMod) {
    enqueuePersistenceOp(() =>
      nativeMod.enqueueItems([
        {
          trackId: existing.track.id,
          title: existing.track.title,
          artist: existing.track.artist,
          duration: existing.track.duration,
          thumbnailUrl: existing.track.thumbnailUrl || '',
        },
      ])
    );
    preResolveNativeStreams([existing.track.id]);
  } else {
    enqueuePersistenceOp(() =>
      upsertPersistedDownloadQueueItem({
        trackId: existing.track.id,
        title: existing.track.title,
        artist: existing.track.artist,
        duration: existing.track.duration,
        thumbnailUrl: existing.track.thumbnailUrl,
        status: 'pending',
        progress: 0,
        error: null,
      })
    );
  }
  notifyQueueListeners();
  scheduleQueueExecution();
  return true;
}

/**
 * Reenfileira em lote todas as faixas que estão com erro na fila de downloads.
 */
export function retryAllFailedDownloads(): number {
  const failedItems = downloadQueue.filter((i) => i.status === 'error');
  if (failedItems.length === 0) return 0;

  const persistedBatch: Array<{
    trackId: string;
    title: string;
    artist: string;
    duration: number;
    thumbnailUrl?: string;
    status: 'pending';
    progress: number;
  }> = [];

  for (const item of failedItems) {
    pushOrReplacePending(item.track);
    persistedBatch.push({
      trackId: item.track.id,
      title: item.track.title,
      artist: item.track.artist,
      duration: item.track.duration,
      thumbnailUrl: item.track.thumbnailUrl,
      status: 'pending',
      progress: 0,
    });
  }

  const nativeMod = getNativeDownloader();
  if (nativeMod) {
    enqueuePersistenceOp(() =>
      nativeMod.enqueueItems(
        persistedBatch.map((b) => ({
          trackId: b.trackId,
          title: b.title,
          artist: b.artist,
          duration: b.duration,
          thumbnailUrl: b.thumbnailUrl || '',
        }))
      )
    );
    preResolveNativeStreams(persistedBatch.map((b) => b.trackId));
  } else {
    enqueuePersistenceOp(() => upsertPersistedDownloadQueueBatch(persistedBatch));
  }

  notifyQueueListeners();
  scheduleQueueExecution();
  return failedItems.length;
}

async function resolveAndDownloadTrack(
  item: DownloadQueueItem,
  handle: ActiveDownloadHandle
): Promise<void> {
  if (handle.cancelled) {
    throw new DownloadCancelledError(item.track.id);
  }
  const streamInfo = await audioStreamResolver(item.track.id);
  if (handle.cancelled) {
    throw new DownloadCancelledError(item.track.id);
  }

  const headers: Record<string, string> | undefined = streamInfo.headers
    ? streamInfo.headers
    : streamInfo.userAgent
      ? { 'User-Agent': streamInfo.userAgent }
      : undefined;

  await downloadTrackFile(
    item.track,
    streamInfo.streamUrl,
    (progress) => {
      if (handle.cancelled) return;
      item.progress = progress;
      notifyQueueListeners();
    },
    headers,
    {
      shouldAbort: () => handle.cancelled,
      onResumableCreated: (resumable) => {
        handle.resumable = resumable;
        if (handle.cancelled && typeof resumable.cancelAsync === 'function') {
          resumable.cancelAsync().catch(() => {});
        }
      },
    }
  );
}

/**
 * Processador sequencial resiliente de fila de downloads em background.
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    while (true) {
      const nextItem = downloadQueue.find((i) => i.status === 'pending');
      if (!nextItem) break;

      const handle: ActiveDownloadHandle = {
        item: nextItem,
        resumable: null,
        cancelled: false,
      };
      activeDownloadHandle = handle;

      const alreadyDownloaded = await isTrackDownloaded(nextItem.track.id);
      if (handle.cancelled || !downloadQueue.includes(nextItem)) {
        if (activeDownloadHandle === handle) activeDownloadHandle = null;
        continue;
      }
      if (alreadyDownloaded) {
        await registerLocalTrackIfMissing(nextItem.track);
        nextItem.status = 'completed';
        nextItem.progress = 1;
        enqueuePersistenceOp(() =>
          updatePersistedDownloadQueueState(nextItem.track.id, 'completed', 1, null)
        );
        if (activeDownloadHandle === handle) activeDownloadHandle = null;
        notifyQueueListeners();
        continue;
      }

      nextItem.status = 'downloading';
      nextItem.progress = 0;
      enqueuePersistenceOp(() =>
        updatePersistedDownloadQueueState(nextItem.track.id, 'downloading', 0, null)
      );
      notifyQueueListeners();

      try {
        try {
          await resolveAndDownloadTrack(nextItem, handle);
        } catch (firstErr) {
          if (
            firstErr instanceof DownloadCancelledError ||
            handle.cancelled ||
            (firstErr instanceof Error && firstErr.message.includes('Espaço em disco insuficiente'))
          ) {
            throw firstErr;
          }
          // Invalida possível URL expirada no streamCache e tenta uma vez com stream novo
          api.invalidateStreamCache(nextItem.track.id);
          nextItem.progress = 0;
          await resolveAndDownloadTrack(nextItem, handle);
        }
        if (handle.cancelled) {
          continue;
        }
        nextItem.status = 'completed';
        nextItem.progress = 1;
        enqueuePersistenceOp(() =>
          updatePersistedDownloadQueueState(nextItem.track.id, 'completed', 1, null)
        );
      } catch (err) {
        if (err instanceof DownloadCancelledError || handle.cancelled) {
          downloadQueue = downloadQueue.filter((i) => i !== nextItem);
          enqueuePersistenceOp(() =>
            removePersistedDownloadQueueItem(nextItem.track.id)
          );
          notifyQueueListeners();
          continue;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        // Espaço em disco insuficiente: pausa a fila sem marcar as demais faixas como erro
        if (errMsg.includes('Espaço em disco insuficiente')) {
          nextItem.status = 'pending';
          nextItem.progress = 0;
          nextItem.error = undefined;
          enqueuePersistenceOp(() =>
            updatePersistedDownloadQueueState(nextItem.track.id, 'pending', 0, null)
          );
          notifyQueueListeners();
          console.warn('[Storage] Fila pausada por espaço insuficiente em disco:', errMsg);
          break;
        }
        nextItem.status = 'error';
        nextItem.error = errMsg;
        enqueuePersistenceOp(() =>
          updatePersistedDownloadQueueState(
            nextItem.track.id,
            'error',
            nextItem.progress,
            nextItem.error || 'Erro desconhecido'
          )
        );
        console.warn('[Storage] Falha no download da faixa:', nextItem.track.id, nextItem.error);
      } finally {
        if (activeDownloadHandle === handle) {
          activeDownloadHandle = null;
        }
      }
      notifyQueueListeners();
    }
  } finally {
    activeDownloadHandle = null;
    isProcessingQueue = false;
  }
}

/**
 * Limpa itens já concluídos da fila.
 */
export function clearCompletedDownloads(): void {
  downloadQueue = downloadQueue.filter((i) => i.status !== 'completed');
  const nativeMod = getNativeDownloader();
  if (nativeMod) {
    enqueuePersistenceOp(() => nativeMod.clearCompleted());
  } else {
    enqueuePersistenceOp(() => clearPersistedCompletedDownloads());
  }
  notifyQueueListeners();
}

/**
 * Limpa itens concluídos e com erro da fila.
 */
export function clearFinishedDownloads(): void {
  downloadQueue = downloadQueue.filter(
    (i) => i.status !== 'completed' && i.status !== 'error'
  );
  const nativeMod = getNativeDownloader();
  if (nativeMod) {
    enqueuePersistenceOp(() => nativeMod.clearFinished());
  } else {
    enqueuePersistenceOp(() => clearPersistedFinishedDownloads());
  }
  notifyQueueListeners();
}

