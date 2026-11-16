import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Globe,
  Heart,
  ListMusic,
  MoreVertical,
  Pause,
  Play,
} from 'lucide-react-native';
import {
  deletePlaylist,
  getCachedPlaylistById,
  getPlaylistById,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistTrackItem,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  updatePlaylist,
} from '../services/database';
import {
  deletePlaylistCover,
  enqueuePlaylistDownload,
  PickedCoverAsset,
  pickPlaylistCoverFromGallery,
  savePlaylistCover,
  subscribeDownloadQueue,
  DownloadQueueItem,
} from '../services/storage';
import { TrackSummary } from '../services/api';
import { TrackContextSheet } from './TrackCard';
import { PlayingEqualizer } from './PlayingEqualizer';
import { MarqueeText } from './MarqueeText';
import { SearchPillInput } from './SearchBarSection';
import { AmbientGlowBackground } from './AmbientGlowBackground';
import { AtmosphericGradient } from './AtmosphericGradient';
import { FavoritesRubyBadge } from './LibrarySection';
import { PlaylistCover } from './PlaylistCover';
import { PlaylistOptionsSheet } from './PlaylistOptionsSheet';
import { EditPlaylistModal, EditPlaylistSavePayload } from './EditPlaylistModal';
import { CoverCropModal } from './CoverCropModal';
import { scheduleNextFrame } from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_SIZE = Math.min(SCREEN_WIDTH * 0.48, 200);
const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
const GLOW_BACKDROP_HEIGHT = ANDROID_STATUS_BAR_HEIGHT + 470;
const AnimatedFlatList =
  Animated.FlatList || Animated.createAnimatedComponent(FlatList);

export interface PlaylistDetailModalProps {
  visible: boolean;
  onClose: () => void;
  playlistId: string | null;
  initialPlaylist?: PlaylistSummary | null;
  currentActiveTrackId?: string;
  isPlaying?: boolean;
  downloadedTrackIds?: Set<string>;
  onPlayTrack: (
    track: PlaylistTrackItem,
    index: number,
    allTracks: PlaylistTrackItem[]
  ) => void;
  onPlayAll: (allTracks: PlaylistTrackItem[]) => void;
  onPlayNext?: (track: TrackSummary) => void;
  onAddToQueue?: (track: TrackSummary) => void;
  onAddToPlaylist?: (track: TrackSummary) => void;
  onDownloadTrack?: (track: TrackSummary) => void;
  onPlaylistUpdated?: () => void;
  onPlaylistDeleted?: (playlistId: string) => void;
}

function formatSeconds(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatTotalDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 min';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} h ${mins} min`;
  }
  return `${mins} min`;
}

interface PlaylistTrackRowProps {
  item: PlaylistTrackItem;
  index: number;
  totalTracks: number;
  isActive: boolean;
  isPlaying: boolean;
  isDownloaded: boolean;
  isReordering: boolean;
  onPressTrack: (item: PlaylistTrackItem, index: number) => void;
  onMoveTrack: (fromIndex: number, toIndex: number) => void;
  onOpenMenu: (item: PlaylistTrackItem, index: number) => void;
}

