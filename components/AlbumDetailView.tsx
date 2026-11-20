import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Disc,
  Download,
  MoreVertical,
  Play,
  RefreshCw,
  Shuffle,
} from 'lucide-react-native';
import {
  AlbumDetail,
  ArtistAlbumSummary,
  getAlbumDetail,
  TrackSummary,
} from '../services/api';
import {
  DownloadQueueItem,
  enqueuePlaylistDownload,
  subscribeDownloadQueue,
} from '../services/storage';
import { BACK_PRIORITY, useBackHandler } from '../services/backNavigation';
import { CircularDownloadProgress, TrackContextSheet } from './TrackCard';
import { PlayingEqualizer } from './PlayingEqualizer';
import { DownloadedTrackBadge, MarqueeText, TrackMetaRow } from './MarqueeText';
import { TrackRowSkeleton } from './TrackRowSkeleton';
import { AmbientGlowBackground } from './AmbientGlowBackground';
import { AtmosphericGradient } from './AtmosphericGradient';
import { theme } from '../theme';

const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
const GLOW_BACKDROP_HEIGHT = ANDROID_STATUS_BAR_HEIGHT + 470;

export interface AlbumDetailViewProps {
  release: ArtistAlbumSummary;
  artistName: string;
  onBack: () => void;
  currentActiveTrackId?: string;
  isPlaying?: boolean;
  downloadedTrackIds?: Set<string>;
  onPlayTrack: (track: TrackSummary, index: number, allTracks: TrackSummary[]) => void;
  onPlayAll: (
    tracks: TrackSummary[],
    startIndex?: number,
    options?: { shuffle?: boolean }
  ) => void;
  onPlayNext?: (track: TrackSummary) => void;
  onAddToQueue?: (track: TrackSummary) => void;
  onAddToPlaylist?: (track: TrackSummary) => void;
  onDownloadTrack?: (track: TrackSummary) => void;
  onShowToast?: (message: string, variant?: 'success' | 'error' | 'info') => void;
  bottomPadding?: number;
  registerBackHandler?: boolean;
}

function formatTotalDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

function formatReleaseType(type: 'album' | 'single' | 'ep'): string {
  if (type === 'ep') return 'EP';
  if (type === 'single') return 'Single';
  return 'Álbum';
}

interface AlbumTrackRowProps {
  item: TrackSummary;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  isQueued: boolean;
  downloadProgress: number;
  onPress: (item: TrackSummary, index: number) => void;
  onOpenMenu: (item: TrackSummary) => void;
}

