import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Clock,
  Disc,
  MoreVertical,
  Music2,
  Play,
  Radio,
  RefreshCw,
  Shuffle,
  User,
} from 'lucide-react-native';
import {
  ArtistAlbumSummary,
  ArtistProfile,
  ArtistSearchResult,
  getArtistProfile,
  getArtistTopTracks,
  TrackSummary,
} from '../services/api';
import { DownloadQueueItem, subscribeDownloadQueue } from '../services/storage';
import { BACK_PRIORITY, useBackHandler, useBackModalLock } from '../services/backNavigation';
import { AlbumDetailView } from './AlbumDetailView';
import { CircularDownloadProgress, TrackContextSheet } from './TrackCard';
import { PlayingEqualizer } from './PlayingEqualizer';
import { DownloadedTrackBadge, MarqueeText, TrackMetaRow } from './MarqueeText';
import { TrackRowSkeleton } from './TrackRowSkeleton';
import { CardSkeleton } from './CardSkeleton';
import { Skeleton } from './Skeleton';
import { ToastBanner, ToastVariant } from './ToastBanner';
import { SHEET_ENTER_MS, scheduleNextFrame, useModalEnterAnimation } from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';

const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
const HERO_HEIGHT = 316 + ANDROID_STATUS_BAR_HEIGHT;
const INITIAL_VISIBLE_POPULAR = 5;

export interface ArtistProfileModalProps {
  visible: boolean;
  onClose: () => void;
  artistName: string;
  channelId?: string;
  initialProfile?: ArtistProfile | null;
  initialAvatarUrl?: string;
  initialSubtitle?: string;
  presentation?: 'inline' | 'modal';
  currentActiveTrackId?: string;
  isPlaying?: boolean;
  isLoadingRadio?: boolean;
  downloadedTrackIds?: Set<string>;
  onPlayTrack: (track: TrackSummary, index?: number) => void;
  onPlayAll?: (
    tracks: TrackSummary[],
    startIndex?: number,
    options?: { shuffle?: boolean }
  ) => void;
  onPlayNext?: (track: TrackSummary) => void;
  onAddToQueue?: (track: TrackSummary) => void;
  onAddToPlaylist?: (track: TrackSummary) => void;
  onDownloadTrack?: (track: TrackSummary) => void;
  onStartArtistRadio: (artistName: string, channelId?: string) => void;
  onSelectRelatedArtist?: (artist: ArtistSearchResult) => void;
  onShowToast?: (message: string, variant?: ToastVariant) => void;
  toastMessage?: string | null;
  toastVariant?: ToastVariant;
  onDismissToast?: () => void;
}

interface PopularTrackRowProps {
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

const PopularTrackRow = memo<PopularTrackRowProps>(
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
    const subtitleText = item.album || item.artist;

    return (
      <TouchableOpacity
        style={[styles.trackRow, isActive && styles.trackRowActive]}
        onPress={() => onPress(item, index)}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={`Tocar ${item.title}`}
      >
        <View style={styles.trackThumbWrapper}>
          {item.thumbnailUrl ? (
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.trackThumb}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.trackThumbFallback}>
              <Music2 color="#777777" size={18} />
            </View>
          )}
          {isActive && <PlayingEqualizer isPlaying={isPlaying} />}
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
            artistText={subtitleText}
            textStyle={styles.trackSub}
          />
        </View>

