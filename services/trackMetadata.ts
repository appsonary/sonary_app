/**
 * Helpers puros de domínio para normalização de metadados, duração e filtragem de faixas musicais.
 * Sem dependências de rede, armazenamento ou provedores externos.
 */

export interface TrackLike {
  id: string;
  title: string;
  artist: string;
  duration: number;
}

export interface ExtractedTrackMetadata {
  primaryArtist: string;
  secondaryArtist?: string;
  cleanTitle: string;
}

export interface DominantArtistInference {
  name: string;
  count: number;
  total: number;
  ratio: number;
}

const DOMINANT_ARTIST_SAMPLE_SIZE = 12;
const DOMINANT_ARTIST_MIN_COUNT = 3;
const DOMINANT_ARTIST_MIN_RATIO = 0.35;
const GENERIC_ARTIST_NAME_REGEX =
  /^(?:artista(?:\s+desconhecido)?|various artists|v[aá]rios artistas)$/i;
const TITLE_DASH_SEPARATOR_REGEX = /\s+[-–—]\s+/;

const NON_MUSIC_HASHTAG_REGEX =
  /(?:^|\s)#(?:shorts?|fy|fyp|viral|preppy|nflop\w*|vertiy|edit|tiktok|roblox|meme|status|trend|humor|gameplay|freefire|clips?)\b/i;

const NON_MUSIC_TITLE_PHRASE_REGEX =
  /^(?:coloque nos coment[aá]rios|duvido todos comentarem|vou ficar off|pov\s*:|quando voc[eê]\s)/i;

const VERSION_SUFFIX_ONLY_REGEX =
  /^(?:original mix|radio edit|extended mix|club mix|remix|ao vivo|live(?:\s+.*)?|acoustic|ac[uú]stico|instrumental|remaster(?:ed)?(?:\s+.*)?|version|demo|bonus track)$/i;

export function parseDurationToSeconds(duration: number | string | undefined | null): number {
  if (typeof duration === 'number') {
    return Math.max(0, Math.floor(duration));
  }
  if (typeof duration === 'string') {
    const parts = duration.split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => isNaN(n))) {
      return 0;
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 1) {
      return parts[0];
    }
  }
  return 0;
}

export function formatDurationSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const pad = (val: number) => (val < 10 ? `0${val}` : `${val}`);

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

function normalizeArtistKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Extrai o artista musical principal e o título limpo a partir de títulos compostos
 * (ex: "Artista - Música (Official Video) | Programa" -> primaryArtist: "Artista", cleanTitle: "Música").
 */
