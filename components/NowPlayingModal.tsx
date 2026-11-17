import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  SafeAreaView,
  ScrollView as RNScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  PanGestureHandler,
  ScrollView as GHScrollView,
  State as GestureState,
} from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming as reanimatedWithTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Track, useProgress } from 'react-native-track-player';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Heart,
  ListMusic,
  Maximize2,
  Menu,
  Minimize2,
  MoreVertical,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Download,
  CheckCircle2,
  ListPlus,
  Repeat,
  Repeat1,
  Shuffle,
  Music2,
  Radio,
  Sparkles,
  X,
} from 'lucide-react-native';
import { RepeatMode, seekTo } from '../services/player';
import {
  ArtistProfile,
  extractTrackMetadata,
  getArtistProfile,
  getRelatedTracks,
  getTrackLyrics,
  LyricLine,
  TrackLyricsPayload,
  TrackSummary,
} from '../services/api';
import { LyricsViewer } from './LyricsViewer';
import { ArtistProfileModal } from './ArtistProfileModal';
import { TrackRowSkeleton } from './TrackRowSkeleton';
import { PlayingEqualizer } from './PlayingEqualizer';
import { AmbientGlowBackground } from './AmbientGlowBackground';
import { MarqueeText, TrackMetaRow } from './MarqueeText';
import { ToastBanner } from './ToastBanner';
import {
  SHEET_ENTER_MS,
  SHEET_EXIT_MS,
  scheduleNextFrame,
  useModalEnterAnimation,
} from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';
import { useBackModalLock } from '../services/backNavigation';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 64, 340);
const ARTWORK_BOX_SIZE = Math.min(Math.round(SCREEN_WIDTH * 0.76), 300);
const QUEUE_ROW_HEIGHT = 60;

export interface NowPlayingModalProps {
  visible: boolean;
  onClose: () => void;
  track: Track | null | undefined;
  isPlaying: boolean;
  isBuffering: boolean;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrevious: (forcePreviousTrack?: boolean) => void;
  onSeekRelative?: (seconds: number) => void;
  fallbackPosition?: number;
  onSeek?: (positionSeconds: number) => Promise<void> | void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  isQueued?: boolean;
  downloadProgress?: number;
  onDownload?: () => void;
  onAddToPlaylist?: () => void;
  onOpenQueue?: () => void;
  onPlayNext?: () => void;
  onAddToQueue?: () => void;
  previousTrack?: Track | null;
  queue?: Track[];
  onSelectQueueTrack?: (track: Track, index: number) => void;
  repeatMode?: RepeatMode;
  onToggleRepeat?: () => void;
  isShuffleActive?: boolean;
  onToggleShuffle?: () => void;
  onRemoveQueueTrack?: (index: number) => void;
  onMoveQueueTrack?: (fromIndex: number, toIndex: number) => void;
  syncedLyrics?: LyricLine[] | null;
  relatedTracks?: TrackSummary[];
  isLoadingRelated?: boolean;
  onPlayRelatedTrack?: (track: TrackSummary) => void;
  onAddRelatedToQueue?: (track: TrackSummary) => void;
  onStartTrackRadio?: () => void;
  onStartArtistRadio?: (artistName: string, channelId?: string) => void;
  isLoadingRadio?: boolean;
  toastMessage?: string | null;
  toastVariant?: 'success' | 'error';
  onDismissToast?: () => void;
}

/**
 * Formata segundos em mm:ss
 */
function formatTime(seconds?: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

interface PlayerProgressSectionProps {
  trackDuration?: number;
  fallbackPosition?: number;
  onSeek?: (positionSeconds: number) => Promise<void> | void;
  scrubberPanRef: React.RefObject<any>;
  onScrubbingChange: (scrubbing: boolean) => void;
}

const PlayerProgressSection: React.FC<PlayerProgressSectionProps> = memo(
  ({ trackDuration, fallbackPosition, onSeek, scrubberPanRef, onScrubbingChange }) => {
    const progress = useProgress(250);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [scrubPosition, setScrubPosition] = useState<number | null>(null);
    const progressBarRef = useRef<View>(null);
    const barLayoutRef = useRef<{ width: number; pageX: number }>({
      width: SCREEN_WIDTH - 48,
      pageX: 24,
    });

    const effectiveDuration =
      progress.duration > 0
        ? progress.duration
        : trackDuration && trackDuration > 0
          ? trackDuration
          : 0;

    const currentPosition =
      isScrubbing && scrubPosition !== null
        ? scrubPosition
        : progress.duration > 0 || progress.position > 0
          ? progress.position
          : fallbackPosition ?? 0;

    const progressPercentage =
      effectiveDuration > 0
        ? Math.min(100, Math.max(0, (currentPosition / effectiveDuration) * 100))
        : 0;

    const calculateSecondsFromPageX = (pageX: number): number => {
      const { width, pageX: barX } = barLayoutRef.current;
      if (width <= 0) return 0;
      const relativeX = Math.min(Math.max(0, pageX - barX), width);
      return (relativeX / width) * effectiveDuration;
    };

    const calculateScrubPosition = (evt: any): number => {
      const { absoluteX, x, pageX } = evt?.nativeEvent ?? {};
      const windowX = typeof absoluteX === 'number' ? absoluteX : pageX;
      if (typeof windowX === 'number') {
        return calculateSecondsFromPageX(windowX);
      }
      const { width } = barLayoutRef.current;
      if (width > 0 && typeof x === 'number') {
        return (Math.min(Math.max(0, x), width) / width) * effectiveDuration;
      }
      return 0;
    };

    const handleMeasureBar = () => {
      progressBarRef.current?.measure((_x, _y, width, _height, pageX) => {
        if (width > 0) {
          barLayoutRef.current = { width, pageX };
        }
      });
    };

    return (
      <View
        style={styles.scrubberContainer}
        accessibilityRole="adjustable"
        accessibilityLabel="Barra de progresso da faixa"
      >
        <PanGestureHandler
          ref={scrubberPanRef}
          testID="player-scrubber-pan"
          minDist={0}
          activeOffsetX={[-1, 1]}
          activeOffsetY={[-1, 1]}
          shouldCancelWhenOutside={false}
          onGestureEvent={(evt: any) => {
            setScrubPosition(calculateScrubPosition(evt));
          }}
          onHandlerStateChange={async (evt: any) => {
            const { state, oldState } = evt?.nativeEvent ?? {};
            const pos = calculateScrubPosition(evt);
            if (state === GestureState.BEGAN) {
              handleMeasureBar();
              onScrubbingChange(true);
              setIsScrubbing(true);
              setScrubPosition(pos);
            } else if (state === GestureState.ACTIVE) {
              onScrubbingChange(true);
              setScrubPosition(pos);
            } else if (state === GestureState.END) {
              onScrubbingChange(false);
              setIsScrubbing(false);
              setScrubPosition(null);
              if (oldState === GestureState.BEGAN || oldState === GestureState.ACTIVE) {
                if (onSeek) {
                  await onSeek(pos);
                } else {
                  await seekTo(pos);
                }
              }
            } else if (
              state === GestureState.CANCELLED ||
              state === GestureState.FAILED
            ) {
              onScrubbingChange(false);
              setIsScrubbing(false);
              setScrubPosition(null);
            }
          }}
        >
          <View
            ref={progressBarRef}
            style={styles.touchableBarArea}
            onLayout={handleMeasureBar}
          >
            <View style={styles.trackBackground}>
              <View style={[styles.trackFill, { width: `${progressPercentage}%` }]} />
            </View>
            <View
              style={[
                styles.scrubberThumb,
                { left: `${progressPercentage}%` },
                isScrubbing && styles.scrubberThumbActive,
              ]}
            />
          </View>
        </PanGestureHandler>

        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
          <Text style={styles.timeText}>
            {effectiveDuration > 0 ? formatTime(effectiveDuration) : '00:00'}
          </Text>
        </View>
      </View>
    );
  }
);

interface PlayerLyricsSectionProps {
  track: { id?: string; title?: string; artist?: string; duration?: number };
  fallbackPosition?: number;
  lyricsPayload: TrackLyricsPayload | null;
  syncedLyricsProp?: LyricLine[] | null;
  isLoading: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onHeaderPress: () => void;
  onSeekTo: (seconds: number) => void;
  onRetry: () => void;
  ambientColor: string;
  onCardLayout: (y: number) => void;
}

const PlayerLyricsSection: React.FC<PlayerLyricsSectionProps> = memo(
  ({
    track,
    fallbackPosition,
    lyricsPayload,
    syncedLyricsProp,
    isLoading,
    isExpanded,
    onToggleExpand,
    onHeaderPress,
    onSeekTo,
    onRetry,
    ambientColor,
    onCardLayout,
  }) => {
    const progress = useProgress(250);
    const effectiveDuration =
      progress.duration > 0
        ? progress.duration
        : track.duration && track.duration > 0
          ? track.duration
          : 0;
    const currentPosition =
      progress.duration > 0 || progress.position > 0
        ? progress.position
        : fallbackPosition ?? 0;

    return (
      <LyricsViewer
        track={{
          id: track.id,
          title: track.title,
          artist: track.artist,
          duration: effectiveDuration,
        }}
        lyricsPayload={lyricsPayload}
        syncedLyricsProp={syncedLyricsProp}
        isLoading={isLoading}
        currentPosition={currentPosition}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        onHeaderPress={onHeaderPress}
        onSeekTo={onSeekTo}
        onRetry={onRetry}
        ambientColor={ambientColor}
        onCardLayout={onCardLayout}
      />
    );
  }
);

interface QueueTrackRowProps {
  rowKey: string;
  rowEpoch: number;
  qTrack: Track;
  qIdx: number;
  isEditingQueue: boolean;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  basePositionsEpochSV: SharedValue<number>;
  basePositionsSV: SharedValue<Record<string, number>>;
  positionsSV: SharedValue<Record<string, number>>;
  activeDragKeySV: SharedValue<string>;
  activeDragIdxSV: SharedValue<number>;
  dragTargetIdxSV: SharedValue<number>;
  dragOffsetYSV: SharedValue<number>;
  listLengthSV: SharedValue<number>;
  scrollDeltaSV: SharedValue<number>;
  scrollViewportHeightSV: SharedValue<number>;
  maxScrollYSV: SharedValue<number>;
  scrollStartSV: SharedValue<number>;
  currentScrollYSV: SharedValue<number>;
  onStartDrag: (idx: number, key: string) => void;
  onEdgeAutoScroll: (translationY: number) => void;
  onStopAutoScroll: () => void;
  onEndDrag: (commit: boolean, translationY: number, fromIdx?: number, toIdx?: number) => void;
  onSelectTrack: (track: Track, index: number) => void;
  onMoveTrack?: (fromIndex: number, toIndex: number) => void;
  onRemoveTrack?: (index: number) => void;
}

function computeReorderedPositions(
  base: Record<string, number>,
  draggedKey: string,
  fromIdx: number,
  toIdx: number
): Record<string, number> {
  'worklet';
  const next: Record<string, number> = {};
  const keys = Object.keys(base);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const pos = base[k];
    if (k === draggedKey) {
      next[k] = toIdx;
    } else if (fromIdx < toIdx && pos > fromIdx && pos <= toIdx) {
      next[k] = pos - 1;
    } else if (fromIdx > toIdx && pos >= toIdx && pos < fromIdx) {
      next[k] = pos + 1;
    } else {
      next[k] = pos;
    }
  }
  return next;
}

const isQueueSwipe = (touch: { x: number; y: number; moved: boolean } | null, evt?: any) => {
  const { pageX, pageY } = evt?.nativeEvent ?? {};
  return Boolean(
    touch &&
      pageX !== undefined &&
      pageY !== undefined &&
      (Math.abs(pageX - touch.x) > 8 || Math.abs(pageY - touch.y) > 8)
  );
};

