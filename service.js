import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * Android Foreground Playback Service
 * 
 * Registrador de eventos remotos do Android acionados a partir de:
 * - Notificação de mídia do Android (MediaNotification)
 * - Controles da Tela de Bloqueio (LockScreen)
 * - Dispositivos Bluetooth e Android Auto (MediaSession)
 * - Gerenciamento de Audio Focus do Android (RemoteDuck)
 */
export const playbackService = async function () {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch (err) {
      console.warn('[TrackPlayer] Fim da fila ou erro no RemoteNext:', err);
    }
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      const progress = await TrackPlayer.getProgress();
      if (progress.position > 3) {
        await TrackPlayer.seekTo(0);
        return;
      }
      await TrackPlayer.skipToPrevious();
    } catch (err) {
      try {
        await TrackPlayer.seekTo(0);
      } catch {}
      console.warn('[TrackPlayer] Início da fila ou erro no RemotePrevious:', err);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.reset();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (event) => {
    try {
      const progress = await TrackPlayer.getProgress();
      const interval = event.interval || 15;
      await TrackPlayer.seekTo(progress.position + interval);
    } catch (err) {
      console.warn('[TrackPlayer] Erro no RemoteJumpForward:', err);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (event) => {
    try {
      const progress = await TrackPlayer.getProgress();
      const interval = event.interval || 15;
      await TrackPlayer.seekTo(Math.max(0, progress.position - interval));
    } catch (err) {
      console.warn('[TrackPlayer] Erro no RemoteJumpBackward:', err);
    }
  });

  /**
   * Audio Focus no Android (RemoteDuck)
   * Trata interrupções externas de áudio conforme o contrato real do RemoteDuckEvent:
   * - permanent === true: Perda definitiva do foco (outro app iniciou áudio prioritário) -> Para a reprodução.
   * - paused === true: Perda temporária com instrução de pausa (ex: chamada telefônica ativa) -> Pausa a reprodução.
   * - Retomada (else): Foco restabelecido após interrupção transitória -> Retoma a reprodução (play).
   * 
   * Nota: A atenuação de volume (ducking transitório para GPS/notificações) é gerenciada
   * nativamente pelo ExoPlayer através de autoHandleInterruptions: true em services/player.ts.
   */
  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    if (event.permanent) {
      await TrackPlayer.stop();
    } else if (event.paused) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  });

  /**
   * Tratamento de falhas de reprodução assíncronas do ExoPlayer / Core Audio.
   */
  TrackPlayer.addEventListener(Event.PlaybackError, (error) => {
    console.warn('[TrackPlayer] PlaybackError capturado:', error);
  });
};

export default playbackService;
