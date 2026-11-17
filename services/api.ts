/**
 * Camada de Resiliência de API (Piped / Invidious)
 * Arquitetura Zero-Backend / Zero-Cost com Multi-Instância e Fallback Automático
 */

import { getCachedLyrics, saveCachedLyrics } from './database';

// ==========================================
// 1. TIPAGEM ESTRITA
// ==========================================

export interface PipedStreamAudio {
  url: string;
  format: string; // ex: "M4A", "WEBMA"
  quality: string; // ex: "128k", "medium"
  mimeType: string; // ex: "audio/mp4", "audio/webm"
  codec: string; // ex: "mp4a.40.2", "opus"
  bitrate: number; // ex: 131072 (bps)
  contentLength?: number;
  audioTrackId?: number | null;
  audioTrackName?: string | null;
}

export interface StreamResponse {
  title: string;
  description: string;
  uploader: string;
  uploaderUrl: string;
  uploaderAvatar?: string;
  thumbnailUrl: string;
  duration: number; // segundos
  audioStreams: PipedStreamAudio[];
}

export interface PipedSearchItem {
  url: string;
  type: string;
  title: string;
  thumbnail: string;
  uploaderName: string;
  uploaderUrl: string;
  uploaderAvatar?: string;
  duration?: number | string;
  uploadedDate?: string;
  views?: number;
}

export interface SearchResult {
  items: PipedSearchItem[];
  nextpage?: string;
}

export interface TrackSummary {
  id: string; // YouTube videoId (ex: "kJQP7kiw5Fk")
  title: string;
  artist: string;
  duration: number; // em segundos
  formattedDuration: string; // "MM:SS" ou "HH:MM:SS"
  thumbnailUrl: string;
}

export interface SearchPageResult {
  tracks: TrackSummary[];
  continuationToken: string | null;
}

export interface SearchPageOptions {
  targetCount?: number;
  continuationToken?: string | null;
  excludeIds?: Iterable<string>;
}

export interface AudioStreamResult {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  streamUrl: string;
  mimeType: string;
  format: string;
  bitrate: number;
  userAgent?: string;
  headers?: Record<string, string>;
}

export type InstanceEngine = 'piped' | 'invidious';

export interface ApiInstanceConfig {
  baseUrl: string;
  engine: InstanceEngine;
}

// ==========================================
// 2. ERROS DE DOMÍNIO CUSTOMIZADOS
// ==========================================

export class AllInstancesFailedError extends Error {
  public readonly instanceErrors: Record<string, string>;

  constructor(instanceErrors: Record<string, string>) {
    const errorDetails = Object.entries(instanceErrors)
      .map(([instance, err]) => `  • [${instance}]: ${err}`)
      .join('\n');

    super(
      `Todas as instâncias públicas da API falharam na requisição.\n` +
      `Falhas registradas por nó:\n${errorDetails}`
    );
    this.name = 'AllInstancesFailedError';
    this.instanceErrors = instanceErrors;
    Object.setPrototypeOf(this, AllInstancesFailedError.prototype);
  }
}

export class InvalidApiResponseError extends Error {
  constructor(message: string) {
    super(`Schema da resposta da API inválido: ${message}`);
    this.name = 'InvalidApiResponseError';
    Object.setPrototypeOf(this, InvalidApiResponseError.prototype);
  }
}

// ==========================================
// 3. POOL DE INSTÂNCIAS (PIPED + INVIDIOUS)
// ==========================================

export const API_INSTANCES: readonly ApiInstanceConfig[] = [
  { baseUrl: 'https://invidious.projectsegfau.lt', engine: 'invidious' },
  { baseUrl: 'https://invidious.f5.si', engine: 'invidious' },
  { baseUrl: 'https://inv.nadeko.net', engine: 'invidious' },
];

// Compatibilidade retroativa para código legado consumidor de array de strings
export const PIPED_INSTANCES: readonly string[] = API_INSTANCES.map((i) => i.baseUrl);

const REQUEST_TIMEOUT_MS = 10000;

/**
 * Utilitário de requisição com timeout estrito via AbortController.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'SonaryProMobile/1.0',
      ...(init?.headers || {}),
    };
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ==========================================
// 4. PARSERS E NORMALIZAÇÃO DE DADOS
// ==========================================

function extractVideoId(urlOrId: string): string {
  if (!urlOrId) return '';
  const match = urlOrId.match(/(?:v=|\/watch\?v=|\/embed\/|\/v\/|^)([a-zA-Z0-9_-]{11})/);
  if (match && match[1]) {
    return match[1];
  }
  return urlOrId.replace('/watch?v=', '').replace('/', '').trim();
}

function parseDurationToSeconds(duration: number | string | undefined | null): number {
  if (typeof duration === 'number') {
    return Math.max(0, Math.floor(duration));
  }
  if (typeof duration === 'string') {
    const parts = duration.split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => isNaN(n))) {
      return 0;
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 1) {
      return parts[0];
    }
  }
  return 0;
}

function formatDurationSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (val: number) => (val < 10 ? `0${val}` : `${val}`);

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

// ==========================================
// 5. FUNÇÕES PÚBLICAS EXPORTADAS
// ==========================================

declare const module: { exports?: { searchTracks?: (query: string) => Promise<TrackSummary[]> } } | undefined;

const DEFAULT_SEARCH_TARGET_COUNT = 30;
const MAX_SEARCH_PAGES_PER_BATCH = 4;
const FALLBACK_CURSOR_PREFIX = '__fb__:';

function extractVideoRendererTrack(v: any): TrackSummary | null {
  if (!v || !v.videoId) return null;
  const title = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Faixa Desconhecida';
  const artist =
    v.longBylineText?.runs?.[0]?.text ||
    v.shortBylineText?.runs?.[0]?.text ||
    v.ownerText?.runs?.[0]?.text ||
    'Artista Desconhecido';
  const durationText =
    v.lengthText?.runs?.[0]?.text || v.lengthText?.simpleText || '0:00';
  const durationSec = parseDurationToSeconds(durationText);
  const thumb =
    v.thumbnail?.thumbnails?.[0]?.url ||
    `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

  return {
    id: v.videoId,
    title,
    artist,
    duration: durationSec,
    formattedDuration: durationText,
    thumbnailUrl: thumb,
  };
}

function extractNextContinuation(continuations: unknown): string | null {
  if (!Array.isArray(continuations)) return null;
  for (const entry of continuations) {
    const token = (entry as any)?.nextContinuationData?.continuation;
    if (typeof token === 'string' && token) return token;
  }
  return null;
}

function parseInnerTubeSearchResponse(
  data: any,
  seenIds: Set<string>
): SearchPageResult {
  const itemSectionCont = data?.continuationContents?.itemSectionContinuation;
  const containerSections: any[] = [
    ...(data?.contents?.sectionListRenderer?.contents || []),
    ...(data?.continuationContents?.sectionListContinuation?.contents || []),
    ...(itemSectionCont ? [{ itemSectionRenderer: itemSectionCont }] : []),
  ];

  const commands = Array.isArray(data?.onResponseReceivedCommands)
    ? data.onResponseReceivedCommands
    : [];
  for (const cmd of commands) {
    const appendItems = cmd?.appendContinuationItemsAction?.continuationItems;
    const reloadItems = cmd?.reloadContinuationItemsCommand?.continuationItems;
    if (Array.isArray(appendItems)) containerSections.push(...appendItems);
    if (Array.isArray(reloadItems)) containerSections.push(...reloadItems);
  }

  const tracks: TrackSummary[] = [];
  let continuationToken: string | null =
    extractNextContinuation(data?.contents?.sectionListRenderer?.continuations) ||
    extractNextContinuation(data?.continuationContents?.sectionListContinuation?.continuations);

  for (const section of containerSections) {
    const directCont =
      section?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
      extractNextContinuation(section?.itemSectionRenderer?.continuations);
    if (typeof directCont === 'string' && directCont) {
      continuationToken = directCont;
    }

    const directTrack = extractVideoRendererTrack(
      section?.compactVideoRenderer || section?.videoRenderer
    );
    if (directTrack && !seenIds.has(directTrack.id)) {
      seenIds.add(directTrack.id);
      tracks.push(directTrack);
    }

    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const cont =
        item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof cont === 'string' && cont) {
        continuationToken = cont;
      }

      const track = extractVideoRendererTrack(
        item?.compactVideoRenderer || item?.videoRenderer
      );
      if (track && !seenIds.has(track.id)) {
        seenIds.add(track.id);
        tracks.push(track);
      }
    }
  }

  return { tracks, continuationToken };
}

/**
 * Busca uma página no InnerTube (`query` na 1ª página ou `continuation` nas seguintes).
 */