const AlbumTrackRow = memo<AlbumTrackRowProps>(
  ({
    item,
    index,
    isActive,
    isPlaying,
    isDownloaded,
    isDownloading,
    isQueued,
    downloadProgress,
    onPress,
    onOpenMenu,
  }) => {
    return (
      <TouchableOpacity
        style={[styles.trackRow, isActive && styles.trackRowActive]}
        onPress={() => onPress(item, index)}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={`Tocar ${item.title}`}
      >
        <View style={styles.trackIndexCell}>
          {isActive ? (
            <PlayingEqualizer isPlaying={isPlaying} variant="inline" />
          ) : (
            <Text style={styles.trackIndexText}>{index + 1}</Text>
          )}
        </View>

        <View style={styles.trackInfo}>
          <MarqueeText
            active={isActive}
            style={[styles.trackTitle, isActive && styles.trackTitleActive]}
          >
            {item.title}
          </MarqueeText>
          <TrackMetaRow
            style={styles.trackMetaRow}
            active={isActive}
            leading={isDownloaded ? <DownloadedTrackBadge /> : undefined}
            artistText={item.artist}
            textStyle={styles.trackSubtitle}
          />
        </View>

        {isDownloading ? (
          <View style={styles.statusIndicator} accessibilityLabel="Baixando música">
            <CircularDownloadProgress progress={downloadProgress} />
          </View>
        ) : isQueued && !isDownloaded ? (
          <View style={styles.queuedPill} accessibilityLabel="Na fila de downloads">
            <Clock color="#AAAAAA" size={12} />
            <Text style={styles.queuedPillText}>Na fila</Text>
          </View>
        ) : item.formattedDuration ? (
          <Text style={styles.trackDuration} numberOfLines={1}>
            {item.formattedDuration}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.moreTrackBtn}
          onPress={(e) => {
            e?.stopPropagation?.();
            onOpenMenu(item);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Mais opções para ${item.title}`}
        >
          <MoreVertical color="#AAAAAA" size={20} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }
);

export const AlbumDetailView: React.FC<AlbumDetailViewProps> = ({
  release,
  artistName,
  onBack,
  currentActiveTrackId,
  isPlaying = false,
  downloadedTrackIds,
  onPlayTrack,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onDownloadTrack,
  onShowToast,
  bottomPadding = 160,
  registerBackHandler = true,
}) => {
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [retryToken, setRetryToken] = useState<number>(0);
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([]);
  const [menuTrack, setMenuTrack] = useState<TrackSummary | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const lastBrowseIdRef = useRef<string>(release.browseId);

  useBackHandler(
    registerBackHandler && !menuTrack,
    () => {
      onBack();
      return true;
    },
    BACK_PRIORITY.SUBSCREEN_MODE + 4
  );

  useEffect(() => {
    return subscribeDownloadQueue(setDownloadQueue);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (lastBrowseIdRef.current !== release.browseId) {
      lastBrowseIdRef.current = release.browseId;
      setAlbum(null);
      scrollY.setValue(0);
    }
    setIsLoading(true);
    setHasError(false);

    getAlbumDetail(release.browseId, {
      ...release,
      artist: artistName,
    })
      .then((detail) => {
        if (!cancelled) {
          setAlbum(detail);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasError(true);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [release.browseId, release.title, release.thumbnailUrl, release.year, release.type, artistName, retryToken]);

  const tracks = album?.tracks || [];
  const displayTitle = album?.title || release.title;
  const displayArtist = album?.artist || artistName;
  const displayYear = album?.year || release.year;
  const displayCover = album?.thumbnailUrl || release.thumbnailUrl;
  const displayType = album?.type || release.type;

  const activeDownloadingItem = useMemo(
    () => downloadQueue.find((item) => item.status === 'downloading') ?? null,
    [downloadQueue]
  );
  const queuedIds = useMemo(
    () =>
      new Set(
        downloadQueue
          .filter((item) => item.status === 'pending')
          .map((item) => item.track.id)
      ),
    [downloadQueue]
  );
  const completedIds = useMemo(
    () =>
      new Set(
        downloadQueue
          .filter((item) => item.status === 'completed')
          .map((item) => item.track.id)
      ),
    [downloadQueue]
  );

  const isTrackDownloaded = useCallback(
    (id: string) => Boolean(downloadedTrackIds?.has(id) || completedIds.has(id)),
    [downloadedTrackIds, completedIds]
  );

  const albumTrackIds = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);
  const activeDownloadsForAlbum = useMemo(
    () => downloadQueue.filter((item) => albumTrackIds.has(item.track.id)),
    [downloadQueue, albumTrackIds]
  );
  const pendingOrDownloadingAlbum = useMemo(
    () =>
      activeDownloadsForAlbum.filter(
        (item) => item.status === 'pending' || item.status === 'downloading'
      ),
    [activeDownloadsForAlbum]
  );
  const completedDownloadsForAlbum = useMemo(
    () => activeDownloadsForAlbum.filter((item) => item.status === 'completed'),
    [activeDownloadsForAlbum]
  );
  const isDownloadingAll = pendingOrDownloadingAlbum.length > 0;
  const allTracksDownloaded =
    tracks.length > 0 && tracks.every((t) => isTrackDownloaded(t.id));
  const downloadCounterText = isDownloadingAll
    ? `${completedDownloadsForAlbum.length}/${activeDownloadsForAlbum.length}`
    : '';

  const handleDownloadAll = useCallback(() => {
    const missing = tracks.filter((t) => !isTrackDownloaded(t.id));
    if (missing.length === 0) {
      onShowToast?.('Todas as faixas deste álbum já estão salvas offline', 'success');
      return;
    }
    const result = enqueuePlaylistDownload(missing);
    if (result.enqueuedCount > 0) {
      onShowToast?.(
        `${result.enqueuedCount} ${result.enqueuedCount === 1 ? 'música adicionada' : 'músicas adicionadas'} à fila de downloads`,
        'success'
      );
    } else {
      onShowToast?.('As faixas deste álbum já estão na fila de downloads', 'info');
    }
  }, [tracks, isTrackDownloaded, onShowToast]);

  const handlePressTrack = useCallback(
    (track: TrackSummary, index: number) => {
      onPlayTrack(track, index, tracks);
    },
    [onPlayTrack, tracks]
  );

  const glowTranslateY = scrollY.interpolate({
    inputRange: [0, GLOW_BACKDROP_HEIGHT],
    outputRange: [0, -GLOW_BACKDROP_HEIGHT],
    extrapolate: 'clamp',
  });
  const topBarScrimOpacity = scrollY.interpolate({
    inputRange: [90, 190],
    outputRange: [0, 0.96],
    extrapolate: 'clamp',
  });
  const topBarTitleOpacity = scrollY.interpolate({
    inputRange: [140, 210],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const metaParts: string[] = [formatReleaseType(displayType)];
  if (displayYear) metaParts.push(displayYear);
  if (tracks.length > 0) {
    metaParts.push(`${tracks.length} ${tracks.length === 1 ? 'música' : 'músicas'}`);
  }
  const durationLabel = formatTotalDuration(album?.totalDuration || 0);
  if (durationLabel) metaParts.push(durationLabel);

  const menuTrackDownloaded = menuTrack ? isTrackDownloaded(menuTrack.id) : false;
  const menuTrackDownloading = Boolean(
    menuTrack && activeDownloadingItem?.track.id === menuTrack.id
  );
  const menuTrackQueued = Boolean(menuTrack && queuedIds.has(menuTrack.id));

  return (
    <View style={styles.container} testID="album-detail-view">
      {/* Glow atmosférico contínuo acompanhando a capa (mesmo padrão do PlaylistDetailModal) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowBackdrop,
          { transform: [{ translateY: glowTranslateY }] },
        ]}
      >
        {displayCover ? (
          <AmbientGlowBackground
            artworkUri={displayCover}
            crossfadeDurationMs={theme.transitions.glowEntryMs}
          />
        ) : (
          <AtmosphericGradient height={GLOW_BACKDROP_HEIGHT} />
        )}
      </Animated.View>

      {/* Top bar flutuante */}
      <View style={styles.topBar}>
        <Animated.View
          pointerEvents="none"
          style={[styles.topBarScrim, { opacity: topBarScrimOpacity }]}
        />
        <TouchableOpacity
          style={styles.circleTopBtn}
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Voltar para o artista"
        >
          <ArrowLeft color="#FFFFFF" size={22} />
        </TouchableOpacity>

        <Animated.Text
          style={[styles.topBarTitle, { opacity: topBarTitleOpacity }]}
          numberOfLines={1}
        >
          {displayTitle}
        </Animated.Text>

        {tracks.length > 0 ? (
          <TouchableOpacity
            style={isDownloadingAll ? styles.downloadProgressPill : styles.circleTopBtn}
            onPress={handleDownloadAll}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={
              isDownloadingAll
                ? `Baixando álbum: ${downloadCounterText}`
                : allTracksDownloaded
                  ? 'Todas as músicas do álbum já baixadas'
                  : 'Baixar todas as músicas do álbum'
            }
          >
            {isDownloadingAll ? (
              <>
                <Download color="#FFFFFF" size={14} />
                <Text style={styles.downloadCounterText}>{downloadCounterText}</Text>
              </>
            ) : allTracksDownloaded ? (
              <CheckCircle2 color="#2BA640" size={19} />
            ) : (
              <Download color="#FFFFFF" size={19} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
      </View>

      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        {/* Hero do Álbum transparente sobre o AmbientGlowBackground */}
        <View style={styles.heroWrapper}>
          <View style={styles.coverShadow}>
            {displayCover ? (
              <Image
                source={{ uri: displayCover }}
                style={styles.coverImage}
                resizeMode="cover"
                accessibilityRole="image"
                accessibilityLabel={`Capa do álbum ${displayTitle}`}
              />
            ) : (
              <View style={styles.coverFallback}>
                <Disc color="#888888" size={48} />
              </View>
            )}
          </View>

          <Text style={styles.albumTitle} numberOfLines={2}>
            {displayTitle}
          </Text>
          <Text style={styles.albumArtist} numberOfLines={1}>
            {displayArtist}
          </Text>
          <Text style={styles.albumMeta} numberOfLines={1}>
            {metaParts.join(' • ')}
          </Text>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.playPill, tracks.length === 0 && styles.pillDisabled]}
              onPress={() => onPlayAll(tracks, 0, { shuffle: false })}
              disabled={tracks.length === 0}
              activeOpacity={0.82}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Tocar álbum ${displayTitle}`}
            >
              <Play color="#FFFFFF" fill="#FFFFFF" size={16} />
              <Text style={styles.playPillText}>Tocar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryPill, tracks.length === 0 && styles.pillDisabled]}
              onPress={() => onPlayAll(tracks, 0, { shuffle: true })}
              disabled={tracks.length === 0}
              activeOpacity={0.82}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Tocar álbum ${displayTitle} em modo aleatório`}
            >
              <Shuffle color="#FFFFFF" size={16} />
              <Text style={styles.secondaryPillText}>Aleatório</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Lista de Faixas */}
        <View style={styles.tracksSection}>
          {isLoading ? (
            <TrackRowSkeleton count={6} />
          ) : hasError || tracks.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                Não foi possível carregar as faixas deste lançamento.
              </Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => setRetryToken((t) => t + 1)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Tentar novamente carregar álbum"
              >
                <RefreshCw color="#FFFFFF" size={15} />
                <Text style={styles.retryBtnText}>Tentar novamente</Text>
              </TouchableOpacity>
            </View>
          ) : (
            tracks.map((track, idx) => {
              const rowDownloading = activeDownloadingItem?.track.id === track.id;
              return (
                <AlbumTrackRow
                  key={`${track.id}-${idx}`}
                  item={track}
                  index={idx}
                  isActive={currentActiveTrackId === track.id}
                  isPlaying={isPlaying}
                  isDownloaded={isTrackDownloaded(track.id)}
                  isDownloading={rowDownloading}
                  isQueued={queuedIds.has(track.id)}
                  downloadProgress={
                    rowDownloading
                      ? Math.round((activeDownloadingItem?.progress || 0) * 100)
                      : 0
                  }
                  onPress={handlePressTrack}
                  onOpenMenu={setMenuTrack}
                />
              );
            })
          )}
        </View>
      </Animated.ScrollView>

      {menuTrack && (
        <TrackContextSheet
          title={menuTrack.title}
          artist={menuTrack.artist}
          durationText={menuTrack.formattedDuration}
          isOfflineList={false}
          isDownloaded={menuTrackDownloaded}
          isDownloading={menuTrackDownloading}
          isQueued={menuTrackQueued}
          downloadProgress={
            menuTrackDownloading
              ? Math.round((activeDownloadingItem?.progress || 0) * 100)
              : 0
          }
          onClose={() => setMenuTrack(null)}
          onPress={() => {
            const idx = tracks.findIndex((t) => t.id === menuTrack.id);
            handlePressTrack(menuTrack, idx >= 0 ? idx : 0);
          }}
          onPlayNext={onPlayNext ? () => onPlayNext(menuTrack) : undefined}
          onAddToQueue={onAddToQueue ? () => onAddToQueue(menuTrack) : undefined}
          onAddToPlaylist={onAddToPlaylist ? () => onAddToPlaylist(menuTrack) : undefined}
          onDownload={onDownloadTrack ? () => onDownloadTrack(menuTrack) : undefined}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  glowBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: GLOW_BACKDROP_HEIGHT,
    overflow: 'hidden',
    zIndex: 0,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: ANDROID_STATUS_BAR_HEIGHT + 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  topBarScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#030303',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  circleTopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadProgressPill: {
    height: 36,
    minWidth: 56,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  downloadCounterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  topBarTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  topBarSpacer: {
    width: 40,
    height: 40,
  },
  scrollView: {
    flex: 1,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: 'transparent',
  },
  heroWrapper: {
    paddingTop: ANDROID_STATUS_BAR_HEIGHT + 64,
    paddingBottom: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  coverShadow: {
    width: 184,
    height: 184,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#181818',
    marginBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 12,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#181818',
  },
  albumTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  albumArtist: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  albumMeta: {
    color: '#AAAAAA',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    width: '100%',
    maxWidth: 360,
  },
  playPill: {
    flex: 1,
    height: 42,
    borderRadius: 9999,
    backgroundColor: theme.colors.brandPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playPillText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryPill: {
    flex: 1,
    height: 42,
    borderRadius: 9999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryPillText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  pillDisabled: {
    opacity: 0.45,
  },
  tracksSection: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  trackRowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  trackIndexCell: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  trackIndexText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '600',
  },
  trackTitleActive: {
    color: theme.colors.brandPrimary,
    fontWeight: '700',
  },
  trackMetaRow: {
    marginTop: 2,
  },
  trackSubtitle: {
    color: '#AAAAAA',
    fontSize: 12.5,
  },
  trackDuration: {
    color: '#AAAAAA',
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
    marginRight: 4,
  },
  statusIndicator: {
    marginRight: 4,
  },
  queuedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 4,
  },
  queuedPillText: {
    color: '#AAAAAA',
    fontSize: 11,
    fontWeight: '600',
  },
  moreTrackBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 14,
  },
  emptyText: {
    color: '#AAAAAA',
    fontSize: 14,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 9999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
});

export default AlbumDetailView;
