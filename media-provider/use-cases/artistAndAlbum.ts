/**
 * Casos de uso: Perfil de artista, Top Tracks expandidas e detalhe de álbum/single/EP.
 */

import {
  AlbumDetail,
  ArtistAlbumSummary,
  ArtistProfile,
  ArtistSearchResult,
  MediaProviderHooks,
  TrackSummary,
} from '../../services/mediaProvider';
import { isValidMusicTrack } from '../../services/trackMetadata';
import { InnerTubeClient } from '../infra/innerTubeClient';
import { TtlCache } from '../infra/ttlCache';
import {
  extractBrowseSections,
  joinRunsText,
  parseAlbumBrowsePayload,
  parseArtistBrowsePayload,
  parseMusicListTrackItem,
  pickBestThumbnail,
} from '../parsers/browseParsers';
import {
  artistCandidateMatchesQuery,
  normalizeArtistForMatch,
} from '../parsers/searchParsers';

export interface ArtistAndAlbumDeps {
  innerTube: Pick<InnerTubeClient, 'postYtmBrowse'>;
  searchArtists: (query: string, limit?: number) => Promise<ArtistSearchResult[]>;
  searchTracks: (query: string) => Promise<TrackSummary[]>;
  caches: {
    artistProfile: TtlCache<ArtistProfile>;
    artistTopTracks: TtlCache<TrackSummary[]>;
    albumDetail: TtlCache<AlbumDetail>;
  };
  hooks?: MediaProviderHooks;
}

export function createArtistAndAlbumUseCases({
  innerTube,
  searchArtists,
  searchTracks,
  caches,
  hooks,
}: ArtistAndAlbumDeps) {
  async function getArtistTopTracks(
    browseId: string,
    params?: string,
    fallbackArtist: string = 'Artista',
    timeoutMs: number = 4000
  ): Promise<TrackSummary[]> {
    if (!browseId) return [];
    const cacheKey = `${browseId}::${params || ''}`;
    const cached = caches.artistTopTracks.get(cacheKey);
    if (cached) return cached;

    try {
      const data = await innerTube.postYtmBrowse(browseId, params, timeoutMs);
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
        caches.artistTopTracks.set(cacheKey, capped);
      }
      return capped;
    } catch {
      return [];
    }
  }

  async function getAlbumDetail(
    browseId: string,
    fallbackMeta?: Partial<ArtistAlbumSummary> & { artist?: string }
  ): Promise<AlbumDetail> {
    const cleanBrowseId = (browseId || '').trim();
    if (cleanBrowseId) {
      const cached = caches.albumDetail.get(cleanBrowseId);
      if (cached) return cached;
    }

    let title = fallbackMeta?.title || 'Álbum';
    let artist = fallbackMeta?.artist || 'Artista';
    let year = fallbackMeta?.year;
    let type: 'album' | 'single' | 'ep' = fallbackMeta?.type || 'album';
    let thumbnailUrl = fallbackMeta?.thumbnailUrl || '';
    let tracks: TrackSummary[] = [];

    if (cleanBrowseId) {
      try {
        const data = await innerTube.postYtmBrowse(cleanBrowseId, undefined, 7000);
        if (data) {
          const parsed = parseAlbumBrowsePayload(data, {
            title,
            artist,
            year,
            type,
            thumbnailUrl,
          });
          title = parsed.title;
          artist = parsed.artist;
          year = parsed.year;
          type = parsed.type;
          thumbnailUrl = parsed.thumbnailUrl;
          tracks = parsed.tracks;
        }
      } catch {
        // Continua para fallback contextual se necessário
      }
    }

    if (tracks.length === 0 && fallbackMeta?.title) {
      try {
        const searchFn = hooks?.getSearchTracks?.() || searchTracks;
        const query = fallbackMeta.artist
          ? `${fallbackMeta.artist} ${fallbackMeta.title}`
          : fallbackMeta.title;
        const found = await searchFn(query);
        tracks = (found || []).filter((t) => isValidMusicTrack(t)).slice(0, 12);
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
      caches.albumDetail.set(cleanBrowseId, album);
    }
    return album;
  }

  async function getArtistProfile(
    artistName: string,
    channelId?: string
  ): Promise<ArtistProfile> {
    const cleanName =
      (artistName || 'Artista').split(/,|feat\.|ft\.|&/i)[0].trim() || 'Artista';
    const initialCacheKey = `${cleanName.toLowerCase()}::${channelId || ''}`;
    const cached = caches.artistProfile.get(initialCacheKey);
    if (cached) return cached;

    let resolvedChannelId = channelId?.trim() || undefined;
    let searchArtistMeta: ArtistSearchResult | undefined;
    let hadNetworkFailure = false;

    if (!resolvedChannelId && cleanName && cleanName.toLowerCase() !== 'artista') {
      try {
        const artistSearchFn = hooks?.getSearchArtists?.() || searchArtists;
        const matches = await artistSearchFn(cleanName, 5);
        if (Array.isArray(matches) && matches.length > 0) {
          const targetNorm = normalizeArtistForMatch(cleanName);
          searchArtistMeta =
            matches.find((a) => normalizeArtistForMatch(a.name) === targetNorm) ||
            matches.find((a) => artistCandidateMatchesQuery(a.name, cleanName));
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
      const resolvedCached = caches.artistProfile.get(resolvedCacheKey);
      if (resolvedCached) {
        caches.artistProfile.set(initialCacheKey, resolvedCached);
        return resolvedCached;
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

    if (resolvedChannelId) {
      try {
        const bData = await innerTube.postYtmBrowse(resolvedChannelId, undefined, 7000);
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

    if (browseTracks.length > 0) {
      topTracks = browseTracks;
    } else {
      try {
        const searchFn = hooks?.getSearchTracks?.() || searchTracks;
        const rawTracks = await searchFn(resolvedName);
        topTracks = (rawTracks || []).filter((t) => isValidMusicTrack(t));
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

    if (hasProfileData) {
      caches.artistProfile.set(initialCacheKey, profile);
      if (resolvedChannelId) {
        caches.artistProfile.set(`${cleanName.toLowerCase()}::${resolvedChannelId}`, profile);
      }
    }
    return profile;
  }

  function clearArtistAndAlbumCaches(): void {
    caches.artistProfile.clear();
    caches.artistTopTracks.clear();
    caches.albumDetail.clear();
  }

  return {
    getArtistTopTracks,
    getAlbumDetail,
    getArtistProfile,
    clearArtistAndAlbumCaches,
  };
}