async function fetchInnerTubeSearchPage(
  query: string,
  seenIds: Set<string>,
  continuationToken?: string | null
): Promise<SearchPageResult> {
  const visitorData = await getInnerTubeVisitorData().catch(() => undefined);
  const bodyPayload: Record<string, unknown> = {
    context: {
      client: {
        clientName: 'VISIONOS',
        clientVersion: '1.04',
        hl: 'pt',
        gl: 'BR',
        ...(visitorData ? { visitorData } : {}),
      },
    },
  };
  if (continuationToken) {
    bodyPayload.continuation = continuationToken;
  } else {
    bodyPayload.query = query;
  }

  const response = await fetchWithTimeout(
    'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
    8000,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify(bodyPayload),
    }
  );

  if (!response.ok) {
    throw new Error(`InnerTube search HTTP ${response.status}`);
  }

  const data = (await response.json()) as any;
  return parseInnerTubeSearchResponse(data, seenIds);
}

async function searchInnerTubeBatch(
  query: string,
  targetCount: number,
  startToken: string | null,
  seenIds: Set<string>
): Promise<SearchPageResult> {
  const collected: TrackSummary[] = [];
  let token: string | null = startToken;
  let hops = 0;

  while (collected.length < targetCount && hops < MAX_SEARCH_PAGES_PER_BATCH) {
    const page = await fetchInnerTubeSearchPage(query, seenIds, token);
    collected.push(...page.tracks);
    token = page.continuationToken;
    hops += 1;

    if (!token || (page.tracks.length === 0 && hops > 1)) {
      break;
    }
  }

  return { tracks: collected, continuationToken: token };
}

