/**
 * Casos de uso: Busca de artistas, busca paginada de faixas (InnerTube + fallback) e enriquecimento de artistas.
 */

import {
  ArtistSearchResult,
  MediaProviderHooks,
  SearchPageOptions,
  SearchPageResult,
  TrackSummary,
} from '../../services/mediaProvider';
import { inferDominantArtistFromTracks } from '../../services/trackMetadata';
import {
  decodeFallbackCursor,
  FallbackInstancesClient,
} from '../infra/fallbackInstances';
import { InnerTubeClient } from '../infra/innerTubeClient';
import {
  artistMatchesInferred,
  DEFAULT_ARTIST_SEARCH_LIMIT,
  normalizeArtistKey,
  parseInnerTubeSearchResponse,
  parseYouTubeMusicArtistsResponse,
} from '../parsers/searchParsers';
import {
  expandSingleArtistWithSimilar,
  extractDirectMediaId,
} from './directLink';

const DEFAULT_SEARCH_TARGET_COUNT = 30;
const MAX_SEARCH_PAGES_PER_BATCH = 4;
const STRONG_DIVERGENCE_MIN_COUNT = 4;
const STRONG_DIVERGENCE_MIN_RATIO = 0.5;

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

export function createSearchArtistsUseCase(
  innerTube: Pick<InnerTubeClient, 'postYtmSearch'>
) {
  return async function searchArtists(
    query: string,
    limit: number = DEFAULT_ARTIST_SEARCH_LIMIT
  ): Promise<ArtistSearchResult[]> {
    const trimmed = query.trim();
    const safeLimit = Math.max(1, limit);
    if (!trimmed) return [];

    try {
      const data = await innerTube.postYtmSearch(trimmed);
      if (!data) return [];
      return parseYouTubeMusicArtistsResponse(data, safeLimit);
    } catch {
      return [];
    }
  };
}

export interface SearchTracksPageDeps {
  innerTube: Pick<InnerTubeClient, 'postSearch' | 'postYtmBrowse'>;
  fallback: Pick<FallbackInstancesClient, 'fetchSearchBatch'>;
  searchArtists: (query: string, limit?: number) => Promise<ArtistSearchResult[]>;
  resolveDirectLink: (mediaId: string) => Promise<SearchPageResult>;
  hooks?: MediaProviderHooks;
}

export function createSearchCatalogUseCases({
  innerTube,
  fallback,
  searchArtists,
  resolveDirectLink,
  hooks,
}: SearchTracksPageDeps) {
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
      const data = await innerTube.postSearch(query, token);
      const page = parseInnerTubeSearchResponse(data, seenIds);
      collected.push(...page.tracks);
      token = page.continuationToken;
      hops += 1;

      if (!token || (page.tracks.length === 0 && hops > 1)) {
        break;
      }
    }

    return { tracks: collected, continuationToken: token };
  }

  async function searchTracksPage(
    query: string,
    options: SearchPageOptions = {}
  ): Promise<SearchPageResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { tracks: [], artists: [], continuationToken: null };
    }

    const mockedSearch = hooks?.getSearchTracks?.();
    const mockedArtists = hooks?.getSearchArtists?.();
    const hasMockedSearch = Boolean(mockedSearch);
    const resolveArtists = mockedArtists || searchArtists;

    if (!options.continuationToken && !hasMockedSearch) {
      const directVideoId = extractDirectMediaId(trimmed);
      if (directVideoId) {
        return resolveDirectLink(directVideoId);
      }
    }

    if (!options.continuationToken && mockedSearch) {
      const [mocked, primaryArtists] = await Promise.all([
        mockedSearch(trimmed),
        mockedArtists
          ? Promise.resolve()
              .then(() => mockedArtists(trimmed, DEFAULT_ARTIST_SEARCH_LIMIT))
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      const artists =
        mockedArtists && mocked.length > 0
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
              ? await enrichArtistsFromTracks(
                  trimmed,
                  innerTubeRes.tracks,
                  primaryArtists,
                  resolveArtists
                )
              : primaryArtists;
          const artists = await expandSingleArtistWithSimilar(
            enrichedArtists,
            innerTube.postYtmBrowse
          );
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

    const fallbackRes = await fallback.fetchSearchBatch(
      trimmed,
      targetCount,
      seenIds,
      fallbackCursor
    );
    if (!artistsPromise) {
      return fallbackRes;
    }
    const primaryArtists = await artistsPromise;
    const enrichedArtists =
      fallbackRes.tracks.length > 0
        ? await enrichArtistsFromTracks(
            trimmed,
            fallbackRes.tracks,
            primaryArtists,
            resolveArtists
          )
        : primaryArtists;
    const artists = await expandSingleArtistWithSimilar(
      enrichedArtists,
      innerTube.postYtmBrowse
    );
    return { ...fallbackRes, artists };
  }

  async function searchTracks(query: string): Promise<TrackSummary[]> {
    const page = await searchTracksPage(query, {
      targetCount: DEFAULT_SEARCH_TARGET_COUNT,
    });
    return page.tracks;
  }

  return {
    searchTracksPage,
    searchTracks,
  };
}