const QueueTrackRow: React.FC<QueueTrackRowProps> = memo(
  ({
    rowKey,
    rowEpoch,
    qTrack,
    qIdx,
    isEditingQueue,
    canReorder,
    isFirst,
    isLast,
    basePositionsEpochSV,
    basePositionsSV,
    positionsSV,
    activeDragKeySV,
    activeDragIdxSV,
    dragTargetIdxSV,
    dragOffsetYSV,
    listLengthSV,
    scrollDeltaSV,
    scrollViewportHeightSV,
    maxScrollYSV,
    scrollStartSV,
    currentScrollYSV,
    onStartDrag,
    onEdgeAutoScroll,
    onStopAutoScroll,
    onEndDrag,
    onSelectTrack,
    onMoveTrack,
    onRemoveTrack,
  }) => {
    const touchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    const edgeActiveSV = useSharedValue(false);
    const rowIdxSV = useSharedValue(qIdx);
    const rowEpochSV = useSharedValue(rowEpoch);
    const artworkSource = useMemo(
      () =>
        qTrack.artwork
          ? typeof qTrack.artwork === 'string'
            ? { uri: qTrack.artwork }
            : qTrack.artwork
          : undefined,
      [qTrack.artwork]
    );

    useLayoutEffect(() => {
      rowIdxSV.value = qIdx;
      rowEpochSV.value = rowEpoch;
    }, [qIdx, rowEpoch, rowEpochSV, rowIdxSV]);

    // Zero-Reset na UI thread: basePositionsSV é comitado atomicamente no onEnd antes do React
    const slotAnimatedStyle = useAnimatedStyle(() => {
      const basePos =
        basePositionsEpochSV.value === rowEpochSV.value
          ? basePositionsSV.value[rowKey]
          : undefined;
      const slotIdx = basePos !== undefined ? basePos : rowIdxSV.value;
      const isDragged =
        activeDragKeySV.value === rowKey &&
        basePositionsEpochSV.value === rowEpochSV.value;
      return {
        transform: [{ translateY: slotIdx * QUEUE_ROW_HEIGHT }],
        zIndex: isDragged ? 20 : 0,
      };
    }, [rowKey]);

    // Toda a animação relativa da linha arrastada e das vizinhas roda 100% na UI thread a 120Hz
    const animatedRowStyle = useAnimatedStyle(() => {
      const activeKey = activeDragKeySV.value;
      if (!activeKey) {
        return {
          transform: [{ translateY: 0 }, { scale: 1 }],
          backgroundColor: 'transparent',
          borderRadius: 0,
        };
      }
      if (activeKey === rowKey) {
        return {
          transform: [{ translateY: dragOffsetYSV.value }, { scale: 1.02 }],
          backgroundColor: '#282828',
          borderRadius: 10,
        };
      }
      const basePos = basePositionsSV.value[rowKey];
      const nextPos = positionsSV.value[rowKey];
      const slotDelta =
        basePos !== undefined && nextPos !== undefined ? nextPos - basePos : 0;
      return {
        transform: [
          { translateY: reanimatedWithTiming(slotDelta * QUEUE_ROW_HEIGHT, { duration: 140 }) },
          { scale: 1 },
        ],
        backgroundColor: 'transparent',
        borderRadius: 0,
      };
    }, [rowKey]);

    const dragGesture = useMemo(
      () =>
        Gesture.Pan()
          .enabled(canReorder)
          .minDistance(0)
          .activeOffsetY([-3, 3])
          .failOffsetX([-35, 35])
          .onBegin(() => {
            'worklet';
            const base = basePositionsSV.value;
            const idx = base[rowKey] !== undefined ? base[rowKey] : rowIdxSV.value;
            edgeActiveSV.value = false;
            activeDragKeySV.value = rowKey;
            activeDragIdxSV.value = idx;
            dragTargetIdxSV.value = idx;
            dragOffsetYSV.value = 0;
            positionsSV.value = { ...base };
            runOnJS(onStartDrag)(idx, rowKey);
          })
          .onUpdate((evt) => {
            'worklet';
            const fromIdx = activeDragIdxSV.value;
            const listLen = listLengthSV.value;
            if (fromIdx < 0 || listLen <= 1) return;

            const minY = -fromIdx * QUEUE_ROW_HEIGHT;
            const maxY = (listLen - 1 - fromIdx) * QUEUE_ROW_HEIGHT;
            const clampedY = Math.max(
              minY,
              Math.min(maxY, evt.translationY + scrollDeltaSV.value)
            );
            dragOffsetYSV.value = clampedY;
            const nextTarget = Math.max(
              0,
              Math.min(listLen - 1, Math.round(fromIdx + clampedY / QUEUE_ROW_HEIGHT))
            );
            if (nextTarget !== dragTargetIdxSV.value) {
              dragTargetIdxSV.value = nextTarget;
              positionsSV.value = computeReorderedPositions(
                basePositionsSV.value,
                rowKey,
                fromIdx,
                nextTarget
              );
            }

            const maxScrollY = maxScrollYSV.value;
            if (maxScrollY > 0) {
              const viewportH = scrollViewportHeightSV.value;
              const edgeZone = Math.min(QUEUE_ROW_HEIGHT * 1.1, viewportH * 0.28);
              const startScrollY = scrollStartSV.value;
              const currentScrollY = currentScrollYSV.value;
              const rowTop = fromIdx * QUEUE_ROW_HEIGHT - startScrollY + evt.translationY;
              const rowBottom = rowTop + QUEUE_ROW_HEIGHT;
              const atTopEdge =
                rowTop < edgeZone &&
                currentScrollY > 0 &&
                (evt.translationY < -4 || currentScrollY > startScrollY);
              const atBottomEdge =
                rowBottom > viewportH - edgeZone &&
                currentScrollY < maxScrollY &&
                (evt.translationY > 4 || currentScrollY < startScrollY);

              if (atTopEdge || atBottomEdge) {
                edgeActiveSV.value = true;
                runOnJS(onEdgeAutoScroll)(evt.translationY);
              } else if (edgeActiveSV.value) {
                edgeActiveSV.value = false;
                runOnJS(onStopAutoScroll)();
              }
            }
          })
          .onEnd((evt) => {
            'worklet';
            edgeActiveSV.value = false;
            const fromIdx = activeDragIdxSV.value;
            const toIdx = dragTargetIdxSV.value;
            if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
              basePositionsSV.value = { ...positionsSV.value };
            }
            activeDragKeySV.value = '';
            activeDragIdxSV.value = -1;
            dragTargetIdxSV.value = -1;
            dragOffsetYSV.value = 0;
            scrollDeltaSV.value = 0;
            runOnJS(onEndDrag)(true, evt.translationY, fromIdx, toIdx);
          })
          .onFinalize((_evt, success) => {
            'worklet';
            if (!success) {
              edgeActiveSV.value = false;
              positionsSV.value = { ...basePositionsSV.value };
              activeDragKeySV.value = '';
              activeDragIdxSV.value = -1;
              dragTargetIdxSV.value = -1;
              dragOffsetYSV.value = 0;
              scrollDeltaSV.value = 0;
              runOnJS(onEndDrag)(false, 0);
            }
          }),
      [
        rowKey,
        canReorder,
        rowIdxSV,
        basePositionsSV,
        positionsSV,
        activeDragKeySV,
        activeDragIdxSV,
        dragTargetIdxSV,
        dragOffsetYSV,
        listLengthSV,
        scrollDeltaSV,
        scrollViewportHeightSV,
        maxScrollYSV,
        scrollStartSV,
        currentScrollYSV,
        edgeActiveSV,
        onStartDrag,
        onEdgeAutoScroll,
        onStopAutoScroll,
        onEndDrag,
      ]
    );

    return (
      <Reanimated.View style={[styles.queueTrackSlot, slotAnimatedStyle]}>
        <Reanimated.View
          onTouchStart={(evt: any) => {
          const { pageX, pageY } = evt?.nativeEvent ?? {};
          touchRef.current =
            pageX !== undefined && pageY !== undefined
              ? { x: pageX, y: pageY, moved: false }
              : null;
        }}
        onTouchMove={(evt: any) => {
          if (isQueueSwipe(touchRef.current, evt)) {
            touchRef.current!.moved = true;
          }
        }}
        onTouchCancel={() => {
          touchRef.current = null;
        }}
        style={[styles.queueTrackRow, animatedRowStyle]}
      >
        <TouchableOpacity
          style={styles.queueTrackSelectArea}
          onPressIn={(evt) => {
            if (touchRef.current) return;
            const { pageX, pageY } = evt?.nativeEvent ?? {};
            if (pageX !== undefined && pageY !== undefined) {
              touchRef.current = { x: pageX, y: pageY, moved: false };
            }
          }}
          onPress={(evt) => {
            const touch = touchRef.current;
            touchRef.current = null;
            if (touch?.moved || isQueueSwipe(touch, evt)) {
              return;
            }
            onSelectTrack(qTrack, qIdx);
          }}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Tocar ${qTrack.title} na fila`}
        >
          {artworkSource ? (
            <Image
              source={artworkSource}
              fadeDuration={0}
              style={styles.queueThumbImg}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.queueThumbFallback}>
              <Music2 color="#FFFFFF" size={18} />
            </View>
          )}

          <View style={styles.queueItemMeta}>
            <Text style={styles.queueItemTitle} numberOfLines={1}>
              {qTrack.title}
            </Text>
            <Text style={styles.queueItemArtist} numberOfLines={1}>
              {qTrack.artist}
            </Text>
          </View>
        </TouchableOpacity>

        {isEditingQueue ? (
          <View style={styles.queueActionsRow}>
            {onMoveTrack && (
              <View style={styles.queueMoveControls}>
                {!isFirst && (
                  <TouchableOpacity
                    style={styles.queueSmallBtn}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      onMoveTrack(qIdx, qIdx - 1);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Mover ${qTrack.title} para cima`}
                  >
                    <ChevronUp color="#AAAAAA" size={16} />
                  </TouchableOpacity>
                )}
                {!isLast && (
                  <TouchableOpacity
                    style={styles.queueSmallBtn}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      onMoveTrack(qIdx, qIdx + 1);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Mover ${qTrack.title} para baixo`}
                  >
                    <ChevronDown color="#AAAAAA" size={16} />
                  </TouchableOpacity>
                )}
              </View>
            )}
            {onRemoveTrack && (
              <TouchableOpacity
                style={styles.queueSmallBtn}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onRemoveTrack(qIdx);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Remover ${qTrack.title} da fila`}
              >
                <X color="#AAAAAA" size={16} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <GestureDetector gesture={dragGesture}>
            <View
              style={styles.queueDragHandle}
              accessibilityRole="adjustable"
              accessibilityLabel={`Arrastar ${qTrack.title} para reordenar na fila`}
            >
              <Menu color="#888888" size={18} />
            </View>
          </GestureDetector>
        )}
        </Reanimated.View>
      </Reanimated.View>
    );
  },
  (prev, next) =>
    prev.rowKey === next.rowKey &&
    prev.qIdx === next.qIdx &&
    prev.isEditingQueue === next.isEditingQueue &&
    prev.canReorder === next.canReorder &&
    prev.isFirst === next.isFirst &&
    prev.isLast === next.isLast &&
    prev.qTrack.id === next.qTrack.id &&
    prev.qTrack.title === next.qTrack.title &&
    prev.qTrack.artist === next.qTrack.artist &&
    prev.qTrack.artwork === next.qTrack.artwork &&
    prev.onStartDrag === next.onStartDrag &&
    prev.onEdgeAutoScroll === next.onEdgeAutoScroll &&
    prev.onStopAutoScroll === next.onStopAutoScroll &&
    prev.onEndDrag === next.onEndDrag &&
    prev.onSelectTrack === next.onSelectTrack &&
    prev.onMoveTrack === next.onMoveTrack &&
    prev.onRemoveTrack === next.onRemoveTrack
);

