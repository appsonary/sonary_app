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
  album?: string;
  duration: number; // em segundos
  formattedDuration: string; // "MM:SS" ou "HH:MM:SS"
  thumbnailUrl: string;
}

export interface ArtistSearchResult {
  id: string; // YouTube channelId / browseId (ex: "UCxVTgYCPCz5Iib9iik9M2bg")
  name: string;
  subtitle?: string;
  thumbnailUrl: string;
}

export interface SearchPageResult {
  tracks: TrackSummary[];
  artists?: ArtistSearchResult[];
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
      'User-Agent': 'SonaryMobile/1.0',
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

declare const module: {
  exports?: {
    searchTracks?: (query: string) => Promise<TrackSummary[]>;
    searchArtists?: (query: string, limit?: number) => Promise<ArtistSearchResult[]>;
    getAudioStream?: (videoId: string) => Promise<AudioStreamResult>;
    getRelatedTracks?: (
      videoId: string,
      trackTitle?: string,
      trackArtist?: string
    ) => Promise<TrackSummary[]>;
  };
} | undefined;

const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);
const YOUTUBE_BARE_HOST_PREFIX_REGEX =
  /^(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\//i;

/**
 * Extrai o ID de 11 caracteres apenas quando a entrada é uma URL válida de vídeo individual do YouTube.
 * Retorna null para buscas textuais comuns, outros domínios ou links puros de playlist.
 */
export function extractYouTubeUrlVideoId(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let candidateUrl = trimmed;
  if (!/^https?:\/\//i.test(candidateUrl)) {
    if (!YOUTUBE_BARE_HOST_PREFIX_REGEX.test(candidateUrl)) {
      return null;
    }
    candidateUrl = `https://${candidateUrl}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_ALLOWED_HOSTS.has(host)) {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  let videoId: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = segments.length === 1 ? segments[0] : null;
  } else if (segments.length === 1 && segments[0].toLowerCase() === 'watch') {
    videoId = parsed.searchParams.get('v');
  } else if (
    segments.length >= 2 &&
    ['shorts', 'live', 'embed', 'v'].includes(segments[0].toLowerCase())
  ) {
    videoId = segments[1];
  }

  return videoId && YOUTUBE_VIDEO_ID_REGEX.test(videoId) ? videoId : null;
}

function cleanArtistSeedName(raw?: string): string {
  return (raw || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestArtistMatch(
  candidates: ArtistSearchResult[],
  seed: string,
  strict: boolean
): ArtistSearchResult | null {
  const valid = (candidates || []).filter(
    (a) => Boolean(a?.id && a?.name?.trim())
  );
  if (valid.length === 0) return null;

  const exactOrStrong = valid.find((a) => artistMatchesInferred(a.name, seed));
  if (exactOrStrong) return exactOrStrong;
  if (strict) return null;

  const seedIsTribute = TRIBUTE_OR_COVER_REGEX.test(seed);
  return (
    valid.find((a) => seedIsTribute || !TRIBUTE_OR_COVER_REGEX.test(a.name)) ||
    null
  );
}

async function expandSingleArtistWithSimilar(
  artists: ArtistSearchResult[]
): Promise<ArtistSearchResult[]> {
  if (artists.length !== 1 || !artists[0]?.id?.startsWith('UC')) {
    return artists;
  }

  try {
    const bData = await postYtmBrowse(artists[0].id, undefined, 5000);
    if (!bData) return artists;
    const parsed = parseArtistBrowsePayload(bData, artists[0].name);
    if (parsed.relatedArtists.length === 0) return artists;

    const merged: ArtistSearchResult[] = [artists[0]];
    const seenIds = new Set<string>([artists[0].id]);
    const seenNames = new Set<string>([normalizeArtistKey(artists[0].name)]);
    for (const similar of parsed.relatedArtists) {
      if (merged.length >= DEFAULT_ARTIST_SEARCH_LIMIT) break;
      const normName = normalizeArtistKey(similar.name);
      if (
        !similar.id ||
        !normName ||
        seenIds.has(similar.id) ||
        seenNames.has(normName)
      ) {
        continue;
      }
      seenIds.add(similar.id);
      seenNames.add(normName);
      merged.push(similar);
    }
    return merged;
  } catch {
    return artists;
  }
}

async function resolveYouTubeUrlSearch(videoId: string): Promise<SearchPageResult> {
  const resolveStream =
    typeof module?.exports?.getAudioStream === 'function'
      ? module.exports.getAudioStream
      : getAudioStream;
  const resolveRelated =
    typeof module?.exports?.getRelatedTracks === 'function'
      ? module.exports.getRelatedTracks
      : getRelatedTracks;
  const resolveArtists =
    typeof module?.exports?.searchArtists === 'function'
      ? module.exports.searchArtists
      : searchArtists;

  let stream: AudioStreamResult;
  try {
    stream = await resolveStream(videoId);
  } catch {
    throw new Error(
      'Não foi possível carregar esta música a partir do link informado. Verifique se ele está correto e disponível.'
    );
  }

  const resolvedId = stream.videoId || videoId;
  const duration = Math.max(0, Math.floor(stream.duration || 0));
  const primaryTrack: TrackSummary = {
    id: resolvedId,
    title: stream.title || 'Faixa Desconhecida',
    artist: stream.artist || 'Artista Desconhecido',
    duration,
    formattedDuration: formatDurationSeconds(duration),
    thumbnailUrl:
      stream.thumbnailUrl || `https://i.ytimg.com/vi/${resolvedId}/hqdefault.jpg`,
  };

  const extractedMeta = extractTrackMetadata(primaryTrack.title, primaryTrack.artist);
  const titleDashParts = (primaryTrack.title || '').split(TITLE_DASH_SEPARATOR_REGEX);
  const rightSideTitleCandidate =
    titleDashParts.length >= 2
      ? cleanArtistSeedName(titleDashParts[1].replace(/\s*[\(\[].*?[\)\]]/g, ''))
      : '';
  const channelArtistSeed = cleanArtistSeedName(primaryTrack.artist);
  const isCompactedChannelHandle =
    /(?:vevo|official)$/i.test(channelArtistSeed) ||
    (channelArtistSeed.length >= 6 && !/\s/.test(channelArtistSeed));

  const primarySeeds: Array<{ name: string; strict: boolean }> = [];
  const primarySeedKeys = new Set<string>();
  const addPrimarySeed = (rawName: string, strict: boolean) => {
    const cleaned = cleanArtistSeedName(rawName);
    const key = normalizeArtistKey(cleaned);
    if (!key || GENERIC_ARTIST_NAME_REGEX.test(cleaned) || primarySeedKeys.has(key)) {
      return;
    }
    primarySeedKeys.add(key);
    primarySeeds.push({ name: cleaned, strict });
  };

  addPrimarySeed(channelArtistSeed, !isCompactedChannelHandle);
  addPrimarySeed(extractedMeta.primaryArtist || '', true);
  if (rightSideTitleCandidate) {
    addPrimarySeed(rightSideTitleCandidate, true);
  }

  const [rawRelated, ...primaryArtistBatches] = await Promise.all([
    Promise.resolve()
      .then(() => resolveRelated(resolvedId, primaryTrack.title, primaryTrack.artist))
      .catch(() => [] as TrackSummary[]),
    ...primarySeeds.map(({ name }) =>
      Promise.resolve()
        .then(() => resolveArtists(name, 4))
        .catch(() => [] as ArtistSearchResult[])
    ),
  ]);

  const seenIds = new Set<string>([primaryTrack.id]);
  const uniqueRelated: TrackSummary[] = [];
  for (const item of rawRelated || []) {
    if (!item?.id || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    uniqueRelated.push(item);
  }

  // Extrai até 6 artistas mais frequentes das faixas relacionadas para compor a prateleira
  const relatedArtistCounts = new Map<string, { name: string; count: number }>();
  for (const item of uniqueRelated) {
    const itemMeta = extractTrackMetadata(item.title, item.artist);
    const candidateName = cleanArtistSeedName(itemMeta.primaryArtist || item.artist);
    const key = normalizeArtistKey(candidateName);
    if (
      !key ||
      primarySeedKeys.has(key) ||
      GENERIC_ARTIST_NAME_REGEX.test(candidateName)
    ) {
      continue;
    }
    const existing = relatedArtistCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      relatedArtistCounts.set(key, { name: candidateName, count: 1 });
    }
  }

  const relatedSeeds = Array.from(relatedArtistCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((entry) => entry.name);

  const relatedArtistBatches =
    relatedSeeds.length > 0
      ? await Promise.all(
          relatedSeeds.map((seed) =>
            Promise.resolve()
              .then(() => resolveArtists(seed, 4))
              .catch(() => [] as ArtistSearchResult[])
          )
        )
      : [];

  const artists: ArtistSearchResult[] = [];
  const seenArtistIds = new Set<string>();
  const seenArtistNames = new Set<string>();
  const appendArtist = (candidate: ArtistSearchResult | null | undefined) => {
    if (!candidate?.id || !candidate.name?.trim()) return;
    if (artists.length >= DEFAULT_ARTIST_SEARCH_LIMIT) return;
    const normName = normalizeArtistKey(candidate.name);
    if (!normName || seenArtistIds.has(candidate.id) || seenArtistNames.has(normName)) {
      return;
    }
    seenArtistIds.add(candidate.id);
    seenArtistNames.add(normName);
    artists.push(candidate);
  };

  primarySeeds.forEach(({ name, strict }, idx) => {
    appendArtist(pickBestArtistMatch(primaryArtistBatches[idx] || [], name, strict));
  });
  relatedSeeds.forEach((seed, idx) => {
    appendArtist(pickBestArtistMatch(relatedArtistBatches[idx] || [], seed, true));
  });

  const expandedArtists = await expandSingleArtistWithSimilar(artists);

  return {
    tracks: [primaryTrack, ...uniqueRelated],
    artists: expandedArtists,
    continuationToken: null,
  };
}

const DEFAULT_SEARCH_TARGET_COUNT = 30;
const DEFAULT_ARTIST_SEARCH_LIMIT = 12;
const MAX_SEARCH_PAGES_PER_BATCH = 4;
const FALLBACK_CURSOR_PREFIX = '__fb__:';
const YTM_ARTIST_SEARCH_PARAMS = 'EgWKAQIgAWoKEAkQChADEAUQBA%3D%3D';

function upgradeArtistThumbUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  return rawUrl.replace(/=w\d+-h\d+/i, '=w240-h240');
}

function parseYouTubeMusicArtistsResponse(
  data: any,
  limit: number = DEFAULT_ARTIST_SEARCH_LIMIT
): ArtistSearchResult[] {
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs;
  const firstTab = Array.isArray(tabs) ? tabs[0]?.tabRenderer?.content : undefined;
  const sections = firstTab?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return [];

  const artists: ArtistSearchResult[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const section of sections) {
    const items = section?.musicShelfRenderer?.contents;
    if (!Array.isArray(items)) continue;

    for (const entry of items) {
      if (artists.length >= limit) return artists;
      const renderer = entry?.musicResponsiveListItemRenderer;
      if (!renderer) continue;

      const browseId = renderer?.navigationEndpoint?.browseEndpoint?.browseId;
      const name =
        renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text?.trim();
      if (!browseId || typeof browseId !== 'string' || !browseId.startsWith('UC') || !name) continue;

      const normName = name.toLowerCase();
      if (seenIds.has(browseId) || seenNames.has(normName)) continue;

      const subRuns =
        renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      const subtitle = Array.isArray(subRuns)
        ? subRuns.map((r: any) => r?.text || '').join('').trim()
        : undefined;

      const thumbs = renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      const rawThumb =
        Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1]?.url || '' : '';

      seenIds.add(browseId);
      seenNames.add(normName);
      artists.push({
        id: browseId,
        name,
        subtitle: subtitle || undefined,
        thumbnailUrl: upgradeArtistThumbUrl(rawThumb),
      });
    }
  }

  return artists;
}

