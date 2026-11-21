import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Track, useProgress } from 'react-native-track-player';
import {
  Heart,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { RepeatMode } from '../services/player';
import { useArtworkMiniPlayerColor } from './AmbientGlowBackground';
import { MarqueeText } from './MarqueeText';
import { theme } from '../theme';

export interface PersistentMiniPlayerProps {
  activeTrack: Track;
  isPlaying: boolean;
  isLoadingAudio: boolean;
  isBuffering: boolean;
  /**
   * Percentual de progresso (0-100).
   * Opcional: Se omitido, consome useProgress(500) internamente,
   * isolando o re-render do restante da aplicação.
   */
  progressPct?: number;
  isFavorite?: boolean;
  repeatMode?: RepeatMode;
  isShuffleActive?: boolean;
  volume?: number;
  onExpand: () => void;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrevious: () => void;
  onToggleFavorite?: () => void;
  onToggleRepeat?: () => void;
  onToggleShuffle?: () => void;
  onToggleMute?: () => void;
  onSeek?: (positionSeconds: number) => void;
  onDragMove?: (dy: number) => void;
  onDragRelease?: (dy: number, vy: number) => void;
  onDragCancel?: () => void;
}

/**
 * Paleta curada de tons atmosféricos escuros do Spotify (Deep Dark Mode)
 * Tons ricos, profundos e com contraste AAA (> 9.5:1) para texto branco.
 */
export const SPOTIFY_DARK_PALETTES = [
  '#132438', // Deep Midnight Navy (tom da screenshot do Bryson Tiller)
  '#0e2d24', // Deep Forest Emerald
  '#2a1435', // Deep Velvet Violet
  '#351419', // Deep Wine Burgundy
  '#322111', // Deep Amber Bronze
  '#112932', // Deep Dark Teal
  '#1c202a', // Deep Slate Carbon
  '#1e1430', // Deep Indigo Purple
  '#2d1b14', // Deep Warm Terracotta
  '#1a2a1e', // Deep Olive Pine
  '#19232d', // Deep Steel Blue
  '#251829', // Deep Mulberry
];

/**
 * Extrai deterministicamente uma cor predominante escura refinada do Spotify
 * baseada nos metadados ou na URL da capa da faixa.
 */
export function getDominantTrackColor(artworkUrl?: string, trackId?: string, title?: string): string {
  const seed = (artworkUrl || '') + (trackId || '') + (title || '');
  if (!seed || seed.trim().length === 0) {
    return '#18181A';
  }

  // Se o título ou capa conter pistas de cor/clima
  const lower = seed.toLowerCase();
  if (lower.includes('blue') || lower.includes('cold') || lower.includes('ocean') || lower.includes('still yours')) return '#132438';
  if (lower.includes('green') || lower.includes('chill') || lower.includes('forest')) return '#0e2d24';
  if (lower.includes('purple') || lower.includes('starboy') || lower.includes('violet')) return '#2a1435';
  if (lower.includes('red') || lower.includes('love') || lower.includes('fire')) return '#351419';
  if (lower.includes('yellow') || lower.includes('gold') || lower.includes('sun')) return '#322111';

  // Hashing determinístico FNV-1a para distribuição homogênea e estável
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = Math.abs(hash) % SPOTIFY_DARK_PALETTES.length;
  return SPOTIFY_DARK_PALETTES[index];
}

export const PersistentMiniPlayer: React.FC<PersistentMiniPlayerProps> = ({
  activeTrack,
  isPlaying,
  isLoadingAudio,
  isBuffering,
  progressPct,
  isFavorite = false,
  repeatMode = RepeatMode.Off,
  isShuffleActive = false,
  volume = 1.0,
  onExpand,
  onTogglePlay,
  onSkipNext,
  onSkipPrevious,
  onToggleFavorite,
  onToggleRepeat,
  onToggleShuffle,
  onToggleMute,
  onSeek,
  onDragMove,
  onDragRelease,
  onDragCancel,
}) => {
  const [imageError, setImageError] = useState(false);
  const screenWidth = Dimensions.get('window').width;
  const isCompact = screenWidth < 680;
  const dragCallbacksRef = useRef({ onDragMove, onDragRelease, onDragCancel });
  dragCallbacksRef.current = { onDragMove, onDragRelease, onDragCancel };
  const hasDragHandlers = Boolean(onDragMove || onDragRelease || onDragCancel);

  const miniPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gs) =>
          Boolean(
            dragCallbacksRef.current.onDragMove ||
              dragCallbacksRef.current.onDragRelease
          ) &&
          gs.dy < -6 &&
          Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2,
        onMoveShouldSetPanResponderCapture: (_, gs) =>
          Boolean(
            dragCallbacksRef.current.onDragMove ||
              dragCallbacksRef.current.onDragRelease
          ) &&
          gs.dy < -8 &&
          Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2,
        onPanResponderMove: (_, gs) => {
          dragCallbacksRef.current.onDragMove?.(gs.dy);
        },
        onPanResponderRelease: (_, gs) => {
          dragCallbacksRef.current.onDragRelease?.(gs.dy, gs.vy);
        },
        onPanResponderTerminate: () => {
          dragCallbacksRef.current.onDragCancel?.();
        },
      }),
    []
  );

  // Cor de fundo dinâmica extraída dos pixels reais da capa (com fallback determinístico enquanto carrega)
  const fallbackDominantBgColor = useMemo(
    () => getDominantTrackColor(activeTrack?.artwork, activeTrack?.id, activeTrack?.title),
    [activeTrack?.artwork, activeTrack?.id, activeTrack?.title]
  );
  const dominantBgColor = useArtworkMiniPlayerColor(
    typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : null,
    fallbackDominantBgColor
  );

  // Isolamento de re-renderização: usa useProgress local apenas se progressPct não for passado
  const internalProgress = useProgress(progressPct !== undefined ? undefined : 500);

  const effectiveDuration =
    internalProgress.duration > 0
      ? internalProgress.duration
      : (activeTrack.duration && activeTrack.duration > 0 ? activeTrack.duration : 0);

  const effectivePosition = internalProgress.position;

  const effectivePct =
    progressPct !== undefined
      ? progressPct
      : effectiveDuration > 0
        ? (effectivePosition / effectiveDuration) * 100
        : 0;

  const clampedPct = Math.min(Math.max(effectivePct, 0), 100);

  const handleProgressBarPress = (evt: any) => {
    evt.stopPropagation?.();
    if (!onSeek || effectiveDuration <= 0) return;
    const clickX = evt.nativeEvent.locationX || 0;
    const ratio = Math.max(0, Math.min(1, clickX / screenWidth));
    onSeek(ratio * effectiveDuration);
  };

  return (
    <View {...(hasDragHandlers ? miniPanResponder.panHandlers : {})}>
      <TouchableOpacity
        style={[
          styles.miniPlayer,
          { backgroundColor: dominantBgColor },
        ]}
        activeOpacity={0.94}
        onPress={onExpand}
        accessibilityRole="button"
        accessibilityLabel={`Tocando agora: ${activeTrack.title} por ${activeTrack.artist}. Toque para expandir player.`}
      >
      <View style={styles.contentRow}>
        {/* Lado Esquerdo: Miniatura da Capa e Metadados estilo Spotify */}
        <View style={styles.leftInfoCluster}>
          <View style={styles.thumbnailWrapper}>
            {activeTrack.artwork && !imageError ? (
              <Image
                source={{ uri: activeTrack.artwork }}
                style={styles.miniThumbnail}
                onError={() => setImageError(true)}
              />
            ) : (
              <View style={styles.thumbnailFallback}>
                <Music2 color="#AAAAAA" size={20} />
              </View>
            )}
          </View>

          <View style={styles.metaColumn}>
            <MarqueeText active={true} style={styles.miniTitle}>
              {activeTrack.title || 'Música'}
            </MarqueeText>
            <MarqueeText active={true} style={styles.miniArtist}>
              {activeTrack.artist || 'Artista'}
            </MarqueeText>
          </View>
        </View>

        {/* Lado Direito: Ações e Controles estilo Spotify */}
        <View style={styles.rightControls}>
          {/* Botão de Favorito / Adicionar */}
          {onToggleFavorite && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={(e) => {
                e?.stopPropagation?.();
                onToggleFavorite();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              activeOpacity={0.7}
            >
              <Heart
                color={isFavorite ? '#FF0000' : '#B3B3B3'}
                fill={isFavorite ? '#FF0000' : 'transparent'}
                size={18}
              />
            </TouchableOpacity>
          )}

          {/* Botão Voltar Faixa */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              onSkipPrevious();
            }}
            disabled={isLoadingAudio}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Voltar faixa"
            activeOpacity={0.7}
          >
            <SkipBack color="#FFFFFF" size={18} fill="#FFFFFF" />
          </TouchableOpacity>

          {/* Botão Tocar / Pausar (Ícone puro branco com preenchimento como no Spotify) */}
          <TouchableOpacity
            style={styles.playButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              onTogglePlay();
            }}
            disabled={isLoadingAudio}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pausar música' : 'Tocar música'}
            activeOpacity={0.7}
          >
            {isLoadingAudio || isBuffering ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : isPlaying ? (
              <Pause color="#FFFFFF" size={22} fill="#FFFFFF" />
            ) : (
              <Play color="#FFFFFF" size={22} fill="#FFFFFF" style={{ marginLeft: 1.5 }} />
            )}
          </TouchableOpacity>

          {/* Botão Avançar Faixa */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              onSkipNext();
            }}
            disabled={isLoadingAudio}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Avançar faixa"
            activeOpacity={0.7}
          >
            <SkipForward color="#FFFFFF" size={18} fill="#FFFFFF" />
          </TouchableOpacity>

          {/* Controles Desktop Avançados */}
          {!isCompact && onToggleRepeat && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={(e) => {
                e?.stopPropagation?.();
                onToggleRepeat();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Repetir"
            >
              {repeatMode === RepeatMode.Track ? (
                <Repeat1 color="#1DB954" size={18} />
              ) : (
                <Repeat
                  color={repeatMode === RepeatMode.Queue ? '#1DB954' : '#717171'}
                  size={18}
                />
              )}
            </TouchableOpacity>
          )}

          {!isCompact && onToggleShuffle && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={(e) => {
                e?.stopPropagation?.();
                onToggleShuffle();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Ordem aleatória"
            >
              <Shuffle color={isShuffleActive ? '#1DB954' : '#717171'} size={18} />
            </TouchableOpacity>
          )}

          {!isCompact && onToggleMute && (
            <View style={styles.volumeGroup}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onToggleMute();
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={volume === 0 ? 'Ativar som' : 'Desativar som'}
                activeOpacity={0.7}
              >
                {volume === 0 ? (
                  <VolumeX color="#FF4E45" size={18} />
                ) : (
                  <Volume2 color="#B3B3B3" size={18} />
                )}
              </TouchableOpacity>
              <View style={styles.volumeSliderTrack}>
                <View
                  style={[
                    styles.volumeSliderFill,
                    { width: `${Math.round((volume ?? 1) * 100)}%` },
                  ]}
                />
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Barra de Progresso Fina no Rodapé do Card (Padrão Spotify) */}
      <TouchableOpacity
        style={styles.progressBarWrapper}
        activeOpacity={1}
        onPress={handleProgressBarPress}
      >
        <View style={styles.miniProgressBarTrack}>
          <View
            style={[
              styles.miniProgressBarFill,
              { width: `${clampedPct}%` },
            ]}
          />
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  miniPlayer: {
    height: 56,
    marginHorizontal: 0,
    marginBottom: 6,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 10,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 8,
    paddingRight: 8,
    height: 56,
  },
  leftInfoCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginRight: 6,
  },
  thumbnailWrapper: {
    width: 40,
    height: 40,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  miniThumbnail: {
    width: 40,
    height: 40,
    borderRadius: 4,
  },
  thumbnailFallback: {
    width: 40,
    height: 40,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaColumn: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
    minWidth: 0,
  },
  miniTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  miniArtist: {
    fontSize: 12,
    fontWeight: '400',
    color: '#B3B3B3',
    marginTop: 1,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  volumeSliderTrack: {
    width: 48,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  volumeSliderFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  progressBarWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    zIndex: 10,
  },
  miniProgressBarTrack: {
    width: '100%',
    height: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  miniProgressBarFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
});

export default PersistentMiniPlayer;