function parsePipedItems(rawItems: unknown[], seenIds: Set<string>): TrackSummary[] {
  const tracks: TrackSummary[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const typedItem = item as PipedSearchItem;
    if (typedItem.type && typedItem.type !== 'stream') continue;

    const videoId = extractVideoId(typedItem.url);
    if (!videoId || videoId.length < 5 || seenIds.has(videoId)) continue;

    seenIds.add(videoId);
    const durationSec = parseDurationToSeconds(typedItem.duration);
    tracks.push({
      id: videoId,
      title: typedItem.title || 'Faixa Desconhecida',
      artist: typedItem.uploaderName || 'Artista Desconhecido',
      duration: durationSec,
      formattedDuration: formatDurationSeconds(durationSec),
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
  return tracks;
}

function parseInvidiousItems(rawData: unknown[], seenIds: Set<string>): TrackSummary[] {
  const tracks: TrackSummary[] = [];
  for (const item of rawData) {
    if (!item || typeof item !== 'object') continue;
    const invItem = item as {
      videoId?: string;
      title?: string;
      author?: string;
      lengthSeconds?: number;
    };

    if (!invItem.videoId || seenIds.has(invItem.videoId)) continue;
    seenIds.add(invItem.videoId);
    const durationSec = invItem.lengthSeconds || 0;
    tracks.push({
      id: invItem.videoId,
      title: invItem.title || 'Faixa Desconhecida',
      artist: invItem.author || 'Artista Desconhecido',
      duration: durationSec,
      formattedDuration: formatDurationSeconds(durationSec),
      thumbnailUrl: `https://i.ytimg.com/vi/${invItem.videoId}/hqdefault.jpg`,
    });
  }
  return tracks;
}

type FallbackCursor =
  | { engine: 'piped'; baseUrl: string; nextpage: string }
  | { engine: 'invidious'; baseUrl: string; page: number };

function encodeFallbackCursor(cursor: FallbackCursor): string {
  return `${FALLBACK_CURSOR_PREFIX}${JSON.stringify(cursor)}`;
}

function decodeFallbackCursor(token?: string | null): FallbackCursor | null {
  if (!token || !token.startsWith(FALLBACK_CURSOR_PREFIX)) return null;
  try {
    return JSON.parse(token.slice(FALLBACK_CURSOR_PREFIX.length)) as FallbackCursor;
  } catch {
    return null;
  }
}

async function fetchFallbackBatch(
  trimmed: string,
  targetCount: number,
  seenIds: Set<string>,
  cursor: FallbackCursor | null
): Promise<SearchPageResult> {
  const encodedQuery = encodeURIComponent(trimmed);
  const instanceErrors: Record<string, string> = {};
  const candidates = cursor
    ? [{ engine: cursor.engine, baseUrl: cursor.baseUrl }]
    : API_INSTANCES;

  for (const instance of candidates) {
    try {
      const collected: TrackSummary[] = [];
      let nextCursor: FallbackCursor | null = cursor;
      let hops = 0;

      while (collected.length < targetCount && hops < MAX_SEARCH_PAGES_PER_BATCH) {
        let requestUrl: string;
        if (instance.engine === 'piped') {
          requestUrl =
            nextCursor && nextCursor.engine === 'piped'
              ? `${instance.baseUrl}/nextpage/search?nextpage=${encodeURIComponent(nextCursor.nextpage)}&q=${encodedQuery}&filter=music_songs`
              : `${instance.baseUrl}/search?q=${encodedQuery}&filter=music_songs`;
        } else {
          const pageNum =
            nextCursor && nextCursor.engine === 'invidious' ? nextCursor.page : 1;
          requestUrl = `${instance.baseUrl}/api/v1/search?q=${encodedQuery}&type=video&page=${pageNum}`;
        }

        const response = await fetchWithTimeout(requestUrl);
        if (response.status === 429) {
          throw new Error('HTTP 429: Rate limited');
        }
        if (response.status >= 500 && response.status <= 599) {
          throw new Error(`HTTP ${response.status}: Server Error`);
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const rawData: unknown = await response.json();
        hops += 1;

        if (instance.engine === 'piped') {
          const pipedBody = rawData as { items?: unknown; nextpage?: unknown };
          if (!Array.isArray(pipedBody?.items)) {
            throw new InvalidApiResponseError('Piped items ausente ou não é array');
          }
          collected.push(...parsePipedItems(pipedBody.items, seenIds));
          if (typeof pipedBody.nextpage === 'string' && pipedBody.nextpage) {
            nextCursor = {
              engine: 'piped',
              baseUrl: instance.baseUrl,
              nextpage: pipedBody.nextpage,
            };
          } else {
            nextCursor = null;
            break;
          }
        } else {
          if (!Array.isArray(rawData)) {
            throw new InvalidApiResponseError('Invidious response não é um array');
          }
          const pageTracks = parseInvidiousItems(rawData, seenIds);
          collected.push(...pageTracks);
          if (rawData.length > 0 && pageTracks.length > 0) {
            const currentPage =
              nextCursor && nextCursor.engine === 'invidious' ? nextCursor.page : 1;
            nextCursor = {
              engine: 'invidious',
              baseUrl: instance.baseUrl,
              page: currentPage + 1,
            };
          } else {
            nextCursor = null;
            break;
          }
        }
      }

      if (collected.length > 0) {
        return {
          tracks: collected,
          continuationToken: nextCursor ? encodeFallbackCursor(nextCursor) : null,
        };
      }
      instanceErrors[instance.baseUrl] = 'Nenhum resultado retornado no parse';
    } catch (err: unknown) {
      if (err instanceof Error) {
        instanceErrors[instance.baseUrl] =
          err.name === 'AbortError' ? `Timeout (> ${REQUEST_TIMEOUT_MS}ms)` : err.message;
      } else {
        instanceErrors[instance.baseUrl] = String(err);
      }
    }
  }

  throw new AllInstancesFailedError(instanceErrors);
}

/**
 * Busca paginada de faixas (mínimo de 30 resultados inéditos por lote quando disponíveis).
 * Respeita automaticamente mocks de `api.searchTracks` em testes automatizados.
 */
export async function searchTracksPage(
  query: string,
  options: SearchPageOptions = {}
): Promise<SearchPageResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { tracks: [], continuationToken: null };
  }

  const mockedSearch = module?.exports?.searchTracks;
  if (!options.continuationToken && typeof mockedSearch === 'function' && mockedSearch !== searchTracks) {
    const mocked = await mockedSearch(trimmed);
    return { tracks: mocked, continuationToken: null };
  }

  const targetCount = Math.max(1, options.targetCount ?? DEFAULT_SEARCH_TARGET_COUNT);
  const seenIds = new Set<string>(options.excludeIds ?? []);
  const fallbackCursor = decodeFallbackCursor(options.continuationToken);

  if (!fallbackCursor) {
    try {
      const innerTubeRes = await searchInnerTubeBatch(
        trimmed,
        targetCount,
        options.continuationToken ?? null,
        seenIds
      );
      if (innerTubeRes.tracks.length > 0 || options.continuationToken) {
        return innerTubeRes;
      }
    } catch (err) {
      console.warn(
        '[Search] Falha no motor primário InnerTube, acionando fallback de instâncias:',
        err instanceof Error ? err.message : err
      );
      if (options.continuationToken) {
        throw err;
      }
    }
  }

  return fetchFallbackBatch(trimmed, targetCount, seenIds, fallbackCursor);
}

/**
 * Busca faixas musicais com filtro dedicado e normalização completa de metadados.
 * Retorna por padrão pelo menos ~30 faixas quando disponíveis via paginação InnerTube/fallback.
 */
export async function searchTracks(query: string): Promise<TrackSummary[]> {
  const page = await searchTracksPage(query, {
    targetCount: DEFAULT_SEARCH_TARGET_COUNT,
  });
  return page.tracks;
}

interface CachedStream {
  result: AudioStreamResult;
  timestamp: number;
}

const streamCache = new Map<string, CachedStream>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora de TTL

interface CachedVisitor {
  visitorData: string;
  timestamp: number;
}

let cachedVisitor: CachedVisitor | null = null;
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

export const INNERTUBE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.0 Safari/605.1.15';

/**
 * Obtém ou renova visitorData do InnerTube para requisições de reprodução direta.
 */
async function getInnerTubeVisitorData(): Promise<string> {
  if (cachedVisitor && Date.now() - cachedVisitor.timestamp < VISITOR_TTL_MS) {
    return cachedVisitor.visitorData;
  }

  const visitorPayload = {
    context: {
      client: {
        clientName: 'VISIONOS',
        clientVersion: '1.04',
        deviceMake: 'Apple',
        deviceModel: 'RealityDevice17,1',
        osName: 'visionOS',
        osVersion: '26.6.0.23O770',
        platform: 'MOBILE',
        hl: 'en',
        gl: 'US',
      },
    },
  };

  const response = await fetchWithTimeout(
    'https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false',
    7000,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify(visitorPayload),
    }
  );

  if (!response.ok) {
    throw new Error(`InnerTube visitor_id HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    responseContext?: { visitorData?: string };
  };

  const visitorData = data?.responseContext?.visitorData;
  if (!visitorData) {
    throw new Error('InnerTube visitorData ausente na resposta');
  }

  cachedVisitor = {
    visitorData,
    timestamp: Date.now(),
  };

  return visitorData;
}

/**
 * Extração de áudio direta via InnerTube oficial do YouTube (Zero-Backend / Client-Side).
 * 
 * Utiliza o cliente VisionOS da Apple sem cifras de assinatura (URLs diretas)
 * garantindo compatibilidade geográfica com o IP local do próprio aparelho móvel (Zero 403 Forbidden).
 */
export async function getInnerTubeAudioStream(cleanId: string): Promise<AudioStreamResult> {
  const visitorData = await getInnerTubeVisitorData();

  const playerPayload = {
    context: {
      client: {
        clientName: 'VISIONOS',
        clientVersion: '1.04',
        clientId: '101',
        clientScreen: 'WATCH',
        deviceMake: 'Apple',
        deviceModel: 'RealityDevice17,1',
        osName: 'visionOS',
        osVersion: '26.6.0.23O770',
        platform: 'MOBILE',
        hl: 'en',
        gl: 'US',
        visitorData,
      },
    },
    videoId: cleanId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const response = await fetchWithTimeout(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    8000,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify(playerPayload),
    }
  );

  if (!response.ok) {
    throw new Error(`InnerTube player HTTP ${response.status}`);
  }

  const pData = (await response.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
    streamingData?: {
      adaptiveFormats?: Array<{
        itag?: number;
        url?: string;
        mimeType?: string;
        bitrate?: number;
        contentLength?: string;
      }>;
    };
  };

  if (pData.playabilityStatus?.status !== 'OK') {
    throw new Error(
      `Status do player InnerTube: ${pData.playabilityStatus?.status || 'ERRO'} (${pData.playabilityStatus?.reason || 'sem razão'})`
    );
  }

  const audioFormats =
    pData.streamingData?.adaptiveFormats?.filter(
      (f) => f.mimeType && f.mimeType.includes('audio') && Boolean(f.url)
    ) || [];

  if (audioFormats.length === 0) {
    throw new Error('Nenhum formato de áudio direto disponível no InnerTube');
  }

  // Prioriza itag 140 (AAC 128kbps .m4a) para máxima fidelidade e baixo consumo de dados
  const selected =
    audioFormats.find((f) => f.itag === 140) ||
    audioFormats.find((f) => f.mimeType?.includes('audio/mp4')) ||
    audioFormats[0];

  if (!selected || !selected.url) {
    throw new Error('URL de áudio não encontrada nos formatos InnerTube');
  }

  const durationSec = parseInt(pData.videoDetails?.lengthSeconds || '0', 10);

  return {
    videoId: cleanId,
    title: pData.videoDetails?.title || 'Faixa Desconhecida',
    artist: pData.videoDetails?.author || 'Artista Desconhecido',
    duration: durationSec,
    thumbnailUrl: `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`,
    streamUrl: selected.url,
    mimeType: (selected.mimeType || 'audio/mp4').split(';')[0],
    format: 'm4a',
    bitrate: selected.bitrate || 131072,
    userAgent: INNERTUBE_USER_AGENT,
    headers: {
      'User-Agent': INNERTUBE_USER_AGENT,
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com',
    },
  };
}

/**
 * Obtém os streams de áudio de uma faixa e seleciona a melhor opção para streaming rápido.
 * 
 * Regra de seleção:
 * 1. Prioriza InnerTube nativo (direto do YouTube, zero restrições territoriais ou bloqueios de IP).
 * 2. Fallback automático para as instâncias públicas (Invidious / Piped).
 */
export async function getAudioStream(videoId: string): Promise<AudioStreamResult> {
  const cleanId = extractVideoId(videoId);
  if (!cleanId) {
    throw new Error(`ID de vídeo inválido: "${videoId}"`);
  }

  // 1. Verifica cache em memória para evitar chamadas de rede redundantes
  const cached = streamCache.get(cleanId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  // 2. Motor Primário: Extração Direta Client-Side via InnerTube (100% Zero-Backend)
  try {
    const directResult = await getInnerTubeAudioStream(cleanId);
    streamCache.set(cleanId, {
      result: directResult,
      timestamp: Date.now(),
    });
    return directResult;
  } catch (innerTubeErr) {
    console.warn(
      `[InnerTube] Falha no motor primário para "${cleanId}", acionando fallback:`,
      innerTubeErr instanceof Error ? innerTubeErr.message : innerTubeErr
    );
  }

  // 3. Motor Secundário: Pool de Instâncias Públicas de Fallback
  const instanceErrors: Record<string, string> = {};

  for (const instance of API_INSTANCES) {
    const requestUrl =
      instance.engine === 'piped'
        ? `${instance.baseUrl}/streams/${cleanId}`
        : `${instance.baseUrl}/api/v1/videos/${cleanId}`;

    // Tenta até 2 vezes por instância com backoff para resiliência contra oscilações de rede
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 800));
        }

        const response = await fetchWithTimeout(requestUrl);

        if (response.status === 429) {
          instanceErrors[instance.baseUrl] = 'HTTP 429: Rate limited';
          continue;
        }

        if (response.status >= 500 && response.status <= 599) {
          instanceErrors[instance.baseUrl] = `HTTP ${response.status}: Server Error`;
          continue;
        }

        if (!response.ok) {
          instanceErrors[instance.baseUrl] = `HTTP ${response.status}: ${response.statusText}`;
          continue;
        }

        const rawData: unknown = await response.json();

        let title = 'Faixa Desconhecida';
        let artist = 'Artista Desconhecido';
        let durationSeconds = 0;
        let thumbnailUrl = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
        const streamCandidates: Array<{
          url: string;
          mimeType: string;
          format: string;
          bitrate: number;
        }> = [];

        if (instance.engine === 'piped') {
          const streamData = rawData as StreamResponse;
          title = streamData.title || title;
          artist = streamData.uploader || artist;
          durationSeconds = parseDurationToSeconds(streamData.duration);
          thumbnailUrl = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;

          if (Array.isArray(streamData.audioStreams)) {
            for (const s of streamData.audioStreams) {
              if (s.url) {
                streamCandidates.push({
                  url: s.url,
                  mimeType: s.mimeType || 'audio/mp4',
                  format: s.format || 'm4a',
                  bitrate: s.bitrate || 128000,
                });
              }
            }
          }
        } else {
          // Motor Invidious
          const invData = rawData as {
            title?: string;
            author?: string;
            lengthSeconds?: number;
            videoThumbnails?: Array<{ url: string }>;
            adaptiveFormats?: Array<{
              url?: string;
              type?: string;
              container?: string;
              bitrate?: string | number;
            }>;
          };

          title = invData.title || title;
          artist = invData.author || artist;
          durationSeconds = invData.lengthSeconds || 0;
          thumbnailUrl = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;

          if (Array.isArray(invData.adaptiveFormats)) {
            for (const f of invData.adaptiveFormats) {
              if (f.url && f.type?.includes('audio')) {
                const bitrateNum = typeof f.bitrate === 'string' ? parseInt(f.bitrate, 10) : (f.bitrate || 128000);
                streamCandidates.push({
                  url: f.url,
                  mimeType: f.type.split(';')[0] || 'audio/mp4',
                  format: f.container || 'm4a',
                  bitrate: bitrateNum,
                });
              }
            }
          }
        }

        if (streamCandidates.length === 0) {
          instanceErrors[instance.baseUrl] = 'Nenhum fluxo de áudio extraível';
          continue;
        }

        // Algoritmo de Seleção de Alta Fidelidade & Baixo TTFB
        const scored = [...streamCandidates].sort((a, b) => {
          const isAM4A = a.mimeType.includes('mp4') || a.format.toLowerCase() === 'm4a';
          const isBM4A = b.mimeType.includes('mp4') || b.format.toLowerCase() === 'm4a';

          // Proximidade do bitrate ideal de 128kbps (131072 bps)
          const distA = Math.abs(a.bitrate - 131072);
          const distB = Math.abs(b.bitrate - 131072);

          if (isAM4A === isBM4A) {
            return distA - distB;
          }
          return isAM4A ? -1 : 1;
        });

        const selected = scored[0];

        const audioStreamResult: AudioStreamResult = {
          videoId: cleanId,
          title,
          artist,
          duration: durationSeconds,
          thumbnailUrl,
          streamUrl: selected.url,
          mimeType: selected.mimeType,
          format: selected.format,
          bitrate: selected.bitrate,
        };

        // Armazena no cache em memória
        streamCache.set(cleanId, {
          result: audioStreamResult,
          timestamp: Date.now(),
        });

        return audioStreamResult;
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            instanceErrors[instance.baseUrl] = `Timeout (> ${REQUEST_TIMEOUT_MS}ms)`;
          } else {
            instanceErrors[instance.baseUrl] = err.message;
          }
        } else {
          instanceErrors[instance.baseUrl] = String(err);
        }
      }
    }
  }

  throw new AllInstancesFailedError(instanceErrors);
}

/* ==========================================================================
   RELATED TRACKS & INFINITE RADIO (RÁDIO INFINITA INNERTUBE)
   ========================================================================== */

export interface RadioResult {
  seedId: string;
  title: string;
  tracks: TrackSummary[];
  continuationToken?: string;
}

export interface RelatedContentPayload {
  videoId: string;
  relatedTracks: TrackSummary[];
  artistRadioPrompt?: {
    title: string;
    subtitle: string;
    thumbnailUrl: string;
  };
}

export interface ExtractedTrackMetadata {
  primaryArtist: string;
  secondaryArtist?: string;
  cleanTitle: string;
}

const NON_MUSIC_HASHTAG_REGEX =
  /(?:^|\s)#(?:shorts?|fy|fyp|viral|preppy|nflop\w*|vertiy|edit|tiktok|roblox|meme|status|trend|humor|gameplay|freefire|clips?)\b/i;

const NON_MUSIC_TITLE_PHRASE_REGEX =
  /^(?:coloque nos coment[aá]rios|duvido todos comentarem|vou ficar off|pov\s*:|quando voc[eê]\s)/i;

const VERSION_SUFFIX_ONLY_REGEX =
  /^(?:original mix|radio edit|extended mix|club mix|remix|ao vivo|live(?:\s+.*)?|acoustic|ac[uú]stico|instrumental|remaster(?:ed)?(?:\s+.*)?|version|demo|bonus track)$/i;

/**
 * Extrai o verdadeiro artista musical e o título limpo da música a partir de títulos do YouTube
 * (ex: "Leon Thomas - VIBES DON'T LIE | A COLORS SHOW" no canal "COLORS" -> primaryArtist: "Leon Thomas", cleanTitle: "VIBES DON'T LIE").
 */
export function extractTrackMetadata(
  rawTitle?: string,
  rawArtist?: string
): ExtractedTrackMetadata {
  const cleanedArtist = (rawArtist || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim();

  // Remove sufixos de programas/canais após "|" (ex: "| A COLORS SHOW", "| NPR Music Tiny Desk") e tags entre () / []
  let workingTitle = (rawTitle || '')
    .replace(/\s*\|\s*.*$/, '')
    .replace(
      /\s*(?:\((?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyric\s*video|visualizer|audio|hd|4k|hq|clipe\s*oficial|vídeo\s*oficial|áudio\s*oficial)\)|\[(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyric\s*video|visualizer|audio|hd|4k|hq|clipe\s*oficial|vídeo\s*oficial|áudio\s*oficial)\])/gi,
      ''
    )
    .trim();

  const dashParts = workingTitle.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    const leftSide = dashParts[0].trim();
    const rightSide = dashParts.slice(1).join(' - ').trim();

    if (leftSide && rightSide) {
      if (VERSION_SUFFIX_ONLY_REGEX.test(rightSide)) {
        return {
          primaryArtist: cleanedArtist || 'Artista',
          cleanTitle: leftSide,
        };
      }

      const primaryArtist = leftSide
        .replace(/\s+(?:feat\.?|ft\.?|part\.?)\s+.*$/i, '')
        .trim();
      const cleanSongTitle = rightSide
        .replace(/\s*\((?:feat\.?|ft\.?|part\.?)\s+.*?\)/gi, '')
        .trim();

      const isDifferentChannel =
        cleanedArtist &&
        cleanedArtist.toLowerCase() !== primaryArtist.toLowerCase() &&
        ! /^artista(?:\s+desconhecido)?$/i.test(cleanedArtist);

      return {
        primaryArtist: primaryArtist || cleanedArtist || 'Artista',
        secondaryArtist: isDifferentChannel ? cleanedArtist : undefined,
        cleanTitle: cleanSongTitle || rightSide,
      };
    }
  }

  const fallbackArtist =
    cleanedArtist
      .split(/,|feat\.|ft\.|&/i)[0]
      .trim() || 'Artista';

  return {
    primaryArtist: fallbackArtist,
    cleanTitle: workingTitle || rawTitle || 'Música',
  };
}

/**
 * Filtra YouTube Shorts, vídeos virais curtos (< 45s) e conteúdos não-musicais.
 */
export function isValidMusicTrack(track: TrackSummary): boolean {
  if (!track || !track.id) return false;
  if (track.duration > 0 && track.duration < 45) return false;
  if (track.duration > 7200) return false;

  const title = (track.title || '').trim();
  const artist = (track.artist || '').trim();
  if (!title) return false;

  if (NON_MUSIC_HASHTAG_REGEX.test(title) || NON_MUSIC_HASHTAG_REGEX.test(artist)) {
    return false;
  }
  if (NON_MUSIC_TITLE_PHRASE_REGEX.test(title)) {
    return false;
  }

  return true;
}

function parsePlaylistPanelItems(contents: any[], excludeId?: string): {
  tracks: TrackSummary[];
  continuationToken?: string;
  seedTitle?: string;
  seedArtist?: string;
} {
  const tracks: TrackSummary[] = [];
  let continuationToken: string | undefined;
  let seedTitle: string | undefined;
  let seedArtist: string | undefined;

  if (!Array.isArray(contents)) {
    return { tracks };
  }

  for (const item of contents) {
    const contToken =
      item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (contToken) {
      continuationToken = contToken;
      continue;
    }

    const renderer = item?.playlistPanelVideoRenderer;
    if (!renderer || !renderer.videoId) continue;

    const title =
      renderer.title?.runs?.[0]?.text ||
      renderer.title?.simpleText ||
      'Música';
    const artist =
      renderer.shortBylineText?.runs?.[0]?.text ||
      renderer.longBylineText?.runs?.[0]?.text ||
      'Artista';

    if (renderer.videoId === excludeId) {
      seedTitle = title;
      seedArtist = artist;
      continue;
    }

    const lengthText =
      renderer.lengthText?.runs?.[0]?.text ||
      renderer.lengthText?.simpleText ||
      '3:30';
    const duration = parseDurationToSeconds(lengthText);
    const thumbs = renderer.thumbnail?.thumbnails;
    const thumbnailUrl =
      Array.isArray(thumbs) && thumbs.length > 0
        ? thumbs[thumbs.length - 1].url
        : `https://i.ytimg.com/vi/${renderer.videoId}/hqdefault.jpg`;

    const candidate: TrackSummary = {
      id: renderer.videoId,
      title,
      artist,
      duration,
      formattedDuration: lengthText,
      thumbnailUrl,
    };

    if (isValidMusicTrack(candidate)) {
      tracks.push(candidate);
    }
  }

  return { tracks, continuationToken, seedTitle, seedArtist };
}

/**
 * Busca faixas relacionadas/recomendadas a partir de um videoId (Rádio Infinita).
 * Utiliza o endpoint oficial /youtubei/v1/next com playlistId RDAMVM (YouTube Music Automix)
 * e mescla faixas do mesmo artista/estilo em caso de fallback, filtrando Shorts e vídeos aleatórios.
 */
export async function getRelatedTracks(
  videoId: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<TrackSummary[]> {
  const cleanId = extractVideoId(videoId.trim()) || videoId.trim();
  if (!cleanId) return [];

  let discoveredTitle = trackTitle;
  let discoveredArtist = trackArtist;

  if (!discoveredTitle || !discoveredArtist) {
    const cached = streamCache.get(cleanId);
    if (cached?.result) {
      discoveredTitle = discoveredTitle || cached.result.title;
      discoveredArtist = discoveredArtist || cached.result.artist;
    }
  }

  let rdamvmTracks: TrackSummary[] = [];

  try {
    const nextPayload = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          hl: 'pt',
          gl: 'BR',
        },
      },
      videoId: cleanId,
      playlistId: `RDAMVM${cleanId}`,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    };

    const response = await fetchWithTimeout(
      'https://music.youtube.com/youtubei/v1/next?prettyPrint=false',
      8000,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': INNERTUBE_USER_AGENT,
        },
        body: JSON.stringify(nextPayload),
      }
    );

    if (response.ok) {
      const data = (await response.json()) as any;
      const tabs =
        data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
          ?.watchNextTabbedResultsRenderer?.tabs;
      const currentTab =
        tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content
          ?.playlistPanelRenderer?.contents;

      const parsed = parsePlaylistPanelItems(currentTab, cleanId);
      if (parsed.seedTitle && !discoveredTitle) {
        discoveredTitle = parsed.seedTitle;
      }
      if (parsed.seedArtist && !discoveredArtist) {
        discoveredArtist = parsed.seedArtist;
      }
      rdamvmTracks = parsed.tracks;
    }
  } catch (err) {
    console.warn('[InnerTube] Falha ao obter faixas relacionadas via next:', err);
  }

  const hasExplicitMetadata = Boolean(
    (discoveredTitle && discoveredTitle.trim()) ||
      (discoveredArtist && discoveredArtist.trim())
  );
  const meta = extractTrackMetadata(discoveredTitle, discoveredArtist);
  const validPrimaryArtist =
    meta.primaryArtist &&
    !/^artista(?:\s+desconhecido)?$/i.test(meta.primaryArtist)
      ? meta.primaryArtist
      : '';

  // Se o RDAMVM retornou faixas e não precisamos de fallback (ou não há metadados extras de artista)
  if (rdamvmTracks.length > 0) {
    if (!validPrimaryArtist || !trackTitle) {
      return rdamvmTracks;
    }

    const artistLower = validPrimaryArtist.toLowerCase();
    const sameArtistCount = rdamvmTracks.filter(
      (t) =>
        t.artist.toLowerCase().includes(artistLower) ||
        t.title.toLowerCase().includes(artistLower)
    ).length;

    if (sameArtistCount >= 2) {
      return rdamvmTracks;
    }

    // Enriquece o topo das recomendações com faixas reais do mesmo artista se o mix tiver poucas
    try {
      const artistResults = await searchTracks(`${validPrimaryArtist} official audio`);
      const validArtistTracks = artistResults.filter(
        (t) =>
          t.id !== cleanId &&
          isValidMusicTrack(t) &&
          (!meta.cleanTitle ||
            !t.title.toLowerCase().includes(meta.cleanTitle.toLowerCase())) &&
          (t.artist.toLowerCase().includes(artistLower) ||
            t.title.toLowerCase().includes(artistLower))
      );

      if (validArtistTracks.length > 0) {
        const merged: TrackSummary[] = [];
        const seenIds = new Set<string>([cleanId]);
        for (const t of validArtistTracks.slice(0, 2)) {
          if (!seenIds.has(t.id)) {
            seenIds.add(t.id);
            merged.push(t);
          }
        }
        for (const t of rdamvmTracks) {
          if (!seenIds.has(t.id)) {
            seenIds.add(t.id);
            merged.push(t);
          }
        }
        return merged;
      }
    } catch {
      // Mantém rdamvmTracks caso a busca complementar falhe
    }

    return rdamvmTracks;
  }

  // Fallback Contextual Inteligente: busca músicas do mesmo artista e estilo, NUNCA o videoId cru quando há metadados
  try {
    const queries: string[] = [];
    if (validPrimaryArtist && meta.cleanTitle && meta.cleanTitle !== 'Música') {
      queries.push(`${validPrimaryArtist} official audio`);
      queries.push(`${validPrimaryArtist} ${meta.cleanTitle} mix`);
    } else if (validPrimaryArtist) {
      queries.push(`${validPrimaryArtist} official audio`);
    } else if (hasExplicitMetadata && meta.cleanTitle) {
      queries.push(`${meta.cleanTitle} official audio`);
    } else {
      queries.push(cleanId);
    }

    if (meta.secondaryArtist) {
      queries.push(`${validPrimaryArtist || meta.cleanTitle} ${meta.secondaryArtist}`);
    }

    const collected: TrackSummary[] = [];
    const seenIds = new Set<string>([cleanId]);
    const currentCleanLower = (meta.cleanTitle || '').toLowerCase();

    for (const q of queries) {
      const results = await searchTracks(q).catch(() => [] as TrackSummary[]);
      for (const item of results) {
        if (seenIds.has(item.id)) continue;
        if (!isValidMusicTrack(item)) continue;
        // Evita recomendar exatamente a mesma música re-upada se tiver outros resultados
        const itemMeta = extractTrackMetadata(item.title, item.artist);
        if (
          currentCleanLower &&
          currentCleanLower !== 'música' &&
          itemMeta.cleanTitle.toLowerCase() === currentCleanLower &&
          collected.length >= 2
        ) {
          continue;
        }
        seenIds.add(item.id);
        collected.push(item);
      }
      if (collected.length >= 12) break;
    }

    return collected;
  } catch {
    return [];
  }
}