export default function NowPlayingModal({
  visible,
  onClose,
  track,
  isPlaying,
  isBuffering,
  onTogglePlay,
  onSkipNext,
  onSkipPrevious,
  onSeekRelative,
  fallbackPosition,
  onSeek,
  isFavorite = false,
  onToggleFavorite,
  isDownloaded = false,
  isDownloading = false,
  isQueued = false,
  downloadProgress = 0,
  onDownload,
  onAddToPlaylist,
  onOpenQueue,
  onPlayNext,
  onAddToQueue,
  previousTrack = null,
  queue = [],
  onSelectQueueTrack,
  repeatMode = RepeatMode.Off,
  onToggleRepeat,
  isShuffleActive = false,
  onToggleShuffle,
  onRemoveQueueTrack,
  onMoveQueueTrack,
  syncedLyrics,
  relatedTracks,
  isLoadingRelated = false,
  onPlayRelatedTrack,
  onAddRelatedToQueue,
  onStartTrackRadio,
  onStartArtistRadio,
  isLoadingRadio = false,
  toastMessage = null,
  toastVariant = 'success',
  onDismissToast,
}: NowPlayingModalProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [activePlayerTab, setActivePlayerTab] = useState<'cover' | 'upnext' | 'lyrics' | 'related'>('cover');
  const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);
  const [cardPositions, setCardPositions] = useState<{
    lyrics?: number;
    related?: number;
  }>({});
  const [isQueueSheetVisible, setIsQueueSheetVisible] = useState(false);
  const [isEditingQueue, setIsEditingQueue] = useState(false);
  const [optimisticQueueMove, setOptimisticQueueMove] = useState<{
    sourceQueue: Track[];
    reordered: Track[];
  } | null>(null);
  const [lyricsPayload, setLyricsPayload] = useState<TrackLyricsPayload | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState<boolean>(false);
  const [fetchedRelatedTracks, setFetchedRelatedTracks] = useState<TrackSummary[]>([]);
  const [isFetchingRelated, setIsFetchingRelated] = useState<boolean>(false);
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [isArtistModalVisible, setIsArtistModalVisible] = useState<boolean>(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(360)).current;
  const sheetBackdropOpacity = useRef(new Animated.Value(0)).current;
  const queueSheetTranslateY = useRef(new Animated.Value(400)).current;
  const queueBackdropOpacity = useRef(new Animated.Value(0)).current;
  const draggingQueueIdxRef = useRef<number | null>(null);
  const draggingQueueKeyRef = useRef<string>('');
  const queueScrollRef = useRef<any>(null);
  const queueScrollOffsetRef = useRef(0);
  const queueListHeightRef = useRef(0);
  const queueContentHeightRef = useRef(0);
  const queueDragStartScrollYRef = useRef(0);
  const queueDragTranslationYRef = useRef(0);
  const queueAutoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueBasePositionsEpochSV = useSharedValue<number>(0);
  const queueBasePositionsSV = useSharedValue<Record<string, number>>({});
  const queuePositionsSV = useSharedValue<Record<string, number>>({});
  const queueLayoutEpochRef = useRef<number>(0);
  const prevQueueKeysOrderRef = useRef<string[]>([]);
  const lastDragReorderedKeysRef = useRef<string[] | null>(null);
  const activeQueueDragKeySV = useSharedValue<string>('');
  const activeQueueDragIdxSV = useSharedValue(-1);
  const queueDragTargetIdxSV = useSharedValue(-1);
  const queueDragOffsetYSV = useSharedValue(0);
  const queueListLengthSV = useSharedValue(0);
  const queueScrollDeltaSV = useSharedValue(0);
  const queueViewportHeightSV = useSharedValue(Math.min(SCREEN_HEIGHT * 0.42, 320));
  const queueMaxScrollYSV = useSharedValue(0);
  const queueScrollStartSV = useSharedValue(0);
  const queueCurrentScrollYSV = useSharedValue(0);
  const mainScrollRef = useRef<RNScrollView>(null);
  const dismissPanRef = useRef<any>(null);
  const horizontalPanRef = useRef<any>(null);
  const scrubberPanRef = useRef<any>(null);
  const [viewportHeight, setViewportHeight] = useState<number>(
    Math.max(560, SCREEN_HEIGHT - (Platform.OS === 'ios' ? 120 : 96))
  );

  const displayedQueue =
    optimisticQueueMove && optimisticQueueMove.sourceQueue === queue
      ? optimisticQueueMove.reordered
      : queue;
  const displayedQueueRef = useRef<Track[]>(displayedQueue);
  displayedQueueRef.current = displayedQueue;
  const queueRef = useRef<Track[]>(queue);
  queueRef.current = queue;
  queueListLengthSV.value = displayedQueue.length;

  const getQueueRowKey = (qTrack: Track, idx: number, list: Track[]) =>
    `${qTrack.id || 'track'}-${
      qTrack.id ? list.slice(0, idx).filter((t) => t.id === qTrack.id).length : idx
    }`;

  // Mantém a ordem de montagem dos filhos no React fixa ao arrastar, mas sincroniza em reordenações externas (ex.: Aleatório)
  const stableQueueKeysRef = useRef<string[]>([]);
  const keyedQueue = displayedQueue.map((qTrack, qIdx) => ({
    qTrack,
    qIdx,
    key: getQueueRowKey(qTrack, qIdx, displayedQueue),
  }));
  const keyedQueueMap = new Map(keyedQueue.map((entry) => [entry.key, entry]));
  const currentQueueKeys = keyedQueue.map((entry) => entry.key);
  const isOptimisticDragRender = Boolean(
    optimisticQueueMove && optimisticQueueMove.sourceQueue === queue
  );
  const dragTargetKeys = lastDragReorderedKeysRef.current;
  const isDragSyncConfirmation = Boolean(
    !isOptimisticDragRender &&
      dragTargetKeys &&
      dragTargetKeys.length === currentQueueKeys.length &&
      dragTargetKeys.every((k, i) => k === currentQueueKeys[i])
  );
  if (isDragSyncConfirmation) {
    lastDragReorderedKeysRef.current = null;
  }

  const prevKeys = prevQueueKeysOrderRef.current;
  const keysChanged =
    prevKeys.length !== currentQueueKeys.length ||
    prevKeys.some((k, i) => k !== currentQueueKeys[i]);

  let stableQueueOrder: string[];
  if (
    keysChanged &&
    !isOptimisticDragRender &&
    !isDragSyncConfirmation &&
    draggingQueueIdxRef.current === null
  ) {
    const prevIndexByKey = new Map(prevKeys.map((k, i) => [k, i]));
    const hasNonAppendChange =
      prevKeys.some((k) => !keyedQueueMap.has(k)) ||
      currentQueueKeys.some((k, idx) => {
        const prevIdx = prevIndexByKey.get(k);
        return prevIdx !== undefined && prevIdx !== idx;
      });
    if (hasNonAppendChange) {
      queueLayoutEpochRef.current += 1;
      stableQueueOrder = currentQueueKeys;
    } else {
      const keptQueueKeys = stableQueueKeysRef.current.filter((key) => keyedQueueMap.has(key));
      const keptQueueSet = new Set(keptQueueKeys);
      stableQueueOrder = [
        ...keptQueueKeys,
        ...currentQueueKeys.filter((key) => !keptQueueSet.has(key)),
      ];
    }
  } else {
    const keptQueueKeys = stableQueueKeysRef.current.filter((key) => keyedQueueMap.has(key));
    const keptQueueSet = new Set(keptQueueKeys);
    stableQueueOrder = [
      ...keptQueueKeys,
      ...currentQueueKeys.filter((key) => !keptQueueSet.has(key)),
    ];
  }
  prevQueueKeysOrderRef.current = currentQueueKeys;
  stableQueueKeysRef.current = stableQueueOrder;
  const stableQueueEntries = stableQueueOrder.map((key) => keyedQueueMap.get(key)!);

  const stopQueueAutoScroll = useCallback(() => {
    if (queueAutoScrollTimerRef.current) {
      clearInterval(queueAutoScrollTimerRef.current);
      queueAutoScrollTimerRef.current = null;
    }
  }, []);

  const getQueueScrollBounds = useCallback((listLen: number) => {
    const viewportH =
      queueListHeightRef.current > 0
        ? queueListHeightRef.current
        : Math.min(SCREEN_HEIGHT * 0.42, listLen * QUEUE_ROW_HEIGHT);
    const contentH =
      queueContentHeightRef.current > 0
        ? queueContentHeightRef.current
        : listLen * QUEUE_ROW_HEIGHT + 12;
    const maxScrollY = Math.max(0, contentH - viewportH);
    queueViewportHeightSV.value = viewportH;
    queueMaxScrollYSV.value = maxScrollY;
    return { viewportH, maxScrollY };
  }, [queueMaxScrollYSV, queueViewportHeightSV]);

  const getQueueAutoScrollStep = useCallback(
    (translationY: number, listLen: number) => {
      const fromIdx = draggingQueueIdxRef.current;
      if (fromIdx === null || listLen <= 1) return 0;
      const { viewportH, maxScrollY } = getQueueScrollBounds(listLen);
      if (maxScrollY <= 0) return 0;
      const startScrollY = queueDragStartScrollYRef.current;
      const currentScrollY = queueScrollOffsetRef.current;
      const edgeZone = Math.min(QUEUE_ROW_HEIGHT * 1.1, viewportH * 0.28);
      const rowTopInViewport = fromIdx * QUEUE_ROW_HEIGHT - startScrollY + translationY;
      const rowBottomInViewport = rowTopInViewport + QUEUE_ROW_HEIGHT;

      if (
        rowTopInViewport < edgeZone &&
        currentScrollY > 0 &&
        (translationY < -4 || currentScrollY > startScrollY)
      ) {
        const intensity = Math.min(1, Math.max(0.2, (edgeZone - rowTopInViewport) / edgeZone));
        return -Math.round(4 + intensity * 10);
      }
      if (
        rowBottomInViewport > viewportH - edgeZone &&
        currentScrollY < maxScrollY &&
        (translationY > 4 || currentScrollY < startScrollY)
      ) {
        const intensity = Math.min(
          1,
          Math.max(0.2, (rowBottomInViewport - (viewportH - edgeZone)) / edgeZone)
        );
        return Math.round(4 + intensity * 10);
      }
      return 0;
    },
    [getQueueScrollBounds]
  );

  const resetQueueDrag = useCallback(() => {
    stopQueueAutoScroll();
    draggingQueueIdxRef.current = null;
    draggingQueueKeyRef.current = '';
    lastDragReorderedKeysRef.current = null;
    queueDragTranslationYRef.current = 0;
    activeQueueDragKeySV.value = '';
    activeQueueDragIdxSV.value = -1;
    queueDragTargetIdxSV.value = -1;
    queueDragOffsetYSV.value = 0;
    queueScrollDeltaSV.value = 0;
    queuePositionsSV.value = { ...queueBasePositionsSV.value };
    queueScrollRef.current?.setNativeProps?.({ scrollEnabled: true });
  }, [
    activeQueueDragKeySV,
    activeQueueDragIdxSV,
    queueBasePositionsSV,
    queueDragOffsetYSV,
    queueDragTargetIdxSV,
    queuePositionsSV,
    queueScrollDeltaSV,
    stopQueueAutoScroll,
  ]);

  const startQueueDrag = useCallback(
    (idx: number, key: string) => {
      stopQueueAutoScroll();
      draggingQueueIdxRef.current = idx;
      draggingQueueKeyRef.current = key;
      const startY = queueScrollOffsetRef.current;
      queueDragStartScrollYRef.current = startY;
      queueDragTranslationYRef.current = 0;
      queueListLengthSV.value = displayedQueueRef.current.length;
      getQueueScrollBounds(displayedQueueRef.current.length);
      queueScrollStartSV.value = startY;
      queueCurrentScrollYSV.value = startY;
      queueScrollDeltaSV.value = 0;
      queueScrollRef.current?.setNativeProps?.({ scrollEnabled: false });
    },
    [
      getQueueScrollBounds,
      queueCurrentScrollYSV,
      queueListLengthSV,
      queueScrollDeltaSV,
      queueScrollStartSV,
      stopQueueAutoScroll,
    ]
  );

  const triggerQueueEdgeAutoScroll = useCallback(
    (translationY: number) => {
      queueDragTranslationYRef.current = translationY;
      const listLen = displayedQueueRef.current.length;
      if (getQueueAutoScrollStep(translationY, listLen) === 0) {
        stopQueueAutoScroll();
        return;
      }
      if (!queueAutoScrollTimerRef.current) {
        queueAutoScrollTimerRef.current = setInterval(() => {
          const activeList = displayedQueueRef.current;
          const fromIdx = draggingQueueIdxRef.current;
          const dragKey = draggingQueueKeyRef.current;
          if (fromIdx === null || !dragKey || activeList.length <= 1) {
            stopQueueAutoScroll();
            return;
          }
          const delta = getQueueAutoScrollStep(queueDragTranslationYRef.current, activeList.length);
          if (delta === 0) {
            stopQueueAutoScroll();
            return;
          }
          const { maxScrollY } = getQueueScrollBounds(activeList.length);
          const nextScrollY = Math.max(0, Math.min(maxScrollY, queueScrollOffsetRef.current + delta));
          if (nextScrollY === queueScrollOffsetRef.current) {
            stopQueueAutoScroll();
            return;
          }
          queueScrollOffsetRef.current = nextScrollY;
          const scrollDelta = nextScrollY - queueDragStartScrollYRef.current;
          queueCurrentScrollYSV.value = nextScrollY;
          queueScrollDeltaSV.value = scrollDelta;
          queueScrollRef.current?.scrollTo?.({ y: nextScrollY, animated: false });

          const minY = -fromIdx * QUEUE_ROW_HEIGHT;
          const maxY = (activeList.length - 1 - fromIdx) * QUEUE_ROW_HEIGHT;
          const clampedY = Math.max(
            minY,
            Math.min(maxY, queueDragTranslationYRef.current + scrollDelta)
          );
          queueDragOffsetYSV.value = clampedY;
          const nextTarget = Math.max(
            0,
            Math.min(activeList.length - 1, Math.round(fromIdx + clampedY / QUEUE_ROW_HEIGHT))
          );
          if (nextTarget !== queueDragTargetIdxSV.value) {
            queueDragTargetIdxSV.value = nextTarget;
            queuePositionsSV.value = computeReorderedPositions(
              queueBasePositionsSV.value,
              dragKey,
              fromIdx,
              nextTarget
            );
          }
        }, 16);
      }
    },
    [
      getQueueAutoScrollStep,
      getQueueScrollBounds,
      queueBasePositionsSV,
      queueCurrentScrollYSV,
      queueDragOffsetYSV,
      queueDragTargetIdxSV,
      queuePositionsSV,
      queueScrollDeltaSV,
      stopQueueAutoScroll,
    ]
  );

  const endQueueDrag = useCallback(
    (commit: boolean, translationY = 0, explicitFromIdx?: number, explicitToIdx?: number) => {
      const fromIdx =
        explicitFromIdx !== undefined && explicitFromIdx >= 0
          ? explicitFromIdx
          : draggingQueueIdxRef.current;
      const activeList = displayedQueueRef.current;
      const scrollDelta = queueScrollOffsetRef.current - queueDragStartScrollYRef.current;
      let toIdx =
        explicitToIdx !== undefined && explicitToIdx >= 0 ? explicitToIdx : fromIdx;
      if (
        (explicitToIdx === undefined || explicitToIdx < 0) &&
        fromIdx !== null &&
        activeList.length > 1
      ) {
        const minY = -fromIdx * QUEUE_ROW_HEIGHT;
        const maxY = (activeList.length - 1 - fromIdx) * QUEUE_ROW_HEIGHT;
        const clampedY = Math.max(minY, Math.min(maxY, translationY + scrollDelta));
        toIdx = Math.max(
          0,
          Math.min(activeList.length - 1, Math.round(fromIdx + clampedY / QUEUE_ROW_HEIGHT))
        );
      }
      const didMove = commit && fromIdx !== null && toIdx !== null && fromIdx !== toIdx;
      if (!didMove || fromIdx === null || toIdx === null) {
        resetQueueDrag();
        return;
      }
      const reordered = [...activeList];
      const [moved] = reordered.splice(fromIdx, 1);
      if (!moved) {
        resetQueueDrag();
        return;
      }
      reordered.splice(toIdx, 0, moved);
      // Posições já foram comitadas atomicamente no onEnd worklet na UI thread (zero reset aqui)
      stopQueueAutoScroll();
      draggingQueueIdxRef.current = null;
      draggingQueueKeyRef.current = '';
      queueDragTranslationYRef.current = 0;
      queueScrollRef.current?.setNativeProps?.({ scrollEnabled: true });
      lastDragReorderedKeysRef.current = reordered.map((t, i) =>
        getQueueRowKey(t, i, reordered)
      );
      setOptimisticQueueMove({ sourceQueue: queueRef.current, reordered });
      onMoveQueueTrack?.(fromIdx, toIdx);
    },
    [onMoveQueueTrack, resetQueueDrag, stopQueueAutoScroll]
  );

  useLayoutEffect(() => {
    if (activeQueueDragKeySV.value) return;
    const currentList = displayedQueueRef.current;
    const currentEpoch = queueLayoutEpochRef.current;
    const desired: Record<string, number> = {};
    for (let i = 0; i < currentList.length; i++) {
      desired[getQueueRowKey(currentList[i], i, currentList)] = i;
    }
    const currentBase = queueBasePositionsSV.value;
    const desiredKeys = Object.keys(desired);
    const baseKeys = Object.keys(currentBase);
    const isSame =
      queueBasePositionsEpochSV.value === currentEpoch &&
      desiredKeys.length === baseKeys.length &&
      desiredKeys.every((k) => currentBase[k] === desired[k]);
    if (!isSame) {
      queueBasePositionsEpochSV.value = currentEpoch;
      queueBasePositionsSV.value = desired;
      queuePositionsSV.value = desired;
    }
  }, [
    displayedQueue,
    activeQueueDragKeySV,
    queueBasePositionsEpochSV,
    queueBasePositionsSV,
    queuePositionsSV,
  ]);

  const selectQueueTrackStable = useCallback(
    (qTrack: Track, idx: number) => {
      if (draggingQueueIdxRef.current !== null) return;
      onSelectQueueTrack?.(qTrack, idx);
    },
    [onSelectQueueTrack]
  );

  const moveQueueTrackStable = useCallback(
    (fromIndex: number, toIndex: number) => {
      onMoveQueueTrack?.(fromIndex, toIndex);
    },
    [onMoveQueueTrack]
  );

  const removeQueueTrackStable = useCallback(
    (idx: number) => {
      onRemoveQueueTrack?.(idx);
    },
    [onRemoveQueueTrack]
  );

  const scrollToSection = (section: 'lyrics' | 'related') => {
    setActivePlayerTab(section);
    const targetY =
      section === 'lyrics'
        ? cardPositions.lyrics ?? viewportHeight
        : cardPositions.related ?? viewportHeight + 420;
    mainScrollRef.current?.scrollTo?.({ y: targetY, animated: true });
  };

  const sheetEaseOut = getEaseOutCubic(Easing);

  const openQueueSheet = () => {
    setActivePlayerTab('upnext');
    setIsEditingQueue(false);
    isDismissingQueueRef.current = false;
    queueScrollOffsetRef.current = 0;
    resetQueueDrag();
    queueSheetTranslateY.setValue(400);
    queueBackdropOpacity.setValue(0);
    setIsQueueSheetVisible(true);
    onOpenQueue?.();
  };

  useEffect(() => {
    if (!isQueueSheetVisible) return;
    queueSheetTranslateY.setValue(400);
    queueBackdropOpacity.setValue(0);
    let anim: Animated.CompositeAnimation | null = null;
    const cancel = scheduleNextFrame(() => {
      anim = Animated.parallel([
        Animated.timing(queueSheetTranslateY, {
          toValue: 0,
          duration: SHEET_ENTER_MS,
          easing: sheetEaseOut,
          useNativeDriver: true,
        }),
        Animated.timing(queueBackdropOpacity, {
          toValue: 1,
          duration: SHEET_ENTER_MS,
          easing: sheetEaseOut,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
    });
    return () => {
      cancel();
      anim?.stop();
    };
  }, [isQueueSheetVisible, queueSheetTranslateY, queueBackdropOpacity]);

  const dismissQueueSheet = () => {
    if (isDismissingQueueRef.current) return;
    isDismissingQueueRef.current = true;
    resetQueueDrag();
    Animated.parallel([
      Animated.timing(queueSheetTranslateY, {
        toValue: 600,
        duration: SHEET_EXIT_MS,
        easing: sheetEaseOut,
        useNativeDriver: true,
      }),
      Animated.timing(queueBackdropOpacity, {
        toValue: 0,
        duration: SHEET_EXIT_MS,
        easing: sheetEaseOut,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      isDismissingQueueRef.current = false;
      if (finished) {
        setIsQueueSheetVisible(false);
        setIsEditingQueue(false);
        setActivePlayerTab('cover');
        queueSheetTranslateY.setValue(0);
      }
    });
  };

  const openMenuSheet = () => {
    isDismissingMenuRef.current = false;
    sheetTranslateY.setValue(360);
    sheetBackdropOpacity.setValue(0);
    setShowContextMenu(true);
  };

  useEffect(() => {
    if (!showContextMenu) return;
    sheetTranslateY.setValue(360);
    sheetBackdropOpacity.setValue(0);
    let anim: Animated.CompositeAnimation | null = null;
    const cancel = scheduleNextFrame(() => {
      anim = Animated.parallel([
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: SHEET_ENTER_MS,
          easing: sheetEaseOut,
          useNativeDriver: true,
        }),
        Animated.timing(sheetBackdropOpacity, {
          toValue: 1,
          duration: SHEET_ENTER_MS,
          easing: sheetEaseOut,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
    });
    return () => {
      cancel();
      anim?.stop();
    };
  }, [showContextMenu, sheetTranslateY, sheetBackdropOpacity]);

  const dismissMenuSheet = (afterDismiss?: () => void) => {
    if (isDismissingMenuRef.current) return;
    isDismissingMenuRef.current = true;
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: 600,
        duration: SHEET_EXIT_MS,
        easing: sheetEaseOut,
        useNativeDriver: true,
      }),
      Animated.timing(sheetBackdropOpacity, {
        toValue: 0,
        duration: SHEET_EXIT_MS,
        easing: sheetEaseOut,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      isDismissingMenuRef.current = false;
      if (finished) {
        setShowContextMenu(false);
        sheetTranslateY.setValue(0);
        if (typeof afterDismiss === 'function') {
          afterDismiss();
        }
      }
    });
  };

  const createSheetPanResponder = (translateY: Animated.Value, onDismiss: () => void) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 2,
      onPanResponderMove: (_, gestureState) => {
        translateY.setValue(
          gestureState.dy > 0 ? gestureState.dy : Math.max(-56, gestureState.dy * 0.15)
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 70 || gestureState.vy > 0.5) {
          onDismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            bounciness: 4,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          bounciness: 4,
          useNativeDriver: true,
        }).start();
      },
    });

  const sheetPanResponder = useMemo(
    () => createSheetPanResponder(sheetTranslateY, dismissMenuSheet),
    []
  );
  const queueSheetPanResponder = useMemo(
    () => createSheetPanResponder(queueSheetTranslateY, dismissQueueSheet),
    []
  );

  const scrollYRef = useRef(0);
  const isAtTopRef = useRef(true);
  const [isAtTop, setIsAtTop] = useState(true);
  const isScrubbingRef = useRef(false);
  const isNativePanActiveRef = useRef(false);
  const isClosingRef = useRef(false);
  const isDismissingMenuRef = useRef(false);
  const isDismissingQueueRef = useRef(false);
  useBackModalLock(Boolean(visible && track));
  const modalTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const swipeFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSwipeFallbackTimer = React.useCallback(() => {
    if (swipeFallbackTimerRef.current) {
      clearTimeout(swipeFallbackTimerRef.current);
      swipeFallbackTimerRef.current = null;
    }
  }, []);

  const { onModalShow: onNowPlayingModalShow } = useModalEnterAnimation({
    visible: Boolean(visible && track),
    onReset: () => {
      modalTranslateY.setValue(SCREEN_HEIGHT);
    },
    onAnimateIn: () => {
      const anim = Animated.timing(modalTranslateY, {
        toValue: 0,
        duration: SHEET_ENTER_MS,
        easing: sheetEaseOut,
        useNativeDriver: true,
      });
      anim.start();
      return anim;
    },
  });

  useEffect(() => {
    if (visible) {
      clearSwipeFallbackTimer();
      swipeTranslateX.setValue(0);
      scrollYRef.current = 0;
      isAtTopRef.current = true;
      setIsAtTop(true);
      isNativePanActiveRef.current = false;
      isClosingRef.current = false;
      isDismissingMenuRef.current = false;
      isDismissingQueueRef.current = false;
      setShowContextMenu(false);
      setIsLyricsExpanded(false);
      setIsArtistModalVisible(false);
      setActivePlayerTab('cover');
      setIsQueueSheetVisible(false);
      setIsEditingQueue(false);
      setOptimisticQueueMove(null);
      resetQueueDrag();
    }
  }, [clearSwipeFallbackTimer, visible]);

  useEffect(
    () => () => {
      stopQueueAutoScroll();
      clearSwipeFallbackTimer();
    },
    [clearSwipeFallbackTimer]
  );

  const handleScrubbingChange = useCallback((scrubbing: boolean) => {
    isScrubbingRef.current = scrubbing;
    setIsScrubbing(scrubbing);
  }, []);

  const clampedModalTranslateY = useMemo(
    () =>
      modalTranslateY.interpolate({
        inputRange: [-500, 0, SCREEN_HEIGHT],
        outputRange: [-75, 0, SCREEN_HEIGHT],
        extrapolate: 'clamp',
      }),
    [modalTranslateY]
  );

  const dismissGestureEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { translationY: modalTranslateY } }], {
        useNativeDriver: true,
      }),
    [modalTranslateY]
  );

  const horizontalGestureEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { translationX: swipeTranslateX } }], {
        useNativeDriver: true,
      }),
    [swipeTranslateX]
  );

  const updateDragTranslate = React.useCallback(
    (dy: number) => {
      if (dy > 0) {
        modalTranslateY.setValue(dy);
      } else {
        modalTranslateY.setValue(dy * 0.15);
      }
    },
    [modalTranslateY]
  );

  const resetDragTranslate = React.useCallback(() => {
    Animated.spring(modalTranslateY, {
      toValue: 0,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  }, [modalTranslateY]);

  const closeWithSlide = React.useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(modalTranslateY, {
      toValue: SCREEN_HEIGHT,
      duration: theme.transitions.sheetOutMs,
      easing: sheetEaseOut,
      useNativeDriver: true,
    }).start(() => {
      onClose();
      modalTranslateY.setValue(0);
    });
  }, [modalTranslateY, onClose, sheetEaseOut]);

  const handleModalRequestClose = React.useCallback(() => {
    if (isArtistModalVisible) {
      setIsArtistModalVisible(false);
      return;
    }
    if (showContextMenu) {
      dismissMenuSheet();
      return;
    }
    if (isQueueSheetVisible) {
      if (isEditingQueue) {
        setIsEditingQueue(false);
      } else {
        dismissQueueSheet();
      }
      return;
    }
    if (isLyricsExpanded) {
      setIsLyricsExpanded(false);
      return;
    }
    closeWithSlide();
  }, [
    isArtistModalVisible,
    showContextMenu,
    isQueueSheetVisible,
    isEditingQueue,
    isLyricsExpanded,
    closeWithSlide,
  ]);

  const finishDragTranslate = React.useCallback(
    (dy: number, vyPerMs: number) => {
      if (dy > 80 || vyPerMs > 0.4) {
        closeWithSlide();
      } else {
        resetDragTranslate();
      }
    },
    [closeWithSlide, resetDragTranslate]
  );

  const resetHorizontalSwipe = React.useCallback(() => {
    clearSwipeFallbackTimer();
    Animated.spring(swipeTranslateX, {
      toValue: 0,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [clearSwipeFallbackTimer, swipeTranslateX]);

  const finishHorizontalSwipe = React.useCallback(
    (dx: number, vxPerMs: number) => {
      const isSwipeNext = dx < -65 || (vxPerMs < -0.35 && dx < -20);
      const isSwipePrev = dx > 65 || (vxPerMs > 0.35 && dx > 20);
      const hasNextTarget = displayedQueueRef.current.length > 0;
      const hasPrevTarget = Boolean(previousTrack);

      if (isSwipeNext && !hasNextTarget) {
        resetHorizontalSwipe();
        return;
      }

      if (isSwipePrev && !hasPrevTarget) {
        onSkipPrevious(true);
        resetHorizontalSwipe();
        return;
      }

      if (isSwipeNext || isSwipePrev) {
        clearSwipeFallbackTimer();
        const exitX = isSwipeNext ? -SCREEN_WIDTH : SCREEN_WIDTH;
        Animated.timing(swipeTranslateX, {
          toValue: exitX,
          duration: theme.transitions.toastMs,
          easing: sheetEaseOut,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) return;
          // Hold swipeTranslateX at exitX so adjacent artwork stays centered until `track.id` updates
          swipeFallbackTimerRef.current = setTimeout(() => {
            swipeFallbackTimerRef.current = null;
            resetHorizontalSwipe();
          }, 450);
          if (typeof (swipeFallbackTimerRef.current as any)?.unref === 'function') {
            (swipeFallbackTimerRef.current as any).unref();
          }
          if (isSwipeNext) {
            onSkipNext();
          } else {
            onSkipPrevious(true);
          }
        });
      } else {
        resetHorizontalSwipe();
      }
    },
    [
      clearSwipeFallbackTimer,
      onSkipNext,
      onSkipPrevious,
      previousTrack,
      resetHorizontalSwipe,
      swipeTranslateX,
    ]
  );

  // PanResponder para gesto de arrastar para baixo e recolher o player quando no topo da tela
  const modalPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            !isNativePanActiveRef.current &&
            !isScrubbingRef.current &&
            !showContextMenu &&
            !isQueueSheetVisible &&
            scrollYRef.current <= 5 &&
            gestureState.dy > 8 &&
            Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.2
          );
        },
        onPanResponderMove: (_, gestureState) => {
          if (!isNativePanActiveRef.current) {
            updateDragTranslate(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (!isNativePanActiveRef.current) {
            finishDragTranslate(gestureState.dy, gestureState.vy);
          }
        },
        onPanResponderTerminate: () => {
          if (!isNativePanActiveRef.current) {
            resetDragTranslate();
          }
        },
      }),
    [
      showContextMenu,
      isQueueSheetVisible,
      updateDragTranslate,
      finishDragTranslate,
      resetDragTranslate,
    ]
  );

  // PanResponder dedicado para a barra superior (header), permitindo arrastar a partir de qualquer ponto
  const headerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            !isNativePanActiveRef.current &&
            !showContextMenu &&
            !isQueueSheetVisible &&
            gestureState.dy > 4 &&
            Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
          );
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          return (
            !isNativePanActiveRef.current &&
            !showContextMenu &&
            !isQueueSheetVisible &&
            gestureState.dy > 8 &&
            Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.2
          );
        },
        onPanResponderMove: (_, gestureState) => {
          if (!isNativePanActiveRef.current) {
            updateDragTranslate(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (!isNativePanActiveRef.current) {
            finishDragTranslate(gestureState.dy, gestureState.vy);
          }
        },
        onPanResponderTerminate: () => {
          if (!isNativePanActiveRef.current) {
            resetDragTranslate();
          }
        },
      }),
    [
      showContextMenu,
      isQueueSheetVisible,
      updateDragTranslate,
      finishDragTranslate,
      resetDragTranslate,
    ]
  );

  const loadLyrics = React.useCallback(
    (forceRefresh: boolean = false) => {
      if (!track?.title || !track?.artist) {
        setLyricsPayload(null);
        setIsLoadingLyrics(false);
        return () => {};
      }
      let isCancelled = false;
      setIsLoadingLyrics(true);
      getTrackLyrics(
        track.id || `${track.title}::${track.artist}`,
        track.title,
        track.artist,
        track.duration,
        forceRefresh
      )
        .then((result) => {
          if (!isCancelled) {
            setLyricsPayload(result);
            setIsLoadingLyrics(false);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setLyricsPayload(null);
            setIsLoadingLyrics(false);
          }
        });
      return () => {
        isCancelled = true;
      };
    },
    [track?.id, track?.title, track?.artist, track?.duration]
  );

  useEffect(() => {
    return loadLyrics(false);
  }, [loadLyrics]);

  const resolvedTrackMeta = useMemo(
    () => extractTrackMetadata(track?.title, track?.artist),
    [track?.title, track?.artist]
  );
  const effectiveArtistName =
    resolvedTrackMeta.primaryArtist || track?.artist || 'Artista';

  // Busca automática de faixas relacionadas e perfil do artista quando o modal está ativo
  useEffect(() => {
    let isCancelled = false;
    if (track?.id && !relatedTracks) {
      setIsFetchingRelated(true);
      getRelatedTracks(track.id, track.title, track.artist)
        .then((res) => {
          if (!isCancelled) {
            setFetchedRelatedTracks(res || []);
            setIsFetchingRelated(false);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setFetchedRelatedTracks([]);
            setIsFetchingRelated(false);
          }
        });
    }

    if (effectiveArtistName) {
      getArtistProfile(effectiveArtistName)
        .then((prof) => {
          if (!isCancelled) {
            setArtistProfile(prof);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setArtistProfile(null);
          }
        });
    } else {
      setArtistProfile(null);
    }

    return () => {
      isCancelled = true;
    };
  }, [track?.id, track?.title, track?.artist, effectiveArtistName, relatedTracks]);

  const effectiveRelatedTracks = useMemo(() => {
    if (relatedTracks && relatedTracks.length > 0) return relatedTracks;
    return fetchedRelatedTracks;
  }, [relatedTracks, fetchedRelatedTracks]);

  // Animação de escala com curva Spring física Apple Design / Emil Kowalski
  const scaleAnim = useRef(new Animated.Value(isPlaying ? 1.0 : 0.95)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: isPlaying ? 1.0 : 0.95,
      useNativeDriver: true,
      damping: 16,
      mass: 1,
      stiffness: 130,
    }).start();
  }, [isPlaying]);

  const effectiveDuration =
    track?.duration && track.duration > 0 ? track.duration : 0;

  const handleLyricsSeekTo = useCallback(
    (seconds: number) => (onSeek ? onSeek(seconds) : seekTo(seconds)),
    [onSeek]
  );

  const handleLyricsToggleExpand = useCallback(() => {
    setIsLyricsExpanded((prev) => !prev);
  }, []);

  const handleLyricsHeaderPress = useCallback(() => {
    scrollToSection('lyrics');
  }, [scrollToSection]);

  const handleLyricsRetry = useCallback(() => {
    loadLyrics(true);
  }, [loadLyrics]);

  const handleLyricsCardLayout = useCallback((y: number) => {
    setCardPositions((prev) => ({ ...prev, lyrics: y }));
  }, []);

  useLayoutEffect(() => {
    clearSwipeFallbackTimer();
    swipeTranslateX.setValue(0);
  }, [clearSwipeFallbackTimer, swipeTranslateX, track?.id]);

  if (!visible || !track) return null;

  const ambientColor = 'rgba(255, 255, 255, 0.06)';
  const nextTrack = displayedQueue.length > 0 ? displayedQueue[0] : null;

  const renderArtworkVisual = (targetTrack: Track | null | undefined, isCurrent: boolean) => {
    const artworkUri = typeof targetTrack?.artwork === 'string' ? targetTrack.artwork : undefined;
    const hasLetterboxBars = Boolean(artworkUri && /(?:hqdefault|sddefault)\.jpg/i.test(artworkUri));

    return targetTrack?.artwork ? (
      <Image
        key={targetTrack.id}
        source={{
          uri: artworkUri,
        }}
        fadeDuration={0}
        style={[styles.artwork, hasLetterboxBars && styles.artworkLetterboxCrop]}
        resizeMode="cover"
        accessible={isCurrent}
        accessibilityRole={isCurrent ? 'image' : undefined}
        accessibilityLabel={
          isCurrent ? `Capa do álbum de ${targetTrack.title || 'música'}` : undefined
        }
      />
    ) : (
      <View style={styles.artworkFallback}>
        <Music2 color="#555555" size={64} />
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      onShow={onNowPlayingModalShow}
      onRequestClose={handleModalRequestClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.safeContainer}>
          <PanGestureHandler
            ref={dismissPanRef}
            testID="player-dismiss-pan"
            enabled={isAtTop && !showContextMenu && !isQueueSheetVisible && !isScrubbing}
            activeOffsetY={10}
            failOffsetY={-5}
            failOffsetX={[-15, 15]}
            simultaneousHandlers={horizontalPanRef}
            waitFor={scrubberPanRef}
            onGestureEvent={dismissGestureEvent}
            onHandlerStateChange={(evt: any) => {
              const { state, oldState, translationY, velocityY } = evt.nativeEvent;
              if (state === GestureState.ACTIVE) {
                isNativePanActiveRef.current = true;
              } else if (
                state === GestureState.END &&
                oldState === GestureState.ACTIVE
              ) {
                isNativePanActiveRef.current = false;
                finishDragTranslate(translationY, velocityY / 1000);
              } else if (
                state === GestureState.CANCELLED ||
                state === GestureState.FAILED
              ) {
                if (oldState === GestureState.ACTIVE && isNativePanActiveRef.current) {
                  resetDragTranslate();
                }
                isNativePanActiveRef.current = false;
              }
            }}
          >
            <Animated.View
              renderToHardwareTextureAndroid={!isQueueSheetVisible && !showContextMenu}
              style={[
                styles.modalContentWrapper,
                {
                  transform: [{ translateY: clampedModalTranslateY }],
                },
              ]}
              {...modalPanResponder.panHandlers}
              testID="now-playing-modal-content"
              accessibilityLabel="Player em tela cheia - arraste para baixo para recolher"
            >
          <AmbientGlowBackground
            artworkUri={typeof track.artwork === 'string' ? track.artwork : null}
          />

          <SafeAreaView style={styles.safeContainer}>
          <PanGestureHandler
            ref={horizontalPanRef}
            testID="player-horizontal-pan"
            enabled={!showContextMenu && !isQueueSheetVisible && !isArtistModalVisible && !isScrubbing}
            activeOffsetX={[-15, 15]}
            failOffsetY={[-12, 12]}
            simultaneousHandlers={dismissPanRef}
            waitFor={scrubberPanRef}
            onGestureEvent={horizontalGestureEvent}
            onHandlerStateChange={(evt: any) => {
              const { state, oldState, translationX = 0, velocityX = 0 } = evt?.nativeEvent ?? {};
              if (state === GestureState.ACTIVE) {
                swipeTranslateX.setValue(
                  Math.max(-SCREEN_WIDTH * 0.85, Math.min(SCREEN_WIDTH * 0.85, translationX))
                );
              } else if (state === GestureState.END && oldState === GestureState.ACTIVE) {
                finishHorizontalSwipe(translationX, velocityX / 1000);
              } else if (
                (state === GestureState.CANCELLED || state === GestureState.FAILED) &&
                oldState === GestureState.ACTIVE
              ) {
                resetHorizontalSwipe();
              }
            }}
          >
          <Animated.View style={styles.container}>
          {/* Header Superior: Botão Minimizar e Indicador de Origem */}
          <View
            style={styles.header}
            {...headerPanResponder.panHandlers}
            accessibilityRole="toolbar"
            accessibilityLabel="Barra superior do player - arraste para baixo para recolher"
          >
            <TouchableOpacity
              style={styles.minimizeButton}
              onPress={closeWithSlide}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Minimizar player"
            >
              <ChevronDown color="#FFFFFF" size={28} />
            </TouchableOpacity>

            <View style={styles.headerCenter} pointerEvents="none">
              <Text style={styles.headerSubtitle}>TOCANDO AGORA</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {track.album || 'Sonary'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.headerAction}
              onPress={openMenuSheet}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Mais opções"
            >
              <MoreVertical color={showContextMenu ? '#FFFFFF' : '#AAAAAA'} size={24} />
            </TouchableOpacity>
          </View>

          {/* ScrollView Vertical Unificado Estilo Spotify */}
          <GHScrollView
            ref={mainScrollRef}
            waitFor={[dismissPanRef, horizontalPanRef]}
            bounces={false}
            overScrollMode="never"
            style={styles.mainScrollView}
            contentContainerStyle={styles.mainScrollContent}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const y = e?.nativeEvent?.contentOffset?.y ?? 0;
              scrollYRef.current = y;
              const nextAtTop = y <= 5;
              if (nextAtTop !== isAtTopRef.current) {
                isAtTopRef.current = nextAtTop;
                setIsAtTop(nextAtTop);
              }
            }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 400 && Math.abs(h - viewportHeight) > 10) {
                setViewportHeight(h);
              }
            }}
          >
            {/* 1. SEÇÃO HERO DO PLAYER (Layout ergonômico estilo Spotify: thumb zone inferior) */}
            <View style={[styles.heroSection, { minHeight: viewportHeight - 64 }]}>
              {/* Capa expansiva estilo carrossel Spotify: revela capa anterior/próxima ao arrastar */}
              <View style={styles.artworkContainer}>
                {previousTrack && (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.artworkWrapper,
                      styles.adjacentArtworkWrapper,
                      {
                        opacity: swipeTranslateX.interpolate({
                          inputRange: [0, 1, SCREEN_WIDTH],
                          outputRange: [0, 0.9, 1],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            translateX: swipeTranslateX.interpolate({
                              inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
                              outputRange: [-SCREEN_WIDTH, -SCREEN_WIDTH, 0],
                              extrapolate: 'clamp',
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    {renderArtworkVisual(previousTrack, false)}
                  </Animated.View>
                )}

                {nextTrack && (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.artworkWrapper,
                      styles.adjacentArtworkWrapper,
                      {
                        opacity: swipeTranslateX.interpolate({
                          inputRange: [-SCREEN_WIDTH, -1, 0],
                          outputRange: [1, 0.9, 0],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            translateX: swipeTranslateX.interpolate({
                              inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
                              outputRange: [0, SCREEN_WIDTH, SCREEN_WIDTH],
                              extrapolate: 'clamp',
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    {renderArtworkVisual(nextTrack, false)}
                  </Animated.View>
                )}

                <Animated.View
                  style={[
                    styles.artworkWrapper,
                    {
                      opacity: swipeTranslateX.interpolate({
                        inputRange: [-SCREEN_WIDTH * 0.5, 0, SCREEN_WIDTH * 0.5],
                        outputRange: [0.45, 1, 0.45],
                        extrapolate: 'clamp',
                      }),
                      transform: [{ scale: scaleAnim }, { translateX: swipeTranslateX }],
                    },
                  ]}
                >
                  {renderArtworkVisual(track, true)}
                </Animated.View>
              </View>

              {/* Bloco de Controles aproximado da parte inferior (Thumb Zone natural) */}
              <View style={styles.heroControlsArea}>
                {/* Metadados da Faixa: Título com Chevron, Artista e Botão de Favoritar */}
                <View style={styles.metadataRow}>
                  <Animated.View
                    style={[
                      styles.titleCol,
                      {
                        opacity: swipeTranslateX.interpolate({
                          inputRange: [-SCREEN_WIDTH * 0.5, 0, SCREEN_WIDTH * 0.5],
                          outputRange: [0.55, 1, 0.55],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            translateX: swipeTranslateX.interpolate({
                              inputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
                              outputRange: [-SCREEN_WIDTH * 0.45, SCREEN_WIDTH * 0.45],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <View style={styles.titleWithChevron}>
                      <MarqueeText
                        active={true}
                        containerStyle={styles.titleMarqueeContainer}
                        style={styles.trackTitle}
                      >
                        {track.title || 'Faixa sem título'}
                      </MarqueeText>
                      <ChevronRight color="#AAAAAA" size={22} style={styles.titleChevron} />
                    </View>
                    <TouchableOpacity
                      onPress={() => setIsArtistModalVisible(true)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver perfil de ${track.artist || 'Artista'}`}
                    >
                      <MarqueeText active={true} style={styles.trackArtist}>
                        {track.artist || 'Artista desconhecido'}
                      </MarqueeText>
                    </TouchableOpacity>
                  </Animated.View>

                  {onToggleFavorite && (
                    <TouchableOpacity
                      style={styles.favoriteButton}
                      onPress={onToggleFavorite}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                    >
                      <Heart
                        color={isFavorite ? '#FF0000' : '#AAAAAA'}
                        fill={isFavorite ? '#FF0000' : 'transparent'}
                        size={26}
                      />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Scrubber de Progresso Interativo isolado com useProgress */}
                <PlayerProgressSection
                  trackDuration={track.duration}
                  fallbackPosition={fallbackPosition}
                  onSeek={onSeek}
                  scrubberPanRef={scrubberPanRef}
                  onScrubbingChange={handleScrubbingChange}
                />

                {/* Controles Principais de Reprodução: Linha de 5 Botões no Thumb Zone */}
                <View style={styles.controlsContainer}>
                  {/* 1. Shuffle na extrema esquerda */}
                  {onToggleShuffle ? (
                    <TouchableOpacity
                      style={styles.sideControlButton}
                      onPress={onToggleShuffle}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel="Ordem aleatória"
                      activeOpacity={0.7}
                    >
                      <Shuffle
                        color={isShuffleActive ? '#FFFFFF' : '#717171'}
                        size={24}
                      />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.sideControlButton} />
                  )}

                  {/* 2. Skip Previous */}
                  <TouchableOpacity
                    style={styles.skipButton}
                    onPress={() => onSkipPrevious(false)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Faixa anterior"
                  >
                    <SkipBack color="#FFFFFF" size={32} fill="#FFFFFF" />
                  </TouchableOpacity>

                  {/* 3. Play / Pause Principal (Círculo Branco Maciço 72px) */}
                  <TouchableOpacity
                    style={styles.mainPlayButton}
                    onPress={onTogglePlay}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pausar' : 'Tocar'}
                  >
                    {isBuffering ? (
                      <ActivityIndicator color="#030303" size="large" />
                    ) : isPlaying ? (
                      <Pause color="#030303" size={32} fill="#030303" />
                    ) : (
                      <Play
                        color="#030303"
                        size={32}
                        fill="#030303"
                        style={{ marginLeft: 3 }}
                      />
                    )}
                  </TouchableOpacity>

                  {/* 4. Skip Next */}
                  <TouchableOpacity
                    style={styles.skipButton}
                    onPress={onSkipNext}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Próxima faixa"
                  >
                    <SkipForward color="#FFFFFF" size={32} fill="#FFFFFF" />
                  </TouchableOpacity>

                  {/* 5. Repeat na extrema direita */}
                  {onToggleRepeat ? (
                    <TouchableOpacity
                      style={styles.sideControlButton}
                      onPress={onToggleRepeat}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel="Repetir"
                      activeOpacity={0.7}
                    >
                      {repeatMode === RepeatMode.Track ? (
                        <Repeat1 color="#FF0000" size={24} />
                      ) : (
                        <Repeat
                          color={repeatMode === RepeatMode.Queue ? '#FFFFFF' : '#717171'}
                          size={24}
                        />
                      )}
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.sideControlButton} />
                  )}
                </View>

                {/* Pílulas de Navegação Rápida de Seção */}
                <View style={styles.sheetTabsRow}>
                  <TouchableOpacity
                    style={[
                      styles.sheetTabButton,
                      (isQueueSheetVisible || activePlayerTab === 'upnext') &&
                        styles.sheetTabButtonActive,
                    ]}
                    onPress={openQueueSheet}
                    accessibilityRole="button"
                    accessibilityLabel="Fila"
                  >
                    <Text
                      style={[
                        styles.sheetTabText,
                        (isQueueSheetVisible || activePlayerTab === 'upnext') &&
                          styles.sheetTabTextActive,
                      ]}
                    >
                      FILA
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.sheetTabButton,
                      activePlayerTab === 'lyrics' && styles.sheetTabButtonActive,
                    ]}
                    onPress={() => scrollToSection('lyrics')}
                    accessibilityRole="button"
                    accessibilityLabel="Letras"
                  >
                    <Text
                      style={[
                        styles.sheetTabText,
                        activePlayerTab === 'lyrics' && styles.sheetTabTextActive,
                      ]}
                    >
                      LETRAS
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.sheetTabButton,
                      activePlayerTab === 'related' && styles.sheetTabButtonActive,
                    ]}
                    onPress={() => scrollToSection('related')}
                    accessibilityRole="button"
                    accessibilityLabel="Relacionados"
                  >
                    <Text
                      style={[
                        styles.sheetTabText,
                        activePlayerTab === 'related' && styles.sheetTabTextActive,
                      ]}
                    >
                      RELACIONADOS
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* 2. CARD DE LETRAS (SPOTIFY LYRICS CARD - Componente desacoplado e memoizado) */}
            <PlayerLyricsSection
              track={track}
              fallbackPosition={fallbackPosition}
              lyricsPayload={lyricsPayload}
              syncedLyricsProp={syncedLyrics}
              isLoading={isLoadingLyrics}
              isExpanded={isLyricsExpanded}
              onToggleExpand={handleLyricsToggleExpand}
              onHeaderPress={handleLyricsHeaderPress}
              onSeekTo={handleLyricsSeekTo}
              onRetry={handleLyricsRetry}
              ambientColor={ambientColor}
              onCardLayout={handleLyricsCardLayout}
            />

            {/* 3. CARD DE RELACIONADOS E SOBRE O ARTISTA (SPOTIFY ARTIST & RECOMMENDATIONS) */}
            <View
              style={styles.spotifyArtistCard}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                setCardPositions((prev) => ({ ...prev, related: y }));
              }}
            >
              <Text style={styles.spotifyCardTitle}>Sobre o artista</Text>

              <TouchableOpacity
                style={styles.spotifyArtistHero}
                onPress={() => setIsArtistModalVisible(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Abrir perfil do artista"
              >
                <View style={styles.spotifyArtistAvatar}>
                  {artistProfile?.avatarUrl ? (
                    <Image
                      source={{ uri: artistProfile.avatarUrl }}
                      style={styles.spotifyArtistAvatarImg}
                      resizeMode="cover"
                      accessibilityRole="image"
                      accessibilityLabel={`Foto de ${track.artist || 'Artista'}`}
                    />
                  ) : (
                    <Sparkles color="#FFFFFF" size={24} />
                  )}
                </View>
                <View style={styles.spotifyArtistMeta}>
                  <Text style={styles.spotifyArtistName} numberOfLines={1}>
                    {artistProfile?.name || effectiveArtistName}
                  </Text>
                  <Text style={styles.spotifyArtistSub} numberOfLines={1}>
                    {`${artistProfile?.subscriberCountText || 'Artista Verificado'} • Explorar discografia e canais recomendados`}
                  </Text>
                </View>
                <ChevronRight color="#AAAAAA" size={20} />
              </TouchableOpacity>

              <Text style={styles.spotifyArtistBio}>
                {artistProfile?.bio ||
                  'Ouça os maiores sucessos, novas faixas e mergulhe na rádio personalizada com base nas suas preferências musicais.'}
              </Text>

              <View style={styles.spotifyDivider} />

              <Text style={styles.spotifySectionHeading}>Você também pode gostar</Text>

              {/* Ação 1: Rádio da Música (Track Radio) */}
              <View style={styles.spotifyRelatedCard}>
                <View style={styles.spotifyRelatedLeft}>
                  <View style={styles.spotifyRelatedIconBadge}>
                    <Music2 color="#FFFFFF" size={20} />
                  </View>
                  <View style={styles.spotifyRelatedInfo}>
                    <Text style={styles.spotifyRelatedTrackTitle} numberOfLines={1}>
                      {`Mix Especial de ${resolvedTrackMeta.cleanTitle || track.title || 'Músicas'}`}
                    </Text>
                    <Text style={styles.spotifyRelatedSubtitle}>
                      Sonary Smart Radio
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.spotifyPlayCircle}
                  onPress={() => {
                    if (onStartTrackRadio) {
                      onStartTrackRadio();
                    } else {
                      onTogglePlay();
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Tocar mix relacionado"
                >
                  {isLoadingRadio ? (
                    <ActivityIndicator color="#030303" size="small" />
                  ) : (
                    <Play color="#030303" size={16} fill="#030303" style={{ marginLeft: 2 }} />
                  )}
                </TouchableOpacity>
              </View>

              {/* Ação 2: Rádio do Artista (Artist Radio) */}
              <TouchableOpacity
                style={styles.spotifyRelatedCard}
                onPress={() => {
                  if (onStartArtistRadio) {
                    onStartArtistRadio(
                      effectiveArtistName,
                      artistProfile?.channelId
                    );
                  } else {
                    onTogglePlay();
                  }
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Iniciar rádio do artista"
              >
                <View style={styles.spotifyRelatedLeft}>
                  <View style={[styles.spotifyRelatedIconBadge, { backgroundColor: '#333333' }]}>
                    <Radio color="#FFFFFF" size={20} />
                  </View>
                  <View style={styles.spotifyRelatedInfo}>
                    <Text style={styles.spotifyRelatedTrackTitle} numberOfLines={1}>
                      {`Rádio de ${effectiveArtistName}`}
                    </Text>
                    <Text style={styles.spotifyRelatedSubtitle}>
                      Descobertas e faixas similares
                    </Text>
                  </View>
                </View>

                <View style={styles.spotifyPillBadge}>
                  <Text style={styles.spotifyPillBadgeText}>Mix Contínuo</Text>
                </View>
              </TouchableOpacity>

              {/* Lista Dinâmica de Faixas Relacionadas Reais */}
              {(isLoadingRelated || isFetchingRelated) &&
              effectiveRelatedTracks.length === 0 ? (
                <View style={styles.relatedSkeletonWrap}>
                  <TrackRowSkeleton
                    count={4}
                    thumbnailSize={40}
                    thumbnailRadius={8}
                    horizontalPadding={0}
                    showDuration={false}
                  />
                </View>
              ) : (
                effectiveRelatedTracks.slice(0, 6).map((relTrack, rIdx) => (
                  <TouchableOpacity
                    key={`${relTrack.id}-${rIdx}`}
                    style={styles.spotifyRelatedCard}
                    onPress={() => onPlayRelatedTrack?.(relTrack)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Tocar relacionada ${relTrack.title}`}
                  >
                    <View style={styles.spotifyRelatedLeft}>
                      {relTrack.thumbnailUrl ? (
                        <Image
                          source={{ uri: relTrack.thumbnailUrl }}
                          style={styles.relatedThumbImg}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.spotifyRelatedIconBadge}>
                          <Music2 color="#FFFFFF" size={18} />
                        </View>
                      )}
                      <View style={styles.spotifyRelatedInfo}>
                        <MarqueeText
                          active={track?.id === relTrack.id}
                          style={styles.spotifyRelatedTrackTitle}
                        >
                          {relTrack.title}
                        </MarqueeText>
                        <TrackMetaRow
                          style={styles.spotifyRelatedMetaRow}
                          active={track?.id === relTrack.id}
                          artistText={relTrack.artist}
                          textStyle={styles.spotifyRelatedSubtitle}
                        />
                      </View>
                    </View>

                    <Text style={styles.relatedDurationText} numberOfLines={1}>
                      {relTrack.formattedDuration || '3:30'}
                    </Text>

                    {onAddRelatedToQueue ? (
                      <TouchableOpacity
                        style={styles.relatedQueueAddBtn}
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          onAddRelatedToQueue(relTrack);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Adicionar ${relTrack.title} à fila`}
                      >
                        <ListPlus color="#FFFFFF" size={18} />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.spotifyPlayCircle}>
                        <Play color="#030303" size={14} fill="#030303" style={{ marginLeft: 2 }} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          </GHScrollView>
        </Animated.View>
        </PanGestureHandler>
        </SafeAreaView>

        {/* Menu Contextual Estilo Bottom Sheet do YouTube Music */}
        {showContextMenu && (
          <Animated.View
            style={[styles.modalSheetOverlay, { opacity: sheetBackdropOpacity }]}
          >
            <TouchableOpacity
              style={styles.sheetBackdrop}
              activeOpacity={1}
              onPress={() => dismissMenuSheet()}
            >
              <Animated.View
                renderToHardwareTextureAndroid
                style={[
                  styles.sheetContainer,
                  {
                    transform: [{ translateY: sheetTranslateY }],
                  },
                ]}
                onStartShouldSetResponder={() => true}
                onTouchEnd={(e) => e?.stopPropagation?.()}
              >
                {/* Área de arrasto superior com PanResponder para recolher */}
                <View
                  style={styles.sheetDragArea}
                  {...sheetPanResponder.panHandlers}
                  accessibilityRole="adjustable"
                  accessibilityLabel="Arraste para baixo para recolher o menu"
                >
                  <View style={styles.sheetDragHandle} />
                </View>

                {/* Cabeçalho com Título, Artista, Duração e Botão Fechar */}
                <View style={styles.sheetHeader}>
                  <View
                    style={styles.sheetHeaderInfo}
                    {...sheetPanResponder.panHandlers}
                  >
                    <Text style={styles.sheetTitle} numberOfLines={1}>
                      {track.title || 'Faixa sem título'}
                    </Text>
                    <Text style={styles.sheetSubtitle} numberOfLines={1}>
                      {track.artist || 'Artista'}
                      {effectiveDuration > 0 ? ` • ${formatTime(effectiveDuration)}` : ''}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.sheetCloseButton}
                    onPress={() => dismissMenuSheet()}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Fechar menu"
                  >
                    <X color="#FFFFFF" size={22} />
                  </TouchableOpacity>
                </View>

                <View style={styles.sheetDivider} />

                {/* 3 Blocos de Ação Rápida no Topo (YouTube Music Tiles) */}
                <View style={styles.quickTilesRow}>
                  {onPlayNext ? (
                    <TouchableOpacity
                      style={styles.quickTile}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        dismissMenuSheet();
                        onPlayNext();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Tocar a seguir"
                    >
                      <ListPlus color="#FFFFFF" size={22} />
                      <Text style={styles.quickTileText} numberOfLines={1}>
                        Tocar a seguir
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.quickTile}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        dismissMenuSheet(openQueueSheet);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Ver fila"
                    >
                      <ListMusic color="#FFFFFF" size={22} />
                      <Text style={styles.quickTileText} numberOfLines={1}>
                        Ver fila
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.quickTile}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      dismissMenuSheet(openQueueSheet);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Fila / Rádio"
                  >
                    <Radio color="#FFFFFF" size={22} />
                    <Text style={styles.quickTileText} numberOfLines={1}>
                      Fila / Rádio
                    </Text>
                  </TouchableOpacity>

                  {onAddToPlaylist && (
                    <TouchableOpacity
                      style={styles.quickTile}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        dismissMenuSheet();
                        onAddToPlaylist();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Playlist"
                    >
                      <Plus color="#FFFFFF" size={22} />
                      <Text style={styles.quickTileText} numberOfLines={1}>
                        Playlist
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Lista Vertical de Opções */}
                <View style={styles.sheetActionsList}>
                  {onAddToQueue && (
                    <TouchableOpacity
                      style={styles.sheetActionRow}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        dismissMenuSheet();
                        onAddToQueue();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Adicionar ao fim da fila"
                    >
                      <ListMusic color="#FFFFFF" size={22} />
                      <Text style={styles.sheetActionText}>Adicionar ao fim da fila</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.sheetActionRow}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      dismissMenuSheet(openQueueSheet);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Ver fila de reprodução"
                  >
                    <ListMusic color="#FFFFFF" size={22} />
                    <Text style={styles.sheetActionText}>Ver fila de reprodução</Text>
                  </TouchableOpacity>

                  {onDownload && (
                    <TouchableOpacity
                      style={styles.sheetActionRow}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        dismissMenuSheet();
                        if (!isDownloaded && !isDownloading && !isQueued) {
                          onDownload();
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isDownloaded
                          ? 'Música salva offline'
                          : isDownloading
                            ? 'Baixando música'
                            : isQueued
                              ? 'Na fila de downloads'
                              : 'Salvar offline'
                      }
                    >
                      {isDownloaded ? (
                        <CheckCircle2 color="#2BA640" size={22} />
                      ) : isDownloading ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : isQueued ? (
                        <Clock color="#AAAAAA" size={22} />
                      ) : (
                        <Download color="#FFFFFF" size={22} />
                      )}
                      <Text style={styles.sheetActionText}>
                        {isDownloaded
                          ? 'Música já baixada'
                          : isDownloading
                            ? `Baixando${downloadProgress > 0 ? ` (${downloadProgress}%)` : '...'}`
                            : isQueued
                              ? 'Na fila de downloads'
                              : 'Salvar offline'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {onAddToPlaylist && (
                    <TouchableOpacity
                      style={styles.sheetActionRow}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        dismissMenuSheet();
                        onAddToPlaylist();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Adicionar à playlist"
                    >
                      <Plus color="#FFFFFF" size={22} />
                      <Text style={styles.sheetActionText}>Adicionar à playlist</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </Animated.View>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Modal Bottom Sheet da Fila Estilo Spotify */}
        {isQueueSheetVisible && (
          <Animated.View
            style={[styles.modalSheetOverlay, { opacity: queueBackdropOpacity }]}
          >
            <TouchableOpacity
              style={styles.sheetBackdrop}
              activeOpacity={1}
              onPress={dismissQueueSheet}
            >
              <Animated.View
                style={[
                  styles.queueSheetContainer,
                  {
                    transform: [{ translateY: queueSheetTranslateY }],
                  },
                ]}
                onStartShouldSetResponder={() => true}
                onTouchEnd={(e) => e?.stopPropagation?.()}
              >
                <View
                  style={styles.sheetDragArea}
                  {...queueSheetPanResponder.panHandlers}
                  accessibilityRole="adjustable"
                  accessibilityLabel="Arraste para baixo para fechar a fila"
                >
                  <View style={styles.sheetDragHandle} />
                </View>

                <View style={styles.queueSheetHeaderRow} {...queueSheetPanResponder.panHandlers}>
                  <View style={styles.sheetHeaderInfo}>
                    <Text style={styles.queueSheetTitle}>Fila</Text>
                    <Text style={styles.queueSheetSubtitle} numberOfLines={1}>
                      {`Tocando agora • ${track.album || 'Sonary'}`}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.queueEditButton, isEditingQueue && styles.queueEditButtonActive]}
                    onPress={() => {
                      resetQueueDrag();
                      setIsEditingQueue((prev) => !prev);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={isEditingQueue ? 'Concluir edição da fila' : 'Editar fila'}
                  >
                    <Text style={styles.queueEditButtonText}>
                      {isEditingQueue ? 'Concluído' : 'Editar'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Faixa Atual */}
                <View style={styles.queueNowPlayingRow}>
                  <View style={styles.queueNowPlayingThumbContainer}>
                    {track.artwork ? (
                      <Image
                        source={typeof track.artwork === 'string' ? { uri: track.artwork } : track.artwork}
                        style={styles.queueThumbImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.queueThumbFallback}>
                        <Music2 color="#FFFFFF" size={18} />
                      </View>
                    )}
                    <PlayingEqualizer isPlaying={isPlaying} />
                  </View>

                  <View style={styles.queueItemMeta}>
                    <MarqueeText active={true} style={styles.queueNowPlayingTitle}>
                      {track.title || 'Faixa sem título'}
                    </MarqueeText>
                    <MarqueeText active={true} style={styles.queueItemArtist}>
                      {track.artist || 'Artista'}
                    </MarqueeText>
                  </View>

                  <TouchableOpacity
                    style={styles.queueNowPlayingPlayBtn}
                    onPress={onTogglePlay}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pausar música atual' : 'Tocar música atual'}
                  >
                    {isPlaying ? (
                      <Pause color="#030303" size={18} fill="#030303" />
                    ) : (
                      <Play color="#030303" size={18} fill="#030303" style={{ marginLeft: 2 }} />
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.queueSheetDivider} />

                {/* Próximas Faixas */}
                <View style={styles.queueSectionHeader}>
                  <Text style={styles.queueSectionLabel}>A seguir</Text>
                  {displayedQueue.length > 0 && (
                    <Text style={styles.queueSectionMeta}>
                      {displayedQueue.length}{' '}
                      {displayedQueue.length === 1 ? 'música' : 'músicas'} •{' '}
                      {formatTime(displayedQueue.reduce((acc, t) => acc + (t.duration || 0), 0))}
                    </Text>
                  )}
                </View>

                <GHScrollView
                  ref={queueScrollRef}
                  style={styles.queueSheetList}
                  contentContainerStyle={styles.queueSheetListContent}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                  scrollEnabled
                  scrollEventThrottle={16}
                  onLayout={(e) => {
                    queueListHeightRef.current = e.nativeEvent.layout.height;
                    getQueueScrollBounds(displayedQueueRef.current.length);
                  }}
                  onContentSizeChange={(_, h) => {
                    queueContentHeightRef.current = h;
                    getQueueScrollBounds(displayedQueueRef.current.length);
                  }}
                  onScroll={(e) => {
                    if (draggingQueueIdxRef.current === null) {
                      const nextY = e.nativeEvent.contentOffset.y;
                      queueScrollOffsetRef.current = nextY;
                      queueCurrentScrollYSV.value = nextY;
                    }
                  }}
                >
                  {displayedQueue.length > 0 ? (
                    <View
                      key={`queue-slots-${queueLayoutEpochRef.current}`}
                      style={[
                        styles.queueSheetListSlots,
                        { height: displayedQueue.length * QUEUE_ROW_HEIGHT },
                      ]}
                    >
                      {stableQueueEntries.map(({ qTrack, qIdx, key }) => (
                        <QueueTrackRow
                          key={key}
                          rowKey={key}
                          rowEpoch={queueLayoutEpochRef.current}
                          qTrack={qTrack}
                          qIdx={qIdx}
                          isEditingQueue={isEditingQueue}
                          canReorder={Boolean(onMoveQueueTrack) && displayedQueue.length > 1}
                          isFirst={qIdx === 0}
                          isLast={qIdx === displayedQueue.length - 1}
                          basePositionsEpochSV={queueBasePositionsEpochSV}
                          basePositionsSV={queueBasePositionsSV}
                          positionsSV={queuePositionsSV}
                          activeDragKeySV={activeQueueDragKeySV}
                          activeDragIdxSV={activeQueueDragIdxSV}
                          dragTargetIdxSV={queueDragTargetIdxSV}
                          dragOffsetYSV={queueDragOffsetYSV}
                          listLengthSV={queueListLengthSV}
                          scrollDeltaSV={queueScrollDeltaSV}
                          scrollViewportHeightSV={queueViewportHeightSV}
                          maxScrollYSV={queueMaxScrollYSV}
                          scrollStartSV={queueScrollStartSV}
                          currentScrollYSV={queueCurrentScrollYSV}
                          onStartDrag={startQueueDrag}
                          onEdgeAutoScroll={triggerQueueEdgeAutoScroll}
                          onStopAutoScroll={stopQueueAutoScroll}
                          onEndDrag={endQueueDrag}
                          onSelectTrack={selectQueueTrackStable}
                          onMoveTrack={onMoveQueueTrack ? moveQueueTrackStable : undefined}
                          onRemoveTrack={onRemoveQueueTrack ? removeQueueTrackStable : undefined}
                        />
                      ))}
                    </View>
                  ) : (
                    <View style={styles.queuePlaceholderBox}>
                      <Radio color="#717171" size={32} />
                      <Text style={styles.queuePlaceholderTitle}>Fila Contínua Automática</Text>
                      <Text style={styles.queuePlaceholderSub}>
                        {`Reproduzindo rádio infinita baseada em ${track.artist || 'suas preferências'}.`}
                      </Text>
                    </View>
                  )}
                </GHScrollView>

                {/* Barra Inferior Estilo Spotify: Aleatório, Repetir e Fechar */}
                <View style={styles.queueBottomBar}>
                  <TouchableOpacity
                    style={styles.queueBottomAction}
                    onPress={() => onToggleShuffle?.()}
                    accessibilityRole="button"
                    accessibilityLabel="Aleatório"
                  >
                    <Shuffle color={isShuffleActive ? '#1DB954' : '#FFFFFF'} size={20} />
                    <Text
                      style={[
                        styles.queueBottomActionText,
                        isShuffleActive && styles.queueBottomActionTextActive,
                      ]}
                    >
                      Aleatório
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.queueBottomAction}
                    onPress={() => onToggleRepeat?.()}
                    accessibilityRole="button"
                    accessibilityLabel="Repetir"
                  >
                    {repeatMode === RepeatMode.Track ? (
                      <Repeat1 color="#1DB954" size={20} />
                    ) : (
                      <Repeat
                        color={repeatMode !== RepeatMode.Off ? '#1DB954' : '#FFFFFF'}
                        size={20}
                      />
                    )}
                    <Text
                      style={[
                        styles.queueBottomActionText,
                        repeatMode !== RepeatMode.Off && styles.queueBottomActionTextActive,
                      ]}
                    >
                      Repetir
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.queueBottomAction}
                    onPress={dismissQueueSheet}
                    accessibilityRole="button"
                    accessibilityLabel="Fechar fila"
                  >
                    <X color="#FFFFFF" size={20} />
                    <Text style={styles.queueBottomActionText}>Fechar</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Toast flutuante dentro do Modal (Dialog Window do Android fica acima do App) */}
        <ToastBanner
          message={!isArtistModalVisible ? toastMessage : null}
          variant={toastVariant}
          onDismiss={onDismissToast}
          topOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 12 : 54}
        />

        {/* Modal Dedicado de Perfil do Artista */}
        <ArtistProfileModal
          visible={isArtistModalVisible}
          onClose={() => setIsArtistModalVisible(false)}
          artistName={effectiveArtistName}
          channelId={artistProfile?.channelId}
          initialProfile={artistProfile}
          onPlayTrack={(relTrack) => {
            if (onPlayRelatedTrack) {
              onPlayRelatedTrack(relTrack);
            }
          }}
          onAddToQueue={(relTrack) => {
            if (onAddRelatedToQueue) {
              onAddRelatedToQueue(relTrack);
            }
          }}
          onStartArtistRadio={(name, cid) => {
            if (onStartArtistRadio) {
              onStartArtistRadio(name, cid);
            }
          }}
          toastMessage={toastMessage}
          onDismissToast={onDismissToast}
        />
            </Animated.View>
          </PanGestureHandler>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalContentWrapper: {
    flex: 1,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
  },
  mainScrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  mainScrollContent: {
    paddingBottom: Platform.OS === 'ios' ? 50 : 36,
  },
  heroSection: {
    width: '100%',
    justifyContent: 'space-between',
    paddingBottom: 0,
  },
  artworkContainer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: ARTWORK_BOX_SIZE + 24,
  },
  heroControlsArea: {
    width: '100%',
    paddingBottom: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    paddingBottom: 12,
    backgroundColor: 'transparent',
    minHeight: 52,
  },
  minimizeButton: {
    padding: 6,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#AAAAAA',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerAction: {
    padding: 6,
  },
  centerStageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: ARTWORK_SIZE,
    width: '100%',
    marginVertical: 4,
  },
  artworkWrapper: {
    width: ARTWORK_BOX_SIZE,
    height: ARTWORK_BOX_SIZE,
    aspectRatio: 1,
    flexShrink: 0,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#161616',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    position: 'relative',
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  artworkLetterboxCrop: {
    transform: [{ scale: 1.35 }],
  },
  artworkFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjacentArtworkWrapper: {
    position: 'absolute',
  },
  artworkSeekOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  artworkSeekButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  artworkSeekLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  spotifySwipePeek: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 4,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderBottomWidth: 0,
  },
  spotifySwipePeekLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  spotifySwipePeekTitles: {
    justifyContent: 'center',
  },
  spotifySwipePeekTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  spotifySwipePeekText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  spotifySwipePeekRight: {
    padding: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotifyLyricsCard: {
    borderRadius: 24,
    padding: 16,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  spotifyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
    marginBottom: 12,
  },
  spotifyCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  spotifyCardTitleBlock: {
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
  },
  spotifyArtistCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  spotifyArtistHero: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 10,
  },
  spotifyArtistAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    overflow: 'hidden',
  },
  spotifyArtistAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 25,
  },
  spotifyArtistMeta: {
    flex: 1,
    marginRight: 8,
  },
  spotifyArtistName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  spotifyArtistSub: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  spotifyArtistBio: {
    color: '#CCCCCC',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  spotifyDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 14,
  },
  spotifySectionHeading: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  spotifyRelatedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  spotifyRelatedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  spotifyRelatedIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotifyRelatedInfo: {
    flex: 1,
    minWidth: 0,
  },
  spotifyRelatedTrackTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  spotifyRelatedMetaRow: {
    marginTop: 2,
  },
  spotifyRelatedSubtitle: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  relatedDurationText: {
    color: '#AAAAAA',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
    marginRight: 10,
  },
  spotifyPlayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotifyPillBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  spotifyPillBadgeText: {
    color: '#AAAAAA',
    fontSize: 11,
    fontWeight: '600',
  },
  relatedThumbImg: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#222222',
  },
  relatedQueueAddBtn: {
    padding: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  relatedSkeletonWrap: {
    marginTop: 4,
    gap: 8,
  },
  queueSheetContainer: {
    backgroundColor: '#181818',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxWidth: 540,
    width: '100%',
    maxHeight: SCREEN_HEIGHT * 0.82 + 72,
    alignSelf: 'center',
    marginBottom: -72,
    paddingBottom: (Platform.OS === 'ios' ? 30 : 18) + 72,
  },
  queueSheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 14,
  },
  queueSheetTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  queueSheetSubtitle: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  queueEditButton: {
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9999,
  },
  queueEditButtonActive: {
    backgroundColor: '#1DB954',
  },
  queueEditButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  queueNowPlayingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  queueNowPlayingThumbContainer: {
    width: 44,
    height: 44,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#282828',
    position: 'relative',
  },
  queueThumbImg: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#282828',
  },
  queueThumbFallback: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#282828',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueNowPlayingTitle: {
    color: theme.colors.brandPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  queueNowPlayingPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  queueSheetDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 20,
    marginVertical: 12,
  },
  queueSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  queueSectionLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  queueSectionMeta: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '500',
  },
  queueSheetList: {
    flexGrow: 0,
    maxHeight: SCREEN_HEIGHT * 0.42,
  },
  queueSheetListContent: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  queueSheetListSlots: {
    position: 'relative',
  },
  queueTrackSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: QUEUE_ROW_HEIGHT,
  },
  queueTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: QUEUE_ROW_HEIGHT,
  },
  queueTrackSelectArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: '100%',
  },
  queueDragHandle: {
    width: 40,
    height: QUEUE_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueItemMeta: {
    flex: 1,
    minWidth: 0,
  },
  queueItemTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  queueItemArtist: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  queueBottomBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  queueBottomAction: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  queueBottomActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  queueBottomActionTextActive: {
    color: '#1DB954',
  },
  queueActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  queueMoveControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  queueSmallBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queuePlaceholderBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  queuePlaceholderTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  queuePlaceholderSub: {
    color: '#AAAAAA',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  lyricsScrollView: {
    flex: 1,
  },
  lyricsContentContainer: {
    paddingVertical: 24,
  },
  relatedScrollView: {
    flex: 1,
  },
  relatedArtistHero: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    marginBottom: 12,
  },
  relatedAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  relatedArtistMeta: {
    flex: 1,
  },
  relatedArtistName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  relatedArtistSub: {
    color: '#AAAAAA',
    fontSize: 11,
  },
  relatedSectionHeading: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  relatedTrackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#181818',
    borderRadius: 6,
    gap: 12,
  },
  relatedTrackInfo: {
    flex: 1,
  },
  relatedTrackTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  relatedTrackSubtitle: {
    color: '#AAAAAA',
    fontSize: 11,
    marginTop: 2,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  titleCol: {
    flex: 1,
    marginRight: 16,
  },
  titleWithChevron: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleMarqueeContainer: {
    flexShrink: 1,
    minWidth: 0,
  },
  titleChevron: {
    marginLeft: 6,
    opacity: 0.8,
  },
  trackTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  trackArtist: {
    fontSize: 15,
    color: '#AAAAAA',
    fontWeight: '500',
    marginTop: 3,
  },
  favoriteButton: {
    padding: 6,
  },
  scrubberContainer: {
    marginVertical: 4,
  },
  touchableBarArea: {
    paddingVertical: 12,
    position: 'relative',
    justifyContent: 'center',
  },
  trackBackground: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 1.5,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 8,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#FFFFFF',
    marginLeft: -5.5,
  },
  scrubberThumbActive: {
    transform: [{ scale: 1.4 }],
    backgroundColor: '#FFFFFF',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 12,
    paddingHorizontal: 8,
  },
  sideControlButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    position: 'relative',
  },
  seekLabel: {
    position: 'absolute',
    color: '#AAAAAA',
    fontSize: 9,
    fontWeight: '800',
    top: 14,
  },
  skipButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainPlayButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  sheetTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  sheetTabButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 9999,
  },
  sheetTabButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  sheetTabText: {
    color: '#AAAAAA',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sheetTabTextActive: {
    color: '#FFFFFF',
  },
  modalSheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    overflow: 'hidden',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#212121',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    marginBottom: -72,
    paddingBottom: (Platform.OS === 'ios' ? 36 : 24) + 72,
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 24,
  },
  sheetDragArea: {
    width: '100%',
    paddingTop: 12,
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    alignSelf: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  sheetHeaderInfo: {
    flex: 1,
    marginRight: 16,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  sheetSubtitle: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  sheetCloseButton: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 14,
  },
  quickTilesRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  quickTile: {
    flex: 1,
    backgroundColor: '#2e2e2e',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  quickTileText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  sheetActionsList: {
    paddingTop: 6,
  },
  sheetActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sheetActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },
});
