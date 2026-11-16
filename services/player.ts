import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
  State,
  Track,
} from 'react-native-track-player';

export { RepeatMode, Track };

// Controle de concorrência e estado da inicialização singleton
let setupPlayerPromise: Promise<boolean> | null = null;
let isPlayerInitialized = false;

/**
 * Inicializa o serviço nativo do TrackPlayer com tratamento estrito de concorrência.
 * Garante idempotência: se chamado concorrentemente ou repetidas vezes,
 * retorna a mesma Promise em andamento ou true imediato se já inicializado.
 */
export async function setupPlayer(): Promise<boolean> {
  if (isPlayerInitialized) {
    return true;
  }

  if (setupPlayerPromise) {
    return setupPlayerPromise;
  }

  setupPlayerPromise = (async () => {
    try {
      try {
        await TrackPlayer.setupPlayer({
          autoHandleInterruptions: true, // Gerenciamento nativo de interrupções de áudio
        });
      } catch (nativeError: unknown) {
        // Trata Fast Refresh / Re-execuções em desenvolvimento onde o serviço nativo já foi instanciado
        const errorMessage = nativeError instanceof Error ? nativeError.message : String(nativeError);
        const isAlreadyInitialized =
          errorMessage.includes('already initialized') ||
          errorMessage.includes('player_already_initialized');

        if (!isAlreadyInitialized) {
          throw nativeError;
        }
      }

      // Configuração completa de capacidades para a MediaSession do Android
      await TrackPlayer.updateOptions({
        android: {
          // Desaloca o Foreground Service ao fechar o app pelo painel de tarefas recentes
          appKilledPlaybackBehavior:
            AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.JumpForward,
          Capability.JumpBackward,
          Capability.Stop,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
        ],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.JumpForward,
          Capability.JumpBackward,
          Capability.Stop,
        ],
      });

      isPlayerInitialized = true;
      return true;
    } catch (error) {
      isPlayerInitialized = false;
      throw error;
    } finally {
      setupPlayerPromise = null;
    }
  })();

  return setupPlayerPromise;
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.0 Safari/605.1.15';

export interface PlayTrackParams {
  id: string;
  url: string;
  title: string;
  artist: string;
  artwork?: string;
  duration?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  contentType?: string;
}

function buildNormalizedTrack(params: PlayTrackParams): Track {
  const isHttp = typeof params.url === 'string' && params.url.startsWith('http');
  const userAgent = params.userAgent || (isHttp ? DEFAULT_USER_AGENT : undefined);
  const headers =
    params.headers ||
    (isHttp
      ? {
          'User-Agent': userAgent || DEFAULT_USER_AGENT,
          Referer: 'https://www.youtube.com/',
          Origin: 'https://www.youtube.com',
        }
      : undefined);

  return {
    id: params.id,
    url: params.url,
    title: params.title,
    artist: params.artist,
    artwork: params.artwork,
    duration: params.duration,
    userAgent,
    headers,
    contentType: params.contentType || (isHttp ? 'audio/mp4' : undefined),
  };
}

/**
 * Carrega uma única faixa no TrackPlayer e dispara a reprodução imediata.
 * Injeta headers e User-Agent de alta fidelidade para streams remotos prevenindo 403.
 */
export async function playTrack(params: PlayTrackParams): Promise<void> {
  await setupPlayer();
  const track = buildNormalizedTrack(params);

  await TrackPlayer.reset();
  await TrackPlayer.add(track);
  await TrackPlayer.play();
}

/**
 * Inicia a reprodução imediata da nova faixa preservando as faixas futuras já presentes
 * na fila ("A seguir"), removendo apenas eventuais duplicatas dela mesma.
 * Só reinicia a fila quando não houver nenhuma outra faixa na sequência.
 */
