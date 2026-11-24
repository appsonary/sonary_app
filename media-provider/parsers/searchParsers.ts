/**
 * Parsers puros para respostas de busca (InnerTube, YouTube Music, Piped, Invidious)
 * e utilitários de normalização/matching de IDs e nomes de artistas.
 */

import {
  ArtistSearchResult,
  SearchPageResult,
  TrackSummary,
} from '../../services/mediaProvider';
import {
  formatDurationSeconds,
  parseDurationToSeconds,
} from '../../services/trackMetadata';

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

export const DEFAULT_ARTIST_SEARCH_LIMIT = 12;

export const GENERIC_ARTIST_NAME_REGEX =
  /^(?:artista(?:\s+desconhecido)?|various artists|v[aá]rios artistas)$/i;
export const TITLE_DASH_SEPARATOR_REGEX = /\s+[-–—]\s+/;
export const TRIBUTE_OR_COVER_REGEX = /\b(?:tribute|tributo|cover|karaoke|instrumental)\b/;

export function extractVideoId(urlOrId: string): string {
  if (!urlOrId) return '';
  const match = urlOrId.match(/(?:v=|\/watch\?v=|\/embed\/|\/v\/|^)([a-zA-Z0-9_-]{11})/);
  if (match && match[1]) {
    return match[1];
  }
  return urlOrId.replace('/watch?v=', '').replace('/', '').trim();
}

export function normalizeArtistKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeArtistForMatch(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,'"`’\-–—_/\\()[\]&+!?]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function artistMatchesInferred(artistName: string, inferredName: string): boolean {
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

export function upgradeArtistThumbUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  return rawUrl.replace(/=w\d+-h\d+/i, '=w240-h240');
}

export function parseYouTubeMusicArtistsResponse(
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
      if (!browseId || typeof browseId !== 'string' || !browseId.startsWith('UC') || !name) {
        continue;
      }

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

export function extractVideoRendererTrack(v: any): TrackSummary | null {
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

export function extractNextContinuation(continuations: unknown): string | null {
  if (!Array.isArray(continuations)) return null;
  for (const entry of continuations) {
    const token = (entry as any)?.nextContinuationData?.continuation;
    if (typeof token === 'string' && token) return token;
  }
  return null;
}

export function parseInnerTubeSearchResponse(
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

export function parsePipedItems(rawItems: unknown[], seenIds: Set<string>): TrackSummary[] {
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

export function parseInvidiousItems(rawData: unknown[], seenIds: Set<string>): TrackSummary[] {
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
