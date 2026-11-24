/**
 * Parser puro para painéis de rádio e faixas relacionadas (/youtubei/v1/next).
 */

import { TrackSummary } from '../../services/mediaProvider';
import {
  isValidMusicTrack,
  parseDurationToSeconds,
} from '../../services/trackMetadata';

export interface ParsedPlaylistPanel {
  tracks: TrackSummary[];
  continuationToken?: string;
  seedTitle?: string;
  seedArtist?: string;
}

export function parsePlaylistPanelItems(
  contents: any[],
  excludeId?: string
): ParsedPlaylistPanel {
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