export async function playTrackPreservingQueue(
  params: PlayTrackParams
): Promise<{ preservedUpcomingCount: number }> {
  await setupPlayer();
  const track = buildNormalizedTrack(params);

  const queue = await TrackPlayer.getQueue();
  const activeIdx = await TrackPlayer.getActiveTrackIndex();
  const hasValidActive =
    activeIdx !== undefined && activeIdx >= 0 && activeIdx < queue.length;

  if (!hasValidActive) {
    await TrackPlayer.reset();
    await TrackPlayer.add(track);
    await TrackPlayer.play();
    return { preservedUpcomingCount: 0 };
  }

  const duplicateIndices: number[] = [];
  let remainingUpcomingCount = 0;
  for (let i = activeIdx + 1; i < queue.length; i++) {
    if (queue[i].id === track.id) {
      duplicateIndices.push(i);
    } else {
      remainingUpcomingCount++;
    }
  }

  if (remainingUpcomingCount === 0) {
    await TrackPlayer.reset();
    await TrackPlayer.add(track);
    await TrackPlayer.play();
    return { preservedUpcomingCount: 0 };
  }

  // Remove em ordem decrescente para manter os índices anteriores intactos
  for (let i = duplicateIndices.length - 1; i >= 0; i--) {
    await TrackPlayer.remove(duplicateIndices[i]);
  }

  const insertIndex = activeIdx + 1;
  await TrackPlayer.add(track, insertIndex);
  await TrackPlayer.skip(insertIndex);
  await TrackPlayer.play();

  return { preservedUpcomingCount: remainingUpcomingCount };
}

/**
 * Carrega uma lista completa de faixas no TrackPlayer, seleciona o índice inicial e reproduz.
 * Permite reprodução contínua (Up Next / Auto-Advance nativo do ExoPlayer).
 */
export async function playTrackList(tracks: Track[], initialIndex: number = 0): Promise<void> {
  if (!tracks || tracks.length === 0) return;

  await setupPlayer();
  await TrackPlayer.reset();

  const normalizedTracks = tracks.map((t) => {
    const isHttp = typeof t.url === 'string' && t.url.startsWith('http');
    return {
      ...t,
      userAgent: t.userAgent || (isHttp ? DEFAULT_USER_AGENT : undefined),
      headers: t.headers || (isHttp ? {
        'User-Agent': DEFAULT_USER_AGENT,
        Referer: 'https://www.youtube.com/',
        Origin: 'https://www.youtube.com',
      } : undefined),
      contentType: t.contentType || (isHttp ? 'audio/mp4' : undefined),
    };
  });

  await TrackPlayer.add(normalizedTracks);

  if (initialIndex > 0 && initialIndex < tracks.length) {
    await TrackPlayer.skip(initialIndex);
  }

  await TrackPlayer.play();
}

/**
 * Adiciona faixas adicionais ao fim da fila nativa sem interromper a reprodução ativa.
 */
export async function addTracksToQueue(tracks: Track[]): Promise<void> {
  if (!tracks || tracks.length === 0) return;
  await setupPlayer();

  const normalizedTracks = tracks.map((t) => {
    const isHttp = typeof t.url === 'string' && t.url.startsWith('http');
    return {
      ...t,
      userAgent: t.userAgent || (isHttp ? DEFAULT_USER_AGENT : undefined),
      headers: t.headers || (isHttp ? {
        'User-Agent': DEFAULT_USER_AGENT,
        Referer: 'https://www.youtube.com/',
        Origin: 'https://www.youtube.com',
      } : undefined),
      contentType: t.contentType || (isHttp ? 'audio/mp4' : undefined),
    };
  });

  await TrackPlayer.add(normalizedTracks);
}

/**
 * Avança para a próxima faixa na fila nativa de forma resiliente.
 * Retorna true se avançou com sucesso no ExoPlayer, false se atingiu o fim da fila ou houve erro.
 */
export async function skipToNext(): Promise<boolean> {
  try {
    await setupPlayer();
    await TrackPlayer.skipToNext();
    return true;
  } catch (err) {
    console.warn('[Player] Fim da fila ou erro no skipToNext:', err);
    return false;
  }
}

/**
 * Retrocede para a faixa anterior na fila nativa de forma resiliente.
 * Se a música já tocou mais de 3 segundos, reinicia a reprodução da faixa atual (padrão de mercado).
 * Se tocou menos de 3 segundos, retrocede para a faixa anterior da fila nativa.
 * Retorna true se a ação foi executada com sucesso, false caso contrário.
 */
export async function skipToPrevious(forcePreviousTrack: boolean = false): Promise<boolean> {
  try {
    await setupPlayer();
    if (forcePreviousTrack === true) {
      const activeIdx = await TrackPlayer.getActiveTrackIndex();
      if (activeIdx !== undefined && activeIdx > 0) {
        // Usa skip(index) direto porque TrackPlayer.skipToPrevious() no KotlinAudio/ExoPlayer também reinicia a faixa após 3s
        await TrackPlayer.skip(activeIdx - 1);
        return true;
      }
      return false;
    }
    const progress = await TrackPlayer.getProgress();
    if (progress.position > 3) {
      await TrackPlayer.seekTo(0);
      return true;
    }
    await TrackPlayer.skipToPrevious();
    return true;
  } catch (err) {
    if (forcePreviousTrack !== true) {
      try {
        await TrackPlayer.seekTo(0);
      } catch {}
    }
    console.warn('[Player] Início da fila ou erro no skipToPrevious:', err);
    return false;
  }
}