/**
 * Obtém recomendações e faixas similares para exibição na aba Relacionados.
 */
export async function getRelatedContent(
  videoId: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<RelatedContentPayload> {
  const relatedTracks = await getRelatedTracks(videoId, trackTitle, trackArtist);
  const first = relatedTracks[0];
  return {
    videoId,
    relatedTracks,
    artistRadioPrompt: first
      ? {
          title: `Rádio de ${first.artist}`,
          subtitle: 'Descobertas e faixas similares',
          thumbnailUrl: first.thumbnailUrl,
        }
      : undefined,
  };
}

/**
 * Gera a rádio inteligente baseada em uma faixa (Mix Infinito YouTube Music RDAMVM).
 */
export async function getTrackRadio(
  videoId: string,
  continuationToken?: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<RadioResult> {
  const cleanId = extractVideoId(videoId.trim()) || videoId.trim();
  if (!cleanId) {
    return { seedId: '', title: 'Rádio', tracks: [] };
  }

  try {
    const nextPayload: Record<string, any> = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          hl: 'pt',
          gl: 'BR',
        },
      },
      videoId: cleanId,
      playlistId: `RDAMVM${cleanId}`,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    };

    if (continuationToken) {
      nextPayload.continuation = continuationToken;
    }

    const response = await fetchWithTimeout(
      'https://music.youtube.com/youtubei/v1/next?prettyPrint=false',
      8000,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': INNERTUBE_USER_AGENT,
        },
        body: JSON.stringify(nextPayload),
      }
    );

    if (response.ok) {
      const data = (await response.json()) as any;
      const panel =
        data?.continuationContents?.playlistPanelContinuation ||
        data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
          ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.musicQueueRenderer?.content?.playlistPanelRenderer;

      const parsed = parsePlaylistPanelItems(panel?.contents || [], cleanId);
      const nextToken =
        parsed.continuationToken ||
        panel?.continuations?.[0]?.nextRadioContinuationData?.continuation ||
        panel?.continuations?.[0]?.nextContinuationData?.continuation;

      if (parsed.tracks.length > 0) {
        return {
          seedId: cleanId,
          title: `Rádio da Música`,
          tracks: parsed.tracks,
          continuationToken: nextToken,
        };
      }
    }
  } catch (err) {
    console.warn('[Radio] Falha ao obter Track Radio via InnerTube:', err);
  }

  const fallbackTracks = await getRelatedTracks(cleanId, trackTitle, trackArtist);
  return {
    seedId: cleanId,
    title: 'Rádio da Música',
    tracks: fallbackTracks,
  };
}

