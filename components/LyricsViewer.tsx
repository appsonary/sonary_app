import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlignLeft,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Music2,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react-native';
import { LyricLine, TrackLyricsPayload } from '../services/api';
import { LyricsBackdropBackground } from './AmbientGlowBackground';

const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;

export interface LyricsViewerProps {
  track: {
    id?: string;
    title?: string;
    artist?: string;
    duration?: number;
  };
  lyricsPayload: TrackLyricsPayload | null;
  syncedLyricsProp?: LyricLine[] | null;
  isLoading: boolean;
  currentPosition: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onHeaderPress?: () => void;
  /** Mantida opcional para compatibilidade; versos são somente leitura e não disparam seek. */
  onSeekTo?: (seconds: number) => void;
  onRetry?: () => void;
  ambientColor?: string;
  artworkUri?: string | null;
  onCardLayout?: (y: number) => void;
  variant?: 'card' | 'fullscreen';
  isPlaying?: boolean;
  isBuffering?: boolean;
  onTogglePlay?: () => void;
  onClose?: () => void;
  scrubberSlot?: React.ReactNode;
}

export const LyricsViewer = React.memo(function LyricsViewer({
  track,
  lyricsPayload,
  syncedLyricsProp,
  isLoading,
  currentPosition,
  isExpanded,
  onToggleExpand,
  onHeaderPress,
  onRetry,
  ambientColor = 'rgba(255, 255, 255, 0.06)',
  artworkUri,
  onCardLayout,
  variant = 'card',
  isPlaying = false,
  isBuffering = false,
  onTogglePlay,
  onClose,
  scrubberSlot,
}: LyricsViewerProps) {
  const [displayMode, setDisplayMode] = useState<'synced' | 'plain'>('synced');
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(variant === 'fullscreen' ? 520 : 220);
  const lyricsScrollRef = useRef<ScrollView>(null);
  const lineOffsetsRef = useRef<Record<number, number>>({});
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFullscreen = variant === 'fullscreen';

  // Prioriza prop direta syncedLyrics (compatibilidade com suíte de testes) ou payload real da API
  const effectivePayload = useMemo<TrackLyricsPayload>(() => {
    if (syncedLyricsProp && syncedLyricsProp.length > 0) {
      return {
        trackId: track.id || 'custom',
        type: 'synced',
        lines: syncedLyricsProp,
        plainText: syncedLyricsProp.map((l) => l.text).join('\n'),
        provider: 'lrclib',
        cachedAt: Date.now(),
      };
    }
    if (lyricsPayload) {
      return lyricsPayload;
    }
    return {
      trackId: track.id || '',
      type: 'none',
      lines: [],
      provider: 'none',
      cachedAt: 0,
    };
  }, [syncedLyricsProp, lyricsPayload, track.id]);

  // Sincroniza modo inicial de exibição com o tipo disponível da letra
  useEffect(() => {
    lineOffsetsRef.current = {};
    if (effectivePayload.type === 'plain') {
      setDisplayMode('plain');
    } else if (effectivePayload.type === 'synced') {
      setDisplayMode('synced');
    }
  }, [effectivePayload.trackId, effectivePayload.type]);

  useEffect(() => {
    return () => {
      if (userScrollTimerRef.current) {
        clearTimeout(userScrollTimerRef.current);
      }
    };
  }, []);

  const handleUserScrollInteraction = () => {
    setIsUserScrolling(true);
    if (userScrollTimerRef.current) {
      clearTimeout(userScrollTimerRef.current);
    }
    userScrollTimerRef.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 4000);
    if (
      userScrollTimerRef.current &&
      typeof (userScrollTimerRef.current as any).unref === 'function'
    ) {
      (userScrollTimerRef.current as any).unref();
    }
  };

  // Identificação milimétrica da linha ativa
  const activeLyricIndex = useMemo(() => {
    if (effectivePayload.type !== 'synced' || effectivePayload.lines.length === 0) {
      return -1;
    }
    let idx = 0;
    for (let i = 0; i < effectivePayload.lines.length; i++) {
      if (currentPosition >= effectivePayload.lines[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [currentPosition, effectivePayload]);

  // Autoscroll suave guiado pela posição real medida via onLayout (sem drift)
  useEffect(() => {
    if (
      displayMode !== 'synced' ||
      effectivePayload.type !== 'synced' ||
      activeLyricIndex < 0 ||
      isUserScrolling
    ) {
      return;
    }
    const containerHeight = viewportHeight > 0 ? viewportHeight : isFullscreen ? 520 : 220;
    const measuredY = lineOffsetsRef.current[activeLyricIndex];
    const targetY =
      measuredY !== undefined
        ? Math.max(0, measuredY - containerHeight * 0.35)
        : Math.max(0, activeLyricIndex * (isFullscreen ? 54 : 38) - 60);

    lyricsScrollRef.current?.scrollTo?.({
      y: targetY,
      animated: true,
    });
  }, [activeLyricIndex, displayMode, effectivePayload.type, isFullscreen, isUserScrolling, viewportHeight]);

  const hasRealLyrics =
    effectivePayload.type !== 'none' && effectivePayload.lines.length > 0;

  const renderLyricsBody = () => {
    if (!hasRealLyrics) {
      return (
        <View
          style={[
            styles.emptyLyricsContainer,
            isFullscreen && styles.emptyLyricsContainerFullscreen,
          ]}
        >
          {isLoading ? (
            <View style={styles.loadingLyricsBox}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.emptyLyricsSubtitle}>
                Buscando letras sincronizadas...
              </Text>
            </View>
          ) : (
            <View style={styles.unavailableBox}>
              <Music2 color="rgba(255, 255, 255, 0.55)" size={isFullscreen ? 36 : 28} />
              <Text style={styles.emptyLyricsTitle}>
                Letras não disponíveis para esta faixa
              </Text>
              <Text style={styles.emptyLyricsSubtitle}>
                Não encontramos letra sincronizada ou em texto puro para esta música.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.retryLyricButton}
            onPress={() => onRetry?.()}
            accessibilityRole="button"
            accessibilityLabel="Tentar carregar letras novamente"
          >
            <RefreshCw color="#FFFFFF" size={14} />
            <Text style={styles.retryLyricButtonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (displayMode === 'plain' || effectivePayload.type === 'plain') {
      return (
        <View style={styles.plainLyricsContainer}>
          {effectivePayload.lines.map((line, lIdx) => (
            <View
              key={lIdx}
              style={isFullscreen ? styles.fullscreenLyricLineRow : styles.lyricLineRow}
            >
              <Text
                style={
                  isFullscreen
                    ? styles.fullscreenPlainLyricText
                    : styles.plainLyricLineText
                }
              >
                {line.text}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    return effectivePayload.lines.map((line, lIdx) => {
      const isActive = lIdx === activeLyricIndex;
      return (
        <View
          key={lIdx}
          style={isFullscreen ? styles.fullscreenLyricLineRow : styles.lyricLineRow}
          onLayout={(e) => {
            const y = e?.nativeEvent?.layout?.y;
            if (typeof y === 'number') {
              lineOffsetsRef.current[lIdx] = y;
            }
          }}
        >
          <Text
            style={[
              isFullscreen ? styles.fullscreenLyricLineText : styles.lyricLineText,
              isActive &&
                (isFullscreen
                  ? styles.fullscreenLyricLineTextActive
                  : styles.lyricLineTextActive),
            ]}
          >
            {line.text}
          </Text>
        </View>
      );
    });
  };

  if (isFullscreen) {
    const handleClose = onClose ?? onToggleExpand;
    return (
      <View
        style={styles.fullscreenRoot}
        testID="fullscreen-lyrics-view"
      >
        <LyricsBackdropBackground artworkUri={artworkUri} />

        {/* Header minimalista (sem título/artista) */}
        <View style={styles.fullscreenHeader}>
          <TouchableOpacity
            style={styles.fullscreenCloseBtn}
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Recolher letras"
          >
            <ChevronDown color="#FFFFFF" size={28} />
          </TouchableOpacity>

          {effectivePayload.type === 'synced' ? (
            <TouchableOpacity
              style={styles.modeToggleBtn}
              onPress={() =>
                setDisplayMode((prev) => (prev === 'synced' ? 'plain' : 'synced'))
              }
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={
                displayMode === 'synced'
                  ? 'Alternar para texto puro'
                  : 'Alternar para letra sincronizada'
              }
            >
              <AlignLeft color="#FFFFFF" size={14} />
              <Text style={styles.modeToggleText}>
                {displayMode === 'synced' ? 'TEXTO' : 'SYNC'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.fullscreenHeaderSpacer} />
          )}
        </View>

        {/* Corpo da letra em tela cheia (somente leitura e scroll) */}
        <View
          style={styles.fullscreenScrollWrapper}
          onLayout={(e) => {
            const h = e?.nativeEvent?.layout?.height;
            if (typeof h === 'number' && h > 0) {
              setViewportHeight(h);
            }
          }}
        >
          <ScrollView
            ref={lyricsScrollRef}
            style={styles.fullscreenScroll}
            contentContainerStyle={styles.fullscreenScrollContent}
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={handleUserScrollInteraction}
          >
            {renderLyricsBody()}
          </ScrollView>

          {isUserScrolling &&
            effectivePayload.type === 'synced' &&
            displayMode === 'synced' && (
              <TouchableOpacity
                style={styles.floatingResumeSyncPill}
                onPress={() => setIsUserScrolling(false)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Retomar sincronização automática"
              >
                <Text style={styles.resumeSyncText}>Sincronizar</Text>
              </TouchableOpacity>
            )}
        </View>

        {/* Rodapé fixo: Scrubber + Play/Pause */}
        <View style={styles.fullscreenFooter}>
          {scrubberSlot ? <View style={styles.fullscreenScrubberSlot}>{scrubberSlot}</View> : null}

          {onTogglePlay ? (
            <View style={styles.fullscreenPlayRow}>
              <TouchableOpacity
                style={styles.fullscreenPlayButton}
                onPress={onTogglePlay}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Reproduzir ou pausar"
              >
                {isBuffering ? (
                  <ActivityIndicator color="#030303" size="small" />
                ) : isPlaying ? (
                  <Pause color="#030303" size={28} fill="#030303" />
                ) : (
                  <Play
                    color="#030303"
                    size={28}
                    fill="#030303"
                    style={{ marginLeft: 3 }}
                  />
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.embeddedLyricsCard, { backgroundColor: ambientColor }]}
      onLayout={(e) => {
        const y = e?.nativeEvent?.layout?.y;
        if (typeof y === 'number') {
          onCardLayout?.(y);
        }
      }}
    >
      {/* Header do Card Compacto de Letras */}
      <TouchableOpacity
        style={styles.embeddedCardHeader}
        onPress={hasRealLyrics ? onToggleExpand : onHeaderPress}
        activeOpacity={0.9}
      >
        <View style={styles.embeddedCardHeaderLeft}>
          <ChevronUp color="#FFFFFF" size={18} />
          <View style={styles.embeddedCardTitleBlock}>
            <Text style={styles.embeddedCardTitle}>Letras</Text>
            <Text style={styles.embeddedCardSubtitle}>
              Arraste para cima para ver a letra
            </Text>
          </View>
        </View>

        <View style={styles.headerActionsRow}>
          <TouchableOpacity
            style={styles.embeddedLyricsExpandBtn}
            onPress={(e) => {
              e?.stopPropagation?.();
              onToggleExpand();
            }}
            accessibilityRole="button"
            accessibilityLabel="Expandir letras"
          >
            <Maximize2 color="#FFFFFF" size={15} />
            <Text style={styles.embeddedLyricsExpandText}>EXPANDIR</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Corpo compacto das letras (somente leitura; tocar no card com letra abre tela cheia) */}
      <ScrollView
        ref={lyricsScrollRef}
        style={styles.embeddedLyricsScroll}
        contentContainerStyle={styles.embeddedLyricsContent}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleUserScrollInteraction}
      >
        {hasRealLyrics ? (
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={onToggleExpand}
            accessibilityRole="button"
            accessibilityLabel="Abrir letras em tela cheia"
          >
            {renderLyricsBody()}
          </TouchableOpacity>
        ) : (
          renderLyricsBody()
        )}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  embeddedLyricsCard: {
    borderRadius: 24,
    padding: 16,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  embeddedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
    marginBottom: 10,
  },
  embeddedCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  embeddedCardTitleBlock: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  embeddedCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  embeddedCardSubtitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
    fontWeight: '500',
    marginTop: 1,
    flexShrink: 1,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  modeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  modeToggleText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  embeddedLyricsExpandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  embeddedLyricsExpandText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  embeddedLyricsScroll: {
    height: 220,
  },
  embeddedLyricsContent: {
    paddingVertical: 6,
  },
  lyricLineRow: {
    paddingVertical: 7,
    alignItems: 'flex-start',
  },
  lyricLineText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 25,
    textAlign: 'left',
  },
  lyricLineTextActive: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
  },
  plainLyricsContainer: {
    paddingVertical: 4,
  },
  plainLyricLineText: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    textAlign: 'left',
  },
  emptyLyricsContainer: {
    paddingVertical: 16,
    alignItems: 'flex-start',
    gap: 12,
  },
  emptyLyricsContainerFullscreen: {
    paddingTop: 64,
  },
  loadingLyricsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  unavailableBox: {
    paddingVertical: 6,
    gap: 8,
  },
  emptyLyricsTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  emptyLyricsSubtitle: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 13,
    lineHeight: 19,
  },
  retryLyricButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  retryLyricButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Fullscreen Lyrics View
  fullscreenRoot: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUS_BAR_HEIGHT + 8 : 52,
  },
  fullscreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  fullscreenCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenHeaderSpacer: {
    width: 44,
    height: 44,
  },
  fullscreenScrollWrapper: {
    flex: 1,
    position: 'relative',
  },
  fullscreenScroll: {
    flex: 1,
  },
  fullscreenScrollContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 48,
  },
  fullscreenLyricLineRow: {
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  fullscreenLyricLineText: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 32,
    textAlign: 'left',
  },
  fullscreenLyricLineTextActive: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    lineHeight: 34,
  },
  fullscreenPlainLyricText: {
    color: 'rgba(255, 255, 255, 0.94)',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 30,
    textAlign: 'left',
  },
  floatingResumeSyncPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  resumeSyncText: {
    color: '#030303',
    fontSize: 12,
    fontWeight: '700',
  },
  fullscreenFooter: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  fullscreenScrubberSlot: {
    marginBottom: 8,
  },
  fullscreenPlayRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  fullscreenPlayButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
});
