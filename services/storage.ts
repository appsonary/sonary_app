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
const DEFAULT_STREAM_DOWNLOAD_HEADERS: Record<string, string> = {
  'User-Agent': api.INNERTUBE_USER_AGENT,
  Referer: 'https://www.youtube.com/',
  Origin: 'https://www.youtube.com',
};

/**
 * Realiza o download de uma faixa com suporte a Scoped Storage, gravação atômica (.part -> .m4a) e persistência SQLite.
 */
export async function downloadTrackFile(
  track: TrackSummary,
  streamUrl: string,
  onProgress?: (progressPercentage: number) => void,
  headers?: Record<string, string>
): Promise<LocalDownloadedTrack> {
  await ensureStorageDirectories();

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

  const requestHeaders = {
    ...DEFAULT_STREAM_DOWNLOAD_HEADERS,
    ...(headers || {}),
  };

  // Download do arquivo de áudio gravando inicialmente no arquivo temporário .part
  const downloadResumable = FileSystem.createDownloadResumable(
    streamUrl,
    partAudioUri,
    {
      headers: requestHeaders,
    },
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

  let downloadResult: FileSystem.FileSystemDownloadResult | undefined;
  try {
    downloadResult = await downloadResumable.downloadAsync();
  } catch (downloadErr) {
    // Garante que nenhum fragmento corrompido permaneça no disco em caso de cancelamento/falha
    await FileSystem.deleteAsync(partAudioUri, { idempotent: true });
    throw downloadErr;
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
    const audioFiles = await FileSystem.readDirectoryAsync(AUDIO_DIRECTORY);
    for (const filename of audioFiles) {
      if (filename.endsWith('.part')) {
        await FileSystem.deleteAsync(`${AUDIO_DIRECTORY}${filename}`, { idempotent: true });
      } else if (filename.endsWith('.m4a')) {
        const videoId = filename.replace('.m4a', '');
        const isQueued = downloadQueue.some(
          (i) => i.track.id === videoId && (i.status === 'pending' || i.status === 'downloading')
        );
        if (!validDbIds.has(videoId) && !isQueued && !(await isDownloadedInDb(videoId))) {
          await FileSystem.deleteAsync(`${AUDIO_DIRECTORY}${filename}`, { idempotent: true });
        }
      }
    }

    const thumbFiles = await FileSystem.readDirectoryAsync(THUMBNAIL_DIRECTORY);
    for (const filename of thumbFiles) {
      if (filename.includes('.part')) {
        await FileSystem.deleteAsync(`${THUMBNAIL_DIRECTORY}${filename}`, { idempotent: true });
      } else if (filename.endsWith('.jpg')) {
        const videoId = filename.replace('.jpg', '');
        if (!validDbIds.has(videoId)) {
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

let downloadQueue: DownloadQueueItem[] = [];
let isProcessingQueue = false;
const queueListeners = new Set<(queue: DownloadQueueItem[]) => void>();

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

/**
 * Enfileira uma faixa individual para download em background.
 */
export function enqueueDownload(track: TrackSummary): void {
  if (!track || !track.id) return;
  const existing = downloadQueue.find((i) => i.track.id === track.id);
  if (existing && (existing.status === 'pending' || existing.status === 'downloading')) {
    return;
  }
  if (existing) {
    existing.track = track;
    existing.status = 'pending';
    existing.progress = 0;
    existing.error = undefined;
  } else {
    downloadQueue.push({
      track,
      status: 'pending',
      progress: 0,
    });
  }
  notifyQueueListeners();
  processQueue();
}

/**
 * Enfileira múltiplas faixas (ex: uma playlist inteira) para download sequencial.
 */
export function enqueuePlaylistDownload(tracks: TrackSummary[]): void {
  if (!tracks || tracks.length === 0) return;
  for (const track of tracks) {
    if (!track || !track.id) continue;
    const existing = downloadQueue.find((i) => i.track.id === track.id);
    if (!existing || (existing.status !== 'pending' && existing.status !== 'downloading')) {
      if (existing) {
        existing.track = track;
        existing.status = 'pending';
        existing.progress = 0;
        existing.error = undefined;
      } else {
        downloadQueue.push({
          track,
          status: 'pending',
          progress: 0,
        });
      }
    }
  }
  notifyQueueListeners();
  processQueue();
}

async function resolveAndDownloadTrack(item: DownloadQueueItem): Promise<void> {
  const streamInfo = await audioStreamResolver(item.track.id);
  const headers: Record<string, string> | undefined = streamInfo.headers
    ? streamInfo.headers
    : streamInfo.userAgent
      ? { 'User-Agent': streamInfo.userAgent }
      : undefined;

  await downloadTrackFile(
    item.track,
    streamInfo.streamUrl,
    (progress) => {
      item.progress = progress;
      notifyQueueListeners();
    },
    headers
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

      const alreadyDownloaded = await isTrackDownloaded(nextItem.track.id);
      if (alreadyDownloaded) {
        await registerLocalTrackIfMissing(nextItem.track);
        nextItem.status = 'completed';
        nextItem.progress = 1;
        notifyQueueListeners();
        continue;
      }

      nextItem.status = 'downloading';
      nextItem.progress = 0;
      notifyQueueListeners();

      try {
        try {
          await resolveAndDownloadTrack(nextItem);
        } catch (firstErr) {
          // Invalida possível URL expirada no streamCache e tenta uma vez com stream novo
          api.invalidateStreamCache(nextItem.track.id);
          nextItem.progress = 0;
          await resolveAndDownloadTrack(nextItem);
        }
        nextItem.status = 'completed';
        nextItem.progress = 1;
      } catch (err) {
        nextItem.status = 'error';
        nextItem.error = err instanceof Error ? err.message : String(err);
        console.warn('[Storage] Falha no download da faixa:', nextItem.track.id, nextItem.error);
      }
      notifyQueueListeners();
    }
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Limpa itens já concluídos da fila.
 */
export function clearCompletedDownloads(): void {
  downloadQueue = downloadQueue.filter((i) => i.status !== 'completed');
  notifyQueueListeners();
}