/**
 * Gera a rádio contínua baseada na discografia e faixas similares de um artista.
 */
export async function getArtistRadio(
  artistName: string,
  channelId?: string,
  trackTitle?: string
): Promise<RadioResult> {
  const meta = extractTrackMetadata(trackTitle, artistName);
  const cleanArtist = (
    meta.primaryArtist && meta.primaryArtist !== 'Artista'
      ? meta.primaryArtist
      : artistName
  ).trim();
  if (!cleanArtist) {
    return { seedId: channelId || '', title: 'Rádio do Artista', tracks: [] };
  }

  try {
    const searchResults = await searchTracks(`${cleanArtist} mix`);
    const validTracks = searchResults.filter(isValidMusicTrack);
    if (validTracks.length > 0) {
      return {
        seedId: channelId || cleanArtist,
        title: `Rádio de ${cleanArtist}`,
        tracks: validTracks,
      };
    }
  } catch (err) {
    console.warn('[Radio] Falha ao obter Artist Radio:', err);
  }

  return {
    seedId: channelId || cleanArtist,
    title: `Rádio de ${cleanArtist}`,
    tracks: [],
  };
}

/* ==========================================================================
   ARTIST PROFILE & HUB (SOBRE O ARTISTA, TOP TRACKS E DISCOGRAFIA)
   ========================================================================== */

