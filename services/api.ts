/**
 * Fachada agnóstica da camada de mídia, letras e metadados do Sonary.
 * Toda lógica específica de busca/catálogo/extração de áudio vive atrás da interface MediaProvider.
 */

import './providerBootstrap';
import {
  getMediaProvider,
  setMediaProviderHooks,
  hasLetterboxArtwork,
  registerMediaProvider,
  resetMediaProvider,
  hasRegisteredMediaProvider,
  MediaProvider,
  TrackSummary,
  ArtistSearchResult,
  SearchPageResult,
  SearchPageOptions,
  AudioStreamResult,
  RadioResult,
  RelatedContentPayload,
  ArtistAlbumSummary,
  AlbumDetail,
  ArtistProfile,
  MediaProviderUnavailableError,
  InvalidMediaResponseError,
  AllInstancesFailedError,
  InvalidApiResponseError,
} from './mediaProvider';
import {
  getTrackLyrics as getTrackLyricsCore,
  getSyncedLyrics as getSyncedLyricsCore,
  parseLrc as parseLrcCore,
  clearLyricsCache as clearLyricsCacheCore,
  LyricsType,
  LyricLine,
  TrackLyricsPayload,
} from './lyrics';
import {
  extractTrackMetadata,
  isValidMusicTrack,
  inferDominantArtistFromTracks,
  parseDurationToSeconds,
  formatDurationSeconds,
  ExtractedTrackMetadata,
  DominantArtistInference,
} from './trackMetadata';

export type {
  MediaProvider,
  TrackSummary,
  ArtistSearchResult,
  SearchPageResult,
  SearchPageOptions,
  AudioStreamResult,
  RadioResult,
  RelatedContentPayload,
  ArtistAlbumSummary,
  AlbumDetail,
  ArtistProfile,
  LyricsType,
  LyricLine,
  TrackLyricsPayload,
  ExtractedTrackMetadata,
  DominantArtistInference,
};

export {
  registerMediaProvider,
  resetMediaProvider,
  hasRegisteredMediaProvider,
  getMediaProvider,
  hasLetterboxArtwork,
  MediaProviderUnavailableError,
  InvalidMediaResponseError,
  AllInstancesFailedError,
  InvalidApiResponseError,
  extractTrackMetadata,
  isValidMusicTrack,
  inferDominantArtistFromTracks,
  parseDurationToSeconds,
  formatDurationSeconds,
};

export function clearLyricsCache(): void {
  clearLyricsCacheCore();
}

export function parseLrc(lrcText: string): LyricLine[] {
  return parseLrcCore(lrcText);
}

export async function getTrackLyrics(
  trackId: string,
  title: string,
  artist: string,
  durationSec?: number,
  forceRefresh: boolean = false
): Promise<TrackLyricsPayload> {
  return getTrackLyricsCore(trackId, title, artist, durationSec, forceRefresh);
}

export async function getSyncedLyrics(
  title: string,
  artist: string,
  durationSec?: number
): Promise<LyricLine[] | null> {
  return getSyncedLyricsCore(title, artist, durationSec);
}

declare const module: {
  exports?: {
    searchTracks?: (query: string) => Promise<TrackSummary[]>;
    searchArtists?: (query: string, limit?: number) => Promise<ArtistSearchResult[]>;
    getAudioStream?: (mediaId: string) => Promise<AudioStreamResult>;
    getRelatedTracks?: (
      mediaId: string,
      trackTitle?: string,
      trackArtist?: string
    ) => Promise<TrackSummary[]>;
  };
} | undefined;

export function extractDirectMediaId(input: string): string | null {
  return getMediaProvider().extractDirectMediaId(input);
}

export async function searchTracksPage(
  query: string,
  options: SearchPageOptions = {}
): Promise<SearchPageResult> {
  return getMediaProvider().searchTracksPage(query, options);
}

export async function searchTracks(query: string): Promise<TrackSummary[]> {
  return getMediaProvider().searchTracks(query);
}

export async function searchArtists(
  query: string,
  limit?: number
): Promise<ArtistSearchResult[]> {
  return getMediaProvider().searchArtists(query, limit);
}

export async function getAudioStream(mediaId: string): Promise<AudioStreamResult> {
  return getMediaProvider().getAudioStream(mediaId);
}

export function invalidateStreamCache(mediaId?: string): void {
  getMediaProvider().invalidateStreamCache(mediaId);
}

export async function getRelatedTracks(
  mediaId: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<TrackSummary[]> {
  return getMediaProvider().getRelatedTracks(mediaId, trackTitle, trackArtist);
}

export async function getRelatedContent(
  mediaId: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<RelatedContentPayload> {
  return getMediaProvider().getRelatedContent(mediaId, trackTitle, trackArtist);
}

export async function getTrackRadio(
  mediaId: string,
  continuationToken?: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<RadioResult> {
  return getMediaProvider().getTrackRadio(
    mediaId,
    continuationToken,
    trackTitle,
    trackArtist
  );
}

export async function getArtistRadio(
  artistName: string,
  channelId?: string,
  trackTitle?: string
): Promise<RadioResult> {
  return getMediaProvider().getArtistRadio(artistName, channelId, trackTitle);
}

export async function getArtistTopTracks(
  browseId: string,
  params?: string,
  fallbackArtist?: string,
  timeoutMs?: number
): Promise<TrackSummary[]> {
  return getMediaProvider().getArtistTopTracks(browseId, params, fallbackArtist, timeoutMs);
}

export async function getArtistProfile(
  artistName: string,
  channelId?: string
): Promise<ArtistProfile> {
  return getMediaProvider().getArtistProfile(artistName, channelId);
}

export async function getAlbumDetail(
  browseId: string,
  fallbackMeta?: Partial<ArtistAlbumSummary> & { artist?: string }
): Promise<AlbumDetail> {
  return getMediaProvider().getAlbumDetail(browseId, fallbackMeta);
}

export function clearArtistAndAlbumCaches(): void {
  getMediaProvider().clearArtistAndAlbumCaches();
}

// Permite que testes que fazem monkey-patch na fachada `services/api` sejam respeitados pelo provedor padrão
setMediaProviderHooks({
  getSearchTracks: () => {
    const fn = module?.exports?.searchTracks;
    return typeof fn === 'function' && fn !== searchTracks ? fn : undefined;
  },
  getSearchArtists: () => {
    const fn = module?.exports?.searchArtists;
    return typeof fn === 'function' && fn !== searchArtists ? fn : undefined;
  },
  getAudioStream: () => {
    const fn = module?.exports?.getAudioStream;
    return typeof fn === 'function' && fn !== getAudioStream ? fn : undefined;
  },
  getRelatedTracks: () => {
    const fn = module?.exports?.getRelatedTracks;
    return typeof fn === 'function' && fn !== getRelatedTracks ? fn : undefined;
  },
});