/**
 * Alterna entre Reprodução e Pausa baseado no estado atual da MediaSession.
 */
export async function togglePlayback(): Promise<void> {
  await setupPlayer();
  const playbackState = await TrackPlayer.getPlaybackState();
  const state = playbackState.state;

  if (state === State.Playing) {
    await TrackPlayer.pause();
  } else {
    await TrackPlayer.play();
  }
}

/**
 * Avança ou retrocede para uma posição específica em segundos.
 */
export async function seekTo(positionInSeconds: number): Promise<void> {
  await setupPlayer();
  await TrackPlayer.seekTo(positionInSeconds);
}

/**
 * Salta uma quantidade relativa de segundos (ex: +15s ou -15s).
 */
export async function seekRelative(seconds: number): Promise<void> {
  await setupPlayer();
  const progress = await TrackPlayer.getProgress();
  const target = Math.max(0, Math.min(progress.duration, progress.position + seconds));
  await TrackPlayer.seekTo(target);
}

/**
 * Obtém a lista atual de faixas na fila do TrackPlayer.
 */
export async function getQueue(): Promise<Track[]> {
  await setupPlayer();
  return TrackPlayer.getQueue();
}

/**
 * Interrompe a reprodução e limpa a fila do player.
 */
export async function resetPlayer(): Promise<void> {
  await setupPlayer();
  await TrackPlayer.reset();
}

/**
 * Define o modo de repetição nativo (Off, Track, Queue).
 */
export async function setRepeatMode(mode: RepeatMode): Promise<RepeatMode> {
  await setupPlayer();
  return TrackPlayer.setRepeatMode(mode);
}

/**
 * Obtém o modo de repetição atual do player nativo.
 */
export async function getRepeatMode(): Promise<RepeatMode> {
  await setupPlayer();
  return TrackPlayer.getRepeatMode();
}

/**
 * Define o volume de reprodução (0.0 até 1.0).
 */
export async function setVolume(level: number): Promise<void> {
  await setupPlayer();
  const clamped = Math.max(0, Math.min(1, level));
  await TrackPlayer.setVolume(clamped);
}

/**
 * Obtém o volume atual de reprodução (0.0 até 1.0).
 */
export async function getVolume(): Promise<number> {
  await setupPlayer();
  return TrackPlayer.getVolume();
}

/**
 * Obtém a faixa ativa atualmente no player nativo.
 */
export async function getActiveTrack(): Promise<Track | undefined> {
  await setupPlayer();
  return TrackPlayer.getActiveTrack();
}

/**
 * Obtém o progresso atual de reprodução (posição, duração, buffer).
 */
export async function getProgress(): Promise<{ position: number; duration: number; buffered: number }> {
  await setupPlayer();
  return TrackPlayer.getProgress();
}

/**
 * Pausa a reprodução nativa sem alterar a fila.
 */
export async function pausePlayer(): Promise<void> {
  await setupPlayer();
  await TrackPlayer.pause();
}

/**
 * Obtém o índice da faixa ativa atualmente na fila nativa.
 */
export async function getActiveTrackIndex(): Promise<number | undefined> {
  await setupPlayer();
  return TrackPlayer.getActiveTrackIndex();
}

/**
 * Insere a faixa imediatamente a seguir na fila nativa (activeTrackIndex + 1)
 * sem interromper a reprodução da faixa atual.
 */
export async function playNextTrack(track: Track): Promise<void> {
  await setupPlayer();
  const queue = await TrackPlayer.getQueue();
  const activeIdx = await TrackPlayer.getActiveTrackIndex();

  const isHttp = typeof track.url === 'string' && track.url.startsWith('http');
  const normalizedTrack: Track = {
    ...track,
    userAgent: track.userAgent || (isHttp ? DEFAULT_USER_AGENT : undefined),
    headers: track.headers || (isHttp ? {
      'User-Agent': DEFAULT_USER_AGENT,
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com',
    } : undefined),
    contentType: track.contentType || (isHttp ? 'audio/mp4' : undefined),
  };

  if (activeIdx === undefined || activeIdx < 0 || queue.length === 0) {
    await TrackPlayer.add(normalizedTrack);
  } else {
    await TrackPlayer.add(normalizedTrack, activeIdx + 1);
  }
}