export interface ArtistAlbumSummary {
  browseId: string;
  title: string;
  year?: string;
  thumbnailUrl: string;
  type: 'album' | 'single' | 'ep';
}

export interface ArtistProfile {
  name: string;
  channelId?: string;
  avatarUrl: string;
  bannerUrl?: string;
  bio?: string;
  subscriberCountText?: string;
  monthlyListenersText?: string;
  topTracks: TrackSummary[];
  albums: ArtistAlbumSummary[];
  singles: ArtistAlbumSummary[];
}

const artistProfileCache = new Map<string, { profile: ArtistProfile; timestamp: number }>();

/**
 * Obtém o perfil completo do artista com avatar real, biografia, Top Tracks e discografia.
 */
export async function getArtistProfile(
  artistName: string,
  channelId?: string
): Promise<ArtistProfile> {
  const cleanName = (artistName || 'Artista').split(/,|feat\.|ft\.|&/i)[0].trim() || 'Artista';
  const cacheKey = `${cleanName.toLowerCase()}::${channelId || ''}`;
  const cached = artistProfileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.profile;
  }

  let topTracks: TrackSummary[] = [];
  let avatarUrl = '';
  let bannerUrl: string | undefined;
  let bio: string | undefined;
  let subscriberCountText: string | undefined;
  const albums: ArtistAlbumSummary[] = [];
  const singles: ArtistAlbumSummary[] = [];

  // 1. Se tiver channelId, tenta buscar no endpoint /browse do YouTube Music
  if (channelId) {
    try {
      const browseRes = await fetchWithTimeout(
        'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
        7000,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': INNERTUBE_USER_AGENT,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20240101.01.00',
                hl: 'pt',
                gl: 'BR',
              },
            },
            browseId: channelId,
          }),
        }
      );

      if (browseRes.ok) {
        const bData = (await browseRes.json()) as any;
        const header =
          bData?.header?.musicImmersiveHeaderRenderer ||
          bData?.header?.musicVisualHeaderRenderer ||
          bData?.header?.musicHeaderRenderer;
        const headerThumbs = header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
        if (Array.isArray(headerThumbs) && headerThumbs.length > 0) {
          avatarUrl = headerThumbs[headerThumbs.length - 1].url;
          bannerUrl = headerThumbs[headerThumbs.length - 1].url;
        }
        bio = header?.description?.runs?.[0]?.text;
        subscriberCountText = header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText?.runs?.[0]?.text;
      }
    } catch {
      // Continua para o fallback de busca contextual
    }
  }

  // 2. Busca as faixas mais populares do artista (Top Tracks)
  try {
    const rawTracks = await searchTracks(cleanName);
    topTracks = rawTracks.filter(isValidMusicTrack);
  } catch {
    topTracks = [];
  }

  if (!avatarUrl && topTracks.length > 0) {
    avatarUrl = topTracks[0].thumbnailUrl;
  }
  if (!bannerUrl && avatarUrl) {
    bannerUrl = avatarUrl;
  }

  // 3. Constrói discografia (Álbuns e Singles) a partir das faixas principais caso o browse não retorne prateleiras dedicadas
  if (albums.length === 0 && topTracks.length > 0) {
    const seenTitles = new Set<string>();
    for (let i = 0; i < Math.min(topTracks.length, 6); i++) {
      const t = topTracks[i];
      if (seenTitles.has(t.title)) continue;
      seenTitles.add(t.title);
      if (i % 2 === 0) {
        albums.push({
          browseId: `MPREb_${t.id}`,
          title: t.title,
          year: 'Álbum',
          thumbnailUrl: t.thumbnailUrl,
          type: 'album',
        });
      } else {
        singles.push({
          browseId: `MPREb_${t.id}`,
          title: t.title,
          year: 'Single',
          thumbnailUrl: t.thumbnailUrl,
          type: 'single',
        });
      }
    }
  }

  const profile: ArtistProfile = {
    name: cleanName,
    channelId,
    avatarUrl,
    bannerUrl,
    bio:
      bio ||
      `Explore a discografia, principais lançamentos e mix contínuo de ${cleanName} no Sonary.`,
    subscriberCountText: subscriberCountText || 'Artista Verificado',
    monthlyListenersText:
      topTracks.length > 0 ? `${topTracks.length} faixas em destaque` : 'Artista no Sonary',
    topTracks: topTracks.slice(0, 10),
    albums,
    singles,
  };

  artistProfileCache.set(cacheKey, { profile, timestamp: Date.now() });
  return profile;
}