/**
 * Busca os primeiros artistas correspondentes à query no YouTube Music (InnerTube WEB_REMIX).
 * Falha silenciosamente retornando [] para nunca bloquear a busca de músicas.
 */
export async function searchArtists(
  query: string,
  limit: number = DEFAULT_ARTIST_SEARCH_LIMIT
): Promise<ArtistSearchResult[]> {
  const trimmed = query.trim();
  const safeLimit = Math.max(1, limit);
  if (!trimmed) return [];

  try {
    const response = await fetchWithTimeout(
      'https://music.youtube.com/youtubei/v1/search?prettyPrint=false',
      6000,
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
          query: trimmed,
          params: YTM_ARTIST_SEARCH_PARAMS,
        }),
      }
    );

    if (!response.ok) return [];
    const data = await response.json();
    return parseYouTubeMusicArtistsResponse(data, safeLimit);
  } catch {
    return [];
  }
}

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

export interface DominantArtistInference {
  name: string;
  count: number;
  total: number;
  ratio: number;
}

const DOMINANT_ARTIST_SAMPLE_SIZE = 12;
const DOMINANT_ARTIST_MIN_COUNT = 3;
const DOMINANT_ARTIST_MIN_RATIO = 0.35;
const STRONG_DIVERGENCE_MIN_COUNT = 4;
const STRONG_DIVERGENCE_MIN_RATIO = 0.5;
const GENERIC_ARTIST_NAME_REGEX =
  /^(?:artista(?:\s+desconhecido)?|various artists|v[aá]rios artistas)$/i;