/**
 * Adiciona uma faixa ao final absoluto da fila nativa sem interromper o playback.
 */
export async function addTrackToEndOfQueue(track: Track): Promise<void> {
  await setupPlayer();
  const isHttp = typeof track.url === 'string' && track.url.startsWith('http');
  const normalizedTrack: Track = {
    ...track,
    userAgent: track.userAgent || (isHttp ? DEFAULT_USER_AGENT : undefined),
    headers: track.headers || (isHttp ? {
      'User-Agent': DEFAULT_USER_AGENT,
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com',
    } : undefined),
    contentType: track.contentType || (isHttp ? 'audio/mp4' : undefined),
  };
  await TrackPlayer.add(normalizedTrack);
}

/**
 * Remove uma faixa específica da fila pelo índice.
 * Impede a remoção da faixa ativa ou de índices inválidos para evitar quebra de playback.
 */
export async function removeTrackFromQueue(index: number): Promise<boolean> {
  await setupPlayer();
  const queue = await TrackPlayer.getQueue();
  const activeIdx = await TrackPlayer.getActiveTrackIndex();

  if (index < 0 || index >= queue.length) {
    return false;
  }

  if (activeIdx !== undefined && index === activeIdx) {
    return false;
  }

  await TrackPlayer.remove(index);
  return true;
}

let queueMoveChain: Promise<void> = Promise.resolve();

/**
 * Move uma faixa de uma posição para outra na fila nativa com validação estrita de limites.
 * Para faixas inativas do mesmo lado da faixa ativa, usa remove + add em vez de TrackPlayer.move,
 * evitando o bug do KotlinAudio v2.1.0 (que subtrai 1 ao mover para cima e dessincroniza a fila).
 */