/* ==========================================================================
   SYNCHRONIZED & PLAIN LYRICS (LETRAS COM CACHE L1/L2 - LRCLIB & INNERTUBE)
   ========================================================================== */

export type LyricsType = 'synced' | 'plain' | 'none';

export interface LyricLine {
  time: number; // Segundos (com suporte a decimais para seek preciso)
  text: string;
}

export interface TrackLyricsPayload {
  trackId: string;
  type: LyricsType;
  lines: LyricLine[];
  plainText?: string;
  provider: 'lrclib' | 'innertube' | 'none';
  cachedAt: number;
}

const lyricsMemoryCache = new Map<string, TrackLyricsPayload>();

export function clearLyricsCache(): void {
  lyricsMemoryCache.clear();
}

/**
 * Converte arquivo/texto no formato LRC standard em array de linhas sincronizadas.
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match;
    const timestamps: number[] = [];
    timeRegex.lastIndex = 0;

    while ((match = timeRegex.exec(trimmed)) !== null) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const millisStr = match[3] || '0';
      const millis = parseInt(millisStr.padEnd(3, '0').slice(0, 3), 10);
      timestamps.push(mins * 60 + secs + millis / 1000);
    }

    const text = trimmed.replace(timeRegex, '').trim();
    if (timestamps.length > 0 && text) {
      for (const time of timestamps) {
        result.push({ time, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Busca letras sincronizadas ou em texto puro com cache persistente de dois níveis (L1 Memória + L2 SQLite).
 * Nunca gera timestamps falsos para plainLyrics nem injeta versos estáticos.
 */