const TITLE_DASH_SEPARATOR_REGEX = /\s+[-–—]\s+/;
const TRIBUTE_OR_COVER_REGEX = /\b(?:tribute|tributo|cover|karaoke|instrumental)\b/;

function normalizeArtistKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeArtistForMatch(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,'"`’\-–—_/\\()[\]&+!?]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function artistMatchesInferred(artistName: string, inferredName: string): boolean {
  const a = normalizeArtistForMatch(artistName);
  const b = normalizeArtistForMatch(inferredName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (TRIBUTE_OR_COVER_REGEX.test(a) && !TRIBUTE_OR_COVER_REGEX.test(b)) return false;
  const hasWholePhrase = (haystack: string, needle: string) =>
    needle.length >= 4 && ` ${haystack} `.includes(` ${needle} `);
  return (
    hasWholePhrase(a, b) ||
    (a.length >= b.length * 0.6 && hasWholePhrase(b, a))
  );
}

/**
 * Infere um artista dominante a partir das primeiras 12 faixas retornadas na busca,
 * aplicando limiar mínimo anti-alucinação (count >= 3 e ratio >= 0.35).
 */
export function inferDominantArtistFromTracks(
  tracks: TrackSummary[]
): DominantArtistInference | null {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const sample = tracks.slice(0, DOMINANT_ARTIST_SAMPLE_SIZE);
  const extracted = sample.map((track) => {
    const meta = extractTrackMetadata(track.title, track.artist);
    const dashParts = (track.title || '').split(TITLE_DASH_SEPARATOR_REGEX);
    const isLeftSideCleanTitle =
      dashParts.length >= 2 &&
      normalizeArtistKey(dashParts[0]) === normalizeArtistKey(meta.cleanTitle || '');
    return { isLeftSideCleanTitle, meta };
  });

  const counts = new Map<string, { name: string; count: number }>();

  for (const { meta } of extracted) {
    const rawName = (meta.primaryArtist || '').trim().replace(/\s+/g, ' ');
    const key = normalizeArtistKey(rawName);
    if (!key || GENERIC_ARTIST_NAME_REGEX.test(rawName)) continue;

    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { name: rawName, count: 1 });
    }
  }

  // Reatribui uploads de fãs no formato "Artista - Live ..." cujo lado esquerdo já aparece como artista no lote.
  for (const { isLeftSideCleanTitle, meta } of extracted) {
    if (!isLeftSideCleanTitle) continue;
    const primaryKey = normalizeArtistKey(meta.primaryArtist || '');
    const titleName = (meta.cleanTitle || '').trim().replace(/\s+/g, ' ');
    const titleKey = normalizeArtistKey(titleName);
    if (!titleKey || titleKey === primaryKey || GENERIC_ARTIST_NAME_REGEX.test(titleName)) {
      continue;
    }

    const primaryEntry = primaryKey ? counts.get(primaryKey) : undefined;
    const titleEntry = counts.get(titleKey);
    if (
      titleEntry &&
      (!primaryEntry || primaryEntry.count <= 1 || primaryEntry.count < titleEntry.count)
    ) {
      titleEntry.count += 1;
      if (primaryEntry) {
        primaryEntry.count -= 1;
      }
    }
  }

  let best: { name: string; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  if (!best) return null;
  const total = sample.length;
  const ratio = best.count / total;
  if (best.count < DOMINANT_ARTIST_MIN_COUNT || ratio < DOMINANT_ARTIST_MIN_RATIO) {
    return null;
  }

  return { name: best.name, count: best.count, total, ratio };
}

