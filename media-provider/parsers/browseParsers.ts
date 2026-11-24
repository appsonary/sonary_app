/**
 * Parsers puros para respostas de /youtubei/v1/browse (perfil de artista, top tracks e álbuns).
 */

import {
  ArtistAlbumSummary,
  ArtistSearchResult,
  TrackSummary,
} from '../../services/mediaProvider';
import {
  isValidMusicTrack,
  parseDurationToSeconds,
} from '../../services/trackMetadata';

export function pickBestThumbnail(
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

export function joinRunsText(runs: unknown): string {
  if (!Array.isArray(runs)) return '';
  return runs
    .map((r: any) => (typeof r?.text === 'string' ? r.text : ''))
    .join('')
    .trim();
}

export function getBrowsePageType(endpoint: any): string | undefined {
  return endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType;
}

export function parseMusicListTrackItem(
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

  return isValidMusicTrack(candidate, { allowShort: Boolean(options?.allowShortTracks) })
    ? candidate
    : null;
}

export function extractBrowseSections(data: any): any[] {
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

export interface ParsedArtistBrowse {
  topTracks: TrackSummary[];
  songsBrowseId?: string;
  songsBrowseParams?: string;
  albums: ArtistAlbumSummary[];
  singles: ArtistAlbumSummary[];
  relatedArtists: ArtistSearchResult[];
}

export function parseArtistBrowsePayload(
  data: any,
  fallbackArtist: string
): ParsedArtistBrowse {
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

export interface ParsedAlbumBrowse {
  title: string;
  artist: string;
  year?: string;
  type: 'album' | 'single' | 'ep';
  thumbnailUrl: string;
  tracks: TrackSummary[];
}

export function parseAlbumBrowsePayload(
  data: any,
  defaults: {
    title: string;
    artist: string;
    year?: string;
    type: 'album' | 'single' | 'ep';
    thumbnailUrl: string;
  }
): ParsedAlbumBrowse {
  let { title, artist, year, type, thumbnailUrl } = defaults;

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
  const tracks: TrackSummary[] = [];
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

  return { title, artist, year, type, thumbnailUrl, tracks };
}
