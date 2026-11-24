/**
 * Caso de uso: Extração de stream de áudio com pipeline Strategy/Chain of Responsibility + cache TTL.
 * Aberto para extensão (OCP): novos clients de extração podem ser plugados no array `strategies`.
 */

import {
  AudioStreamResult,
  MediaProviderUnavailableError,
} from '../../services/mediaProvider';
import { FallbackInstancesClient } from '../infra/fallbackInstances';
import {
  INNERTUBE_STREAM_HEADERS,
  INNERTUBE_USER_AGENT,
  InnerTubeClient,
} from '../infra/innerTubeClient';
import { TtlCache } from '../infra/ttlCache';
import { extractVideoId } from '../parsers/searchParsers';

export interface AudioStreamStrategy {
  readonly name: string;
  extract(cleanId: string): Promise<AudioStreamResult>;
}

export function createInnerTubeAudioStrategy(
  innerTube: Pick<InnerTubeClient, 'postPlayer'>
): AudioStreamStrategy {
  return {
    name: 'innertube-visionos',
    async extract(cleanId: string): Promise<AudioStreamResult> {
      const pData = (await innerTube.postPlayer(cleanId)) as {
        playabilityStatus?: { status?: string; reason?: string };
        videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
        streamingData?: {
          adaptiveFormats?: Array<{
            itag?: number;
            url?: string;
            mimeType?: string;
            bitrate?: number;
            contentLength?: string;
          }>;
        };
      };

      if (pData.playabilityStatus?.status !== 'OK') {
        throw new Error(
          `Status do player InnerTube: ${pData.playabilityStatus?.status || 'ERRO'} (${pData.playabilityStatus?.reason || 'sem razão'})`
        );
      }

      const audioFormats =
        pData.streamingData?.adaptiveFormats?.filter(
          (f) => f.mimeType && f.mimeType.includes('audio') && Boolean(f.url)
        ) || [];

      if (audioFormats.length === 0) {
        throw new Error('Nenhum formato de áudio direto disponível no InnerTube');
      }

      const selected =
        audioFormats.find((f) => f.itag === 140) ||
        audioFormats.find((f) => f.mimeType?.includes('audio/mp4')) ||
        audioFormats[0];

      if (!selected || !selected.url) {
        throw new Error('URL de áudio não encontrada nos formatos InnerTube');
      }

      const durationSec = parseInt(pData.videoDetails?.lengthSeconds || '0', 10);

      return {
        videoId: cleanId,
        title: pData.videoDetails?.title || 'Faixa Desconhecida',
        artist: pData.videoDetails?.author || 'Artista Desconhecido',
        duration: durationSec,
        thumbnailUrl: `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`,
        streamUrl: selected.url,
        mimeType: (selected.mimeType || 'audio/mp4').split(';')[0],
        format: 'm4a',
        bitrate: selected.bitrate || 131072,
        userAgent: INNERTUBE_USER_AGENT,
        headers: { ...INNERTUBE_STREAM_HEADERS },
      };
    },
  };
}

export function createFallbackInstancesAudioStrategy(
  fallback: Pick<FallbackInstancesClient, 'fetchAudioStream'>
): AudioStreamStrategy {
  return {
    name: 'fallback-instances',
    extract(cleanId: string): Promise<AudioStreamResult> {
      return fallback.fetchAudioStream(cleanId);
    },
  };
}

export interface ExtractAudioStreamDeps {
  strategies: readonly AudioStreamStrategy[];
  cache: TtlCache<AudioStreamResult>;
  onInvalidate?: () => void;
}

export interface ExtractAudioStreamUseCase {
  execute(mediaId: string): Promise<AudioStreamResult>;
  invalidateCache(mediaId?: string): void;
  getCached(mediaId: string): AudioStreamResult | undefined;
}

export function createExtractAudioStreamUseCase({
  strategies,
  cache,
  onInvalidate,
}: ExtractAudioStreamDeps): ExtractAudioStreamUseCase {
  return {
    async execute(mediaId: string): Promise<AudioStreamResult> {
      const cleanId = extractVideoId(mediaId);
      if (!cleanId) {
        throw new Error(`ID de vídeo inválido: "${mediaId}"`);
      }

      const cached = cache.get(cleanId);
      if (cached) {
        return cached;
      }

      const strategyErrors: Record<string, string> = {};

      for (let idx = 0; idx < strategies.length; idx++) {
        const strategy = strategies[idx];
        try {
          const result = await strategy.extract(cleanId);
          cache.set(cleanId, result);
          return result;
        } catch (err: unknown) {
          const isLast = idx === strategies.length - 1;
          if (!isLast) {
            console.warn(
              `[MediaProvider] Falha na estratégia "${strategy.name}" para "${cleanId}", acionando fallback:`,
              err instanceof Error ? err.message : err
            );
          }

          if (err instanceof MediaProviderUnavailableError) {
            Object.assign(strategyErrors, err.instanceErrors);
          } else {
            strategyErrors[strategy.name] =
              err instanceof Error ? err.message : String(err);
          }
        }
      }

      throw new MediaProviderUnavailableError(strategyErrors);
    },

    invalidateCache(mediaId?: string): void {
      onInvalidate?.();
      if (!mediaId) {
        cache.clear();
        return;
      }
      const cleanId = extractVideoId(mediaId);
      if (cleanId) {
        cache.delete(cleanId);
      }
    },

    getCached(mediaId: string): AudioStreamResult | undefined {
      const cleanId = extractVideoId(mediaId);
      return cleanId ? cache.get(cleanId) : undefined;
    },
  };
}