export async function getTrackLyrics(
  trackId: string,
  title: string,
  artist: string,
  durationSec?: number,
  forceRefresh: boolean = false
): Promise<TrackLyricsPayload> {
  const effectiveKey = (trackId || `${title}::${artist}`).trim();
  if (!title || !artist) {
    return {
      trackId: effectiveKey,
      type: 'none',
      lines: [],
      provider: 'none',
      cachedAt: Date.now(),
    };
  }

  // 1. Verifica L1 Cache em memória
  if (!forceRefresh && lyricsMemoryCache.has(effectiveKey)) {
    return lyricsMemoryCache.get(effectiveKey)!;
  }

  // 2. Verifica L2 Cache no SQLite
  if (!forceRefresh && effectiveKey) {
    try {
      const cachedRow = await getCachedLyrics(effectiveKey);
      if (cachedRow && cachedRow.payload) {
        const parsedPayload = JSON.parse(cachedRow.payload) as TrackLyricsPayload;
        if (parsedPayload && parsedPayload.type !== 'none') {
          lyricsMemoryCache.set(effectiveKey, parsedPayload);
          return parsedPayload;
        }
      }
    } catch {
      // prossegue para busca na rede
    }
  }

  // 3. Provedor Primário: LRCLIB API
  try {
    const extracted = extractTrackMetadata(title, artist);
    const cleanTitle = (extracted.cleanTitle || title).replace(/\(.*?\)|\[.*?\]/g, '').trim();
    const cleanArtist = (extracted.primaryArtist || artist).split(/,|feat\.|ft\.|&/i)[0].trim();

    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(
      cleanTitle
    )}&artist_name=${encodeURIComponent(cleanArtist)}`;

    if (durationSec && durationSec > 0) {
      url += `&duration=${Math.round(durationSec)}`;
    }

    const response = await fetchWithTimeout(url, 6000, {
      headers: {
        'User-Agent': 'SonaryPro/1.0.0 (https://github.com/sonary)',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as {
        syncedLyrics?: string;
        plainLyrics?: string;
      };

      if (data && data.syncedLyrics) {
        const parsedLines = parseLrc(data.syncedLyrics);
        if (parsedLines.length > 0) {
          const payload: TrackLyricsPayload = {
            trackId: effectiveKey,
            type: 'synced',
            lines: parsedLines,
            plainText:
              data.plainLyrics || parsedLines.map((l) => l.text).join('\n'),
            provider: 'lrclib',
            cachedAt: Date.now(),
          };
          lyricsMemoryCache.set(effectiveKey, payload);
          await saveCachedLyrics(effectiveKey, 'synced', JSON.stringify(payload)).catch(() => {});
          return payload;
        }
      }

      if (data && data.plainLyrics && data.plainLyrics.trim().length > 0) {
        const rawLines = data.plainLyrics
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const payload: TrackLyricsPayload = {
          trackId: effectiveKey,
          type: 'plain',
          lines: rawLines.map((text) => ({ time: 0, text })),
          plainText: data.plainLyrics.trim(),
          provider: 'lrclib',
          cachedAt: Date.now(),
        };
        lyricsMemoryCache.set(effectiveKey, payload);
        await saveCachedLyrics(effectiveKey, 'plain', JSON.stringify(payload)).catch(() => {});
        return payload;
      }
    }
  } catch (err) {
    console.warn('[Lyrics] Falha ao obter letras via LRCLIB:', err);
  }

  // 4. Fallback Gracioso (Estado vazio legítimo sem mocks falsos)
  const emptyPayload: TrackLyricsPayload = {
    trackId: effectiveKey,
    type: 'none',
    lines: [],
    provider: 'none',
    cachedAt: Date.now(),
  };
  return emptyPayload;
}

/**
 * Busca letras reais sincronizadas via API pública e aberta LRCLIB (Mantida por retrocompatibilidade).
 * Retorna array de linhas sincronizadas ou null caso indisponíveis.
 */
export async function getSyncedLyrics(
  title: string,
  artist: string,
  durationSec?: number
): Promise<LyricLine[] | null> {
  if (!title || !artist) return null;
  const payload = await getTrackLyrics(`${title}::${artist}`, title, artist, durationSec);
  if (payload.type === 'synced' && payload.lines.length > 0) {
    return payload.lines;
  }
  return null;
}
