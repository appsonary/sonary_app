/**
 * Caso de uso: Parsing e resolução de links diretos de mídia (com enriquecimento de artistas relacionados).
 */

import {
  ArtistSearchResult,
  AudioStreamResult,
  SearchPageResult,
  TrackSummary,
} from '../../services/mediaProvider';
import {
  extractTrackMetadata,
  formatDurationSeconds,
} from '../../services/trackMetadata';
import { InnerTubeClient } from '../infra/innerTubeClient';
import { parseArtistBrowsePayload } from '../parsers/browseParsers';
import {
  artistMatchesInferred,
  DEFAULT_ARTIST_SEARCH_LIMIT,
  GENERIC_ARTIST_NAME_REGEX,
  normalizeArtistKey,
  TITLE_DASH_SEPARATOR_REGEX,
  TRIBUTE_OR_COVER_REGEX,
} from '../parsers/searchParsers';

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
 * Extrai o ID de 11 caracteres apenas quando a entrada é uma URL válida de faixa individual.
 * Retorna null para buscas textuais comuns, outros domínios ou links puros de playlist.
 */
export function extractDirectMediaId(input: string): string | null {
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

export async function expandSingleArtistWithSimilar(
  artists: ArtistSearchResult[],
  postYtmBrowse: InnerTubeClient['postYtmBrowse']
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

export interface ResolveDirectLinkDeps {
  getAudioStream: (mediaId: string) => Promise<AudioStreamResult>;
  getRelatedTracks: (
    mediaId: string,
    trackTitle?: string,
    trackArtist?: string
  ) => Promise<TrackSummary[]>;
  searchArtists: (query: string, limit?: number) => Promise<ArtistSearchResult[]>;
  postYtmBrowse: InnerTubeClient['postYtmBrowse'];
}

export function createResolveDirectLinkUseCase({
  getAudioStream,
  getRelatedTracks,
  searchArtists,
  postYtmBrowse,
}: ResolveDirectLinkDeps) {
  return async function resolveDirectLink(videoId: string): Promise<SearchPageResult> {
    let stream: AudioStreamResult;
    try {
      stream = await getAudioStream(videoId);
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
        .then(() => getRelatedTracks(resolvedId, primaryTrack.title, primaryTrack.artist))
        .catch(() => [] as TrackSummary[]),
      ...primarySeeds.map(({ name }) =>
        Promise.resolve()
          .then(() => searchArtists(name, 4))
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
                .then(() => searchArtists(seed, 4))
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

    const expandedArtists = await expandSingleArtistWithSimilar(artists, postYtmBrowse);

    return {
      tracks: [primaryTrack, ...uniqueRelated],
      artists: expandedArtists,
      continuationToken: null,
    };
  };
}