const PlaylistTrackRow = React.memo<PlaylistTrackRowProps>(
  ({
    item,
    index,
    totalTracks,
    isActive,
    isPlaying,
    isDownloaded,
    isReordering,
    onPressTrack,
    onMoveTrack,
    onOpenMenu,
  }) => {
    const isLast = index === totalTracks - 1;

    return (
      <TouchableOpacity
        style={[styles.trackCard, isActive && styles.trackCardActive]}
        onPress={() => onPressTrack(item, index)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Tocar ${item.title} de ${item.artist}`}
      >
        {/* Controles de Reordenação (visíveis apenas no modo Reordenar) */}
        {isReordering && (
          <View style={styles.reorderControls}>
            <TouchableOpacity
              style={[styles.reorderBtn, index === 0 && styles.reorderBtnDisabled]}
              onPress={() => onMoveTrack(index, index - 1)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel={`Mover ${item.title} para cima`}
            >
              <ChevronUp color={index === 0 ? '#444444' : '#FFFFFF'} size={18} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reorderBtn, isLast && styles.reorderBtnDisabled]}
              onPress={() => onMoveTrack(index, index + 1)}
              disabled={isLast}
              accessibilityRole="button"
              accessibilityLabel={`Mover ${item.title} para baixo`}
            >
              <ChevronDown color={isLast ? '#444444' : '#FFFFFF'} size={18} />
            </TouchableOpacity>
          </View>
        )}

        {/* Capa da Música (Token track-card: 4px) */}
        <View style={styles.trackThumbnailContainer}>
          <Image source={{ uri: item.thumbnailUrl }} style={styles.trackThumbnail} />
          {isActive && <PlayingEqualizer isPlaying={isPlaying} />}
        </View>

        {/* Informações da Música */}
        <View style={styles.trackInfo}>
          <MarqueeText
            active={isActive}
            style={[styles.trackTitle, isActive && styles.trackTitleActive]}
          >
            {item.title}
          </MarqueeText>
          <View style={styles.trackMetaRow}>
            {isDownloaded ? (
              <View style={styles.downloadBadge}>
                <CheckCircle2 color="#2BA640" size={13} />
                <Text style={styles.downloadBadgeText}>Baixada</Text>
              </View>
            ) : (
              <View style={styles.streamBadge}>
                <Globe color="#AAAAAA" size={13} />
                <Text style={styles.streamBadgeText}>Stream</Text>
              </View>
            )}
            <MarqueeText
              active={isActive}
              containerStyle={styles.trackArtistMarqueeContainer}
              style={styles.trackArtist}
            >
              {`• ${item.artist} • ${formatSeconds(item.duration)}`}
            </MarqueeText>
          </View>
        </View>

        {/* Botão Menu Contextual 3-pontinhos (mesma experiência da aba Baixadas) */}
        <View collapsable={false}>
          <TouchableOpacity
            style={styles.removeTrackButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              onOpenMenu(item, index);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Mais opções para ${item.title}`}
          >
            <MoreVertical color="#AAAAAA" size={20} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }
);

export const PlaylistDetailModal: React.FC<PlaylistDetailModalProps> = ({
  visible,
  onClose,
  playlistId,
  initialPlaylist,
  currentActiveTrackId,
  isPlaying,
  downloadedTrackIds,
  onPlayTrack,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onDownloadTrack,
  onPlaylistUpdated,
  onPlaylistDeleted,
}) => {
  const initialCached =
    visible && playlistId ? getCachedPlaylistById(playlistId) : null;
  const hasInitialPreview = Boolean(
    visible && playlistId && initialPlaylist && initialPlaylist.id === playlistId
  );

  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(() => {
    if (initialCached) return initialCached;
    if (hasInitialPreview && initialPlaylist) {
      return {
        ...initialPlaylist,
        tracks: [],
        createdAt: 0,
        updatedAt: 0,
      };
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(
    () => !initialCached && !hasInitialPreview
  );
  const [showOptionsSheet, setShowOptionsSheet] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [pendingCropAsset, setPendingCropAsset] = useState<PickedCoverAsset | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isReordering, setIsReordering] = useState<boolean>(false);
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([]);
  const [menuItem, setMenuItem] = useState<{
    track: PlaylistTrackItem;
    index: number;
  } | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(14)).current;
  const contentFadeRef = useRef<Animated.CompositeAnimation | null>(null);
  const isClosingRef = useRef(false);
  const playlistRef = useRef<PlaylistDetail | null>(playlist);
  playlistRef.current = playlist;

  useEffect(() => {
    const unsubscribe = subscribeDownloadQueue((q) => {
      setDownloadQueue(q);
    });
    return () => unsubscribe();
  }, []);

  const loadDetails = async (silent = false) => {
    if (!playlistId) return;
    try {
      if (!silent) {
        setIsLoading(true);
      }
      const data = await getPlaylistById(playlistId);
      setPlaylist(data);
    } catch (err) {
      console.error('[PlaylistDetailModal] Falha ao carregar detalhes:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    scrollY.setValue(0);
    contentFadeRef.current?.stop();
    isClosingRef.current = false;
    if (visible && playlistId) {
      setShowOptionsSheet(false);
      setShowEditModal(false);
      setPendingCropAsset(null);
      setIsReordering(false);
      setSearchQuery('');
      setMenuItem(null);
      contentOpacity.setValue(0);
      contentTranslateY.setValue(14);
      const cached = getCachedPlaylistById(playlistId);
      if (cached) {
        setPlaylist(cached);
        setIsLoading(false);
      } else {
        const hasPreview = initialPlaylist && initialPlaylist.id === playlistId;
        if (hasPreview) {
          setPlaylist({
            ...initialPlaylist,
            tracks: [],
            createdAt: 0,
            updatedAt: 0,
          });
          setIsLoading(false);
          loadDetails(true);
        } else {
          loadDetails(false);
        }
      }
    } else {
      contentOpacity.setValue(0);
      contentTranslateY.setValue(14);
      setMenuItem(null);
      setPlaylist(null);
    }
    return () => {
      contentFadeRef.current?.stop();
    };
  }, [visible, playlistId]);

  useEffect(() => {
    if (!isLoading && visible && !isClosingRef.current) {
      contentFadeRef.current?.stop();
      const cancel = scheduleNextFrame(() => {
        if (isClosingRef.current) return;
        const easing = getEaseOutCubic(Easing);
        const anim = Animated.parallel([
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: theme.transitions.screenInMs,
            easing,
            useNativeDriver: true,
          }),
          Animated.timing(contentTranslateY, {
            toValue: 0,
            duration: theme.transitions.sheetInMs,
            easing,
            useNativeDriver: true,
          }),
        ]);
        contentFadeRef.current = anim;
        anim.start();
      });
      return cancel;
    }
  }, [isLoading, playlist?.id, visible, contentOpacity, contentTranslateY]);

  const handleClose = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    contentFadeRef.current?.stop();
    const anim = Animated.timing(contentOpacity, {
      toValue: 0,
      duration: theme.transitions.screenOutMs,
      easing: getEaseOutCubic(Easing),
      useNativeDriver: true,
    });
    contentFadeRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) {
        onClose();
      } else {
        isClosingRef.current = false;
      }
    });
  };

  const handleMoveTrack = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const current = playlistRef.current;
      if (
        !current ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.tracks.length ||
        toIndex >= current.tracks.length
      ) {
        return;
      }
      const newTracks = [...current.tracks];
      const [moved] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, moved);
      setPlaylist({ ...current, tracks: newTracks });

      const orderedTrackIds = newTracks.map((t) => t.trackId);
      try {
        await reorderPlaylistTracks(current.id, orderedTrackIds);
        onPlaylistUpdated?.();
      } catch (err) {
        console.error('[PlaylistDetailModal] Falha ao reordenar faixas:', err);
        await loadDetails();
      }
    },
    [onPlaylistUpdated]
  );

  const handlePressTrack = useCallback(
    (item: PlaylistTrackItem, index: number) => {
      const current = playlistRef.current;
      if (current) {
        onPlayTrack(item, index, current.tracks);
      }
    },
    [onPlayTrack]
  );

  const handleOpenTrackMenu = useCallback(
    (track: PlaylistTrackItem, index: number) => {
      setMenuItem({ track, index });
    },
    []
  );

  const handleDownloadAll = () => {
    if (!playlist || playlist.tracks.length === 0) return;
    const summaries: TrackSummary[] = playlist.tracks.map((t) => ({
      id: t.trackId,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      formattedDuration: formatSeconds(t.duration),
      thumbnailUrl: t.thumbnailUrl,
    }));
    enqueuePlaylistDownload(summaries);
  };

  const handlePickCustomCover = async () => {
    if (!playlist || playlist.isSystem) return;
    try {
      const pickedAsset = await pickPlaylistCoverFromGallery();
      if (!pickedAsset) return;
      setPendingCropAsset(pickedAsset);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Não foi possível abrir a galeria para escolher uma capa.';
      Alert.alert('Capa da playlist', message);
    }
  };

  const handleConfirmCroppedCover = async (croppedUri: string) => {
    if (!playlist || playlist.isSystem) {
      setPendingCropAsset(null);
      return;
    }
    try {
      const savedUri = await savePlaylistCover(playlist.id, croppedUri);
      await updatePlaylist(
        playlist.id,
        playlist.name,
        playlist.description ?? undefined,
        savedUri
      );
      setPendingCropAsset(null);
      await loadDetails(true);
      onPlaylistUpdated?.();
    } catch (err) {
      setPendingCropAsset(null);
      const message =
        err instanceof Error
          ? err.message
          : 'Não foi possível atualizar a capa da playlist.';
      Alert.alert('Capa da playlist', message);
    }
  };

  const handleResetCustomCover = async () => {
    if (!playlist || playlist.isSystem) return;
    const prevCustomCover = playlist.hasCustomCover ? playlist.thumbnailUrl : null;
    try {
      await updatePlaylist(
        playlist.id,
        playlist.name,
        playlist.description ?? undefined,
        null
      );
      await deletePlaylistCover(prevCustomCover);
      await loadDetails(true);
      onPlaylistUpdated?.();
    } catch (err) {
      console.error('[PlaylistDetailModal] Falha ao restaurar capa automática:', err);
    }
  };

  const handleSaveDetails = async (payload: EditPlaylistSavePayload) => {
    if (!playlist) return;
    const prevCustomCover = playlist.hasCustomCover ? playlist.thumbnailUrl : null;
    let nextThumbnailUrl: string | null | undefined = undefined;

    if (payload.customCoverSourceUri) {
      nextThumbnailUrl = await savePlaylistCover(
        playlist.id,
        payload.customCoverSourceUri
      );
    } else if (payload.resetCustomCover) {
      nextThumbnailUrl = null;
    }

    await updatePlaylist(
      playlist.id,
      payload.name,
      payload.description,
      nextThumbnailUrl
    );
    if (payload.resetCustomCover && prevCustomCover) {
      await deletePlaylistCover(prevCustomCover);
    }
    await loadDetails(true);
    onPlaylistUpdated?.();
  };

  const handleDelete = () => {
    if (!playlist || playlist.isSystem) return;

    Alert.alert(
      'Excluir playlist',
      `Tem certeza que deseja excluir "${playlist.name}"? As músicas não serão apagadas do seu dispositivo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              const prevCover = playlist.hasCustomCover
                ? playlist.thumbnailUrl
                : null;
              await deletePlaylist(playlist.id);
              await deletePlaylistCover(prevCover);
              onPlaylistDeleted?.(playlist.id);
              onClose();
            } catch (err) {
              console.error('[PlaylistDetailModal] Falha ao excluir playlist:', err);
            }
          },
        },
      ]
    );
  };

  const handleRemoveTrack = async (trackId: string) => {
    if (!playlist) return;
    try {
      await removeTrackFromPlaylist(playlist.id, trackId);
      await loadDetails();
      onPlaylistUpdated?.();
    } catch (err) {
      console.error('[PlaylistDetailModal] Falha ao remover faixa da playlist:', err);
    }
  };

  const completedDownloadIds = useMemo(
    () =>
      new Set(
        downloadQueue
          .filter((item) => item.status === 'completed')
          .map((item) => item.track.id)
      ),
    [downloadQueue]
  );

  const isTrackDownloaded = useCallback(
    (track: PlaylistTrackItem): boolean => {
      const id = track.trackId || track.id;
      return Boolean(
        track.isDownloaded ||
          downloadedTrackIds?.has(id) ||
          completedDownloadIds.has(id)
      );
    },
    [downloadedTrackIds, completedDownloadIds]
  );

  const toTrackSummary = (track: PlaylistTrackItem): TrackSummary => ({
    id: track.trackId || track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    formattedDuration: formatSeconds(track.duration),
    thumbnailUrl: track.thumbnailUrl,
  });

  const playlistTrackIds = useMemo(
    () => new Set(playlist?.tracks.map((t) => t.trackId) || []),
    [playlist?.tracks]
  );
  const activeDownloadsForPlaylist = downloadQueue.filter((item) =>
    playlistTrackIds.has(item.track.id)
  );
  const pendingOrDownloading = activeDownloadsForPlaylist.filter(
    (item) => item.status === 'pending' || item.status === 'downloading'
  );
  const completedDownloadsForPlaylist = activeDownloadsForPlaylist.filter(
    (item) => item.status === 'completed'
  );

  const isDownloadingAll = pendingOrDownloading.length > 0;
  const downloadStatusText = isDownloadingAll
    ? `${completedDownloadsForPlaylist.length}/${activeDownloadsForPlaylist.length}`
    : 'Baixar';
  const glowTranslateY = scrollY.interpolate({
    inputRange: [0, GLOW_BACKDROP_HEIGHT],
    outputRange: [0, -GLOW_BACKDROP_HEIGHT],
    extrapolate: 'clamp',
  });
  const topBarScrimOpacity = scrollY.interpolate({
    inputRange: [0, 120],
    outputRange: [0, 0.92],
    extrapolate: 'clamp',
  });

  const displayedTracks = useMemo(
    () =>
      (playlist?.tracks || []).filter((t) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
      }),
    [playlist?.tracks, searchQuery]
  );

  const totalTracksCount = playlist?.tracks.length ?? 0;

  const renderTrackItem = useCallback(
    ({ item, index }: { item: PlaylistTrackItem; index: number }) => (
      <PlaylistTrackRow
        item={item}
        index={index}
        totalTracks={totalTracksCount}
        isActive={currentActiveTrackId === item.trackId}
        isPlaying={Boolean(isPlaying)}
        isDownloaded={isTrackDownloaded(item)}
        isReordering={isReordering}
        onPressTrack={handlePressTrack}
        onMoveTrack={handleMoveTrack}
        onOpenMenu={handleOpenTrackMenu}
      />
    ),
    [
      totalTracksCount,
      currentActiveTrackId,
      isPlaying,
      isTrackDownloaded,
      isReordering,
      handlePressTrack,
      handleMoveTrack,
      handleOpenTrackMenu,
    ]
  );

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.safeContainer,
        {
          opacity: contentOpacity,
          transform: [{ translateY: contentTranslateY }],
        },
      ]}
      testID="playlist-detail-transition"
    >
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent={true}
      />

      {/* Glow atmosférico contínuo do topo da tela (StatusBar + TopBar + Capa) */}
      {!isLoading && playlist && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glowBackdrop,
            { transform: [{ translateY: glowTranslateY }] },
          ]}
        >
          {!playlist.isSystem && playlist.thumbnailUrl ? (
            <AmbientGlowBackground
              artworkUri={playlist.thumbnailUrl}
              crossfadeDurationMs={theme.transitions.glowEntryMs}
            />
          ) : (
            <AtmosphericGradient height={GLOW_BACKDROP_HEIGHT} />
          )}
        </Animated.View>
      )}

      {/* Top Navigation Bar transparente sobre o glow */}
      <View style={styles.topBar}>
          <Animated.View
            pointerEvents="none"
            style={[styles.topBarScrim, { opacity: topBarScrimOpacity }]}
          />
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <ArrowLeft color="#FFFFFF" size={24} />
          </TouchableOpacity>

          <Text style={styles.topBarTitle} numberOfLines={1}>
            {playlist?.name || 'Playlist'}
          </Text>

          {playlist && !playlist.isSystem ? (
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => setShowOptionsSheet(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Mais opções da playlist"
            >
              <MoreVertical color="#FFFFFF" size={22} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        {isLoading ? null : playlist ? (
          <View style={styles.listFadeWrap}>
            <AnimatedFlatList
            style={styles.list}
            data={displayedTracks}
            keyExtractor={(item) => item.trackId}
            showsVerticalScrollIndicator={false}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { y: scrollY } } }],
              { useNativeDriver: true }
            )}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View style={styles.headerContainer}>
                <View style={styles.headerForeground}>
                  {/* Capa da Playlist 1:1 (customizada, colagem 2x2 com 4+ faixas, ou 1ª faixa) */}
                  {playlist.isSystem ? (
                    <View style={styles.coverWrapper}>
                      <FavoritesRubyBadge
                        iconSize={68}
                        style={styles.favoritesCover}
                      />
                    </View>
                  ) : (
                    <PlaylistCover
                      thumbnailUrl={playlist.thumbnailUrl}
                      hasCustomCover={playlist.hasCustomCover}
                      coverThumbnails={playlist.coverThumbnails}
                      size={COVER_SIZE}
                      borderRadius={12}
                      iconSize={64}
                      placeholderColor="#AAAAAA"
                      style={styles.coverWrapper}
                    />
                  )}

                  {/* Exibição de Informações */}
                  <View style={styles.infoSection}>
                    <Text style={styles.playlistName}>{playlist.name}</Text>
                    {playlist.description ? (
                      <Text style={styles.playlistDesc}>{playlist.description}</Text>
                    ) : null}
                    <Text style={styles.playlistMeta}>
                      {playlist.trackCount}{' '}
                      {playlist.trackCount === 1 ? 'música' : 'músicas'} •{' '}
                      {formatTotalDuration(playlist.totalDuration)}
                    </Text>
                  </View>

                  {/* Nova Barra de Ações em 1 Única Linha Centralizada */}
                  <View style={styles.actionsBar}>
                    {playlist.tracks.length > 0 && (
                      <TouchableOpacity
                        style={[
                          styles.circleActionItem,
                          isDownloadingAll && styles.circleActionDisabled,
                        ]}
                        onPress={handleDownloadAll}
                        disabled={isDownloadingAll}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Baixar todas as músicas da playlist"
                      >
                        <View style={styles.circleActionButton}>
                          <Download color="#FFFFFF" size={18} />
                        </View>
                        <Text style={styles.circleActionLabel} numberOfLines={1}>
                          {downloadStatusText}
                        </Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.playAllButton,
                        playlist.tracks.length === 0 && styles.playAllButtonDisabled,
                      ]}
                      onPress={() => onPlayAll(playlist.tracks)}
                      disabled={playlist.tracks.length === 0}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel="Tocar todas as músicas da playlist"
                    >
                      <Play color="#000000" fill="#000000" size={18} />
                      <Text style={styles.playAllText}>Tocar</Text>
                    </TouchableOpacity>

                    {playlist.tracks.length > 1 && (
                      <TouchableOpacity
                        style={styles.circleActionItem}
                        onPress={() => setIsReordering((prev) => !prev)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Modo reordenar faixas"
                      >
                        <View
                          style={[
                            styles.circleActionButton,
                            isReordering && styles.circleActionButtonActive,
                          ]}
                        >
                          <ArrowUpDown
                            color={isReordering ? '#000000' : '#FFFFFF'}
                            size={18}
                          />
                        </View>
                        <Text
                          style={[
                            styles.circleActionLabel,
                            isReordering && styles.circleActionLabelActive,
                          ]}
                          numberOfLines={1}
                        >
                          {isReordering ? 'Concluir' : 'Ordenar'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Barra de Busca Interna da Playlist */}
                  {playlist.tracks.length > 0 && (
                    <SearchPillInput
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder="Buscar nesta playlist..."
                      accessibilityLabel="Buscar nesta playlist"
                      clearAccessibilityLabel="Limpar busca interna"
                    />
                  )}
                </View>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <ListMusic color="#717171" size={48} />
                <Text style={styles.emptyTitle}>
                  {searchQuery ? 'Nenhuma faixa encontrada' : 'Sua playlist está vazia'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {searchQuery
                    ? `Não foram encontrados resultados para "${searchQuery}".`
                    : 'Pesquise por músicas online ou navegue nas baixadas e adicione faixas aqui.'}
                </Text>
              </View>
            }
            renderItem={renderTrackItem}
            />
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Playlist não encontrada</Text>
          </View>
        )}

      {/* Menu Bottom Sheet Contextual da Faixa (montado sob demanda) */}
      {playlist && menuItem && (
        <TrackContextSheet
          title={menuItem.track.title}
          artist={menuItem.track.artist}
          durationText={formatSeconds(menuItem.track.duration)}
          isOfflineList={false}
          isDownloaded={isTrackDownloaded(menuItem.track)}
          onClose={() => setMenuItem(null)}
          onPress={() =>
            onPlayTrack(menuItem.track, menuItem.index, playlist.tracks)
          }
          onPlayNext={
            onPlayNext
              ? () => onPlayNext(toTrackSummary(menuItem.track))
              : undefined
          }
          onAddToQueue={
            onAddToQueue
              ? () => onAddToQueue(toTrackSummary(menuItem.track))
              : undefined
          }
          onAddToPlaylist={
            onAddToPlaylist
              ? () => onAddToPlaylist(toTrackSummary(menuItem.track))
              : undefined
          }
          onDownload={
            onDownloadTrack
              ? () => onDownloadTrack(toTrackSummary(menuItem.track))
              : undefined
          }
          onRemoveFromPlaylist={() =>
            handleRemoveTrack(menuItem.track.trackId)
          }
        />
      )}

      {/* Bottom Sheet de opções da playlist */}
      <PlaylistOptionsSheet
        visible={showOptionsSheet}
        playlist={playlist}
        isReordering={isReordering}
        isDownloadingAll={isDownloadingAll}
        onClose={() => setShowOptionsSheet(false)}
        onPickCustomCover={handlePickCustomCover}
        onResetCustomCover={handleResetCustomCover}
        onEditDetails={() => setShowEditModal(true)}
        onToggleReorder={() => setIsReordering((prev) => !prev)}
        onDownloadAll={handleDownloadAll}
        onDeletePlaylist={handleDelete}
      />

      {/* Modal dedicado para editar nome, descrição e capa */}
      <EditPlaylistModal
        visible={showEditModal}
        playlist={playlist}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveDetails}
      />

      {/* Studio 1:1 integrado do Sonary para recortar capa da galeria */}
      <CoverCropModal
        visible={Boolean(pendingCropAsset)}
        asset={pendingCropAsset}
        onCancel={() => setPendingCropAsset(null)}
        onConfirm={handleConfirmCroppedCover}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#030303',
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
    position: 'relative',
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUS_BAR_HEIGHT + 8 : 10,
    paddingBottom: 10,
    backgroundColor: 'transparent',
  },
  topBarScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#030303',
  },
  backButton: {
    padding: 6,
  },
  topBarTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  menuButton: {
    padding: 6,
  },
  listFadeWrap: {
    flex: 1,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  list: {
    flex: 1,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  listContent: {
    paddingBottom: 156,
    backgroundColor: 'transparent',
  },
  headerContainer: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  headerForeground: {
    width: '100%',
    alignItems: 'center',
    zIndex: 1,
  },
  coverWrapper: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    aspectRatio: 1,
    flexShrink: 0,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 16,
  },
  favoritesCover: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoSection: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  playlistName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  playlistDesc: {
    color: '#AAAAAA',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 16,
  },
  playlistMeta: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 6,
    fontWeight: '500',
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 16,
  },
  circleActionItem: {
    alignItems: 'center',
    minWidth: 52,
  },
  circleActionDisabled: {
    opacity: 0.45,
  },
  circleActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleActionButtonActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  circleActionLabel: {
    color: '#AAAAAA',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
  circleActionLabelActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  playAllButton: {
    height: 46,
    minWidth: 144,
    paddingHorizontal: 24,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  playAllButtonDisabled: {
    backgroundColor: '#FFFFFF',
    opacity: 0.4,
  },
  playAllText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  reorderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    gap: 4,
  },
  reorderBtn: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  reorderBtnDisabled: {
    opacity: 0.3,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#AAAAAA',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  trackCardActive: {
    backgroundColor: '#141414',
  },
  trackThumbnailContainer: {
    width: 44,
    height: 44,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#1E1E1E',
    marginRight: 12,
    position: 'relative',
  },
  trackThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#1E1E1E',
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  trackTitleActive: {
    color: theme.colors.brandPrimary,
    fontWeight: '700',
  },
  trackMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  downloadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  downloadBadgeText: {
    color: '#2BA640',
    fontSize: 11,
    fontWeight: '500',
  },
  streamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  streamBadgeText: {
    color: '#AAAAAA',
    fontSize: 11,
    fontWeight: '500',
  },
  trackArtistMarqueeContainer: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  trackArtist: {
    color: '#AAAAAA',
    fontSize: 11,
  },
  removeTrackButton: {
    padding: 8,
    marginLeft: 4,
    marginRight: -8,
  },
});
