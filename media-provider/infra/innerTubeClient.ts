/**
 * Cliente de transporte InnerTube / YouTube Music.
 * Encapsula contextos de cliente, headers, visitorData e chamadas POST aos endpoints youtubei/v1/*.
 */

import { HttpClient } from './httpClient';
import { TtlCache } from './ttlCache';

export const INNERTUBE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.0 Safari/605.1.15';

export const INNERTUBE_STREAM_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': INNERTUBE_USER_AGENT,
  Referer: 'https://www.youtube.com/',
  Origin: 'https://www.youtube.com',
};

export const YTM_WEB_REMIX_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.01.00',
    hl: 'pt',
    gl: 'BR',
  },
} as const;

export const YTM_ARTIST_SEARCH_PARAMS = 'EgWKAQIgAWoKEAkQChADEAUQBA%3D%3D';

const VISITOR_CACHE_KEY = 'default';

export interface InnerTubeClient {
  getVisitorData(): Promise<string>;
  clearVisitorCache(): void;
  postPlayer(videoId: string): Promise<any>;
  postSearch(query: string, continuationToken?: string | null): Promise<any>;
  postYtmSearch(query: string, params?: string, timeoutMs?: number): Promise<any | null>;
  postYtmNext(videoId: string, continuationToken?: string): Promise<any | null>;
  postYtmBrowse(browseId: string, params?: string, timeoutMs?: number): Promise<any | null>;
}

export interface InnerTubeClientDeps {
  http: HttpClient;
  visitorCache: TtlCache<string>;
}

export function createInnerTubeClient({
  http,
  visitorCache,
}: InnerTubeClientDeps): InnerTubeClient {
  async function getVisitorData(): Promise<string> {
    const cached = visitorCache.get(VISITOR_CACHE_KEY);
    if (cached) return cached;

    const response = await http.fetch(
      'https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': INNERTUBE_USER_AGENT,
          'X-Goog-Api-Format-Version': '2',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'VISIONOS',
              clientVersion: '1.04',
              deviceMake: 'Apple',
              deviceModel: 'RealityDevice17,1',
              osName: 'visionOS',
              osVersion: '26.6.0.23O770',
              platform: 'MOBILE',
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      },
      7000
    );

    if (!response.ok) {
      throw new Error(`InnerTube visitor_id HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      responseContext?: { visitorData?: string };
    };

    const visitorData = data?.responseContext?.visitorData;
    if (!visitorData) {
      throw new Error('InnerTube visitorData ausente na resposta');
    }

    visitorCache.set(VISITOR_CACHE_KEY, visitorData);
    return visitorData;
  }

  return {
    getVisitorData,

    clearVisitorCache(): void {
      visitorCache.clear();
    },

    async postPlayer(videoId: string): Promise<any> {
      const visitorData = await getVisitorData();
      const response = await http.fetch(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': INNERTUBE_USER_AGENT,
            'X-Goog-Api-Format-Version': '2',
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'VISIONOS',
                clientVersion: '1.04',
                clientId: '101',
                clientScreen: 'WATCH',
                deviceMake: 'Apple',
                deviceModel: 'RealityDevice17,1',
                osName: 'visionOS',
                osVersion: '26.6.0.23O770',
                platform: 'MOBILE',
                hl: 'en',
                gl: 'US',
                visitorData,
              },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        },
        8000
      );

      if (!response.ok) {
        throw new Error(`InnerTube player HTTP ${response.status}`);
      }

      return response.json();
    },

    async postSearch(query: string, continuationToken?: string | null): Promise<any> {
      const visitorData = await getVisitorData().catch(() => undefined);
      const bodyPayload: Record<string, unknown> = {
        context: {
          client: {
            clientName: 'VISIONOS',
            clientVersion: '1.04',
            hl: 'pt',
            gl: 'BR',
            ...(visitorData ? { visitorData } : {}),
          },
        },
      };
      if (continuationToken) {
        bodyPayload.continuation = continuationToken;
      } else {
        bodyPayload.query = query;
      }

      const response = await http.fetch(
        'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': INNERTUBE_USER_AGENT,
            'X-Goog-Api-Format-Version': '2',
          },
          body: JSON.stringify(bodyPayload),
        },
        8000
      );

      if (!response.ok) {
        throw new Error(`InnerTube search HTTP ${response.status}`);
      }

      return response.json();
    },

    async postYtmSearch(
      query: string,
      params: string = YTM_ARTIST_SEARCH_PARAMS,
      timeoutMs: number = 6000
    ): Promise<any | null> {
      const response = await http.fetch(
        'https://music.youtube.com/youtubei/v1/search?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': INNERTUBE_USER_AGENT,
          },
          body: JSON.stringify({
            context: YTM_WEB_REMIX_CONTEXT,
            query,
            params,
          }),
        },
        timeoutMs
      );

      if (!response.ok) return null;
      return response.json();
    },

    async postYtmNext(videoId: string, continuationToken?: string): Promise<any | null> {
      const payload: Record<string, unknown> = {
        context: YTM_WEB_REMIX_CONTEXT,
        videoId,
        playlistId: `RDAMVM${videoId}`,
        isAudioOnly: true,
        enablePersistentPlaylistPanel: true,
      };
      if (continuationToken) {
        payload.continuation = continuationToken;
      }

      const response = await http.fetch(
        'https://music.youtube.com/youtubei/v1/next?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': INNERTUBE_USER_AGENT,
          },
          body: JSON.stringify(payload),
        },
        8000
      );

      if (!response.ok) return null;
      return response.json();
    },

    async postYtmBrowse(
      browseId: string,
      params?: string,
      timeoutMs: number = 7000
    ): Promise<any | null> {
      const payload: Record<string, unknown> = {
        context: YTM_WEB_REMIX_CONTEXT,
        browseId,
      };
      if (params) {
        payload.params = params;
      }

      const response = await http.fetch(
        'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': INNERTUBE_USER_AGENT,
          },
          body: JSON.stringify(payload),
        },
        timeoutMs
      );

      if (!response.ok) return null;
      return response.json();
    },
  };
}
