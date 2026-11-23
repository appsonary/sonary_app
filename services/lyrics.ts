/**
 * Módulo agnóstico de letras sincronizadas e em texto puro via API aberta LRCLIB
 * com cache em dois níveis (L1 memória + L2 SQLite).
 */

import { getCachedLyrics, saveCachedLyrics } from './database';
import { extractTrackMetadata } from './trackMetadata';

export type LyricsType = 'synced' | 'plain' | 'none';

export interface LyricLine {
  time: number; // Segundos (com suporte a decimais para seek preciso)
  text: string;
}

export interface TrackLyricsPayload {
  trackId: string;
  type: LyricsType;
  lines: LyricLine[];
  plainText?: string;
  provider: 'lrclib' | 'none';
  cachedAt: number;
}

const lyricsMemoryCache = new Map<string, TrackLyricsPayload>();

export function clearLyricsCache(): void {
  lyricsMemoryCache.clear();
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'SonaryMobile/1.0',
      ...(init?.headers || {}),
    };
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Converte arquivo/texto no formato LRC standard em array de linhas sincronizadas.
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match: RegExpExecArray | null;
    const timestamps: number[] = [];
    timeRegex.lastIndex = 0;

    while ((match = timeRegex.exec(trimmed)) !== null) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const millisStr = match[3] || '0';
      const millis = parseInt(millisStr.padEnd(3, '0').slice(0, 3), 10);
      timestamps.push(mins * 60 + secs + millis / 1000);
    }

    const text = trimmed.replace(timeRegex, '').trim();
    if (timestamps.length > 0 && text) {
      for (const time of timestamps) {
        result.push({ time, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Busca letras sincronizadas ou em texto puro com cache persistente de dois níveis (L1 Memória + L2 SQLite).
 * Nunca gera timestamps falsos para plainLyrics nem injeta versos estáticos.
 */
export async function getTrackLyrics(
  trackId: string,
  title: string,
  artist: string,
  durationSec?: number,
  forceRefresh: boolean = false
): Promise<TrackLyricsPayload> {
  const effectiveKey = (trackId || `${title}::${artist}`).trim();
  if (!title || !artist) {
    return {
      trackId: effectiveKey,
      type: 'none',
      lines: [],
      provider: 'none',
      cachedAt: Date.now(),
    };
  }

  if (!forceRefresh && lyricsMemoryCache.has(effectiveKey)) {
    return lyricsMemoryCache.get(effectiveKey)!;
  }

  if (!forceRefresh && effectiveKey) {
    try {
      const cachedRow = await getCachedLyrics(effectiveKey);
      if (cachedRow && cachedRow.payload) {
        const parsedPayload = JSON.parse(cachedRow.payload) as TrackLyricsPayload;
        if (parsedPayload && parsedPayload.type !== 'none') {
          lyricsMemoryCache.set(effectiveKey, parsedPayload);
          return parsedPayload;
        }
      }
    } catch {
      // prossegue para busca na rede
    }
  }

  try {
    const extracted = extractTrackMetadata(title, artist);
    const cleanTitle = (extracted.cleanTitle || title).replace(/\(.*?\)|\[.*?\]/g, '').trim();
    const cleanArtist = (extracted.primaryArtist || artist).split(/,|feat\.|ft\.|&/i)[0].trim();

    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(
      cleanTitle
    )}&artist_name=${encodeURIComponent(cleanArtist)}`;

    if (durationSec && durationSec > 0) {
      url += `&duration=${Math.round(durationSec)}`;
    }

    const response = await fetchWithTimeout(url, 6000, {
      headers: {
        'User-Agent': 'Sonary/1.0.0 (https://appsonary.com)',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as {
        syncedLyrics?: string;
        plainLyrics?: string;
      };

      if (data && data.syncedLyrics) {
        const parsedLines = parseLrc(data.syncedLyrics);
        if (parsedLines.length > 0) {
          const payload: TrackLyricsPayload = {
            trackId: effectiveKey,
            type: 'synced',
            lines: parsedLines,
            plainText: data.plainLyrics || parsedLines.map((l) => l.text).join('\n'),
            provider: 'lrclib',
            cachedAt: Date.now(),
          };
          lyricsMemoryCache.set(effectiveKey, payload);
          await saveCachedLyrics(effectiveKey, 'synced', JSON.stringify(payload)).catch(() => {});
          return payload;
        }
      }

      if (data && data.plainLyrics && data.plainLyrics.trim().length > 0) {
        const rawLines = data.plainLyrics
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const payload: TrackLyricsPayload = {
          trackId: effectiveKey,
          type: 'plain',
          lines: rawLines.map((text) => ({ time: 0, text })),
          plainText: data.plainLyrics.trim(),
          provider: 'lrclib',
          cachedAt: Date.now(),
        };
        lyricsMemoryCache.set(effectiveKey, payload);
        await saveCachedLyrics(effectiveKey, 'plain', JSON.stringify(payload)).catch(() => {});
        return payload;
      }
    }
  } catch (err) {
    console.warn('[Lyrics] Falha ao obter letras via LRCLIB:', err);
  }

  return {
    trackId: effectiveKey,
    type: 'none',
    lines: [],
    provider: 'none',
    cachedAt: Date.now(),
  };
}

/**
 * Busca letras sincronizadas via API aberta LRCLIB.
 * Retorna array de linhas sincronizadas ou null caso indisponíveis.
 */
export async function getSyncedLyrics(
  title: string,
  artist: string,
  durationSec?: number
): Promise<LyricLine[] | null> {
  if (!title || !artist) return null;
  const payload = await getTrackLyrics(`${title}::${artist}`, title, artist, durationSec);
  if (payload.type === 'synced' && payload.lines.length > 0) {
    return payload.lines;
  }
  return null;
}
