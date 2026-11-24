/**
 * Pool de instâncias públicas de fallback (Invidious / Piped) para busca e extração de áudio.
 */

import {
  AudioStreamResult,
  InvalidMediaResponseError,
  MediaProviderUnavailableError,
  SearchPageResult,
  TrackSummary,
} from '../../services/mediaProvider';
import { parseDurationToSeconds } from '../../services/trackMetadata';
import { DEFAULT_REQUEST_TIMEOUT_MS, HttpClient } from './httpClient';
import { INNERTUBE_STREAM_HEADERS, INNERTUBE_USER_AGENT } from './innerTubeClient';
import {
  parseInvidiousItems,
  parsePipedItems,
  type PipedSearchItem,
} from '../parsers/searchParsers';

export type { PipedSearchItem };

export interface PipedStreamAudio {
  url: string;
  format: string;
  quality: string;
  mimeType: string;
  codec: string;
  bitrate: number;
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
  duration: number;
  audioStreams: PipedStreamAudio[];
}

export type InstanceEngine = 'piped' | 'invidious';

export interface ApiInstanceConfig {
  baseUrl: string;
  engine: InstanceEngine;
}

export type FallbackCursor =
  | { engine: 'piped'; baseUrl: string; nextpage: string }
  | { engine: 'invidious'; baseUrl: string; page: number };

export const API_INSTANCES: readonly ApiInstanceConfig[] = [
  { baseUrl: 'https://invidious.projectsegfau.lt', engine: 'invidious' },
  { baseUrl: 'https://invidious.f5.si', engine: 'invidious' },
  { baseUrl: 'https://inv.nadeko.net', engine: 'invidious' },
];

export const PIPED_INSTANCES: readonly string[] = API_INSTANCES.map((i) => i.baseUrl);

const FALLBACK_CURSOR_PREFIX = '__fb__:';
const MAX_SEARCH_PAGES_PER_BATCH = 4;

export function encodeFallbackCursor(cursor: FallbackCursor): string {
  return `${FALLBACK_CURSOR_PREFIX}${JSON.stringify(cursor)}`;
}

export function decodeFallbackCursor(token?: string | null): FallbackCursor | null {
  if (!token || !token.startsWith(FALLBACK_CURSOR_PREFIX)) return null;
  try {
    return JSON.parse(token.slice(FALLBACK_CURSOR_PREFIX.length)) as FallbackCursor;
  } catch {
    return null;
  }
}

export interface FallbackInstancesClient {
  fetchSearchBatch(
    trimmedQuery: string,
    targetCount: number,
    seenIds: Set<string>,
    cursor: FallbackCursor | null
  ): Promise<SearchPageResult>;
  fetchAudioStream(cleanId: string): Promise<AudioStreamResult>;
}

export interface FallbackInstancesClientDeps {
  http: HttpClient;
  instances?: readonly ApiInstanceConfig[];
  retryDelayMs?: number;
}

function formatInstanceError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === 'AbortError'
      ? `Timeout (> ${DEFAULT_REQUEST_TIMEOUT_MS}ms)`
      : err.message;
  }
  return String(err);
}

export function createFallbackInstancesClient({
  http,
  instances = API_INSTANCES,
  retryDelayMs = 800,
}: FallbackInstancesClientDeps): FallbackInstancesClient {
  return {
    async fetchSearchBatch(
      trimmedQuery: string,
      targetCount: number,
      seenIds: Set<string>,
      cursor: FallbackCursor | null
    ): Promise<SearchPageResult> {
      const encodedQuery = encodeURIComponent(trimmedQuery);
      const instanceErrors: Record<string, string> = {};
      const candidates = cursor
        ? [{ engine: cursor.engine, baseUrl: cursor.baseUrl }]
        : instances;

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

            const response = await http.fetch(requestUrl);
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
                throw new InvalidMediaResponseError('Piped items ausente ou não é array');
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
                throw new InvalidMediaResponseError('Invidious response não é um array');
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
          instanceErrors[instance.baseUrl] = formatInstanceError(err);
        }
      }

      throw new MediaProviderUnavailableError(instanceErrors);
    },

    async fetchAudioStream(cleanId: string): Promise<AudioStreamResult> {
      const instanceErrors: Record<string, string> = {};

      for (const instance of instances) {
        const requestUrl =
          instance.engine === 'piped'
            ? `${instance.baseUrl}/streams/${cleanId}`
            : `${instance.baseUrl}/api/v1/videos/${cleanId}`;

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt > 0 && retryDelayMs > 0) {
              await new Promise((r) => setTimeout(r, retryDelayMs));
            }

            const response = await http.fetch(requestUrl);
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
            const thumbnailUrl = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
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
              const invData = rawData as {
                title?: string;
                author?: string;
                lengthSeconds?: number;
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

              if (Array.isArray(invData.adaptiveFormats)) {
                for (const f of invData.adaptiveFormats) {
                  if (f.url && f.type?.includes('audio')) {
                    const bitrateNum =
                      typeof f.bitrate === 'string'
                        ? parseInt(f.bitrate, 10)
                        : f.bitrate || 128000;
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

            const scored = [...streamCandidates].sort((a, b) => {
              const isAM4A = a.mimeType.includes('mp4') || a.format.toLowerCase() === 'm4a';
              const isBM4A = b.mimeType.includes('mp4') || b.format.toLowerCase() === 'm4a';
              const distA = Math.abs(a.bitrate - 131072);
              const distB = Math.abs(b.bitrate - 131072);
              if (isAM4A === isBM4A) return distA - distB;
              return isAM4A ? -1 : 1;
            });

            const selected = scored[0];
            return {
              videoId: cleanId,
              title,
              artist,
              duration: durationSeconds,
              thumbnailUrl,
              streamUrl: selected.url,
              mimeType: selected.mimeType,
              format: selected.format,
              bitrate: selected.bitrate,
              userAgent: INNERTUBE_USER_AGENT,
              headers: { ...INNERTUBE_STREAM_HEADERS },
            };
          } catch (err: unknown) {
            instanceErrors[instance.baseUrl] = formatInstanceError(err);
          }
        }
      }

      throw new MediaProviderUnavailableError(instanceErrors);
    },
  };
}
