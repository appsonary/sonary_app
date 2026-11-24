/**
 * Composition Root do provedor padrão de mídia do Sonary (`media-provider/`).
 * Compõe infraestrutura, parsers puros e casos de uso SOLID atrás do contrato `MediaProvider`.
 */

import {
  AlbumDetail,
  ArtistProfile,
  AudioStreamResult,
  MediaProvider,
  MediaProviderHooks,
  TrackSummary,
} from '../services/mediaProvider';
import {
  API_INSTANCES,
  createFallbackInstancesClient,
  PIPED_INSTANCES,
} from './infra/fallbackInstances';
import { createHttpClient } from './infra/httpClient';
import {
  createInnerTubeClient,
  INNERTUBE_USER_AGENT,
} from './infra/innerTubeClient';
import { createTtlCache } from './infra/ttlCache';
import { createArtistAndAlbumUseCases } from './use-cases/artistAndAlbum';
import {
  createResolveDirectLinkUseCase,
  extractDirectMediaId,
} from './use-cases/directLink';
import {
  createExtractAudioStreamUseCase,
  createFallbackInstancesAudioStrategy,
  createInnerTubeAudioStrategy,
} from './use-cases/extractAudioStream';
import { createRadioAndRelatedUseCases } from './use-cases/radioAndRelated';
import {
  createSearchArtistsUseCase,
  createSearchCatalogUseCases,
} from './use-cases/searchCatalog';

const STREAM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const VISITOR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

export {
  API_INSTANCES,
  PIPED_INSTANCES,
  INNERTUBE_USER_AGENT,
  extractDirectMediaId,
  extractDirectMediaId as extractYouTubeUrlVideoId,
};

export function hasLetterboxArtwork(uri?: string | null): boolean {
  return Boolean(uri && /(?:hqdefault|sddefault)\.jpg/i.test(uri));
}

export function createDefaultMediaProvider(hooks?: MediaProviderHooks): MediaProvider {
  const http = createHttpClient();
  const visitorCache = createTtlCache<string>(VISITOR_CACHE_TTL_MS);
  const streamCache = createTtlCache<AudioStreamResult>(STREAM_CACHE_TTL_MS);
  const artistProfileCache = createTtlCache<ArtistProfile>(STREAM_CACHE_TTL_MS);
  const artistTopTracksCache = createTtlCache<TrackSummary[]>(STREAM_CACHE_TTL_MS);
  const albumDetailCache = createTtlCache<AlbumDetail>(STREAM_CACHE_TTL_MS);

  const innerTube = createInnerTubeClient({ http, visitorCache });
  const fallback = createFallbackInstancesClient({ http });

  const streamUseCase = createExtractAudioStreamUseCase({
    strategies: [
      createInnerTubeAudioStrategy(innerTube),
      createFallbackInstancesAudioStrategy(fallback),
    ],
    cache: streamCache,
    onInvalidate: () => innerTube.clearVisitorCache(),
  });

  const searchArtists = createSearchArtistsUseCase(innerTube);

  // Encadeamento explícito para respeitar hooks de monkey-patch em testes de integração
  const resolveSearchTracks = (query: string) =>
    (hooks?.getSearchTracks?.() || searchCatalog.searchTracks)(query);
  const resolveSearchArtists = (query: string, limit?: number) =>
    (hooks?.getSearchArtists?.() || searchArtists)(query, limit);
  const resolveAudioStream = (mediaId: string) =>
    (hooks?.getAudioStream?.() || streamUseCase.execute)(mediaId);
  const resolveRelatedTracks = (
    mediaId: string,
    trackTitle?: string,
    trackArtist?: string
  ) => (hooks?.getRelatedTracks?.() || radioAndRelated.getRelatedTracks)(mediaId, trackTitle, trackArtist);

  const radioAndRelated = createRadioAndRelatedUseCases({
    innerTube,
    searchTracks: resolveSearchTracks,
    getCachedStream: (id) => streamUseCase.getCached(id),
  });

  const resolveDirectLink = createResolveDirectLinkUseCase({
    getAudioStream: resolveAudioStream,
    getRelatedTracks: resolveRelatedTracks,
    searchArtists: resolveSearchArtists,
    postYtmBrowse: innerTube.postYtmBrowse,
  });

  const searchCatalog = createSearchCatalogUseCases({
    innerTube,
    fallback,
    searchArtists,
    resolveDirectLink,
    hooks,
  });

  const artistAndAlbum = createArtistAndAlbumUseCases({
    innerTube,
    searchArtists,
    searchTracks: searchCatalog.searchTracks,
    caches: {
      artistProfile: artistProfileCache,
      artistTopTracks: artistTopTracksCache,
      albumDetail: albumDetailCache,
    },
    hooks,
  });

  return {
    id: 'default-media-provider',
    extractDirectMediaId,
    hasLetterboxArtwork,
    searchTracksPage: searchCatalog.searchTracksPage,
    searchTracks: searchCatalog.searchTracks,
    searchArtists,
    getAudioStream: streamUseCase.execute,
    invalidateStreamCache: streamUseCase.invalidateCache,
    getRelatedTracks: radioAndRelated.getRelatedTracks,
    getRelatedContent: radioAndRelated.getRelatedContent,
    getTrackRadio: radioAndRelated.getTrackRadio,
    getArtistRadio: radioAndRelated.getArtistRadio,
    getArtistTopTracks: artistAndAlbum.getArtistTopTracks,
    getAlbumDetail: artistAndAlbum.getAlbumDetail,
    getArtistProfile: artistAndAlbum.getArtistProfile,
    clearArtistAndAlbumCaches: artistAndAlbum.clearArtistAndAlbumCaches,
  };
}