export function extractTrackMetadata(
  rawTitle?: string,
  rawArtist?: string
): ExtractedTrackMetadata {
  const cleanedArtist = (rawArtist || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim();

  const workingTitle = (rawTitle || '')
    .replace(/\s*\|\s*.*$/, '')
    .replace(
      /\s*(?:\((?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyric\s*video|visualizer|audio|hd|4k|hq|clipe\s*oficial|vídeo\s*oficial|áudio\s*oficial)\)|\[(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyric\s*video|visualizer|audio|hd|4k|hq|clipe\s*oficial|vídeo\s*oficial|áudio\s*oficial)\])/gi,
      ''
    )
    .trim();

  const dashParts = workingTitle.split(TITLE_DASH_SEPARATOR_REGEX);
  if (dashParts.length >= 2) {
    const leftSide = dashParts[0].trim();
    const rightSide = dashParts.slice(1).join(' - ').trim();

    if (leftSide && rightSide) {
      if (VERSION_SUFFIX_ONLY_REGEX.test(rightSide)) {
        return {
          primaryArtist: cleanedArtist || 'Artista',
          cleanTitle: leftSide,
        };
      }

      const primaryArtist = leftSide
        .replace(/\s+(?:feat\.?|ft\.?|part\.?)\s+.*$/i, '')
        .trim();
      const cleanSongTitle = rightSide
        .replace(/\s*\((?:feat\.?|ft\.?|part\.?)\s+.*?\)/gi, '')
        .trim();

      const isDifferentChannel =
        cleanedArtist &&
        cleanedArtist.toLowerCase() !== primaryArtist.toLowerCase() &&
        !/^artista(?:\s+desconhecido)?$/i.test(cleanedArtist);

      return {
        primaryArtist: primaryArtist || cleanedArtist || 'Artista',
        secondaryArtist: isDifferentChannel ? cleanedArtist : undefined,
        cleanTitle: cleanSongTitle || rightSide,
      };
    }
  }

  const fallbackArtist =
    cleanedArtist.split(/,|feat\.|ft\.|&/i)[0].trim() || 'Artista';

  return {
    primaryArtist: fallbackArtist,
    cleanTitle: workingTitle || rawTitle || 'Música',
  };
}

/**
 * Filtra clipes muito curtos (< 45s), gravações excessivamente longas (> 2h) e conteúdos não-musicais.
 */
export function isValidMusicTrack(
  track: TrackLike,
  options?: { allowShort?: boolean }
): boolean {
  if (!track || !track.id) return false;
  if (!options?.allowShort && track.duration > 0 && track.duration < 45) return false;
  if (track.duration > 7200) return false;

  const title = (track.title || '').trim();
  const artist = (track.artist || '').trim();
  if (!title) return false;

  if (NON_MUSIC_HASHTAG_REGEX.test(title) || NON_MUSIC_HASHTAG_REGEX.test(artist)) {
    return false;
  }
  if (NON_MUSIC_TITLE_PHRASE_REGEX.test(title)) {
    return false;
  }

  return true;
}

/**
 * Infere um artista dominante a partir das primeiras 12 faixas retornadas na busca,
 * aplicando limiar mínimo anti-alucinação (count >= 3 e ratio >= 0.35).
 */
export function inferDominantArtistFromTracks(
  tracks: TrackLike[]
): DominantArtistInference | null {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const sample = tracks.slice(0, DOMINANT_ARTIST_SAMPLE_SIZE);
  const extracted = sample.map((track) => {
    const meta = extractTrackMetadata(track.title, track.artist);
    const dashParts = (track.title || '').split(TITLE_DASH_SEPARATOR_REGEX);
    const isLeftSideCleanTitle =
      dashParts.length >= 2 &&
      normalizeArtistKey(dashParts[0]) === normalizeArtistKey(meta.cleanTitle || '');
    return { isLeftSideCleanTitle, meta };
  });

  const counts = new Map<string, { name: string; count: number }>();

  for (const { meta } of extracted) {
    const rawName = (meta.primaryArtist || '').trim().replace(/\s+/g, ' ');
    const key = normalizeArtistKey(rawName);
    if (!key || GENERIC_ARTIST_NAME_REGEX.test(rawName)) continue;

    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { name: rawName, count: 1 });
    }
  }

  for (const { isLeftSideCleanTitle, meta } of extracted) {
    if (!isLeftSideCleanTitle) continue;
    const primaryKey = normalizeArtistKey(meta.primaryArtist || '');
    const titleName = (meta.cleanTitle || '').trim().replace(/\s+/g, ' ');
    const titleKey = normalizeArtistKey(titleName);
    if (!titleKey || titleKey === primaryKey || GENERIC_ARTIST_NAME_REGEX.test(titleName)) {
      continue;
    }

    const primaryEntry = primaryKey ? counts.get(primaryKey) : undefined;
    const titleEntry = counts.get(titleKey);
    if (
      titleEntry &&
      (!primaryEntry || primaryEntry.count <= 1 || primaryEntry.count < titleEntry.count)
    ) {
      titleEntry.count += 1;
      if (primaryEntry) {
        primaryEntry.count -= 1;
      }
    }
  }

  let best: { name: string; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  if (!best) return null;
  const total = sample.length;
  const ratio = best.count / total;
  if (best.count < DOMINANT_ARTIST_MIN_COUNT || ratio < DOMINANT_ARTIST_MIN_RATIO) {
    return null;
  }

  return { name: best.name, count: best.count, total, ratio };
}
