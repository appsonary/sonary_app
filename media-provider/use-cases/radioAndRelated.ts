/**
 * Casos de uso: Faixas relacionadas, conteúdo relacionado e Rádio Infinita (por faixa ou artista).
 */

import {
  AudioStreamResult,
  RadioResult,
  RelatedContentPayload,
  TrackSummary,
} from '../../services/mediaProvider';
import {
  extractTrackMetadata,
  isValidMusicTrack,
} from '../../services/trackMetadata';
import { InnerTubeClient } from '../infra/innerTubeClient';
import { parsePlaylistPanelItems } from '../parsers/radioParsers';
import { extractVideoId } from '../parsers/searchParsers';

export interface RadioAndRelatedDeps {
  innerTube: Pick<InnerTubeClient, 'postYtmNext'>;
  searchTracks: (query: string) => Promise<TrackSummary[]>;
  getCachedStream: (mediaId: string) => AudioStreamResult | undefined;
}

export function createRadioAndRelatedUseCases({
  innerTube,
  searchTracks,
  getCachedStream,
}: RadioAndRelatedDeps) {
  async function getRelatedTracks(
    videoId: string,
    trackTitle?: string,
    trackArtist?: string
  ): Promise<TrackSummary[]> {
    const cleanId = extractVideoId(videoId.trim()) || videoId.trim();
    if (!cleanId) return [];

    let discoveredTitle = trackTitle;
    let discoveredArtist = trackArtist;

    if (!discoveredTitle || !discoveredArtist) {
      const cached = getCachedStream(cleanId);
      if (cached) {
        discoveredTitle = discoveredTitle || cached.title;
        discoveredArtist = discoveredArtist || cached.artist;
      }
    }

    let rdamvmTracks: TrackSummary[] = [];

    try {
      const data = await innerTube.postYtmNext(cleanId);
      if (data) {
        const tabs =
          data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
            ?.watchNextTabbedResultsRenderer?.tabs;
        const currentTab =
          tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content
            ?.playlistPanelRenderer?.contents;

        const parsed = parsePlaylistPanelItems(currentTab, cleanId);
        if (parsed.seedTitle && !discoveredTitle) {
          discoveredTitle = parsed.seedTitle;
        }
        if (parsed.seedArtist && !discoveredArtist) {
          discoveredArtist = parsed.seedArtist;
        }
        rdamvmTracks = parsed.tracks;
      }
    } catch (err) {
      console.warn('[InnerTube] Falha ao obter faixas relacionadas via next:', err);
    }

    const hasExplicitMetadata = Boolean(
      (discoveredTitle && discoveredTitle.trim()) ||
        (discoveredArtist && discoveredArtist.trim())
    );
    const meta = extractTrackMetadata(discoveredTitle, discoveredArtist);
    const validPrimaryArtist =
      meta.primaryArtist &&
      !/^artista(?:\s+desconhecido)?$/i.test(meta.primaryArtist)
        ? meta.primaryArtist
        : '';

    if (rdamvmTracks.length > 0) {
      if (!validPrimaryArtist || !trackTitle) {
        return rdamvmTracks;
      }

      const artistLower = validPrimaryArtist.toLowerCase();
      const sameArtistCount = rdamvmTracks.filter(
        (t) =>
          t.artist.toLowerCase().includes(artistLower) ||
          t.title.toLowerCase().includes(artistLower)
      ).length;

      if (sameArtistCount >= 2) {
        return rdamvmTracks;
      }

      try {
        const artistResults = await searchTracks(`${validPrimaryArtist} official audio`);
        const validArtistTracks = artistResults.filter(
          (t) =>
            t.id !== cleanId &&
            isValidMusicTrack(t) &&
            (!meta.cleanTitle ||
              !t.title.toLowerCase().includes(meta.cleanTitle.toLowerCase())) &&
            (t.artist.toLowerCase().includes(artistLower) ||
              t.title.toLowerCase().includes(artistLower))
        );

        if (validArtistTracks.length > 0) {
          const merged: TrackSummary[] = [];
          const seenIds = new Set<string>([cleanId]);
          for (const t of validArtistTracks.slice(0, 2)) {
            if (!seenIds.has(t.id)) {
              seenIds.add(t.id);
              merged.push(t);
            }
          }
          for (const t of rdamvmTracks) {
            if (!seenIds.has(t.id)) {
              seenIds.add(t.id);
              merged.push(t);
            }
          }
          return merged;
        }
      } catch {
        // Mantém rdamvmTracks caso a busca complementar falhe
      }

      return rdamvmTracks;
    }

    try {
      const queries: string[] = [];
      if (validPrimaryArtist && meta.cleanTitle && meta.cleanTitle !== 'Música') {
        queries.push(`${validPrimaryArtist} official audio`);
        queries.push(`${validPrimaryArtist} ${meta.cleanTitle} mix`);
      } else if (validPrimaryArtist) {
        queries.push(`${validPrimaryArtist} official audio`);
      } else if (hasExplicitMetadata && meta.cleanTitle) {
        queries.push(`${meta.cleanTitle} official audio`);
      } else {
        queries.push(cleanId);
      }

      if (meta.secondaryArtist) {
        queries.push(`${validPrimaryArtist || meta.cleanTitle} ${meta.secondaryArtist}`);
      }

      const collected: TrackSummary[] = [];
      const seenIds = new Set<string>([cleanId]);
      const currentCleanLower = (meta.cleanTitle || '').toLowerCase();

      for (const q of queries) {
        const results = await searchTracks(q).catch(() => [] as TrackSummary[]);
        for (const item of results) {
          if (seenIds.has(item.id)) continue;
          if (!isValidMusicTrack(item)) continue;
          const itemMeta = extractTrackMetadata(item.title, item.artist);
          if (
            currentCleanLower &&
            currentCleanLower !== 'música' &&
            itemMeta.cleanTitle.toLowerCase() === currentCleanLower &&
            collected.length >= 2
          ) {
            continue;
          }
          seenIds.add(item.id);
          collected.push(item);
        }
        if (collected.length >= 12) break;
      }

      return collected;
    } catch {
      return [];
    }
  }

  async function getRelatedContent(
    videoId: string,
    trackTitle?: string,
    trackArtist?: string
  ): Promise<RelatedContentPayload> {
    const relatedTracks = await getRelatedTracks(videoId, trackTitle, trackArtist);
    const first = relatedTracks[0];
    return {
      videoId,
      relatedTracks,
      artistRadioPrompt: first
        ? {
            title: `Rádio de ${first.artist}`,
            subtitle: 'Descobertas e faixas similares',
            thumbnailUrl: first.thumbnailUrl,
          }
        : undefined,
    };
  }

  async function getTrackRadio(
    videoId: string,
    continuationToken?: string,
    trackTitle?: string,
    trackArtist?: string
  ): Promise<RadioResult> {
    const cleanId = extractVideoId(videoId.trim()) || videoId.trim();
    if (!cleanId) {
      return { seedId: '', title: 'Rádio', tracks: [] };
    }

    try {
      const data = await innerTube.postYtmNext(cleanId, continuationToken);
      if (data) {
        const panel =
          data?.continuationContents?.playlistPanelContinuation ||
          data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
            ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.musicQueueRenderer?.content?.playlistPanelRenderer;

        const parsed = parsePlaylistPanelItems(panel?.contents || [], cleanId);
        const nextToken =
          parsed.continuationToken ||
          panel?.continuations?.[0]?.nextRadioContinuationData?.continuation ||
          panel?.continuations?.[0]?.nextContinuationData?.continuation;

        if (parsed.tracks.length > 0) {
          return {
            seedId: cleanId,
            title: 'Rádio da Música',
            tracks: parsed.tracks,
            continuationToken: nextToken,
          };
        }
      }
    } catch (err) {
      console.warn('[Radio] Falha ao obter Track Radio via InnerTube:', err);
    }

    const fallbackTracks = await getRelatedTracks(cleanId, trackTitle, trackArtist);
    return {
      seedId: cleanId,
      title: 'Rádio da Música',
      tracks: fallbackTracks,
    };
  }

  async function getArtistRadio(
    artistName: string,
    channelId?: string,
    trackTitle?: string
  ): Promise<RadioResult> {
    const meta = extractTrackMetadata(trackTitle, artistName);
    const cleanArtist = (
      meta.primaryArtist && meta.primaryArtist !== 'Artista'
        ? meta.primaryArtist
        : artistName
    ).trim();
    if (!cleanArtist) {
      return { seedId: channelId || '', title: 'Rádio do Artista', tracks: [] };
    }

    try {
      const searchResults = await searchTracks(`${cleanArtist} mix`);
      const validTracks = searchResults.filter((t) => isValidMusicTrack(t));
      if (validTracks.length > 0) {
        return {
          seedId: channelId || cleanArtist,
          title: `Rádio de ${cleanArtist}`,
          tracks: validTracks,
        };
      }
    } catch (err) {
      console.warn('[Radio] Falha ao obter Artist Radio:', err);
    }

    return {
      seedId: channelId || cleanArtist,
      title: `Rádio de ${cleanArtist}`,
      tracks: [],
    };
  }

  return {
    getRelatedTracks,
    getRelatedContent,
    getTrackRadio,
    getArtistRadio,
  };
}
