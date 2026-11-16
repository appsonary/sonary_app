import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlignLeft,
  ChevronUp,
  Maximize2,
  Minimize2,
  Music2,
  RefreshCw,
  Sparkles,
} from 'lucide-react-native';
import { LyricLine, TrackLyricsPayload } from '../services/api';

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
  onSeekTo: (seconds: number) => void;
  onRetry?: () => void;
  ambientColor?: string;
  onCardLayout?: (y: number) => void;
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
  onSeekTo,
  onRetry,
  ambientColor = 'rgba(255, 255, 255, 0.06)',
  onCardLayout,
}: LyricsViewerProps) {
  const [displayMode, setDisplayMode] = useState<'synced' | 'plain'>('synced');
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const lyricsScrollRef = useRef<ScrollView>(null);
  const lineOffsetsRef = useRef<Record<number, number>>({});
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const containerHeight = isExpanded ? 480 : 250;
    const measuredY = lineOffsetsRef.current[activeLyricIndex];
    const targetY =
      measuredY !== undefined
        ? Math.max(0, measuredY - containerHeight * 0.35)
        : Math.max(0, activeLyricIndex * 42 - 60);

    lyricsScrollRef.current?.scrollTo?.({
      y: targetY,
      animated: true,
    });
  }, [activeLyricIndex, displayMode, effectivePayload.type, isExpanded, isUserScrolling]);

  const title = track.title || 'Faixa';
  const artist = track.artist || 'Artista';
  const hasRealLyrics =
    effectivePayload.type !== 'none' && effectivePayload.lines.length > 0;

  return (
    <View
      style={[styles.spotifyLyricsCard, { backgroundColor: ambientColor }]}
      onLayout={(e) => {
        const y = e?.nativeEvent?.layout?.y;
        if (typeof y === 'number') {
          onCardLayout?.(y);
        }
      }}
    >
      {/* Header do Card de Letras */}
      <TouchableOpacity
        style={styles.spotifyCardHeader}
        onPress={onHeaderPress}
        activeOpacity={0.9}
      >
        <View style={styles.spotifyCardHeaderLeft}>
          <ChevronUp color="#FFFFFF" size={18} />
          <View style={styles.spotifyCardTitleBlock}>
            <Text style={styles.spotifyCardTitle}>Letras</Text>
            <Text style={styles.spotifyCardSubtitle}>
              Arraste para cima para ver a letra
            </Text>
          </View>
        </View>

        <View style={styles.headerActionsRow}>
          {effectivePayload.type === 'synced' && (
            <TouchableOpacity
              style={styles.modeToggleBtn}
              onPress={(e) => {
                e?.stopPropagation?.();
                setDisplayMode((prev) => (prev === 'synced' ? 'plain' : 'synced'));
              }}
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
          )}

          <TouchableOpacity
            style={styles.spotifyLyricsExpandBtn}
            onPress={(e) => {
              e?.stopPropagation?.();
              onToggleExpand();
            }}
            accessibilityRole="button"
            accessibilityLabel={isExpanded ? 'Recolher letras' : 'Expandir letras'}
          >
            {isExpanded ? (
              <Minimize2 color="#FFFFFF" size={16} />
            ) : (
              <Maximize2 color="#FFFFFF" size={16} />
            )}
            <Text style={styles.spotifyLyricsExpandText}>
              {isExpanded ? 'RECOLHER' : 'EXPANDIR'}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Corpo das Letras: Sincronizada, Texto Puro ou Estado Vazio Elegante */}
      <ScrollView
        ref={lyricsScrollRef}
        style={[
          styles.spotifyLyricsScroll,
          isExpanded && styles.spotifyLyricsScrollExpanded,
        ]}
        contentContainerStyle={styles.spotifyLyricsContent}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleUserScrollInteraction}
      >
        {hasRealLyrics ? (
          displayMode === 'plain' || effectivePayload.type === 'plain' ? (
            <View style={styles.plainLyricsContainer}>
              {effectivePayload.lines.map((line, lIdx) => (
                <TouchableOpacity
                  key={lIdx}
                  style={styles.lyricLineButton}
                  onPress={() => {
                    if (effectivePayload.type === 'synced') {
                      onSeekTo(line.time);
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.plainLyricLineText}>{line.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            effectivePayload.lines.map((line, lIdx) => {
              const isActive = lIdx === activeLyricIndex;
              return (
                <TouchableOpacity
                  key={lIdx}
                  style={styles.lyricLineButton}
                  onLayout={(e) => {
                    const y = e?.nativeEvent?.layout?.y;
                    if (typeof y === 'number') {
                      lineOffsetsRef.current[lIdx] = y;
                    }
                  }}
                  onPress={() => {
                    setIsUserScrolling(false);
                    onSeekTo(line.time);
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.lyricLineText,
                      isActive && styles.lyricLineTextActive,
                    ]}
                  >
                    {line.text}
                  </Text>
                </TouchableOpacity>
              );
            })
          )
        ) : (
          <View style={styles.emptyLyricsContainer}>
            {/* Linha de referência da faixa atual (clicável para voltar ao início) */}
            <TouchableOpacity
              style={styles.lyricLineButton}
              onPress={() => onSeekTo(0)}
              accessibilityRole="button"
              accessibilityLabel={`Início de ${title}`}
            >
              <Text style={styles.lyricLineTextActive}>
                {`♪ ${title} • ${artist} ♪`}
              </Text>
            </TouchableOpacity>

            {isLoading ? (
              <View style={styles.loadingLyricsBox}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={styles.emptyLyricsSubtitle}>
                  Buscando letras sincronizadas...
                </Text>
              </View>
            ) : (
              <View style={styles.unavailableBox}>
                <Music2 color="rgba(255, 255, 255, 0.55)" size={28} />
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
              onPress={() => {
                onSeekTo(currentPosition >= 0 ? currentPosition : 0);
                onRetry?.();
              }}
              accessibilityRole="button"
              accessibilityLabel="Tentar carregar letras novamente"
            >
              <RefreshCw color="#FFFFFF" size={14} />
              <Text style={styles.retryLyricButtonText}>Tentar novamente</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Rodapé com status e retomada de autoscroll */}
      <View style={styles.spotifyLyricsFooter}>
        <Sparkles color="rgba(255, 255, 255, 0.7)" size={14} />
        <Text style={styles.spotifyLyricsFooterText}>
          {effectivePayload.type === 'synced'
            ? 'Sincronizado via LRCLIB • Toque em um verso para pular'
            : effectivePayload.type === 'plain'
            ? 'Letra em texto corrido • LRCLIB'
            : 'LRCLIB • Verificador de Letras'}
        </Text>
        {isUserScrolling && effectivePayload.type === 'synced' && (
          <TouchableOpacity
            style={styles.resumeSyncPill}
            onPress={() => setIsUserScrolling(false)}
            accessibilityRole="button"
            accessibilityLabel="Retomar sincronização automática"
          >
            <Text style={styles.resumeSyncText}>Sincronizar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  spotifyLyricsCard: {
    borderRadius: 24,
    padding: 16,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  spotifyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
    marginBottom: 12,
  },
  spotifyCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  spotifyCardTitleBlock: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  spotifyCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  spotifyCardSubtitle: {
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
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  modeToggleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  spotifyLyricsExpandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  spotifyLyricsExpandText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  spotifyLyricsScroll: {
    height: 250,
  },
  spotifyLyricsScrollExpanded: {
    height: 480,
  },
  spotifyLyricsContent: {
    paddingVertical: 10,
  },
  lyricLineButton: {
    paddingVertical: 8,
    alignItems: 'flex-start',
  },
  lyricLineText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 26,
    textAlign: 'left',
  },
  lyricLineTextActive: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 30,
    textShadowColor: 'rgba(255, 255, 255, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
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
    paddingVertical: 12,
    alignItems: 'flex-start',
    gap: 10,
  },
  loadingLyricsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  unavailableBox: {
    paddingVertical: 8,
    gap: 6,
  },
  emptyLyricsTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyLyricsSubtitle: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 13,
    lineHeight: 18,
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
  spotifyLyricsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  spotifyLyricsFooterText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
  },
  resumeSyncPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  resumeSyncText: {
    color: '#030303',
    fontSize: 11,
    fontWeight: '700',
  },
});