export async function moveTrackInQueue(fromIndex: number, toIndex: number): Promise<boolean> {
  let moved = false;

  const run = async () => {
    await setupPlayer();
    const queue = await TrackPlayer.getQueue();

    if (
      fromIndex < 0 ||
      fromIndex >= queue.length ||
      toIndex < 0 ||
      toIndex >= queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const activeIdx = await TrackPlayer.getActiveTrackIndex();
    const trackToMove = queue[fromIndex];
    const canReorderViaRemoveAdd =
      Boolean(trackToMove) &&
      (activeIdx === undefined ||
        (fromIndex > activeIdx && toIndex > activeIdx) ||
        (fromIndex < activeIdx && toIndex < activeIdx));

    if (canReorderViaRemoveAdd) {
      await TrackPlayer.remove(fromIndex);
      await TrackPlayer.add(trackToMove, toIndex);
    } else {
      await TrackPlayer.move(fromIndex, toIndex);
    }
    moved = true;
  };

  queueMoveChain = queueMoveChain.then(run, run);
  await queueMoveChain;
  return moved;
}

/**
 * Salta diretamente para um índice absoluto na fila nativa.
 */
export async function skipToIndex(index: number): Promise<void> {
  await setupPlayer();
  await TrackPlayer.skip(index);
}

/**
 * Retorna uma cópia embaralhada via Fisher-Yates sem mutar o array original.
 */
export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Ativa o modo Shuffle de forma não-destrutiva.
 * Mantém o histórico já reproduzido até a faixa ativa e embaralha apenas as próximas faixas.
 * Retorna a nova ordem da lista completa com a faixa ativa preservada.
 */
export async function enableShuffle(
  originalTracks: Track[],
  currentTrackId: string,
  activeIndex?: number
): Promise<Track[]> {
  await setupPlayer();
  if (!originalTracks || originalTracks.length <= 1) return originalTracks || [];

  const nativeIdx =
    activeIndex !== undefined ? activeIndex : await TrackPlayer.getActiveTrackIndex();
  const resolvedIdx =
    nativeIdx !== undefined &&
    nativeIdx >= 0 &&
    nativeIdx < originalTracks.length &&
    originalTracks[nativeIdx]?.id === currentTrackId
      ? nativeIdx
      : originalTracks.findIndex((t) => t.id === currentTrackId);

  const prefix =
    resolvedIdx >= 0 ? originalTracks.slice(0, resolvedIdx + 1) : [originalTracks[0]];
  const upcomingSource =
    resolvedIdx >= 0
      ? originalTracks.slice(resolvedIdx + 1)
      : originalTracks.slice(1);
  const remaining = shuffleArray(upcomingSource);

  const shuffledList = [...prefix, ...remaining];

  await TrackPlayer.removeUpcomingTracks();
  if (remaining.length > 0) {
    await TrackPlayer.add(remaining);
  }

  return shuffledList;
}

/**
 * Desativa o modo Shuffle (Un-shuffle verdadeiro), restaurando a ordem original das próximas faixas
 * a partir do snapshot imutável sem reiniciar ou duplicar faixas já reproduzidas até a faixa ativa.
 */
export async function disableShuffle(
  originalTracks: Track[],
  currentTrackId: string,
  activeIndex?: number
): Promise<Track[]> {
  await setupPlayer();
  if (!originalTracks || originalTracks.length <= 1) return originalTracks || [];

  const queue = await TrackPlayer.getQueue();
  const nativeIdx =
    activeIndex !== undefined ? activeIndex : await TrackPlayer.getActiveTrackIndex();
  const hasValidNativeIdx = nativeIdx !== undefined && nativeIdx >= 0 && nativeIdx < queue.length;

  const currentOriginalIdx = originalTracks.findIndex((t) => t.id === currentTrackId);

  let remainingOriginal: Track[];
  if (hasValidNativeIdx && queue[nativeIdx]?.id === currentTrackId) {
    if (
      currentOriginalIdx === nativeIdx &&
      queue
        .slice(0, nativeIdx + 1)
        .every((t, idx) => originalTracks[idx]?.id === t.id)
    ) {
      remainingOriginal = originalTracks.slice(currentOriginalIdx + 1);
    } else {
      // Usuário avançou de faixa enquanto o Shuffle estava ativo: restaura apenas o que ainda não está antes/na faixa ativa
      const prefixCounts = new Map<string, number>();
      for (let i = 0; i <= nativeIdx; i++) {
        const id = queue[i]?.id;
        if (id) prefixCounts.set(id, (prefixCounts.get(id) || 0) + 1);
      }
      remainingOriginal = [];
      for (const track of originalTracks) {
        const used = prefixCounts.get(track.id) || 0;
        if (used > 0) {
          prefixCounts.set(track.id, used - 1);
        } else {
          remainingOriginal.push(track);
        }
      }
    }
  } else {
    const startIdx = currentOriginalIdx >= 0 ? currentOriginalIdx : 0;
    remainingOriginal = originalTracks.slice(startIdx + 1);
  }

  await TrackPlayer.removeUpcomingTracks();
  if (remainingOriginal.length > 0) {
    await TrackPlayer.add(remainingOriginal);
  }

  return hasValidNativeIdx
    ? [...queue.slice(0, nativeIdx + 1), ...remainingOriginal]
    : originalTracks;
}

/**
 * Embaralha as próximas faixas da fila nativa mantendo a faixa atual em execução.
 * Mantido por retrocompatibilidade.
 */
export async function shuffleUpcomingQueue(): Promise<void> {
  await setupPlayer();
  const queue = await TrackPlayer.getQueue();
  const activeIdx = await TrackPlayer.getActiveTrackIndex();

  if (activeIdx === undefined || activeIdx >= queue.length - 1) return;

  const activeTrack = queue[activeIdx];
  await enableShuffle(queue, activeTrack.id, activeIdx);
}

/**
 * Substitui todas as faixas futuras da fila nativa (Rádio Inteligente)
 * preservando a reprodução ininterrupta da faixa atual no ExoPlayer/AVPlayer.
 */
export async function replaceUpcomingQueue(tracks: Track[]): Promise<void> {
  await setupPlayer();
  await TrackPlayer.removeUpcomingTracks();

  if (!tracks || tracks.length === 0) return;

  const normalizedTracks = tracks.map((t) => {
    const isHttp = typeof t.url === 'string' && t.url.startsWith('http');
    return {
      ...t,
      userAgent: t.userAgent || (isHttp ? DEFAULT_USER_AGENT : undefined),
      headers: t.headers || (isHttp ? {
        'User-Agent': DEFAULT_USER_AGENT,
        Referer: 'https://www.youtube.com/',
        Origin: 'https://www.youtube.com',
      } : undefined),
      contentType: t.contentType || (isHttp ? 'audio/mp4' : undefined),
    };
  });

  await TrackPlayer.add(normalizedTracks);
}