async function enrichArtistsFromTracks(
  query: string,
  tracks: TrackSummary[],
  primaryArtists: ArtistSearchResult[],
  fetchArtists: (query: string, limit?: number) => Promise<ArtistSearchResult[]>
): Promise<ArtistSearchResult[]> {
  if (tracks.length === 0) return primaryArtists;

  const inferred = inferDominantArtistFromTracks(tracks);
  if (!inferred) return primaryArtists;

  if (normalizeArtistKey(inferred.name) === normalizeArtistKey(query)) {
    return primaryArtists;
  }

  const safeFetchArtists = async (artistQuery: string): Promise<ArtistSearchResult[]> => {
    try {
      const res = await fetchArtists(artistQuery, DEFAULT_ARTIST_SEARCH_LIMIT);
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  };

  if (primaryArtists.length === 0) {
    return safeFetchArtists(inferred.name);
  }

  if (
    inferred.count < STRONG_DIVERGENCE_MIN_COUNT ||
    inferred.ratio < STRONG_DIVERGENCE_MIN_RATIO
  ) {
    return primaryArtists;
  }

  if (primaryArtists.some((a) => artistMatchesInferred(a.name, inferred.name))) {
    return primaryArtists;
  }

  const fallbackArtists = await safeFetchArtists(inferred.name);
  if (fallbackArtists.length === 0) {
    return primaryArtists;
  }

  const merged: ArtistSearchResult[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const artist of [...fallbackArtists, ...primaryArtists]) {
    if (merged.length >= DEFAULT_ARTIST_SEARCH_LIMIT) break;
    const normName = artist.name.trim().toLowerCase();
    if (!artist.id || !normName || seenIds.has(artist.id) || seenNames.has(normName)) {
      continue;
    }
    seenIds.add(artist.id);
    seenNames.add(normName);
    merged.push(artist);
  }
  return merged;
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
    return { tracks: [], artists: [], continuationToken: null };
  }

  const mockedSearch = module?.exports?.searchTracks;
  const mockedArtists = module?.exports?.searchArtists;
  const hasMockedSearch =
    typeof mockedSearch === 'function' && mockedSearch !== searchTracks;
  const hasMockedArtists =
    typeof mockedArtists === 'function' && mockedArtists !== searchArtists;
  const resolveArtists = hasMockedArtists ? mockedArtists : searchArtists;

  if (!options.continuationToken && !hasMockedSearch) {
    const directVideoId = extractYouTubeUrlVideoId(trimmed);
    if (directVideoId) {
      return resolveYouTubeUrlSearch(directVideoId);
    }
  }

  if (!options.continuationToken && hasMockedSearch) {
    const [mocked, primaryArtists] = await Promise.all([
      mockedSearch(trimmed),
      hasMockedArtists
        ? Promise.resolve()
            .then(() => mockedArtists(trimmed, DEFAULT_ARTIST_SEARCH_LIMIT))
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    const artists =
      hasMockedArtists && mocked.length > 0
        ? await enrichArtistsFromTracks(trimmed, mocked, primaryArtists, mockedArtists)
        : primaryArtists;
    return { tracks: mocked, artists, continuationToken: null };
  }

  const targetCount = Math.max(1, options.targetCount ?? DEFAULT_SEARCH_TARGET_COUNT);
  const seenIds = new Set<string>(options.excludeIds ?? []);
  const fallbackCursor = decodeFallbackCursor(options.continuationToken);

  const artistsPromise: Promise<ArtistSearchResult[]> | null = !options.continuationToken
    ? Promise.resolve()
        .then(() => resolveArtists(trimmed, DEFAULT_ARTIST_SEARCH_LIMIT))
        .catch(() => [])
    : null;

  if (!fallbackCursor) {
    try {
      const innerTubeRes = await searchInnerTubeBatch(
        trimmed,
        targetCount,
        options.continuationToken ?? null,
        seenIds
      );
      if (innerTubeRes.tracks.length > 0 || options.continuationToken) {
        if (!artistsPromise) {
          return innerTubeRes;
        }
        const primaryArtists = await artistsPromise;
        const enrichedArtists =
          innerTubeRes.tracks.length > 0
            ? await enrichArtistsFromTracks(trimmed, innerTubeRes.tracks, primaryArtists, resolveArtists)
            : primaryArtists;
        const artists = await expandSingleArtistWithSimilar(enrichedArtists);
        return { ...innerTubeRes, artists };
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

  const fallbackRes = await fetchFallbackBatch(trimmed, targetCount, seenIds, fallbackCursor);
  if (!artistsPromise) {
    return fallbackRes;
  }
  const primaryArtists = await artistsPromise;
  const enrichedArtists =
    fallbackRes.tracks.length > 0
      ? await enrichArtistsFromTracks(trimmed, fallbackRes.tracks, primaryArtists, resolveArtists)
      : primaryArtists;
  const artists = await expandSingleArtistWithSimilar(enrichedArtists);
  return { ...fallbackRes, artists };
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

export function invalidateStreamCache(videoId?: string): void {
  if (!videoId) {
    streamCache.clear();
    return;
  }
  const cleanId = extractVideoId(videoId);
  if (cleanId) {
    streamCache.delete(cleanId);
  }
}

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
function isValidMusicTrackCore(track: TrackSummary, allowShort: boolean): boolean {
  if (!track || !track.id) return false;
  if (!allowShort && track.duration > 0 && track.duration < 45) return false;
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

export function isValidMusicTrack(track: TrackSummary): boolean {
  return isValidMusicTrackCore(track, false);
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
  subtitle?: string;
  thumbnailUrl: string;
  type: 'album' | 'single' | 'ep';
}

export interface AlbumDetail {
  browseId: string;
  title: string;
  artist: string;
  year?: string;
  type: 'album' | 'single' | 'ep';
  thumbnailUrl: string;
  trackCount: number;
  totalDuration: number;
  tracks: TrackSummary[];
}

export interface ArtistProfile {
  name: string;
  channelId?: string;
  avatarUrl: string;
  bannerUrl?: string;
  subtitle?: string;
  bio?: string;
  subscriberCountText?: string;
  monthlyListenersText?: string;
  songsBrowseId?: string;
  songsBrowseParams?: string;
  topTracks: TrackSummary[];
  albums: ArtistAlbumSummary[];
  singles: ArtistAlbumSummary[];
  relatedArtists?: ArtistSearchResult[];
}

const artistProfileCache = new Map<string, { profile: ArtistProfile; timestamp: number }>();
const artistTopTracksCache = new Map<string, { tracks: TrackSummary[]; timestamp: number }>();
const albumDetailCache = new Map<string, { album: AlbumDetail; timestamp: number }>();

export function clearArtistAndAlbumCaches(): void {
  artistProfileCache.clear();
  artistTopTracksCache.clear();
  albumDetailCache.clear();
}

const YTM_WEB_REMIX_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.01.00',
    hl: 'pt',
    gl: 'BR',
  },
};

async function postYtmBrowse(
  browseId: string,
  params?: string,
  timeoutMs: number = 7000
): Promise<any | null> {
  const payload: Record<string, unknown> = {
    context: YTM_WEB_REMIX_CONTEXT,
    browseId,
  };
  if (params) {
    payload.params = params;
  }

  const response = await fetchWithTimeout(
    'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
    timeoutMs,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) return null;
  return response.json();
}

function pickBestThumbnail(
  thumbnails: unknown,
  maxWidth: number = 1920
): string {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return '';
  const valid = thumbnails.filter(
    (t): t is { url: string; width?: number; height?: number } =>
      Boolean(t && typeof t === 'object' && typeof (t as any).url === 'string' && (t as any).url)
  );
  if (valid.length === 0) return '';

  const withWidth = valid.filter((t) => typeof t.width === 'number' && t.width > 0);
  if (withWidth.length === 0) {
    return valid[valid.length - 1].url;
  }

  const underLimit = withWidth.filter((t) => (t.width as number) <= maxWidth);
  const pool = underLimit.length > 0 ? underLimit : withWidth;
  pool.sort((a, b) => (a.width as number) - (b.width as number));
  return pool[pool.length - 1].url;
}

function joinRunsText(runs: unknown): string {
  if (!Array.isArray(runs)) return '';
  return runs
    .map((r: any) => (typeof r?.text === 'string' ? r.text : ''))
    .join('')
    .trim();
}

function getBrowsePageType(endpoint: any): string | undefined {
  return endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType;
}

function parseMusicListTrackItem(
  renderer: any,
  fallbackArtist: string,
  options?: { fallbackThumbnail?: string; fallbackAlbum?: string; allowShortTracks?: boolean }
): TrackSummary | null {
  if (!renderer) return null;

  const videoId =
    renderer?.playlistItemData?.videoId ||
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
    renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
      ?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId || typeof videoId !== 'string') return null;

  const title =
    renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text?.trim();
  if (!title) return null;

  let artistText: string | undefined;
  let albumText: string | undefined = options?.fallbackAlbum;
  const flexCols = Array.isArray(renderer?.flexColumns) ? renderer.flexColumns : [];

  for (let i = 1; i < flexCols.length; i++) {
    const runs = flexCols[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    if (!Array.isArray(runs)) continue;

    for (const run of runs) {
      const text = typeof run?.text === 'string' ? run.text.trim() : '';
      if (!text || text === '•' || text === '·' || text === '&' || text === ',') continue;
      const browseId = run?.navigationEndpoint?.browseEndpoint?.browseId;
      const pageType = getBrowsePageType(run?.navigationEndpoint);

      if (
        !albumText &&
        (pageType === 'MUSIC_PAGE_TYPE_ALBUM' ||
          (typeof browseId === 'string' && browseId.startsWith('MPREb_')))
      ) {
        albumText = text;
        continue;
      }

      if (
        !artistText &&
        (pageType === 'MUSIC_PAGE_TYPE_ARTIST' ||
          (typeof browseId === 'string' && browseId.startsWith('UC')))
      ) {
        artistText = text;
      }
    }
  }

  if (!artistText) {
    const secondRuns = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    if (Array.isArray(secondRuns)) {
      artistText = secondRuns
        .map((r: any) => (typeof r?.text === 'string' ? r.text.trim() : ''))
        .find(
          (t: string) =>
            t &&
            t !== '•' &&
            t !== '·' &&
            t !== '&' &&
            !/^\d+:\d{2}(?::\d{2})?$/.test(t) &&
            !/^tocou\s/i.test(t) &&
            !/\b(?:plays?|visualizaç|ouvintes)\b/i.test(t)
        );
    }
  }

  let durationText =
    renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text?.trim();
  if (!durationText) {
    for (const col of flexCols) {
      const runs = col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      if (!Array.isArray(runs)) continue;
      const match = runs.find(
        (r: any) => typeof r?.text === 'string' && /^\d+:\d{2}(?::\d{2})?$/.test(r.text.trim())
      );
      if (match) {
        durationText = match.text.trim();
        break;
      }
    }
  }

  const formattedDuration = durationText || '';
  const duration = formattedDuration ? parseDurationToSeconds(formattedDuration) : 0;
  const thumbs = renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const parsedThumb = pickBestThumbnail(thumbs, 544);
  const thumbnailUrl =
    parsedThumb ||
    options?.fallbackThumbnail ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const candidate: TrackSummary = {
    id: videoId,
    title,
    artist: artistText || fallbackArtist,
    ...(albumText ? { album: albumText } : {}),
    duration,
    formattedDuration,
    thumbnailUrl,
  };

  return isValidMusicTrackCore(candidate, Boolean(options?.allowShortTracks))
    ? candidate
    : null;
}

function extractBrowseSections(data: any): any[] {
  const singleTabs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs;
  const singleSections = Array.isArray(singleTabs)
    ? singleTabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents
    : undefined;
  if (Array.isArray(singleSections)) return singleSections;

  const twoCol = data?.contents?.twoColumnBrowseResultsRenderer;
  const secondary = twoCol?.secondaryContents?.sectionListRenderer?.contents;
  const primary = twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
  return [
    ...(Array.isArray(secondary) ? secondary : []),
    ...(Array.isArray(primary) ? primary : []),
  ];
}

function parseArtistBrowsePayload(
  data: any,
  fallbackArtist: string
): {
  topTracks: TrackSummary[];
  songsBrowseId?: string;
  songsBrowseParams?: string;
  albums: ArtistAlbumSummary[];
  singles: ArtistAlbumSummary[];
  relatedArtists: ArtistSearchResult[];
} {
  const sections = extractBrowseSections(data);
  const topTracks: TrackSummary[] = [];
  const seenTrackIds = new Set<string>();
  const albums: ArtistAlbumSummary[] = [];
  const singles: ArtistAlbumSummary[] = [];
  const seenReleaseIds = new Set<string>();
  const relatedArtists: ArtistSearchResult[] = [];
  const seenArtistIds = new Set<string>();
  let songsBrowseId: string | undefined;
  let songsBrowseParams: string | undefined;

  for (const section of sections) {
    const shelf = section?.musicShelfRenderer;
    if (shelf && Array.isArray(shelf.contents)) {
      if (!songsBrowseId) {
        const endpoint =
          shelf?.bottomEndpoint?.browseEndpoint ||
          shelf?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
        if (typeof endpoint?.browseId === 'string' && endpoint.browseId) {
          songsBrowseId = endpoint.browseId;
          if (typeof endpoint.params === 'string' && endpoint.params) {
            songsBrowseParams = endpoint.params;
          }
        }
      }

      for (const entry of shelf.contents) {
        const track = parseMusicListTrackItem(
          entry?.musicResponsiveListItemRenderer,
          fallbackArtist
        );
        if (track && !seenTrackIds.has(track.id)) {
          seenTrackIds.add(track.id);
          topTracks.push(track);
        }
      }
      continue;
    }

    const carousel = section?.musicCarouselShelfRenderer;
    if (!carousel || !Array.isArray(carousel.contents)) continue;

    const shelfTitle = joinRunsText(
      carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs
    );
    const isAlbumsShelf = /(?:á|a)lbuns|\balbums\b/i.test(shelfTitle);
    const isSinglesShelf = /\bsingles?\b|\beps?\b/i.test(shelfTitle);
    const isRelatedArtistsShelf =
      /f[ãa]s\s+tamb[ée]m|fans\s+might\s+also\s+like|artistas?\s+(?:similares|relacionados)|related\s+artists/i.test(
        shelfTitle
      );

    if (!isAlbumsShelf && !isSinglesShelf && !isRelatedArtistsShelf) {
      continue;
    }

    for (const entry of carousel.contents) {
      const card = entry?.musicTwoRowItemRenderer;
      if (!card) continue;

      const browseId = card?.navigationEndpoint?.browseEndpoint?.browseId;
      const pageType = getBrowsePageType(card?.navigationEndpoint);
      const title = joinRunsText(card?.title?.runs);
      if (!browseId || typeof browseId !== 'string' || !title) continue;

      const subtitleText = joinRunsText(card?.subtitle?.runs);
      const thumbs = card?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      const thumbnailUrl = pickBestThumbnail(thumbs, 544);

      if (isRelatedArtistsShelf) {
        if (
          (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || browseId.startsWith('UC')) &&
          !seenArtistIds.has(browseId)
        ) {
          seenArtistIds.add(browseId);
          relatedArtists.push({
            id: browseId,
            name: title,
            subtitle: subtitleText || undefined,
            thumbnailUrl,
          });
        }
        continue;
      }

      const isAlbumItem =
        pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId.startsWith('MPREb_');
      if (!isAlbumItem || seenReleaseIds.has(browseId)) continue;
      seenReleaseIds.add(browseId);

      const yearMatch = subtitleText.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : undefined;
      const isEp = /\bep\b/i.test(subtitleText);
      const isSingle = isSinglesShelf || /\bsingle\b/i.test(subtitleText);
      const type: 'album' | 'single' | 'ep' = isEp ? 'ep' : isSingle ? 'single' : 'album';

      const release: ArtistAlbumSummary = {
        browseId,
        title,
        year,
        subtitle: subtitleText || undefined,
        thumbnailUrl,
        type,
      };

      if (isSinglesShelf) {
        singles.push(release);
      } else {
        albums.push(release);
      }
    }
  }

  return {
    topTracks,
    songsBrowseId,
    songsBrowseParams,
    albums,
    singles,
    relatedArtists,
  };
}

/**
 * Carrega a lista completa de faixas populares de um artista ("Ver tudo") via /browse.
 */
export async function getArtistTopTracks(
  browseId: string,
  params?: string,
  fallbackArtist: string = 'Artista',
  timeoutMs: number = 4000
): Promise<TrackSummary[]> {
  if (!browseId) return [];
  const cacheKey = `${browseId}::${params || ''}`;
  const cached = artistTopTracksCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.tracks;
  }

  try {
    const data = await postYtmBrowse(browseId, params, timeoutMs);
    if (!data) return [];

    const sections = extractBrowseSections(data);
    const tracks: TrackSummary[] = [];
    const seenIds = new Set<string>();

    for (const section of sections) {
      const items =
        section?.musicPlaylistShelfRenderer?.contents ||
        section?.musicShelfRenderer?.contents;
      if (!Array.isArray(items)) continue;

      for (const entry of items) {
        const track = parseMusicListTrackItem(
          entry?.musicResponsiveListItemRenderer,
          fallbackArtist
        );
        if (track && !seenIds.has(track.id)) {
          seenIds.add(track.id);
          tracks.push(track);
          if (tracks.length >= 50) break;
        }
      }
      if (tracks.length >= 50) break;
    }

    const capped = tracks.slice(0, 50);
    if (capped.length > 0) {
      artistTopTracksCache.set(cacheKey, { tracks: capped, timestamp: Date.now() });
    }
    return capped;
  } catch {
    return [];
  }
}

/**
 * Obtém o detalhe real de um álbum, single ou EP (`MPREb_...`) via /youtubei/v1/browse.
 */
export async function getAlbumDetail(
  browseId: string,
  fallbackMeta?: Partial<ArtistAlbumSummary> & { artist?: string }
): Promise<AlbumDetail> {
  const cleanBrowseId = (browseId || '').trim();
  if (cleanBrowseId) {
    const cached = albumDetailCache.get(cleanBrowseId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.album;
    }
  }

  let title = fallbackMeta?.title || 'Álbum';
  let artist = fallbackMeta?.artist || 'Artista';
  let year = fallbackMeta?.year;
  let type: 'album' | 'single' | 'ep' = fallbackMeta?.type || 'album';
  let thumbnailUrl = fallbackMeta?.thumbnailUrl || '';
  let tracks: TrackSummary[] = [];

  if (cleanBrowseId) {
    try {
      const data = await postYtmBrowse(cleanBrowseId, undefined, 7000);
      if (data) {
        const twoCol = data?.contents?.twoColumnBrowseResultsRenderer;
        const primarySections =
          twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        const respHeader = primarySections.find(
          (s: any) => s?.musicResponsiveHeaderRenderer
        )?.musicResponsiveHeaderRenderer;
        const header =
          respHeader ||
          data?.header?.musicDetailHeaderRenderer ||
          data?.header?.musicResponsiveHeaderRenderer;

        if (header) {
          const parsedTitle = joinRunsText(header?.title?.runs);
          if (parsedTitle) title = parsedTitle;

          const parsedArtist = joinRunsText(header?.straplineTextOne?.runs);
          if (parsedArtist) artist = parsedArtist;

          const subtitle = joinRunsText(header?.subtitle?.runs);
          const yearMatch = subtitle.match(/\b(19|20)\d{2}\b/);
          if (yearMatch) year = yearMatch[0];
          if (/\bep\b/i.test(subtitle)) type = 'ep';
          else if (/\bsingle\b/i.test(subtitle)) type = 'single';
          else if (/(?:á|a)lbum|\balbum\b/i.test(subtitle)) type = 'album';

          const headerThumb = pickBestThumbnail(
            header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
              header?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails,
            544
          );
          if (headerThumb) thumbnailUrl = headerThumb;
        }

        const sections = extractBrowseSections(data);
        const seenIds = new Set<string>();
        for (const section of sections) {
          const items =
            section?.musicShelfRenderer?.contents ||
            section?.musicPlaylistShelfRenderer?.contents;
          if (!Array.isArray(items)) continue;

          for (const entry of items) {
            const track = parseMusicListTrackItem(
              entry?.musicResponsiveListItemRenderer,
              artist,
              { fallbackThumbnail: thumbnailUrl, fallbackAlbum: title, allowShortTracks: true }
            );
            if (track && !seenIds.has(track.id)) {
              seenIds.add(track.id);
              tracks.push(track);
            }
          }
        }
      }
    } catch {
      // Continua para fallback contextual se necessário
    }
  }

  if (tracks.length === 0 && fallbackMeta?.title) {
    try {
      const searchFn =
        typeof module?.exports?.searchTracks === 'function'
          ? module.exports.searchTracks
          : searchTracks;
      const query = fallbackMeta.artist
        ? `${fallbackMeta.artist} ${fallbackMeta.title}`
        : fallbackMeta.title;
      const found = await searchFn(query);
      tracks = (found || []).filter(isValidMusicTrack).slice(0, 12);
    } catch {
      tracks = [];
    }
  }

  if (!thumbnailUrl && tracks.length > 0) {
    thumbnailUrl = tracks[0].thumbnailUrl;
  }

  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const album: AlbumDetail = {
    browseId: cleanBrowseId,
    title,
    artist,
    year,
    type,
    thumbnailUrl,
    trackCount: tracks.length,
    totalDuration,
    tracks,
  };

  if (cleanBrowseId && tracks.length > 0) {
    albumDetailCache.set(cleanBrowseId, { album, timestamp: Date.now() });
  }
  return album;
}

/**
 * Obtém o perfil completo do artista com banner/avatar reais, biografia, Top Tracks,
 * Álbuns, Singles & EPs e artistas semelhantes via /youtubei/v1/browse.
 */
export async function getArtistProfile(
  artistName: string,
  channelId?: string
): Promise<ArtistProfile> {
  const cleanName = (artistName || 'Artista').split(/,|feat\.|ft\.|&/i)[0].trim() || 'Artista';
  const initialCacheKey = `${cleanName.toLowerCase()}::${channelId || ''}`;
  const cached = artistProfileCache.get(initialCacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.profile;
  }

  let resolvedChannelId = channelId?.trim() || undefined;
  let searchArtistMeta: ArtistSearchResult | undefined;
  let hadNetworkFailure = false;

  // 1. Se channelId não foi informado (ex.: vindo do NowPlayingModal), resolve via searchArtists
  if (!resolvedChannelId && cleanName && cleanName.toLowerCase() !== 'artista') {
    try {
      const artistSearchFn =
        typeof module?.exports?.searchArtists === 'function'
          ? module.exports.searchArtists
          : searchArtists;
      const matches = await artistSearchFn(cleanName, 3);
      if (Array.isArray(matches) && matches.length > 0) {
        const targetNorm = normalizeArtistForMatch(cleanName);
        searchArtistMeta =
          matches.find((a) => normalizeArtistForMatch(a.name) === targetNorm) ||
          matches.find((a) => artistMatchesInferred(a.name, cleanName)) ||
          matches[0];
        if (searchArtistMeta?.id) {
          resolvedChannelId = searchArtistMeta.id;
        }
      }
    } catch {
      hadNetworkFailure = true;
    }
  }

  if (resolvedChannelId && resolvedChannelId !== channelId) {
    const resolvedCacheKey = `${cleanName.toLowerCase()}::${resolvedChannelId}`;
    const resolvedCached = artistProfileCache.get(resolvedCacheKey);
    if (resolvedCached && Date.now() - resolvedCached.timestamp < CACHE_TTL_MS) {
      artistProfileCache.set(initialCacheKey, resolvedCached);
      return resolvedCached.profile;
    }
  }

  let resolvedName = cleanName;
  let topTracks: TrackSummary[] = [];
  let browseTracks: TrackSummary[] = [];
  let avatarUrl = searchArtistMeta?.thumbnailUrl || '';
  let bannerUrl: string | undefined;
  let bio: string | undefined;
  let subscriberCountText: string | undefined;
  let monthlyListenersText: string | undefined;
  let songsBrowseId: string | undefined;
  let songsBrowseParams: string | undefined;
  let albums: ArtistAlbumSummary[] = [];
  let singles: ArtistAlbumSummary[] = [];
  let relatedArtists: ArtistSearchResult[] = [];

  // 2. Busca o perfil real no endpoint /browse do YouTube Music
  if (resolvedChannelId) {
    try {
      const bData = await postYtmBrowse(resolvedChannelId, undefined, 7000);
      if (bData) {
        const header =
          bData?.header?.musicImmersiveHeaderRenderer ||
          bData?.header?.musicVisualHeaderRenderer ||
          bData?.header?.musicHeaderRenderer;

        const headerTitle = joinRunsText(header?.title?.runs);
        if (headerTitle) {
          resolvedName = headerTitle;
        }

        const headerThumbs = header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
        const bestBanner = pickBestThumbnail(headerThumbs, 1920);
        if (bestBanner) {
          bannerUrl = bestBanner;
          avatarUrl = bestBanner;
        }

        const rawBio = joinRunsText(header?.description?.runs);
        if (rawBio) {
          bio = rawBio;
        }

        const subBtn = header?.subscriptionButton?.subscribeButtonRenderer;
        subscriberCountText =
          joinRunsText(subBtn?.longSubscriberCountText?.runs) ||
          joinRunsText(subBtn?.subscriberCountText?.runs) ||
          undefined;
        monthlyListenersText =
          joinRunsText(header?.monthlyListenerCount?.runs) || undefined;

        const parsed = parseArtistBrowsePayload(bData, resolvedName);
        browseTracks = parsed.topTracks;
        songsBrowseId = parsed.songsBrowseId;
        songsBrowseParams = parsed.songsBrowseParams;
        albums = parsed.albums;
        singles = parsed.singles;
        relatedArtists = parsed.relatedArtists;
      } else {
        hadNetworkFailure = true;
      }
    } catch {
      hadNetworkFailure = true;
    }
  }

  // 3. Se houver playlist completa de populares (songsBrowseId), enriquece faixas com durações reais e lista expandida
  if (songsBrowseId && browseTracks.length > 0) {
    const expandedTracks = await getArtistTopTracks(
      songsBrowseId,
      songsBrowseParams,
      resolvedName,
      4000
    ).catch(() => [] as TrackSummary[]);
    if (expandedTracks.length > 0) {
      browseTracks = expandedTracks;
    }
  }

  // 4. Prioriza as faixas reais da prateleira Top músicas do /browse antes do fallback searchTracks
  if (browseTracks.length > 0) {
    topTracks = browseTracks;
  } else {
    try {
      const searchFn =
        typeof module?.exports?.searchTracks === 'function'
          ? module.exports.searchTracks
          : searchTracks;
      const rawTracks = await searchFn(resolvedName);
      topTracks = (rawTracks || []).filter(isValidMusicTrack);
    } catch {
      hadNetworkFailure = true;
      topTracks = [];
    }
  }

  const hasProfileData = Boolean(
    topTracks.length > 0 || albums.length > 0 || singles.length > 0 || bio
  );
  if (!hasProfileData && hadNetworkFailure) {
    throw new Error('Não foi possível carregar os dados do artista.');
  }

  if (!avatarUrl && topTracks.length > 0) {
    avatarUrl = topTracks[0].thumbnailUrl;
  }
  if (!bannerUrl && avatarUrl) {
    bannerUrl = avatarUrl;
  }

  const statDetail =
    monthlyListenersText ||
    (searchArtistMeta?.subtitle &&
    searchArtistMeta.subtitle.toLowerCase() !== 'artista'
      ? searchArtistMeta.subtitle.replace(/^artista\s*[•·-]\s*/i, '').trim()
      : undefined) ||
    subscriberCountText;

  const subtitle = statDetail ? `Artista • ${statDetail}` : 'Artista';

  const profile: ArtistProfile = {
    name: resolvedName,
    channelId: resolvedChannelId,
    avatarUrl,
    bannerUrl,
    subtitle,
    ...(bio ? { bio } : {}),
    ...(subscriberCountText ? { subscriberCountText } : {}),
    monthlyListenersText: monthlyListenersText || subscriberCountText || 'Artista',
    ...(songsBrowseId ? { songsBrowseId } : {}),
    ...(songsBrowseParams ? { songsBrowseParams } : {}),
    topTracks: topTracks.slice(0, 50),
    albums,
    singles,
    ...(relatedArtists.length > 0 ? { relatedArtists } : {}),
  };

  // Nunca grava perfis vazios no cache para não travar o usuário sem dados após falha transitória
  if (hasProfileData) {
    const entry = { profile, timestamp: Date.now() };
    artistProfileCache.set(initialCacheKey, entry);
    if (resolvedChannelId) {
      artistProfileCache.set(`${cleanName.toLowerCase()}::${resolvedChannelId}`, entry);
    }
  }
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
        'User-Agent': 'Sonary/1.0.0 (https://appsonary.com)',
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