        {isDownloading ? (
          <View style={styles.downloadingBadge} accessibilityLabel="Baixando música">
            <CircularDownloadProgress progress={downloadProgress} />
          </View>
        ) : isQueued && !isDownloaded ? (
          <View style={styles.queuedBadge} accessibilityLabel="Na fila de downloads">
            <Clock color="#AAAAAA" size={12} />
            <Text style={styles.queuedBadgeText}>Na fila</Text>
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

function normalizeArtistKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,'"`’\-–—_/\\()[\]&+!?]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeHeroSubtitle(
  profile: ArtistProfile | null,
  fallbackSubtitle?: string
): string {
  if (profile?.subtitle && profile.subtitle.trim()) {
    return profile.subtitle.trim();
  }
  const detail =
    profile?.monthlyListenersText &&
    profile.monthlyListenersText.toLowerCase() !== 'artista' &&
    profile.monthlyListenersText.toLowerCase() !== 'artista no sonary'
      ? profile.monthlyListenersText
      : profile?.subscriberCountText &&
          profile.subscriberCountText.toLowerCase() !== 'artista verificado'
        ? profile.subscriberCountText
        : fallbackSubtitle
          ? fallbackSubtitle.replace(/^artista\s*[•·-]\s*/i, '').trim()
          : '';
  return detail ? `Artista • ${detail}` : 'Artista';
}

export function ArtistProfileModal({
  visible,
  onClose,
  artistName,
  channelId,
  initialProfile,
  initialAvatarUrl,
  initialSubtitle,
  presentation = 'modal',
  currentActiveTrackId,
  isPlaying = false,
  isLoadingRadio = false,
  downloadedTrackIds,
  onPlayTrack,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onDownloadTrack,
  onStartArtistRadio,
  onSelectRelatedArtist,
  onShowToast,
  toastMessage = null,
  toastVariant = 'success',
  onDismissToast,
}: ArtistProfileModalProps) {
  const isInline = presentation === 'inline';

  const [overrideArtist, setOverrideArtist] = useState<{
    name: string;
    channelId?: string;
    avatarUrl?: string;
    subtitle?: string;
  } | null>(null);

  const activeArtist = overrideArtist ?? {
    name: artistName,
    channelId,
    avatarUrl: initialAvatarUrl,
    subtitle: initialSubtitle,
  };

  const [profile, setProfile] = useState<ArtistProfile | null>(initialProfile || null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [retryToken, setRetryToken] = useState<number>(0);

  const [showAllPopular, setShowAllPopular] = useState<boolean>(false);
  const [expandedTracks, setExpandedTracks] = useState<TrackSummary[] | null>(null);
  const [expandedFetchAttempted, setExpandedFetchAttempted] = useState<boolean>(false);
  const [isLoadingAllPopular, setIsLoadingAllPopular] = useState<boolean>(false);
  const [isBioExpanded, setIsBioExpanded] = useState<boolean>(false);

  const [selectedRelease, setSelectedRelease] = useState<ArtistAlbumSummary | null>(null);
  const [menuTrack, setMenuTrack] = useState<TrackSummary | null>(null);
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([]);

  useEffect(() => {
    setOverrideArtist(null);
    setSelectedRelease(null);
    setShowAllPopular(false);
    setExpandedTracks(null);
    setExpandedFetchAttempted(false);
    setIsBioExpanded(false);
    setRetryToken(0);
  }, [artistName, channelId, initialAvatarUrl, initialSubtitle]);

  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalTranslateY = useRef(new Animated.Value(isInline ? 14 : 18)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const isMountedRef = useRef(true);
  const activeArtistKey = `${activeArtist.name}::${activeArtist.channelId || ''}`;
  const activeArtistKeyRef = useRef(activeArtistKey);
  activeArtistKeyRef.current = activeArtistKey;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useBackModalLock(!isInline && visible);

  useBackHandler(
    isInline && visible && !selectedRelease && !menuTrack,
    () => {
      onClose();
      return true;
    },
    BACK_PRIORITY.SUBSCREEN_MODE + 2
  );

  // Animação de entrada no modo modal (compatível com testes legados)
  const { onModalShow } = useModalEnterAnimation({
    visible: !isInline && visible,
    onReset: () => {
      modalOpacity.setValue(0);
      modalTranslateY.setValue(18);
    },
    onAnimateIn: () => {
      const easeOut = getEaseOutCubic(Easing);
      const anim = Animated.parallel([
        Animated.timing(modalOpacity, {
          toValue: 1,
          duration: SHEET_ENTER_MS,
          easing: easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(modalTranslateY, {
          toValue: 0,
          duration: SHEET_ENTER_MS,
          easing: easeOut,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
      return anim;
    },
  });

  // Animação de entrada no modo inline (alinhada ao PlaylistDetailModal)
  useEffect(() => {
    if (!isInline || !visible) return;
    modalOpacity.setValue(0);
    modalTranslateY.setValue(14);
    let anim: Animated.CompositeAnimation | null = null;
    const cancelFrame = scheduleNextFrame(() => {
      const easeOut = getEaseOutCubic(Easing);
      anim = Animated.parallel([
        Animated.timing(modalOpacity, {
          toValue: 1,
          duration: theme.transitions.screenInMs,
          easing: easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(modalTranslateY, {
          toValue: 0,
          duration: theme.transitions.screenInMs,
          easing: easeOut,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
    });
    return () => {
      cancelFrame();
      anim?.stop();
    };
  }, [isInline, visible, activeArtist.name, activeArtist.channelId, modalOpacity, modalTranslateY]);

  useEffect(() => {
    if (!visible) return;
    return subscribeDownloadQueue(setDownloadQueue);
  }, [visible]);

  useEffect(() => {
    if (!visible || !activeArtist.name) return;

    const cleanTarget = normalizeArtistKey(
      activeArtist.name.split(/,|feat\.|ft\.|&/i)[0]
    );
    const initialMatches = Boolean(
      initialProfile &&
        activeArtist.name === artistName &&
        ((activeArtist.channelId &&
          initialProfile.channelId &&
          activeArtist.channelId === initialProfile.channelId) ||
          normalizeArtistKey(initialProfile.name) === cleanTarget)
    );

    if (retryToken === 0 && initialMatches && initialProfile) {
      setProfile(initialProfile);
      setExpandedTracks(null);
      setExpandedFetchAttempted(false);
      setHasError(false);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    setProfile(null);
    setExpandedTracks(null);
    setExpandedFetchAttempted(false);
    setHasError(false);
    setIsLoading(true);
    scrollY.setValue(0);

    getArtistProfile(activeArtist.name, activeArtist.channelId)
      .then((res) => {
        if (!isCancelled) {
          setProfile(res);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setHasError(true);
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    visible,
    activeArtist.name,
    activeArtist.channelId,
    artistName,
    initialProfile,
    retryToken,
    scrollY,
  ]);

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

  const allTopTracks = useMemo(
    () => expandedTracks || profile?.topTracks || [],
    [expandedTracks, profile?.topTracks]
  );

  const visibleTopTracks = useMemo(
    () =>
      showAllPopular
        ? allTopTracks
        : allTopTracks.slice(0, INITIAL_VISIBLE_POPULAR),
    [allTopTracks, showAllPopular]
  );

  const canToggleShowAll =
    allTopTracks.length > INITIAL_VISIBLE_POPULAR ||
    Boolean(
      profile?.songsBrowseId &&
        !expandedTracks &&
        !expandedFetchAttempted &&
        allTopTracks.length >= INITIAL_VISIBLE_POPULAR
    );

  const handleToggleShowAllPopular = useCallback(async () => {
    if (showAllPopular) {
      setShowAllPopular(false);
      return;
    }
    setShowAllPopular(true);

    if (
      profile?.songsBrowseId &&
      !expandedTracks &&
      !expandedFetchAttempted &&
      allTopTracks.length <= INITIAL_VISIBLE_POPULAR
    ) {
      const requestKey = activeArtistKeyRef.current;
      setIsLoadingAllPopular(true);
      try {
        const full = await getArtistTopTracks(
          profile.songsBrowseId,
          profile.songsBrowseParams,
          profile.name
        );
        if (!isMountedRef.current || activeArtistKeyRef.current !== requestKey) {
          return;
        }
        setExpandedFetchAttempted(true);
        if (full.length > 0) {
          setExpandedTracks(full);
        }
      } finally {
        if (isMountedRef.current && activeArtistKeyRef.current === requestKey) {
          setIsLoadingAllPopular(false);
        }
      }
    }
  }, [showAllPopular, profile, expandedTracks, expandedFetchAttempted, allTopTracks.length]);

  const handlePlayCollection = useCallback(
    (
      tracks: TrackSummary[],
      startIndex: number = 0,
      options?: { shuffle?: boolean }
    ) => {
      if (!tracks || tracks.length === 0) return;
      if (onPlayAll) {
        onPlayAll(tracks, startIndex, options);
      } else {
        const target = tracks[startIndex] || tracks[0];
        if (target) onPlayTrack(target, startIndex);
      }
    },
    [onPlayAll, onPlayTrack]
  );

  const handlePressPopularTrack = useCallback(
    (track: TrackSummary, index: number) => {
      if (onPlayAll) {
        onPlayAll(allTopTracks, index, { shuffle: false });
      } else {
        onPlayTrack(track, index);
      }
    },
    [onPlayAll, onPlayTrack, allTopTracks]
  );

  const handlePressRelatedArtist = useCallback(
    (related: ArtistSearchResult) => {
      if (onSelectRelatedArtist) {
        onSelectRelatedArtist(related);
        return;
      }
      setSelectedRelease(null);
      setShowAllPopular(false);
      setExpandedTracks(null);
      setExpandedFetchAttempted(false);
      setIsBioExpanded(false);
      setRetryToken(0);
      setOverrideArtist({
        name: related.name,
        channelId: related.id,
        avatarUrl: related.thumbnailUrl,
        subtitle: related.subtitle,
      });
    },
    [onSelectRelatedArtist]
  );

  const handleModalRequestClose = useCallback(() => {
    if (menuTrack) {
      setMenuTrack(null);
      return;
    }
    if (selectedRelease) {
      setSelectedRelease(null);
      return;
    }
    onClose();
  }, [menuTrack, selectedRelease, onClose]);

  if (!visible) return null;

  const displayName = profile?.name || activeArtist.name || 'Artista';
  const heroImageUri =
    profile?.bannerUrl || profile?.avatarUrl || activeArtist.avatarUrl || '';
  const heroSubtitle = normalizeHeroSubtitle(profile, activeArtist.subtitle);
  const albums = profile?.albums || [];
  const singles = profile?.singles || [];
  const relatedArtists = profile?.relatedArtists || [];
  const bottomPadding = isInline ? 168 : 48;

  const heroImageTranslateY = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [0, HERO_HEIGHT * 0.28],
    extrapolate: 'clamp',
  });
  const topBarScrimOpacity = scrollY.interpolate({
    inputRange: [HERO_HEIGHT - 130, HERO_HEIGHT - 40],
    outputRange: [0, 0.96],
    extrapolate: 'clamp',
  });
  const topBarTitleOpacity = scrollY.interpolate({
    inputRange: [HERO_HEIGHT - 100, HERO_HEIGHT - 30],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const menuTrackDownloaded = menuTrack ? isTrackDownloaded(menuTrack.id) : false;
  const menuTrackDownloading = Boolean(
    menuTrack && activeDownloadingItem?.track.id === menuTrack.id
  );
  const menuTrackQueued = Boolean(menuTrack && queuedIds.has(menuTrack.id));

  const renderReleaseCarousel = (
    title: string,
    items: ArtistAlbumSummary[],
    sectionTestId: string
  ) => {
    if (items.length === 0) return null;
    return (
      <View style={styles.sectionBlock} testID={sectionTestId}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContent}
        >
          {items.map((release, idx) => (
            <TouchableOpacity
              key={`${release.browseId}-${idx}`}
              style={styles.releaseCard}
              onPress={() => setSelectedRelease(release)}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityLabel={`Abrir ${release.title}`}
            >
              {release.thumbnailUrl ? (
                <Image
                  source={{ uri: release.thumbnailUrl }}
                  style={styles.releaseCover}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.releaseCoverFallback}>
                  <Disc color="#777777" size={32} />
                </View>
              )}
              <Text style={styles.releaseTitle} numberOfLines={1} ellipsizeMode="tail">
                {release.title}
              </Text>
              <Text style={styles.releaseYear} numberOfLines={1}>
                {release.year || (release.type === 'ep' ? 'EP' : release.type === 'single' ? 'Single' : 'Álbum')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  const innerContent = (
    <Animated.View
      style={[
        styles.animatedRoot,
        {
          opacity: modalOpacity,
          transform: [{ translateY: modalTranslateY }],
        },
      ]}
    >
      <View style={styles.container} testID="artist-profile-modal">
        <StatusBar
          barStyle="light-content"
          backgroundColor="transparent"
          translucent={true}
        />

        {selectedRelease ? (
          <AlbumDetailView
            release={selectedRelease}
            artistName={displayName}
            onBack={() => setSelectedRelease(null)}
            currentActiveTrackId={currentActiveTrackId}
            isPlaying={isPlaying}
            downloadedTrackIds={downloadedTrackIds}
            onPlayTrack={(track, idx, albumTracks) =>
              handlePlayCollection(albumTracks, idx, { shuffle: false })
            }
            onPlayAll={handlePlayCollection}
            onPlayNext={onPlayNext}
            onAddToQueue={onAddToQueue}
            onAddToPlaylist={onAddToPlaylist}
            onDownloadTrack={onDownloadTrack}
            onShowToast={onShowToast}
            bottomPadding={bottomPadding}
            registerBackHandler={isInline}
          />
        ) : (
          <>
            {/* Barra superior flutuante: apenas botão circular Voltar + título sticky no scroll */}
            <View style={styles.topBar} pointerEvents="box-none">
              <Animated.View
                pointerEvents="none"
                style={[styles.topBarScrim, { opacity: topBarScrimOpacity }]}
              />
              <TouchableOpacity
                style={styles.backCircleBtn}
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Voltar"
              >
                <ArrowLeft color="#FFFFFF" size={22} />
              </TouchableOpacity>

              <Animated.Text
                style={[styles.stickyTitle, { opacity: topBarTitleOpacity }]}
                numberOfLines={1}
              >
                {displayName}
              </Animated.Text>

              <View style={styles.topBarSpacer} />
            </View>

            <Animated.ScrollView
              style={styles.scrollView}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: bottomPadding },
              ]}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                { useNativeDriver: true }
              )}
            >
              {/* Hero Full-Bleed edge-to-edge com vinheta carmesim OLED */}
              <View style={styles.heroContainer} testID="artist-hero-banner">
                <Animated.View
                  style={[
                    styles.heroImageLayer,
                    { transform: [{ translateY: heroImageTranslateY }] },
                  ]}
                  pointerEvents="none"
                >
                  {heroImageUri ? (
                    <Image
                      source={{ uri: heroImageUri }}
                      style={styles.heroImage}
                      resizeMode="cover"
                      accessibilityRole="image"
                      accessibilityLabel={`Foto de ${displayName}`}
                    />
                  ) : isLoading ? (
                    <Skeleton
                      width="100%"
                      height={HERO_HEIGHT}
                      borderRadius={0}
                      style={styles.heroImage}
                    />
                  ) : (
                    <LinearGradient
                      colors={['#3A0710', '#1A0509', '#030303']}
                      style={styles.heroFallback}
                    >
                      <User color="rgba(255,255,255,0.22)" size={72} />
                    </LinearGradient>
                  )}
                </Animated.View>

                {/* Scrim superior leve para contraste do botão Voltar */}
                <LinearGradient
                  colors={['rgba(0, 0, 0, 0.56)', 'rgba(0, 0, 0, 0)']}
                  locations={[0, 1]}
                  style={styles.heroTopScrim}
                  pointerEvents="none"
                />

                {/* Vinheta inferior + glow carmesim suave fundindo no pitch-black #030303 */}
                <LinearGradient
                  colors={[
                    'rgba(3, 3, 3, 0)',
                    'rgba(62, 6, 15, 0.42)',
                    'rgba(96, 10, 22, 0.62)',
                    'rgba(18, 3, 6, 0.92)',
                    '#030303',
                  ]}
                  locations={[0, 0.44, 0.66, 0.86, 1]}
                  style={styles.heroBottomGradient}
                  pointerEvents="none"
                />

                {/* Nome, subtítulo e barra de 3 pills sobre a base do Hero */}
                <View style={styles.heroContent}>
                  <Text
                    style={styles.artistTitle}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {displayName}
                  </Text>
                  <Text style={styles.artistSubtitle} numberOfLines={1}>
                    {heroSubtitle}
                  </Text>

                  <View style={styles.actionPillsRow}>
                    <TouchableOpacity
                      style={[
                        styles.playPillBtn,
                        allTopTracks.length === 0 && styles.pillDisabled,
                      ]}
                      onPress={() =>
                        handlePlayCollection(allTopTracks, 0, { shuffle: false })
                      }
                      disabled={allTopTracks.length === 0}
                      activeOpacity={0.82}
                      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Tocar populares de ${displayName}`}
                    >
                      <Play color="#FFFFFF" fill="#FFFFFF" size={15} />
                      <Text style={styles.playPillText}>Tocar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.secondaryPillBtn,
                        allTopTracks.length === 0 && styles.pillDisabled,
                      ]}
                      onPress={() =>
                        handlePlayCollection(allTopTracks, 0, { shuffle: true })
                      }
                      disabled={allTopTracks.length === 0}
                      activeOpacity={0.8}
                      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Tocar ${displayName} em modo aleatório`}
                    >
                      <Shuffle color="#FFFFFF" size={15} />
                      <Text style={styles.secondaryPillText}>Aleatório</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.secondaryPillBtn}
                      onPress={() =>
                        onStartArtistRadio(
                          displayName,
                          profile?.channelId || activeArtist.channelId
                        )
                      }
                      activeOpacity={0.8}
                      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Iniciar rádio de ${displayName}`}
                    >
                      {isLoadingRadio ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Radio color="#FFFFFF" size={15} />
                      )}
                      <Text style={styles.secondaryPillText}>Rádio</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Loading Skeleton estruturado */}
              {isLoading && allTopTracks.length === 0 ? (
                <View style={styles.skeletonWrapper} testID="artist-profile-skeleton">
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>Populares</Text>
                  </View>
                  <TrackRowSkeleton count={4} />
                  <CardSkeleton count={3} shape="square" />
                </View>
              ) : hasError && allTopTracks.length === 0 ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>
                    Não foi possível carregar os dados deste artista no momento.
                  </Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => setRetryToken((t) => t + 1)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Tentar novamente carregar artista"
                  >
                    <RefreshCw color="#FFFFFF" size={15} />
                    <Text style={styles.retryBtnText}>Tentar novamente</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Seção: Populares */}
                  <View style={styles.sectionBlock} testID="artist-popular-section">
                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.sectionTitle}>Populares</Text>
                      {canToggleShowAll && (
                        <TouchableOpacity
                          onPress={() => void handleToggleShowAllPopular()}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          accessibilityRole="button"
                          accessibilityLabel={
                            showAllPopular
                              ? 'Ver menos faixas populares'
                              : 'Ver todas as faixas populares'
                          }
                        >
                          <Text style={styles.seeAllText}>
                            {showAllPopular ? 'Ver menos' : 'Ver tudo'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {visibleTopTracks.length > 0 ? (
                      <View style={styles.tracksList}>
                        {visibleTopTracks.map((item, idx) => {
                          const isRowDownloading =
                            activeDownloadingItem?.track.id === item.id;
                          return (
                            <PopularTrackRow
                              key={`${item.id}-${idx}`}
                              item={item}
                              index={idx}
                              isActive={currentActiveTrackId === item.id}
                              isPlaying={isPlaying}
                              isDownloaded={isTrackDownloaded(item.id)}
                              isDownloading={isRowDownloading}
                              isQueued={queuedIds.has(item.id)}
                              downloadProgress={
                                isRowDownloading
                                  ? Math.round(
                                      (activeDownloadingItem?.progress || 0) * 100
                                    )
                                  : 0
                              }
                              onPress={handlePressPopularTrack}
                              onOpenMenu={setMenuTrack}
                            />
                          );
                        })}
                        {isLoadingAllPopular && (
                          <View style={styles.loadingMoreRow}>
                            <ActivityIndicator color="#FF0000" size="small" />
                          </View>
                        )}
                      </View>
                    ) : (
                      <Text style={styles.emptySectionText}>
                        Nenhuma faixa popular encontrada no momento.
                      </Text>
                    )}
                  </View>

                  {/* Seção: Álbuns (apenas reais do /browse) */}
                  {renderReleaseCarousel('Álbuns', albums, 'artist-albums-section')}

                  {/* Seção: Singles e EPs (apenas reais do /browse) */}
                  {renderReleaseCarousel(
                    'Singles e EPs',
                    singles,
                    'artist-singles-section'
                  )}

                  {/* Seção: Artistas semelhantes (exibida apenas quando retornada no /browse) */}
                  {relatedArtists.length > 0 && (
                    <View style={styles.sectionBlock} testID="artist-related-section">
                      <View style={styles.sectionHeaderRow}>
                        <Text style={styles.sectionTitle}>Artistas semelhantes</Text>
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.carouselContent}
                      >
                        {relatedArtists.map((rel) => (
                          <TouchableOpacity
                            key={rel.id}
                            style={styles.relatedArtistCard}
                            onPress={() => handlePressRelatedArtist(rel)}
                            activeOpacity={0.78}
                            accessibilityRole="button"
                            accessibilityLabel={`Abrir perfil do artista ${rel.name}`}
                          >
                            <View style={styles.relatedAvatarRing}>
                              {rel.thumbnailUrl ? (
                                <Image
                                  source={{ uri: rel.thumbnailUrl }}
                                  style={styles.relatedAvatarImg}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={styles.relatedAvatarFallback}>
                                  <User color="#AAAAAA" size={26} />
                                </View>
                              )}
                            </View>
                            <Text
                              style={styles.relatedArtistName}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {rel.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Seção: Sobre (apenas quando houver biografia real) */}
                  {Boolean(profile?.bio) && (
                    <View style={styles.sectionBlock} testID="artist-bio-section">
                      <View style={styles.sectionHeaderRow}>
                        <Text style={styles.sectionTitle}>Sobre</Text>
                      </View>
                      <View style={styles.bioCard}>
                        <Text
                          style={styles.bioText}
                          numberOfLines={isBioExpanded ? undefined : 4}
                        >
                          {profile?.bio}
                        </Text>
                        {(profile?.bio?.length || 0) > 180 && (
                          <TouchableOpacity
                            style={styles.bioToggleBtn}
                            onPress={() => setIsBioExpanded((prev) => !prev)}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isBioExpanded
                                ? 'Recolher biografia do artista'
                                : 'Ler biografia completa do artista'
                            }
                          >
                            <Text style={styles.bioToggleText}>
                              {isBioExpanded ? 'Ler menos' : 'Ler mais'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  )}
                </>
              )}
            </Animated.ScrollView>

            {/* Menu contextual de faixa reutilizado do TrackCard */}
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
                  const idx = allTopTracks.findIndex((t) => t.id === menuTrack.id);
                  handlePressPopularTrack(menuTrack, idx >= 0 ? idx : 0);
                }}
                onPlayNext={onPlayNext ? () => onPlayNext(menuTrack) : undefined}
                onAddToQueue={onAddToQueue ? () => onAddToQueue(menuTrack) : undefined}
                onAddToPlaylist={
                  onAddToPlaylist ? () => onAddToPlaylist(menuTrack) : undefined
                }
                onDownload={
                  onDownloadTrack ? () => onDownloadTrack(menuTrack) : undefined
                }
              />
            )}
          </>
        )}

        {!isInline && (
          <ToastBanner
            message={toastMessage}
            variant={toastVariant}
            onDismiss={onDismissToast}
            topOffset={Platform.OS === 'android' ? ANDROID_STATUS_BAR_HEIGHT + 12 : 54}
          />
        )}
      </View>
    </Animated.View>
  );

  if (isInline) {
    return innerContent;
  }

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      onShow={onModalShow}
      onRequestClose={handleModalRequestClose}
    >
      <SafeAreaView style={styles.modalSafeArea}>{innerContent}</SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalSafeArea: {
    flex: 1,
    backgroundColor: '#030303',
  },
  animatedRoot: {
    flex: 1,
    backgroundColor: '#030303',
  },
  container: {
    flex: 1,
    backgroundColor: '#030303',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 25,
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
  backCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
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
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroContainer: {
    width: '100%',
    minHeight: HERO_HEIGHT,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: '#030303',
    marginBottom: 8,
  },
  heroImageLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: ANDROID_STATUS_BAR_HEIGHT + 86,
  },
  heroBottomGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    paddingHorizontal: 18,
    paddingTop: ANDROID_STATUS_BAR_HEIGHT + 116,
    paddingBottom: 14,
  },
  artistTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.7,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  artistSubtitle: {
    color: '#B8B8BE',
    fontSize: 13.5,
    fontWeight: '500',
    marginTop: 5,
    marginBottom: 16,
  },
  actionPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playPillBtn: {
    flex: 1,
    height: 40,
    borderRadius: 9999,
    backgroundColor: theme.colors.brandPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  playPillText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryPillBtn: {
    flex: 1,
    height: 40,
    borderRadius: 9999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },
  secondaryPillText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  pillDisabled: {
    opacity: 0.45,
  },
  skeletonWrapper: {
    paddingTop: 8,
  },
  errorBox: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    gap: 14,
  },
  errorText: {
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
  sectionBlock: {
    marginTop: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  seeAllText: {
    color: '#AAAAAA',
    fontSize: 13.5,
    fontWeight: '600',
  },
  tracksList: {
    paddingHorizontal: 10,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  trackRowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  trackThumbWrapper: {
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#181818',
    marginRight: 12,
    position: 'relative',
  },
  trackThumb: {
    width: 48,
    height: 48,
  },
  trackThumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#181818',
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
  trackSub: {
    color: '#AAAAAA',
    fontSize: 12.5,
  },
  trackDuration: {
    color: '#AAAAAA',
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
    marginRight: 4,
  },
  downloadingBadge: {
    marginRight: 4,
  },
  queuedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 4,
  },
  queuedBadgeText: {
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
  loadingMoreRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptySectionText: {
    color: '#777777',
    fontSize: 13.5,
    paddingHorizontal: 18,
  },
  carouselContent: {
    paddingHorizontal: 18,
    gap: 14,
  },
  releaseCard: {
    width: 144,
  },
  releaseCover: {
    width: 144,
    height: 144,
    borderRadius: 8,
    backgroundColor: '#181818',
    marginBottom: 8,
  },
  releaseCoverFallback: {
    width: 144,
    height: 144,
    borderRadius: 8,
    backgroundColor: '#181818',
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  releaseTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  releaseYear: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  relatedArtistCard: {
    width: 82,
    alignItems: 'center',
  },
  relatedAvatarRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    overflow: 'hidden',
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  relatedAvatarImg: {
    width: '100%',
    height: '100%',
  },
  relatedAvatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relatedArtistName: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 7,
    textAlign: 'center',
    width: '100%',
  },
  bioCard: {
    marginHorizontal: 18,
    backgroundColor: '#111113',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  bioText: {
    color: '#CCCCCC',
    fontSize: 13.5,
    lineHeight: 20,
  },
  bioToggleBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  bioToggleText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default ArtistProfileModal;
