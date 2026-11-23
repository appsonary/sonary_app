/**
 * Contrato agnóstico de Provedor de Mídia (MediaProvider) e Registry do core Sonary.
 * Desacopla toda a lógica de busca, catálogo e extração de áudio de serviços externos.
 */

export interface TrackSummary {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number; // em segundos
  formattedDuration: string; // "MM:SS" ou "HH:MM:SS"
  thumbnailUrl: string;
}

export interface ArtistSearchResult {
  id: string;
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

export class MediaProviderUnavailableError extends Error {
  public readonly instanceErrors: Record<string, string>;

  static [Symbol.hasInstance](instance: unknown): boolean {
    if (!instance || typeof instance !== 'object') return false;
    const candidate = instance as { name?: string };
    return (
      Object.prototype.isPrototypeOf.call(MediaProviderUnavailableError.prototype, instance) ||
      candidate.name === 'MediaProviderUnavailableError' ||
      candidate.name === 'AllInstancesFailedError'
    );
  }

  constructor(instanceErrors: Record<string, string>) {
    const errorDetails = Object.entries(instanceErrors)
      .map(([instance, err]) => `  • [${instance}]: ${err}`)
      .join('\n');

    super(
      `Todas as fontes configuradas falharam na requisição.\n` +
        `Falhas registradas por origem:\n${errorDetails}`
    );
    this.name = 'MediaProviderUnavailableError';
    this.instanceErrors = instanceErrors;
    Object.setPrototypeOf(this, MediaProviderUnavailableError.prototype);
  }
}

export class InvalidMediaResponseError extends Error {
  static [Symbol.hasInstance](instance: unknown): boolean {
    if (!instance || typeof instance !== 'object') return false;
    const candidate = instance as { name?: string };
    return (
      Object.prototype.isPrototypeOf.call(InvalidMediaResponseError.prototype, instance) ||
      candidate.name === 'InvalidMediaResponseError' ||
      candidate.name === 'InvalidApiResponseError'
    );
  }

  constructor(message: string) {
    super(`Schema da resposta do provedor inválido: ${message}`);
    this.name = 'InvalidMediaResponseError';
    Object.setPrototypeOf(this, InvalidMediaResponseError.prototype);
  }
}

// Aliases semânticos de retrocompatibilidade para consumidores/testes existentes
export {
  MediaProviderUnavailableError as AllInstancesFailedError,
  InvalidMediaResponseError as InvalidApiResponseError,
};

export interface MediaProvider {
  readonly id: string;
  extractDirectMediaId(input: string): string | null;
  hasLetterboxArtwork?(uri?: string | null): boolean;
  searchTracksPage(query: string, options?: SearchPageOptions): Promise<SearchPageResult>;
  searchTracks(query: string): Promise<TrackSummary[]>;
  searchArtists(query: string, limit?: number): Promise<ArtistSearchResult[]>;
  getAudioStream(mediaId: string): Promise<AudioStreamResult>;
  invalidateStreamCache(mediaId?: string): void;
  getRelatedTracks(
    mediaId: string,
    trackTitle?: string,
    trackArtist?: string
  ): Promise<TrackSummary[]>;
  getRelatedContent(
    mediaId: string,
    trackTitle?: string,
    trackArtist?: string
  ): Promise<RelatedContentPayload>;
  getTrackRadio(
    mediaId: string,
    continuationToken?: string,
    trackTitle?: string,
    trackArtist?: string
  ): Promise<RadioResult>;
  getArtistRadio(
    artistName: string,
    channelId?: string,
    trackTitle?: string
  ): Promise<RadioResult>;
  getArtistTopTracks(
    browseId: string,
    params?: string,
    fallbackArtist?: string,
    timeoutMs?: number
  ): Promise<TrackSummary[]>;
  getArtistProfile(artistName: string, channelId?: string): Promise<ArtistProfile>;
  getAlbumDetail(
    browseId: string,
    fallbackMeta?: Partial<ArtistAlbumSummary> & { artist?: string }
  ): Promise<AlbumDetail>;
  clearArtistAndAlbumCaches(): void;
}

export interface MediaProviderHooks {
  getSearchTracks?: () => ((query: string) => Promise<TrackSummary[]>) | undefined;
  getSearchArtists?: () => ((query: string, limit?: number) => Promise<ArtistSearchResult[]>) | undefined;
  getAudioStream?: () => ((mediaId: string) => Promise<AudioStreamResult>) | undefined;
  getRelatedTracks?: () => (
    (mediaId: string, trackTitle?: string, trackArtist?: string) => Promise<TrackSummary[]>
  ) | undefined;
}

let activeProvider: MediaProvider | null = null;
let lazyBootstrap: (() => void) | null = null;
let registeredHooks: MediaProviderHooks | null = null;

export function setMediaProviderHooks(hooks: MediaProviderHooks | null): void {
  registeredHooks = hooks;
}

export function getMediaProviderHooks(): MediaProviderHooks | undefined {
  return registeredHooks || undefined;
}

export function setMediaProviderBootstrap(bootstrap: () => void): void {
  lazyBootstrap = bootstrap;
}

export function registerMediaProvider(provider: MediaProvider): void {
  activeProvider = provider;
}

export function resetMediaProvider(): void {
  activeProvider = null;
}

export function hasRegisteredMediaProvider(): boolean {
  return activeProvider !== null;
}

export function getMediaProvider(): MediaProvider {
  if (!activeProvider && lazyBootstrap) {
    lazyBootstrap();
  }
  if (!activeProvider) {
    throw new Error('Nenhum MediaProvider registrado no Sonary.');
  }
  return activeProvider;
}

/**
 * Consulta o provedor ativo para saber se uma URI de capa precisa de crop anti-tarjas (4:3 letterbox).
 */
export function hasLetterboxArtwork(uri?: string | null): boolean {
  if (!uri) return false;
  if (!activeProvider && lazyBootstrap) {
    try {
      lazyBootstrap();
    } catch {
      return false;
    }
  }
  return Boolean(activeProvider?.hasLetterboxArtwork?.(uri));
}
