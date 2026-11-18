import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  usePlaybackState,
  useActiveTrack,
  useTrackPlayerEvents,
  Event,
  State,
} from 'react-native-track-player';
import NowPlayingModal from './components/NowPlayingModal';
import { AddToPlaylistModal } from './components/AddToPlaylistModal';
import { PlaylistDetailModal } from './components/PlaylistDetailModal';
import { BrandHeader } from './components/BrandHeader';
import { DevMenuModal, isDevMenuEnabled } from './components/DevMenuModal';
import { DownloadQueueModal } from './components/DownloadQueueModal';
import { MainTab, NavigationTabBar } from './components/NavigationTabBar';
import { SearchBarSection, SearchPillInput } from './components/SearchBarSection';
import { SupportSection } from './components/SupportSection';
import { TrackCard } from './components/TrackCard';
import {
  FavoritesRubyBadge,
  LibrarySection,
} from './components/LibrarySection';
import { PersistentMiniPlayer } from './components/PersistentMiniPlayer';
import { YouTubeMusicSidebar } from './components/YouTubeMusicSidebar';
import { QuickPicksSection } from './components/QuickPicksSection';
import { AtmosphericGradient } from './components/AtmosphericGradient';
import { TrackRowSkeleton } from './components/TrackRowSkeleton';
import { ToastBanner, ToastVariant } from './components/ToastBanner';
import { PlaylistCover } from './components/PlaylistCover';
import {
  DRAWER_SHELL_TRANSLATE_RATIO,
  SideDrawerMenu,
} from './components/SideDrawerMenu';
import { getEaseOutCubic, theme } from './theme';
import {
  AlertCircle,
  Coffee,
  Disc3,
  Download,
  Dumbbell,
  FolderDown,
  Globe,
  Guitar,
  Headphones,
  Heart,
  ListMusic,
  ListPlus,
  Moon,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react-native';
import {
  TrackSummary,
  searchTracksPage,
  getAudioStream,
  AllInstancesFailedError,
  getRelatedTracks,
  getTrackRadio,
  getArtistRadio,
} from './services/api';
import {
  setupPlayer,
  playTrack,
  playTrackPreservingQueue,
  playTrackList,
  shuffleArray,
  addTracksToQueue,
  skipToNext,
  skipToPrevious,
  seekTo,
  seekRelative,
  togglePlayback,
  resetPlayer,
  RepeatMode,
  setRepeatMode,
  setVolume,
  shuffleUpcomingQueue,
  playNextTrack,
  addTrackToEndOfQueue,
  removeTrackFromQueue,
  moveTrackInQueue,
  getActiveTrackIndex,
  getQueue,
  enableShuffle,
  disableShuffle,
  skipToIndex,
  getActiveTrack,
  getProgress,
  pausePlayer,
  replaceUpcomingQueue,
  Track,
} from './services/player';
import {
  downloadTrackFile,
  isTrackDownloaded,
  getLocalTrackUri,
  deleteDownloadedTrack,
  syncAndCleanStorage,
  registerLocalTrackIfMissing,
  enqueueDownload,
  getDownloadQueue,
  subscribeDownloadQueue,
  cancelDownload,
  cancelAllDownloads,
  retryDownload,
  clearFinishedDownloads,
  hydrateDownloadQueue,
  DownloadQueueItem,
} from './services/storage';
import {
  DownloadedTrack,
  getDownloadedTracks,
  getDownloadedTrackIds,
  getPlaylistById,
  getPlaylists,
  PlaylistSummary,
  PlaylistTrackItem,
  FAVORITES_PLAYLIST_ID,
  isDownloaded,
  isFavorite,
  toggleFavorite,
  getFavoriteTrackIds,
  TrackInput,
  createPlaylist,
  recordPlaybackHistory,
  savePlaybackSession,
  getPlaybackSession,
  PlaybackSessionState,
  getSearchHistory,
  recordSearchHistory,
  removeSearchHistoryItem,
  clearSearchHistory,
  incrementDailySupportPlayCount,
} from './services/database';
import {
  attachSupportNotificationListeners,
  RealPlaytimeTracker,
  triggerSupportNotificationIfEligible,
} from './services/supportNotifications';
import { BACK_PRIORITY, useBackHandler } from './services/backNavigation';
import { UpdateModal } from './components/UpdateModal';
import {
  checkForAppUpdate,
  cleanupCachedUpdateApks,
  getInstalledAppVersion,
  InstalledAppVersion,
  RemoteReleaseInfo,
  skipAppUpdateVersion,
} from './services/updater';

type PlayableTrack = TrackSummary | DownloadedTrack | PlaylistTrackItem;
type NavHistoryEntry = { tab: MainTab; playlistId: string | null };
const EXIT_PROMPT_MS = 2000;
const EXIT_PROMPT_MESSAGE = 'Pressione voltar novamente para sair';

export default function App() {
  const { width, height: windowHeight } = useWindowDimensions();
  const isDesktop = width >= 768;
  const searchSkeletonRows = Math.max(10, Math.ceil(Math.max(0, windowHeight - 210) / 68));
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>('search');
  const [pendingTab, setPendingTab] = useState<MainTab | null>(null);
  const tabContentOpacity = useRef(new Animated.Value(1)).current;
  const tabTransitionRef = useRef<Animated.CompositeAnimation | null>(null);
  const shellOpacity = useRef(new Animated.Value(1)).current;
  const shellTransitionRef = useRef<Animated.CompositeAnimation | null>(null);
  const activeGlowColor = '#6E000D';
  const [query, setQuery] = useState('');
  const [recentSearchQueries, setRecentSearchQueries] = useState<string[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<TrackSummary[]>([]);
  const [searchContinuationToken, setSearchContinuationToken] = useState<string | null>(null);
  const [lastSearchedQuery, setLastSearchedQuery] = useState<string>('');
  const [isLoadingMoreSearch, setIsLoadingMoreSearch] = useState(false);
  const [downloadsSearchQuery, setDownloadsSearchQuery] = useState('');
  const [downloadedTracks, setDownloadedTracks] = useState<DownloadedTrack[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([]);
  const [isDownloadQueueVisible, setIsDownloadQueueVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const shellDrawerTranslateX = React.useMemo(
    () =>
      drawerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -width * DRAWER_SHELL_TRANSLATE_RATIO],
        extrapolate: 'clamp',
      }),
    [drawerProgress, width]
  );
  const [availableUpdate, setAvailableUpdate] = useState<RemoteReleaseInfo | null>(null);
  const [installedAppVersion, setInstalledAppVersion] = useState<InstalledAppVersion | null>(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<string>>(new Set());
  const [isCurrentFavorite, setIsCurrentFavorite] = useState(false);
  const [isNowPlayingVisible, setIsNowPlayingVisible] = useState(false);
  const [isMiniDragging, setIsMiniDragging] = useState(false);
  const [morphEpoch, setMorphEpoch] = useState(0);
  const [measuredNavHeight, setMeasuredNavHeight] = useState(66);
  const [safeAreaHeight, setSafeAreaHeight] = useState(windowHeight);
  const [measuredMiniPlayerY, setMeasuredMiniPlayerY] = useState<number | null>(null);
  const isPersistentPlayerEnv = typeof requestAnimationFrame === 'function';
  const navBarHeight = isDesktop ? 0 : measuredNavHeight;
  const defaultCollapseDistance = Math.max(
    200,
    safeAreaHeight - (isDesktop ? 62 : 62 + navBarHeight)
  );
  const collapseDistance =
    measuredMiniPlayerY !== null && measuredMiniPlayerY >= 200
      ? Math.max(defaultCollapseDistance, measuredMiniPlayerY)
      : defaultCollapseDistance;
  const modalTranslateY = useRef(new Animated.Value(defaultCollapseDistance)).current;
  const activeMorphAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const isMiniDraggingRef = useRef(false);
  const isNowPlayingVisibleRef = useRef(isNowPlayingVisible);
  isNowPlayingVisibleRef.current = isNowPlayingVisible;

  useEffect(() => {
    if (!isNowPlayingVisible && !isMiniDragging && !isMiniDraggingRef.current) {
      modalTranslateY.setValue(collapseDistance);
    }
  }, [collapseDistance, isMiniDragging, isNowPlayingVisible, modalTranslateY]);

  const miniPlayerOpacity = React.useMemo(
    () =>
      modalTranslateY.interpolate({
        inputRange: [collapseDistance - 1.5, collapseDistance],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [collapseDistance, modalTranslateY]
  );

  const navBarTranslateY = React.useMemo(
    () =>
      modalTranslateY.interpolate({
        inputRange: [0, collapseDistance],
        outputRange: [navBarHeight, 0],
        extrapolate: 'clamp',
      }),
    [collapseDistance, modalTranslateY, navBarHeight]
  );

  const navBarOpacity = React.useMemo(
    () =>
      modalTranslateY.interpolate({
        inputRange: [0, collapseDistance * 0.12],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [collapseDistance, modalTranslateY]
  );

  // Estados dos modais de playlist
  const [isAddToPlaylistVisible, setIsAddToPlaylistVisible] = useState(false);
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState<TrackInput | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isPlaylistDetailVisible, setIsPlaylistDetailVisible] = useState(false);
  const [isQuickCreateVisible, setIsQuickCreateVisible] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState('');
  const [isDevMenuVisible, setIsDevMenuVisible] = useState(false);
  const isDevMode = isDevMenuEnabled();

  // Contexto da lista ativa para auto-advance contínuo e navegação na fila
  const activePlaylistRef = React.useRef<{
    type: 'search' | 'downloads' | 'playlist';
    tracks: PlayableTrack[];
  }>({ type: 'search', tracks: [] });

  // Rastreamento de IDs já enfileirados no player nativo e geração da fila
  const queuedTrackIdsRef = React.useRef<Set<string>>(new Set());
  const inFlightQueueIdsRef = React.useRef<Set<string>>(new Set());
  const queueGenerationRef = React.useRef<number>(0);
  const selectionHandledRef = React.useRef<{ epoch: number; trackId: string } | null>(null);
  const repeatModeRef = React.useRef<RepeatMode>(RepeatMode.Off);

  // Hooks oficiais da MediaSession / TrackPlayer nativo
  const playbackState = usePlaybackState();
  const nativeActiveTrack = useActiveTrack();
  const [restoredSession, setRestoredSession] = useState<PlaybackSessionState | null>(null);
  const recoveringTrackIdRef = React.useRef<string | null>(null);
  const activeTrack: Track | undefined =
    nativeActiveTrack ??
    (restoredSession
      ? {
        id: restoredSession.track.id,
        url: '',
        title: restoredSession.track.title,
        artist: restoredSession.track.artist,
        artwork: restoredSession.track.thumbnailUrl,
        duration: restoredSession.track.duration,
      }
      : undefined);

  const handleBottomDockLayout = useCallback(
    (e: any) => {
      const { y, height: h } = e.nativeEvent.layout;
      if (activeTrack && h >= 100 && y >= 200) {
        setMeasuredMiniPlayerY((prev) =>
          prev === null || Math.abs(prev - y) > 1 ? y : prev
        );
      }
    },
    [activeTrack]
  );

  const [repeatMode, setRepeatModeState] = useState<RepeatMode>(RepeatMode.Off);
  const [isShuffleActive, setIsShuffleActive] = useState<boolean>(false);
  const [volume, setVolumeState] = useState<number>(1.0);

  // Estado reativo da fila do player nativo e un-shuffle imutável
  const [playerQueue, setPlayerQueue] = useState<Track[]>([]);
  const [activeQueueIndex, setActiveQueueIndex] = useState<number>(0);
  const upcomingQueue = React.useMemo(
    () => playerQueue.slice(activeQueueIndex + 1),
    [playerQueue, activeQueueIndex]
  );
  const originalQueueRef = React.useRef<Track[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<ToastVariant>('success');
  const showToast = useCallback(
    (msg: string, variant: ToastVariant = 'success') => {
      setToastVariant(variant);
      setToastMessage(msg);
    },
    []
  );
  const [isLoadingRadio, setIsLoadingRadio] = useState<boolean>(false);
  const radioContinuationRef = React.useRef<string | undefined>(undefined);

  const isPlaying = playbackState.state === State.Playing;
  const isBuffering =
    playbackState.state === State.Buffering ||
    playbackState.state === State.Loading;

  /**
   * Sincroniza a fila nativa e o índice ativo com o estado do React
   */
  const syncPlayerQueue = async () => {
    try {
      const q = await getQueue();
      const idx = await getActiveTrackIndex();
      setPlayerQueue(q);
      setActiveQueueIndex(idx !== undefined && idx >= 0 ? idx : 0);
    } catch (err) {
      console.warn('[Queue] Erro ao sincronizar fila nativa:', err);
    }
  };

  /**
   * Pré-carrega e adiciona a próxima faixa à fila nativa sem interromper o áudio ativo
   */
  const preloadAndQueueTrack = async (
    track: PlayableTrack,
    expectedEpoch?: number
  ): Promise<boolean> => {
    if (
      !track ||
      !track.id ||
      queuedTrackIdsRef.current.has(track.id) ||
      inFlightQueueIdsRef.current.has(track.id)
    ) {
      return false;
    }
    inFlightQueueIdsRef.current.add(track.id);
    try {
      const localUri = await getLocalTrackUri(track.id);
      if (expectedEpoch !== undefined && queueGenerationRef.current !== expectedEpoch) {
        return false;
      }
      if (localUri) {
        queuedTrackIdsRef.current.add(track.id);
        await addTracksToQueue([
          {
            id: track.id,
            url: localUri,
            title: track.title,
            artist: track.artist,
            artwork: track.thumbnailUrl,
            duration: track.duration,
          },
        ]);
        await syncPlayerQueue();
        return true;
      }
      const streamInfo = await getAudioStream(track.id);
      if (expectedEpoch !== undefined && queueGenerationRef.current !== expectedEpoch) {
        return false;
      }
      queuedTrackIdsRef.current.add(track.id);
      await addTracksToQueue([
        {
          id: track.id,
          url: streamInfo.streamUrl,
          title: streamInfo.title || track.title,
          artist: streamInfo.artist || track.artist,
          artwork: streamInfo.thumbnailUrl || track.thumbnailUrl,
          duration: streamInfo.duration || track.duration,
          userAgent: streamInfo.userAgent,
          headers: streamInfo.headers,
          contentType: streamInfo.mimeType,
        },
      ]);
      await syncPlayerQueue();
      return true;
    } catch (err) {
      console.warn('[Queue] Erro ao pré-enfileirar próxima faixa:', err);
      return false;
    } finally {
      inFlightQueueIdsRef.current.delete(track.id);
    }
  };

  const RECOMMENDED_UPCOMING_TARGET = 5;

  /**
   * Preenche as próximas faixas da fila SOMENTE quando não houver nenhuma música na sequência.
   * Fora de playlists ativas (ou ao chegar na última faixa), preenche com pelo menos 5
   * faixas aleatórias relacionadas à música atual, mesmo com o modo Repetir ativado.
   */
  const fillUpcomingQueueIfEmpty = async (
    epoch: number,
    seedTrack: { id: string; title?: string; artist?: string }
  ) => {
    try {
      const q = await getQueue();
      const idx = await getActiveTrackIndex();
      if (queueGenerationRef.current !== epoch) return;

      const upcomingCount =
        idx !== undefined && idx >= 0 ? Math.max(0, q.length - 1 - idx) : 0;
      if (upcomingCount > 0) return;

      if (activePlaylistRef.current.type === 'playlist') {
        const list = activePlaylistRef.current.tracks;
        const activeIdx = list.findIndex((t) => t.id === seedTrack.id);
        if (activeIdx >= 0 && activeIdx < list.length - 1) {
          const addedFirst = await preloadAndQueueTrack(list[activeIdx + 1], epoch);
          if (queueGenerationRef.current !== epoch) return;
          let addedSecond = false;
          if (activeIdx + 2 < list.length) {
            addedSecond = await preloadAndQueueTrack(list[activeIdx + 2], epoch);
          }
          if (addedFirst || addedSecond) return;
        }
      }

      const seenIds = new Set<string>([
        seedTrack.id,
        ...Array.from(queuedTrackIdsRef.current),
        ...Array.from(inFlightQueueIdsRef.current),
      ]);
      const collectUnique = (items: TrackSummary[] | undefined) => {
        const fresh: TrackSummary[] = [];
        for (const item of items || []) {
          if (!item?.id || seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          fresh.push(item);
        }
        return fresh;
      };

      const radioBatch = await getTrackRadio(
        seedTrack.id,
        radioContinuationRef.current,
        seedTrack.title,
        seedTrack.artist
      );
      if (queueGenerationRef.current !== epoch) return;

      // Re-checa se o usuário não inseriu músicas na fila enquanto a recomendação carregava
      const latestQ = await getQueue();
      const latestIdx = await getActiveTrackIndex();
      const latestUpcomingCount =
        latestIdx !== undefined && latestIdx >= 0
          ? Math.max(0, latestQ.length - 1 - latestIdx)
          : 0;
      if (latestUpcomingCount > 0) return;

      if (radioBatch.continuationToken) {
        radioContinuationRef.current = radioBatch.continuationToken;
      }

      let pool = collectUnique(radioBatch.tracks);
      let fetchedRelatedFallback = false;
      if (pool.length < RECOMMENDED_UPCOMING_TARGET) {
        fetchedRelatedFallback = true;
        const related = await getRelatedTracks(
          seedTrack.id,
          seedTrack.title,
          seedTrack.artist
        );
        if (queueGenerationRef.current !== epoch) return;
        pool = pool.concat(collectUnique(related));
      }

      let addedCount = 0;
      const tryQueueBatch = async (candidates: TrackSummary[]) => {
        const shuffled = shuffleArray(candidates);
        for (const rel of shuffled) {
          if (queueGenerationRef.current !== epoch) return false;
          if (addedCount >= RECOMMENDED_UPCOMING_TARGET) return true;
          const ok = await preloadAndQueueTrack(rel, epoch);
          if (ok) addedCount += 1;
        }
        return true;
      };

      if (!(await tryQueueBatch(pool))) return;

      if (addedCount < RECOMMENDED_UPCOMING_TARGET && !fetchedRelatedFallback) {
        const related = await getRelatedTracks(
          seedTrack.id,
          seedTrack.title,
          seedTrack.artist
        );
        if (queueGenerationRef.current !== epoch) return;
        const extra = collectUnique(related);
        if (extra.length > 0) {
          await tryQueueBatch(extra);
        }
      }
    } catch (radioErr) {
      console.warn('[Radio] Falha ao autogerar fila infinita:', radioErr);
    }
  };

  /**
   * Inicia explicitamente a Rádio da Música atual: substitui a fila futura por 20+ faixas similares
   * sem interromper a reprodução da faixa atual.
   */
  const handleStartTrackRadio = async () => {
    if (!activeTrack || isLoadingRadio) return;
    if (!nativeActiveTrack && restoredSession) {
      const resumed = await resumeRestoredSession(restoredSession);
      if (!resumed) return;
    }
    const radioEpoch = ++queueGenerationRef.current;
    inFlightQueueIdsRef.current.clear();
    setIsLoadingRadio(true);
    try {
      const radioRes = await getTrackRadio(
        activeTrack.id,
        undefined,
        activeTrack.title,
        activeTrack.artist
      );
      if (queueGenerationRef.current !== radioEpoch) return;
      radioContinuationRef.current = radioRes.continuationToken;
      if (radioRes.tracks.length > 0) {
        await replaceUpcomingQueue([]);
        queuedTrackIdsRef.current = new Set([activeTrack.id]);
        activePlaylistRef.current = {
          type: 'search',
          tracks: radioRes.tracks,
        };
        const initialBatch = radioRes.tracks.slice(0, 5);
        for (const t of initialBatch) {
          if (queueGenerationRef.current !== radioEpoch) return;
          await preloadAndQueueTrack(t, radioEpoch);
        }
        await syncPlayerQueue();
        setToastMessage(`Rádio iniciada • ${radioRes.tracks.length} faixas similares`);
      }
    } catch (err) {
      console.warn('[Radio] Erro ao iniciar Rádio da Música:', err);
    } finally {
      setIsLoadingRadio(false);
    }
  };

  /**
   * Inicia explicitamente a Rádio do Artista: substitui a fila futura pelo mix do artista
   * sem interromper a música atual.
   */
  const handleStartArtistRadio = async (artistName: string, channelId?: string) => {
    if (!artistName || isLoadingRadio) return;
    if (!nativeActiveTrack && restoredSession) {
      const resumed = await resumeRestoredSession(restoredSession);
      if (!resumed) return;
    }
    const radioEpoch = ++queueGenerationRef.current;
    inFlightQueueIdsRef.current.clear();
    setIsLoadingRadio(true);
    try {
      const radioRes = await getArtistRadio(
        artistName,
        channelId,
        activeTrack?.title
      );
      if (queueGenerationRef.current !== radioEpoch) return;
      radioContinuationRef.current = radioRes.continuationToken;
      if (radioRes.tracks.length > 0) {
        await replaceUpcomingQueue([]);
        queuedTrackIdsRef.current = new Set(activeTrack ? [activeTrack.id] : []);
        activePlaylistRef.current = {
          type: 'search',
          tracks: radioRes.tracks,
        };
        const initialBatch = radioRes.tracks.slice(0, 5);
        for (const t of initialBatch) {
          if (queueGenerationRef.current !== radioEpoch) return;
          await preloadAndQueueTrack(t, radioEpoch);
        }
        await syncPlayerQueue();
        setToastMessage(`${radioRes.title} iniciada`);
      }
    } catch (err) {
      console.warn('[Radio] Erro ao iniciar Rádio do Artista:', err);
    } finally {
      setIsLoadingRadio(false);
    }
  };

  // Monitora mudança de faixa ativa para manter a fila sempre alimentada (somente se não houver próximas na fila)
  useEffect(() => {
    if (!nativeActiveTrack) return;

    // Registra histórico de reprodução localmente no SQLite
    recordPlaybackHistory({
      id: nativeActiveTrack.id,
      title: nativeActiveTrack.title || 'Música',
      artist: nativeActiveTrack.artist || 'Artista',
      duration: nativeActiveTrack.duration || 0,
      thumbnailUrl:
        typeof nativeActiveTrack.artwork === 'string' ? nativeActiveTrack.artwork : '',
    }).catch(() => { });

    // Sincroniza a fila nativa com a UI
    syncPlayerQueue();

    const currentEpoch = queueGenerationRef.current;
    const handled = selectionHandledRef.current;
    if (
      handled &&
      handled.epoch === currentEpoch &&
      handled.trackId === nativeActiveTrack.id
    ) {
      selectionHandledRef.current = null;
      return;
    }

    void fillUpcomingQueueIfEmpty(currentEpoch, {
      id: nativeActiveTrack.id,
      title: nativeActiveTrack.title,
      artist: nativeActiveTrack.artist,
    });
  }, [nativeActiveTrack?.id]);

  const lastSavedSessionRef = React.useRef<{ trackId: string; position: number } | null>(null);
  const hasHydratedQueueRef = React.useRef<boolean>(false);
  const syncedCompletedIdsRef = React.useRef<Set<string>>(new Set());
  const reportedDownloadErrorMapRef = React.useRef<Map<string, string>>(new Map());

  // Persistência periódica de sessão (TASK-006)
  useEffect(() => {
    if (!nativeActiveTrack) return;
    const sessionTimer = setInterval(async () => {
      try {
        const progress = await getProgress();
        const positionSec = progress.position || 0;
        const lastSaved = lastSavedSessionRef.current;
        if (
          lastSaved &&
          lastSaved.trackId === nativeActiveTrack.id &&
          Math.abs(positionSec - lastSaved.position) < 2
        ) {
          return;
        }
        await savePlaybackSession({
          track: {
            id: nativeActiveTrack.id,
            title: nativeActiveTrack.title || 'Música',
            artist: nativeActiveTrack.artist || 'Artista',
            duration: nativeActiveTrack.duration || 0,
            thumbnailUrl:
              typeof nativeActiveTrack.artwork === 'string' ? nativeActiveTrack.artwork : '',
          },
          positionSec,
          playlistContext: {
            type: activePlaylistRef.current.type,
          },
          savedAt: Date.now(),
        });
        lastSavedSessionRef.current = {
          trackId: nativeActiveTrack.id,
          position: positionSec,
        };
      } catch {
        // ignore
      }
    }, 5000);
    if (sessionTimer && typeof (sessionTimer as any).unref === 'function') {
      (sessionTimer as any).unref();
    }
    return () => clearInterval(sessionTimer);
  }, [nativeActiveTrack?.id]);

  // Auto-dismiss do toast de feedback
  useEffect(() => {
    if (!toastMessage) return;
    const timeoutMs =
      toastMessage === EXIT_PROMPT_MESSAGE
        ? EXIT_PROMPT_MS
        : toastVariant === 'error'
          ? 4500
          : 3000;
    const timer = setTimeout(() => {
      setToastMessage(null);
      setToastVariant('success');
    }, timeoutMs);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    return () => clearTimeout(timer);
  }, [toastMessage, toastVariant]);

  // Tratamento resiliente de erro de reprodução nativo (ExoPlayer 403 / IO) e sincronização de eventos
  useTrackPlayerEvents(
    [
      Event.PlaybackError,
      Event.PlaybackActiveTrackChanged,
      Event.PlaybackTrackChanged,
    ],
    async (event) => {
      if (
        event.type === Event.PlaybackActiveTrackChanged ||
        event.type === Event.PlaybackTrackChanged
      ) {
        await syncPlayerQueue();
        return;
      }

      console.warn('[App] PlaybackError capturado:', event);
      setIsLoadingAudio(false);

      const failedTrack = nativeActiveTrack ?? (await getActiveTrack().catch(() => undefined));

      // Se o player encontrou erro em um stream remoto, aciona fallback resiliente via download local
      if (failedTrack && !downloadedIds.has(failedTrack.id)) {
        if (recoveringTrackIdRef.current === failedTrack.id) {
          return;
        }
        recoveringTrackIdRef.current = failedTrack.id;
        setErrorMessage(
          'Stream bloqueado pelo servidor. Sincronizando faixa para reprodução offline direta...'
        );
        try {
          const streamInfo = await getAudioStream(failedTrack.id);
          const trackSummary: TrackSummary = {
            id: failedTrack.id,
            title: failedTrack.title || 'Música',
            artist: failedTrack.artist || 'Artista',
            duration: failedTrack.duration || 0,
            formattedDuration: formatSeconds(failedTrack.duration),
            thumbnailUrl:
              typeof failedTrack.artwork === 'string' ? failedTrack.artwork : '',
          };
          const downloaded = await downloadTrackFile(
            trackSummary,
            streamInfo.streamUrl
          );
          await loadOfflineTracks();
          await playTrack({
            id: downloaded.id,
            url: downloaded.localAudioUri,
            title: downloaded.title,
            artist: downloaded.artist,
            artwork: downloaded.localArtworkUri,
            duration: downloaded.duration,
          });
          setErrorMessage(null);
        } catch (fallbackErr) {
          setErrorMessage(
            'Não foi possível reproduzir a faixa selecionada. Tente novamente mais tarde.'
          );
          await resetPlayer();
        } finally {
          recoveringTrackIdRef.current = null;
        }
      } else {
        setErrorMessage(
          'Erro na reprodução do áudio. Verifique sua conexão com a internet.'
        );
        await resetPlayer();
      }
    });

  /**
   * Solicita permissão de notificação em runtime para Android 13+ (API 33+)
   */
  const requestNotificationPermission = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      try {
        const granted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        if (!granted) {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
        }
      } catch (err) {
        console.warn('[Permissão] Erro ao solicitar POST_NOTIFICATIONS:', err);
      }
    }
  };

  /**
   * Sincroniza a lista de faixas offline persistidas no SQLite
   */
  /**
   * Sincroniza a lista de faixas offline persistidas no SQLite
   */
  const loadOfflineTracks = async (options?: { clean?: boolean }) => {
    try {
      if (options?.clean) {
        await syncAndCleanStorage();
      }
      const offlineList = await getDownloadedTracks();
      setDownloadedTracks(offlineList);
      setDownloadedIds(new Set(offlineList.map((t) => t.id)));
    } catch (err) {
      console.error('Falha ao carregar faixas offline do SQLite:', err);
    }
  };

  /**
   * Sincroniza as playlists cadastradas no SQLite silenciosamente (sem skeleton flash)
   */
  const loadPlaylists = async (): Promise<PlaylistSummary[]> => {
    try {
      const list = await getPlaylists();
      setPlaylists(list);
      return list;
    } catch (err) {
      console.error('Falha ao carregar playlists do SQLite:', err);
      return [];
    }
  };

  useEffect(() => {
    // Inicialização do Subsistema Nativo do Player e banco SQLite
    setupPlayer().catch((err) => {
      console.error('Falha ao inicializar TrackPlayer nativo:', err);
    });
    void hydrateDownloadQueue()
      .then((initialQueue) => {
        for (const item of initialQueue) {
          if (item.status === 'completed') {
            syncedCompletedIdsRef.current.add(item.track.id);
          } else if (item.status === 'error') {
            reportedDownloadErrorMapRef.current.set(
              item.track.id,
              item.error || 'Erro desconhecido'
            );
          }
        }
        hasHydratedQueueRef.current = true;
        return loadOfflineTracks();
      })
      .then(() => loadOfflineTracks({ clean: true }))
      .catch(() => {
        hasHydratedQueueRef.current = true;
      });
    void loadPlaylists().then((list) => {
      const topIds = list.slice(0, 5).map((p) => p.id);
      if (topIds.length > 0) {
        void Promise.allSettled(topIds.map((id) => getPlaylistById(id)));
      }
    });
    getSearchHistory()
      .then(setRecentSearchQueries)
      .catch(() => { });

    // Restaura a última sessão salva em estado pausado se não houver faixa ativa (TASK-006)
    getPlaybackSession()
      .then(async (session) => {
        if (session && session.track) {
          const active = await getActiveTrack();
          if (!active) {
            const localUri = await getLocalTrackUri(session.track.id);
            if (localUri) {
              if (await getActiveTrack()) return;
              await addTracksToQueue([
                {
                  id: session.track.id,
                  url: localUri,
                  title: session.track.title,
                  artist: session.track.artist,
                  artwork: session.track.thumbnailUrl,
                  duration: session.track.duration,
                },
              ]);
              if (session.positionSec > 0) {
                await seekTo(session.positionSec);
              }
              await pausePlayer();
              await syncPlayerQueue();
            } else if (!(await getActiveTrack())) {
              // Não envia URL fictícia ao ExoPlayer; mantém restaurado na UI e resolve o stream real ao dar Play
              setRestoredSession(session);
            }
          }
        }
      })
      .catch(() => { });

    const appStateSub = AppState.addEventListener?.('change', (nextState) => {
      if (nextState === 'active') {
        void hydrateDownloadQueue().then(() => loadOfflineTracks());
      }
    });

    // Solicita permissão de notificação após o frame inicial estabilizar para evitar race condition na janela do Android 14+
    const permTimer = setTimeout(() => {
      requestNotificationPermission();
    }, 1200);
    if (typeof (permTimer as any).unref === 'function') {
      (permTimer as any).unref();
    }

    let isMounted = true;
    void getInstalledAppVersion()
      .then((info) => {
        if (isMounted) setInstalledAppVersion(info);
      })
      .catch(() => {});

    const updateTimer = setTimeout(() => {
      if (!isMounted) return;
      void cleanupCachedUpdateApks();
      void checkForAppUpdate()
        .then((res) => {
          if (!isMounted) return;
          setInstalledAppVersion(res.installed);
          if (res.status === 'update_available') {
            setAvailableUpdate(res.release);
          }
        })
        .catch(() => {});
    }, 3500);
    if (typeof (updateTimer as any).unref === 'function') {
      (updateTimer as any).unref();
    }

    return () => {
      isMounted = false;
      clearTimeout(permTimer);
      clearTimeout(updateTimer);
      appStateSub?.remove?.();
    };
  }, []);

  // Monitora se a faixa atualmente em reprodução está favoritada
  useEffect(() => {
    if (activeTrack?.id) {
      isFavorite(activeTrack.id)
        .then((fav) => setIsCurrentFavorite(fav))
        .catch(() => { });
    } else {
      setIsCurrentFavorite(false);
    }
  }, [activeTrack?.id]);

  // Carrega histórico recente e ouvintes de resposta à notificação de apoio
  const playtimeTrackerRef = React.useRef<RealPlaytimeTracker>(new RealPlaytimeTracker());
  const navHistoryRef = useRef<NavHistoryEntry[]>([]);
  const lastBackExitPressRef = useRef<number>(0);
  const isPlaylistDetailVisibleRef = useRef<boolean>(false);
  isPlaylistDetailVisibleRef.current = isPlaylistDetailVisible;
  const isOpeningPlaylistRef = useRef<boolean>(false);

  const openNowPlayingPlayer = useCallback(
    (fromDrag = false) => {
      lastBackExitPressRef.current = 0;
      activeMorphAnimRef.current?.stop();
      activeMorphAnimRef.current = null;
      isMiniDraggingRef.current = false;
      if (fromDrag) {
        modalTranslateY.setValue(0);
      } else if (!isNowPlayingVisibleRef.current) {
        modalTranslateY.setValue(collapseDistance);
      }
      // Order matters: called from an Animated callback (no batching on old arch), so
      // clearing isMiniDragging first would render visible=false and snap the player to collapsed.
      setMorphEpoch((e) => e + 1);
      setIsNowPlayingVisible(true);
      setIsMiniDragging(false);
    },
    [collapseDistance, modalTranslateY]
  );

  const closeNowPlayingImmediate = useCallback(() => {
    activeMorphAnimRef.current?.stop();
    activeMorphAnimRef.current = null;
    isMiniDraggingRef.current = false;
    setIsMiniDragging(false);
    modalTranslateY.setValue(collapseDistance);
    setIsNowPlayingVisible(false);
  }, [collapseDistance, modalTranslateY]);

  const handleMiniDragMove = useCallback(
    (dy: number) => {
      if (!isMiniDraggingRef.current) {
        isMiniDraggingRef.current = true;
        setIsMiniDragging(true);
      }
      activeMorphAnimRef.current?.stop();
      activeMorphAnimRef.current = null;
      const nextY = Math.max(0, Math.min(collapseDistance, collapseDistance + dy));
      modalTranslateY.setValue(nextY);
    },
    [collapseDistance, modalTranslateY]
  );

  const handleMiniDragCancel = useCallback(() => {
    activeMorphAnimRef.current?.stop();
    const anim = Animated.spring(modalTranslateY, {
      toValue: collapseDistance,
      bounciness: 4,
      useNativeDriver: true,
    });
    activeMorphAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (activeMorphAnimRef.current === anim) {
        activeMorphAnimRef.current = null;
      }
      if (finished !== false) {
        isMiniDraggingRef.current = false;
        setIsMiniDragging(false);
      }
    });
  }, [collapseDistance, modalTranslateY]);

  const handleMiniDragRelease = useCallback(
    (dy: number, vy: number) => {
      if (dy < -50 || vy < -0.35) {
        const currentY = Math.max(0, Math.min(collapseDistance, collapseDistance + dy));
        modalTranslateY.setValue(currentY);
        activeMorphAnimRef.current?.stop();
        const anim = Animated.timing(modalTranslateY, {
          toValue: 0,
          duration: 240,
          easing: getEaseOutCubic(Easing),
          useNativeDriver: true,
        });
        activeMorphAnimRef.current = anim;
        anim.start(({ finished }) => {
          if (activeMorphAnimRef.current === anim) {
            activeMorphAnimRef.current = null;
          }
          if (finished !== false) {
            openNowPlayingPlayer(true);
          }
        });
      } else {
        handleMiniDragCancel();
      }
    },
    [collapseDistance, handleMiniDragCancel, modalTranslateY, openNowPlayingPlayer]
  );

  const pushNavHistory = useCallback((entry: NavHistoryEntry) => {
    lastBackExitPressRef.current = 0;
    const stack = navHistoryRef.current;
    const top = stack[stack.length - 1];
    if (top && top.tab === entry.tab && top.playlistId === entry.playlistId) {
      return;
    }
    stack.push(entry);
    if (stack.length > 20) {
      stack.shift();
    }
  }, []);

  const openSupportFromNotification = React.useCallback(() => {
    const visibleTab = pendingTab ?? activeTab;
    if (visibleTab !== 'support' || isPlaylistDetailVisible) {
      pushNavHistory({
        tab: visibleTab,
        playlistId: isPlaylistDetailVisible ? selectedPlaylistId : null,
      });
    }
    tabTransitionRef.current?.stop();
    tabTransitionRef.current = null;
    shellTransitionRef.current?.stop();
    shellTransitionRef.current = null;
    isOpeningPlaylistRef.current = false;
    setIsDevMenuVisible(false);
    setIsDownloadQueueVisible(false);
    setIsDrawerVisible(false);
    closeNowPlayingImmediate();
    isPlaylistDetailVisibleRef.current = false;
    setIsPlaylistDetailVisible(false);
    setIsAddToPlaylistVisible(false);
    setIsQuickCreateVisible(false);
    setPendingTab(null);
    setActiveTab('support');
    tabContentOpacity.setValue(1);
    shellOpacity.setValue(1);
  }, [
    pendingTab,
    activeTab,
    isPlaylistDetailVisible,
    selectedPlaylistId,
    pushNavHistory,
    closeNowPlayingImmediate,
    tabContentOpacity,
    shellOpacity,
  ]);

  const fadeOpacity = useCallback(
    (
      animValue: Animated.Value,
      animRef: React.MutableRefObject<Animated.CompositeAnimation | null>,
      toValue: number,
      duration: number,
      onFinished?: () => void
    ) => {
      animRef.current?.stop();
      const easing = getEaseOutCubic(Easing);
      const anim = Animated.timing(animValue, {
        toValue,
        duration,
        easing,
        useNativeDriver: true,
      });
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) {
          onFinished?.();
        }
      });
    },
    []
  );

  const handleTabChange = useCallback(
    (nextTab: MainTab, options?: { skipHistory?: boolean }) => {
      const visibleTab = pendingTab ?? activeTab;
      if (nextTab === visibleTab && !isPlaylistDetailVisible) {
        return;
      }

      if (!options?.skipHistory) {
        pushNavHistory({
          tab: visibleTab,
          playlistId: isPlaylistDetailVisible ? selectedPlaylistId : null,
        });
      } else {
        lastBackExitPressRef.current = 0;
      }

      const wasInPlaylistDetail = isPlaylistDetailVisible;
      shellTransitionRef.current?.stop();
      isOpeningPlaylistRef.current = false;
      isPlaylistDetailVisibleRef.current = false;
      setIsPlaylistDetailVisible(false);

      if (nextTab !== 'search') {
        setIsSearchFocused(false);
      }
      if (nextTab === 'playlists') {
        loadPlaylists();
      } else if (nextTab === 'downloads') {
        loadOfflineTracks();
      }

      if (wasInPlaylistDetail) {
        tabTransitionRef.current?.stop();
        tabContentOpacity.setValue(1);
        setActiveTab(nextTab);
        setPendingTab(null);
        shellOpacity.setValue(0);
        fadeOpacity(
          shellOpacity,
          shellTransitionRef,
          1,
          theme.transitions.screenInMs
        );
        return;
      }

      shellOpacity.setValue(1);

      if (nextTab === activeTab) {
        setPendingTab(null);
        tabContentOpacity.setValue(0);
        fadeOpacity(
          tabContentOpacity,
          tabTransitionRef,
          1,
          theme.transitions.screenInMs
        );
        return;
      }

      setPendingTab(nextTab);
      fadeOpacity(
        tabContentOpacity,
        tabTransitionRef,
        0,
        theme.transitions.screenOutMs,
        () => {
          setActiveTab(nextTab);
          setPendingTab(null);
          fadeOpacity(
            tabContentOpacity,
            tabTransitionRef,
            1,
            theme.transitions.screenInMs
          );
        }
      );
    },
    [
      pendingTab,
      activeTab,
      isPlaylistDetailVisible,
      selectedPlaylistId,
      pushNavHistory,
      tabContentOpacity,
      shellOpacity,
      fadeOpacity,
    ]
  );

  const handlePrefetchPlaylist = useCallback((playlistId: string) => {
    void getPlaylistById(playlistId).catch(() => { });
  }, []);

  const openPlaylistDetail = useCallback(
    (playlistId: string) => {
      if (isPlaylistDetailVisible && selectedPlaylistId === playlistId) {
        return;
      }
      const visibleTab = pendingTab ?? activeTab;
      pushNavHistory({
        tab: visibleTab,
        playlistId: isPlaylistDetailVisible ? selectedPlaylistId : null,
      });
      tabTransitionRef.current?.stop();
      shellTransitionRef.current?.stop();
      isOpeningPlaylistRef.current = false;
      setPendingTab(null);
      void getPlaylistById(playlistId).catch(() => { });
      if (isPlaylistDetailVisible) {
        setSelectedPlaylistId(playlistId);
        return;
      }
      isOpeningPlaylistRef.current = true;
      fadeOpacity(
        shellOpacity,
        shellTransitionRef,
        0,
        theme.transitions.screenOutMs,
        () => {
          isOpeningPlaylistRef.current = false;
          setSelectedPlaylistId(playlistId);
          isPlaylistDetailVisibleRef.current = true;
          setIsPlaylistDetailVisible(true);
        }
      );
    },
    [
      isPlaylistDetailVisible,
      selectedPlaylistId,
      pendingTab,
      activeTab,
      pushNavHistory,
      shellOpacity,
      fadeOpacity,
    ]
  );

  const closePlaylistDetail = useCallback(() => {
    isOpeningPlaylistRef.current = false;
    if (!isPlaylistDetailVisibleRef.current) {
      return;
    }
    lastBackExitPressRef.current = 0;

    const stack = navHistoryRef.current;
    const top = stack[stack.length - 1];
    if (top && top.playlistId) {
      stack.pop();
      setActiveTab(top.tab);
      setPendingTab(null);
      setSelectedPlaylistId(top.playlistId);
      isPlaylistDetailVisibleRef.current = true;
      setIsPlaylistDetailVisible(true);
      return;
    }

    if (top && top.playlistId === null) {
      stack.pop();
      if (top.tab !== activeTab) {
        setActiveTab(top.tab);
        setPendingTab(null);
        if (top.tab === 'playlists') {
          loadPlaylists();
        } else if (top.tab === 'downloads') {
          loadOfflineTracks();
        }
      }
    }

    isPlaylistDetailVisibleRef.current = false;
    setIsPlaylistDetailVisible(false);
    tabContentOpacity.setValue(1);
    shellOpacity.setValue(0);
    fadeOpacity(
      shellOpacity,
      shellTransitionRef,
      1,
      theme.transitions.screenInMs
    );
  }, [activeTab, tabContentOpacity, shellOpacity, fadeOpacity]);

  useEffect(() => {
    if (isNowPlayingVisible && !activeTrack) {
      closeNowPlayingImmediate();
    }
  }, [isNowPlayingVisible, activeTrack, closeNowPlayingImmediate]);

  const handleCheckUpdates = useCallback(
    async (openModal: boolean = false) => {
      if (isCheckingUpdates) {
        if (openModal) setIsUpdateModalVisible(true);
        return;
      }
      if (availableUpdate && openModal) {
        setUpdateCheckError(null);
        setIsUpdateModalVisible(true);
        return;
      }
      if (openModal) {
        setUpdateCheckError(null);
        setIsUpdateModalVisible(true);
      }
      setIsCheckingUpdates(true);
      try {
        const res = await checkForAppUpdate({ force: true });
        setInstalledAppVersion(res.installed);
        if (res.status === 'update_available') {
          setAvailableUpdate(res.release);
          setUpdateCheckError(null);
          setIsUpdateModalVisible(true);
        } else if (res.status === 'up_to_date') {
          setAvailableUpdate(null);
          setUpdateCheckError(null);
          if (!openModal) {
            showToast(`Você já está na versão mais recente (v${res.installed.versionName})`, 'success');
          }
        } else if (res.status === 'error') {
          setUpdateCheckError(res.error);
          if (!openModal) {
            showToast(res.error, 'error');
          }
        }
      } finally {
        setIsCheckingUpdates(false);
      }
    },
    [availableUpdate, isCheckingUpdates, showToast]
  );

  const hasBlockingModalOpen = Boolean(
    (isNowPlayingVisible && activeTrack) ||
    isAddToPlaylistVisible ||
    isDownloadQueueVisible ||
    isUpdateModalVisible ||
    (isDevMode && isDevMenuVisible) ||
    isDrawerVisible
  );

  useBackHandler(
    !isPlaylistDetailVisible &&
    !hasBlockingModalOpen &&
    activeTab === 'playlists' &&
    isQuickCreateVisible,
    () => {
      setIsQuickCreateVisible(false);
      setQuickCreateName('');
      return true;
    },
    BACK_PRIORITY.INLINE_OVERLAY
  );

  useBackHandler(
    !isPlaylistDetailVisible &&
    !hasBlockingModalOpen &&
    activeTab === 'downloads' &&
    downloadsSearchQuery.trim().length > 0,
    () => {
      setDownloadsSearchQuery('');
      return true;
    },
    BACK_PRIORITY.SUBSCREEN_MODE
  );

  useBackHandler(
    !isPlaylistDetailVisible && !hasBlockingModalOpen,
    () => {
      if (isOpeningPlaylistRef.current) {
        isOpeningPlaylistRef.current = false;
        shellTransitionRef.current?.stop();
        shellTransitionRef.current = null;
        const stack = navHistoryRef.current;
        if (stack.length > 0 && stack[stack.length - 1].playlistId === null) {
          stack.pop();
        }
        lastBackExitPressRef.current = 0;
        fadeOpacity(
          shellOpacity,
          shellTransitionRef,
          1,
          theme.transitions.screenInMs
        );
        return true;
      }

      const stack = navHistoryRef.current;
      if (stack.length > 0) {
        const prev = stack.pop()!;
        lastBackExitPressRef.current = 0;
        if (prev.playlistId) {
          setActiveTab(prev.tab);
          setPendingTab(null);
          setSelectedPlaylistId(prev.playlistId);
          isPlaylistDetailVisibleRef.current = true;
          setIsPlaylistDetailVisible(true);
        } else {
          handleTabChange(prev.tab, { skipHistory: true });
        }
        return true;
      }

      const currentTab = pendingTab ?? activeTab;
      if (currentTab !== 'search') {
        lastBackExitPressRef.current = 0;
        handleTabChange('search', { skipHistory: true });
        return true;
      }

      const now = Date.now();
      if (now - lastBackExitPressRef.current < EXIT_PROMPT_MS) {
        lastBackExitPressRef.current = 0;
        setToastMessage(null);
        return false;
      }

      lastBackExitPressRef.current = now;
      setToastMessage(EXIT_PROMPT_MESSAGE);
      return true;
    },
    BACK_PRIORITY.TAB_HISTORY
  );

  useEffect(() => {
    return () => {
      tabTransitionRef.current?.stop();
      shellTransitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    return attachSupportNotificationListeners(openSupportFromNotification);
  }, [openSupportFromNotification]);

  // Rastreamento de reprodução real (>= 30s) para disparo de notificação de apoio
  useEffect(() => {
    if (!nativeActiveTrack?.id) {
      playtimeTrackerRef.current.reset();
      return;
    }
    if (!isPlaying) return;

    let active = true;
    const trackId = nativeActiveTrack.id;

    const sampleProgress = async () => {
      try {
        const progress = await getProgress();
        if (!active) return;
        const counted = playtimeTrackerRef.current.recordProgressSample(
          trackId,
          progress.position
        );
        if (counted) {
          await incrementDailySupportPlayCount();
          await triggerSupportNotificationIfEligible();
        }
      } catch {
        // Ignora erro transitório de leitura de progresso
      }
    };

    sampleProgress();
    const interval = setInterval(sampleProgress, 1000);
    if (interval && typeof (interval as any).unref === 'function') {
      (interval as any).unref();
    }

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isPlaying, nativeActiveTrack?.id]);

  // Limpeza automática do banner de erro quando a reprodução inicia com sucesso
  useEffect(() => {
    if (isPlaying) {
      setErrorMessage(null);
    }
  }, [isPlaying]);

  // Limpeza automática do banner de erro após 8 segundos
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  const handleToggleFavorite = async () => {
    if (!activeTrack?.id) return;
    try {
      const input: TrackInput = {
        id: activeTrack.id,
        title: activeTrack.title || 'Música',
        artist: activeTrack.artist || 'Artista',
        duration: activeTrack.duration || 0,
        thumbnailUrl:
          typeof activeTrack.artwork === 'string' ? activeTrack.artwork : '',
      };
      const nowFav = await toggleFavorite(input);
      setIsCurrentFavorite(nowFav);
      setFavoriteTrackIds((prev) => {
        const next = new Set(prev);
        if (nowFav) next.add(activeTrack.id);
        else next.delete(activeTrack.id);
        return next;
      });
      await loadPlaylists();
    } catch (err) {
      console.error('Falha ao alternar favorito:', err);
    }
  };

  const handleOpenAddToPlaylist = (track: TrackInput | PlayableTrack) => {
    setTrackToAddToPlaylist({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      thumbnailUrl: track.thumbnailUrl,
    });
    setIsAddToPlaylistVisible(true);
  };

  /**
   * Converte uma faixa clicável para formato de faixa nativa do player
   */
  const resolvePlayableToTrack = async (
    track: PlayableTrack
  ): Promise<Track> => {
    const localUri = await getLocalTrackUri(track.id);
    if (localUri) {
      return {
        id: track.id,
        url: localUri,
        title: track.title,
        artist: track.artist,
        artwork: track.thumbnailUrl,
        duration: track.duration,
      };
    }
    const streamInfo = await getAudioStream(track.id);
    return {
      id: track.id,
      url: streamInfo.streamUrl,
      title: streamInfo.title || track.title,
      artist: streamInfo.artist || track.artist,
      artwork: streamInfo.thumbnailUrl || track.thumbnailUrl,
      duration: streamInfo.duration || track.duration,
      userAgent: streamInfo.userAgent,
      headers: streamInfo.headers,
      contentType: streamInfo.mimeType,
    };
  };

  /**
   * Resolve e adiciona em ordem todas as faixas restantes de uma playlist logo após a faixa escolhida.
   * Interrompe imediatamente se a geração da fila mudar (troca de faixa/playlist pelo usuário).
   */
  const enqueuePlaylistRemainingTracks = async (
    epoch: number,
    remainingTracks: PlayableTrack[]
  ) => {
    if (!remainingTracks || remainingTracks.length === 0) return;

    const BATCH_SIZE = 4;
    for (let i = 0; i < remainingTracks.length; i += BATCH_SIZE) {
      if (queueGenerationRef.current !== epoch) return;
      const chunk = remainingTracks.slice(i, i + BATCH_SIZE);

      const resolvedChunk = await Promise.all(
        chunk.map(async (item): Promise<Track | null> => {
          if (!item?.id || queuedTrackIdsRef.current.has(item.id)) {
            return null;
          }
          try {
            return await resolvePlayableToTrack(item);
          } catch (err) {
            console.warn('[PlaylistQueue] Falha ao resolver faixa da playlist:', item.id, err);
            return null;
          }
        })
      );

      if (queueGenerationRef.current !== epoch) return;

      const validTracks = resolvedChunk.filter((t): t is Track => {
        if (!t || queuedTrackIdsRef.current.has(t.id)) return false;
        queuedTrackIdsRef.current.add(t.id);
        return true;
      });

      if (validTracks.length > 0) {
        await addTracksToQueue(validTracks);
        if (queueGenerationRef.current !== epoch) return;
        await syncPlayerQueue();
      }
    }
  };

  const handlePlayPlaylist = async (
    tracks: PlaylistTrackItem[],
    startIndex: number = 0
  ) => {
    if (!tracks || tracks.length === 0) return;
    const safeIndex = startIndex >= 0 && startIndex < tracks.length ? startIndex : 0;
    activePlaylistRef.current = {
      type: 'playlist',
      tracks,
    };
    const targetTrack = tracks[safeIndex];
    await handleSelectTrack(targetTrack, safeIndex, {
      resetQueueForPlaylist: true,
    });
  };

  const handleQuickCreatePlaylist = async () => {
    if (!quickCreateName.trim()) return;
    try {
      await createPlaylist(quickCreateName.trim());
      setQuickCreateName('');
      setIsQuickCreateVisible(false);
      await loadPlaylists();
    } catch (err) {
      console.error('Falha ao criar playlist rápida:', err);
    }
  };

  const handleSearch = async (overrideQuery?: string) => {
    const targetQuery = typeof overrideQuery === 'string' ? overrideQuery : query;
    const trimmed = targetQuery.trim();
    if (!trimmed) return;
    lastBackExitPressRef.current = 0;

    if (typeof overrideQuery === 'string') {
      setQuery(overrideQuery);
    }

    recordSearchHistory(trimmed)
      .then(setRecentSearchQueries)
      .catch(() => { });

    setIsSearching(true);
    setIsLoadingMoreSearch(false);
    setSearchContinuationToken(null);
    setLastSearchedQuery(trimmed);
    setErrorMessage(null);

    try {
      const page = await searchTracksPage(trimmed, { targetCount: 30 });
      setSearchResults(page.tracks);
      setSearchContinuationToken(page.continuationToken);

      // Consulta em lote no SQLite sem descartar IDs já carregados de playlists/aba Baixadas
      const resultIds = page.tracks.map((t) => t.id);
      const downloadedSet = await getDownloadedTrackIds(resultIds);
      setDownloadedIds((prev) => new Set([...prev, ...downloadedSet]));

      const favoriteSet = await getFavoriteTrackIds(resultIds);
      setFavoriteTrackIds(favoriteSet);
    } catch (err: unknown) {
      if (err instanceof AllInstancesFailedError) {
        setErrorMessage(
          'Todas as instâncias da API falharam. Verifique sua conexão ou tente mais tarde.'
        );
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : 'Ocorreu um erro ao buscar músicas.'
        );
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadMoreSearch = async () => {
    if (isSearching || isLoadingMoreSearch || !searchContinuationToken || !lastSearchedQuery) {
      return;
    }

    setIsLoadingMoreSearch(true);
    setErrorMessage(null);

    try {
      const existingIds = new Set(searchResults.map((t) => t.id));
      const page = await searchTracksPage(lastSearchedQuery, {
        targetCount: 30,
        continuationToken: searchContinuationToken,
        excludeIds: existingIds,
      });

      const uniqueNew = page.tracks.filter((t) => !existingIds.has(t.id));
      if (uniqueNew.length > 0) {
        setSearchResults((prev) => {
          const prevIds = new Set(prev.map((t) => t.id));
          const merged = [...prev];
          for (const t of uniqueNew) {
            if (!prevIds.has(t.id)) {
              prevIds.add(t.id);
              merged.push(t);
            }
          }
          return merged;
        });

        const newIds = uniqueNew.map((t) => t.id);
        const [newDownloaded, newFavorites] = await Promise.all([
          getDownloadedTrackIds(newIds),
          getFavoriteTrackIds(newIds),
        ]);
        setDownloadedIds((prev) => new Set([...prev, ...newDownloaded]));
        setFavoriteTrackIds((prev) => new Set([...prev, ...newFavorites]));
      }

      setSearchContinuationToken(page.continuationToken);
    } catch (err: unknown) {
      if (err instanceof AllInstancesFailedError) {
        setErrorMessage(
          'Todas as instâncias da API falharam ao carregar mais músicas.'
        );
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : 'Não foi possível carregar mais músicas.'
        );
      }
    } finally {
      setIsLoadingMoreSearch(false);
    }
  };

  /**
   * Reproduz faixa selecionada.
   * Arquitetura Cache-First com Fila Contínua:
   * - Na biblioteca offline: carrega a lista baixada inteira na fila nativa para auto-advance e skip imediatos.
   * - Na busca online / playlists: toca a faixa instantaneamente via streaming progressivo e pré-enfileira as próximas faixas.
   */
  const handleSelectTrack = async (
    track: PlayableTrack,
    index?: number,
    options?: { resetQueueForPlaylist?: boolean; preservePlaylistContext?: boolean }
  ) => {
    const selectionEpoch = ++queueGenerationRef.current;
    const isPlaylistReset = Boolean(options?.resetQueueForPlaylist);
    const keepPlaylistContext = Boolean(options?.preservePlaylistContext);
    // 1. Checa se o arquivo local físico realmente existe em disco e se há sequência na fila
    const [localUri, existingQueue, existingActiveIdx] = await Promise.all([
      getLocalTrackUri(track.id),
      isPlaylistReset ? Promise.resolve([] as Track[]) : getQueue().catch(() => [] as Track[]),
      isPlaylistReset ? Promise.resolve(undefined) : getActiveTrackIndex().catch(() => undefined),
    ]);
    if (queueGenerationRef.current !== selectionEpoch) return;

    const hasPreservedUpcoming =
      !isPlaylistReset &&
      existingActiveIdx !== undefined &&
      existingActiveIdx >= 0 &&
      existingQueue
        .slice(existingActiveIdx + 1)
        .some((t) => t.id !== track.id);

    setIsLoadingAudio(true);
    setErrorMessage(null);

    try {
      // Se não há sequência futura e estamos na aba de downloads, carrega toda a coleção offline
      if (
        localUri &&
        !hasPreservedUpcoming &&
        !isPlaylistReset &&
        activePlaylistRef.current.type !== 'playlist' &&
        activeTab === 'downloads' &&
        downloadedTracks.length > 0
      ) {
        activePlaylistRef.current = {
          type: 'downloads',
          tracks: downloadedTracks,
        };

        const selectedIndex =
          index !== undefined
            ? index
            : downloadedTracks.findIndex((t) => t.id === track.id);

        const queueTracks = downloadedTracks.map((t) => ({
          id: t.id,
          url: t.localUri,
          title: t.title,
          artist: t.artist,
          artwork: t.thumbnailUrl,
          duration: t.duration,
        }));

        selectionHandledRef.current = { epoch: selectionEpoch, trackId: track.id };
        await playTrackList(queueTracks, Math.max(0, selectedIndex));
        if (queueGenerationRef.current !== selectionEpoch) return;
        queuedTrackIdsRef.current = new Set(queueTracks.map((t) => t.id));
        radioContinuationRef.current = undefined;
        setIsShuffleActive(false);
        originalQueueRef.current = [];
        setRestoredSession(null);
        await syncPlayerQueue();
        return;
      }

      // Garante registro offline local quando o arquivo existe em disco; se foi apagado externamente, limpa SQLite
      let playbackParams: Parameters<typeof playTrackPreservingQueue>[0];
      if (localUri) {
        const alreadyInDb = downloadedIds.has(track.id) || (await isDownloaded(track.id));
        if (queueGenerationRef.current !== selectionEpoch) return;
        if (!alreadyInDb) {
          const trackSummary: TrackSummary = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnailUrl: track.thumbnailUrl,
            formattedDuration:
              'formattedDuration' in track && track.formattedDuration
                ? track.formattedDuration
                : formatSeconds(track.duration),
          };
          await registerLocalTrackIfMissing(trackSummary);
          await loadOfflineTracks();
          if (queueGenerationRef.current !== selectionEpoch) return;
        }

        playbackParams = {
          id: track.id,
          url: localUri,
          title: track.title,
          artist: track.artist,
          artwork: track.thumbnailUrl,
          duration: track.duration,
        };
      } else {
        if ('localUri' in track) {
          await deleteDownloadedTrack(track.id);
          await loadOfflineTracks();
          if (queueGenerationRef.current !== selectionEpoch) return;
        }

        const streamInfo = await getAudioStream(track.id);
        if (queueGenerationRef.current !== selectionEpoch) return;

        playbackParams = {
          id: track.id,
          url: streamInfo.streamUrl,
          title: streamInfo.title || track.title,
          artist: streamInfo.artist || track.artist,
          artwork: streamInfo.thumbnailUrl || track.thumbnailUrl,
          duration: streamInfo.duration || track.duration,
          userAgent: streamInfo.userAgent,
          headers: streamInfo.headers,
          contentType: streamInfo.mimeType,
        };
      }

      if (!isPlaylistReset && !keepPlaylistContext) {
        activePlaylistRef.current = {
          type: 'search',
          tracks: searchResults,
        };
      }

      selectionHandledRef.current = { epoch: selectionEpoch, trackId: track.id };
      const { preservedUpcomingCount } = isPlaylistReset
        ? (await playTrack(playbackParams), { preservedUpcomingCount: 0 })
        : await playTrackPreservingQueue(playbackParams);
      if (queueGenerationRef.current !== selectionEpoch) return;

      setRestoredSession(null);
      setIsShuffleActive(false);
      originalQueueRef.current = [];

      if (preservedUpcomingCount > 0) {
        // Mantém exatamente a fila já inserida pelo usuário sem re-aleatorizar ou injetar novas faixas
        const updatedQueue = await getQueue().catch(() => [] as Track[]);
        queuedTrackIdsRef.current = new Set(updatedQueue.map((t) => t.id));
        await syncPlayerQueue();
        return;
      }

      // Exceção de playlist ou fila vazia: inicia fila limpa a partir da faixa escolhida
      queuedTrackIdsRef.current = new Set([track.id]);
      radioContinuationRef.current = undefined;
      await syncPlayerQueue();

      const activeList = activePlaylistRef.current.tracks;
      const currentIndex =
        index !== undefined
          ? index
          : activeList.findIndex((t) => t.id === track.id);

      if (isPlaylistReset) {
        const remainingPlaylistTracks =
          currentIndex >= 0 ? activeList.slice(currentIndex + 1) : [];
        if (remainingPlaylistTracks.length > 0) {
          void enqueuePlaylistRemainingTracks(selectionEpoch, remainingPlaylistTracks);
          return;
        }
      }

      void fillUpcomingQueueIfEmpty(selectionEpoch, {
        id: track.id,
        title: playbackParams.title,
        artist: playbackParams.artist,
      });
    } catch (err: unknown) {
      if (queueGenerationRef.current === selectionEpoch) {
        selectionHandledRef.current = null;
      }
      if (err instanceof AllInstancesFailedError) {
        setErrorMessage('Falha ao obter áudio: instâncias da API indisponíveis.');
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : 'Erro ao processar e reproduzir a faixa.'
        );
      }
    } finally {
      setIsLoadingAudio(false);
    }
  };

  /**
   * Retoma uma sessão restaurada sob demanda ao pressionar Play,
   * resolvendo o stream real (ou arquivo local) e restaurando a posição salva.
   */
  const resumeRestoredSession = async (
    session: PlaybackSessionState
  ): Promise<boolean> => {
    if (isLoadingAudio) return false;
    setIsLoadingAudio(true);
    setErrorMessage(null);
    try {
      const localUri = await getLocalTrackUri(session.track.id);
      queuedTrackIdsRef.current.clear();
      queuedTrackIdsRef.current.add(session.track.id);

      if (localUri) {
        await playTrack({
          id: session.track.id,
          url: localUri,
          title: session.track.title,
          artist: session.track.artist,
          artwork: session.track.thumbnailUrl,
          duration: session.track.duration,
        });
      } else {
        const streamInfo = await getAudioStream(session.track.id);
        await playTrack({
          id: session.track.id,
          url: streamInfo.streamUrl,
          title: streamInfo.title || session.track.title,
          artist: streamInfo.artist || session.track.artist,
          artwork: streamInfo.thumbnailUrl || session.track.thumbnailUrl,
          duration: streamInfo.duration || session.track.duration,
          userAgent: streamInfo.userAgent,
          headers: streamInfo.headers,
          contentType: streamInfo.mimeType,
        });
      }

      if (session.positionSec > 0) {
        await seekTo(session.positionSec);
      }
      setRestoredSession(null);
      return true;
    } catch (err: unknown) {
      if (err instanceof AllInstancesFailedError) {
        setErrorMessage('Falha ao obter áudio: instâncias da API indisponíveis.');
      } else {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Erro ao processar e reproduzir a faixa.'
        );
      }
      return false;
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const handleTogglePlay = async () => {
    try {
      if (!nativeActiveTrack && restoredSession) {
        await resumeRestoredSession(restoredSession);
        return;
      }
      await togglePlayback();
    } catch (err) {
      console.error('Erro ao alternar reprodução:', err);
    }
  };

  const handleSeekTo = async (positionInSeconds: number) => {
    if (!nativeActiveTrack && restoredSession) {
      const duration = restoredSession.track.duration || 0;
      const clamped =
        duration > 0
          ? Math.max(0, Math.min(duration, positionInSeconds))
          : Math.max(0, positionInSeconds);
      const updated = { ...restoredSession, positionSec: clamped };
      setRestoredSession(updated);
      savePlaybackSession(updated).catch(() => { });
      return;
    }
    await seekTo(positionInSeconds);
  };

  const handleSeekRelative = async (seconds: number) => {
    if (!nativeActiveTrack && restoredSession) {
      await handleSeekTo(restoredSession.positionSec + seconds);
      return;
    }
    await seekRelative(seconds);
  };

  const handleSkipNext = async () => {
    if (isLoadingAudio) return;
    if (!nativeActiveTrack && restoredSession) return;
    try {
      const skipped = await skipToNext();
      if (!skipped) {
        // Se a fila nativa atingiu o fim ou a próxima ainda não foi pré-carregada no buffer nativo:
        const { type, tracks } = activePlaylistRef.current;
        if (activeTrack && tracks.length > 0) {
          const currentIdx = tracks.findIndex((t) => t.id === activeTrack.id);
          if (currentIdx >= 0 && currentIdx < tracks.length - 1) {
            await handleSelectTrack(tracks[currentIdx + 1], currentIdx + 1, {
              preservePlaylistContext: type === 'playlist',
            });
          }
        }
      }
    } catch (err) {
      console.warn('[Player] Erro ao avançar faixa:', err);
    }
  };

  const handleSkipPrevious = async (forcePreviousTrack: boolean = false) => {
    if (isLoadingAudio) return;
    const shouldForcePrevious = forcePreviousTrack === true;
    if (!nativeActiveTrack && restoredSession) {
      if (!shouldForcePrevious && restoredSession.positionSec > 3) {
        await handleSeekTo(0);
      }
      return;
    }
    try {
      const skipped = await skipToPrevious(shouldForcePrevious);
      if (!skipped) {
        // Se a fila nativa não tinha item anterior mas a lista ativa possui:
        const { type, tracks } = activePlaylistRef.current;
        if (activeTrack && tracks.length > 0) {
          const currentIdx = tracks.findIndex((t) => t.id === activeTrack.id);
          if (currentIdx > 0) {
            await handleSelectTrack(tracks[currentIdx - 1], currentIdx - 1, {
              preservePlaylistContext: type === 'playlist',
            });
            return;
          }
        }
        if (shouldForcePrevious) {
          await seekTo(0).catch(() => { });
        }
      }
    } catch (err) {
      console.warn('[Player] Erro ao retroceder faixa:', err);
    }
  };

  const handleToggleRepeat = async () => {
    try {
      const nextMode =
        repeatMode === RepeatMode.Off
          ? RepeatMode.Queue
          : repeatMode === RepeatMode.Queue
            ? RepeatMode.Track
            : RepeatMode.Off;
      repeatModeRef.current = nextMode;
      setRepeatModeState(nextMode);
      await setRepeatMode(nextMode);
    } catch (err) {
      console.warn('Erro ao alternar repetição:', err);
    }
  };

  const handleToggleShuffle = async () => {
    try {
      const nextState = !isShuffleActive;
      setIsShuffleActive(nextState);
      if (nextState) {
        const [currentQueue, nativeIdx] = await Promise.all([
          getQueue(),
          getActiveTrackIndex(),
        ]);
        originalQueueRef.current = [...currentQueue];
        if (activeTrack?.id) {
          await enableShuffle(currentQueue, activeTrack.id, nativeIdx);
        }
      } else if (originalQueueRef.current.length > 0 && activeTrack?.id) {
        await disableShuffle(originalQueueRef.current, activeTrack.id);
      }
      await syncPlayerQueue();
    } catch (err) {
      console.warn('Erro ao alternar ordem aleatória:', err);
    }
  };

  /**
   * Toca a faixa selecionada a seguir na fila nativa (TASK-004)
   */
  const handlePlayNext = async (track: PlayableTrack) => {
    try {
      const playerTrack = await resolvePlayableToTrack(track);
      queuedTrackIdsRef.current.add(track.id);
      await playNextTrack(playerTrack);
      setToastMessage(`"${track.title}" será tocada a seguir`);
      await syncPlayerQueue();
    } catch (err) {
      console.warn('[Queue] Erro ao reproduzir a seguir:', err);
    }
  };

  /**
   * Adiciona a faixa selecionada ao fim absoluto da fila nativa (TASK-004)
   */
  const handleAddToQueue = async (track: PlayableTrack) => {
    try {
      const playerTrack = await resolvePlayableToTrack(track);
      queuedTrackIdsRef.current.add(track.id);
      await addTrackToEndOfQueue(playerTrack);
      setToastMessage(`"${track.title}" adicionada ao fim da fila`);
      await syncPlayerQueue();
    } catch (err) {
      console.warn('[Queue] Erro ao adicionar ao fim da fila:', err);
    }
  };

  const handleToggleMute = async () => {
    try {
      const nextVol = volume === 0 ? 1.0 : 0.0;
      setVolumeState(nextVol);
      await setVolume(nextVol);
    } catch (err) {
      console.warn('Erro ao alternar mudo:', err);
    }
  };

  /**
   * Atalhos de Teclado e Controles de Mídia Globais (Padrão YouTube Music)
   * Suporta Espaço/K (Play/Pause), Setas/J/L (Seek +/-5s), M (Mudo), N/P (Próxima/Anterior), Esc (Fechar Modal)
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;

    const handleKeyDown = (e: any) => {
      const activeTag = (document?.activeElement?.tagName || '').toLowerCase();
      if (
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        (document?.activeElement as any)?.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault?.();
          handleTogglePlay();
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          e.preventDefault?.();
          handleSeekRelative(5);
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault?.();
          handleSeekRelative(-5);
          break;
        case 'm':
        case 'M':
          e.preventDefault?.();
          handleToggleMute();
          break;
        case 'n':
        case 'N':
          e.preventDefault?.();
          handleSkipNext();
          break;
        case 'p':
        case 'P':
          e.preventDefault?.();
          handleSkipPrevious();
          break;
        case 'Escape':
          if (isNowPlayingVisible) {
            e.preventDefault?.();
            closeNowPlayingImmediate();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isNowPlayingVisible,
    volume,
    isLoadingAudio,
    nativeActiveTrack?.id,
    restoredSession,
    closeNowPlayingImmediate,
  ]);

  const queuedDownloadIds = React.useMemo(
    () =>
      new Set(
        downloadQueue
          .filter((i) => i.status === 'pending')
          .map((i) => i.track.id)
      ),
    [downloadQueue]
  );

  const downloadQueueBadgeCount = React.useMemo(
    () =>
      downloadQueue.filter(
        (i) => i.status === 'downloading' || i.status === 'pending'
      ).length,
    [downloadQueue]
  );

  const hasDownloadErrors = React.useMemo(
    () => downloadQueue.some((i) => i.status === 'error'),
    [downloadQueue]
  );

  // Sincroniza a fila de downloads com a UI, lista offline e erros
  useEffect(() => {
    const unsubscribe = subscribeDownloadQueue((queue) => {
      setDownloadQueue(queue);
      const active = queue.find((i) => i.status === 'downloading');
      if (active) {
        setDownloadingId(active.track.id);
        setDownloadProgress(Math.round(active.progress * 100));
      } else {
        setDownloadingId(null);
        setDownloadProgress(0);
      }

      // Limpa registro de erros para faixas re-enfileiradas ou concluídas
      for (const item of queue) {
        if (item.status !== 'error') {
          reportedDownloadErrorMapRef.current.delete(item.track.id);
        }
      }

      const completedItems = queue.filter((i) => i.status === 'completed');
      const completedIds = completedItems.map((i) => i.track.id);
      const newlyCompleted = completedItems.filter(
        (i) => !syncedCompletedIdsRef.current.has(i.track.id)
      );
      syncedCompletedIdsRef.current = new Set(completedIds);
      if (newlyCompleted.length > 0) {
        void loadOfflineTracks();
        if (hasHydratedQueueRef.current) {
          const lastCompleted = newlyCompleted[newlyCompleted.length - 1];
          if (lastCompleted?.track?.title) {
            showToast(`"${lastCompleted.track.title}" salva em Baixadas`, 'success');
          }
        }
      }

      if (!hasHydratedQueueRef.current) {
        for (const item of queue) {
          if (item.status === 'error') {
            reportedDownloadErrorMapRef.current.set(
              item.track.id,
              item.error || 'Erro desconhecido'
            );
          }
        }
      } else {
        const failedItem = queue.find((i) => {
          if (i.status !== 'error') return false;
          const msg = i.error || 'Erro desconhecido';
          return reportedDownloadErrorMapRef.current.get(i.track.id) !== msg;
        });
        if (failedItem) {
          const reason = failedItem.error || 'Não foi possível concluir o download.';
          reportedDownloadErrorMapRef.current.set(failedItem.track.id, reason);
          const friendlyMsg = `Falha ao baixar "${failedItem.track.title}": ${reason}`;
          setErrorMessage(friendlyMsg);
          showToast(friendlyMsg, 'error');
        }
      }
    });
    return () => unsubscribe();
  }, [showToast]);

  const handleDownload = (track: TrackSummary) => {
    if (!track || !track.id) return;
    if (downloadedIds.has(track.id)) {
      showToast(`"${track.title}" já está salva em Baixadas`, 'success');
      return;
    }
    setErrorMessage(null);
    reportedDownloadErrorMapRef.current.delete(track.id);
    const result = enqueueDownload(track);
    if (result === 'already_queued') {
      showToast(`"${track.title}" já está na fila de downloads`, 'success');
      return;
    }
    if (result === 'queued') {
      const activeOrPending = getDownloadQueue().filter(
        (i) => i.status === 'pending' || i.status === 'downloading'
      ).length;
      showToast(
        `"${track.title}" adicionada à fila (${activeOrPending} na fila)`,
        'success'
      );
      return;
    }
    showToast(`Baixando "${track.title}"...`, 'success');
  };

  const handleDeleteOfflineTrack = async (id: string) => {
    try {
      // Se a faixa excluída for a que está tocando, interrompe o player para evitar crash de I/O
      if (nativeActiveTrack?.id === id) {
        await resetPlayer();
      }
      if (restoredSession?.track.id === id) {
        setRestoredSession(null);
      }
      await deleteDownloadedTrack(id);
      await loadOfflineTracks();
    } catch (err) {
      console.error('Falha ao remover faixa offline:', err);
    }
  };

  const formatSeconds = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView
        style={styles.container}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h >= 200) {
            setSafeAreaHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
          }
        }}
      >
        <StatusBar
          barStyle="light-content"
          backgroundColor="transparent"
          translucent={true}
        />

        <Animated.View
          testID="app-shell-perspective-layer"
          pointerEvents={isDrawerVisible ? 'none' : 'auto'}
          style={[
            styles.appShell,
            {
              overflow: 'hidden',
              transform: [{ translateX: shellDrawerTranslateX }],
            },
          ]}
        >
        <View style={styles.shellContainer}>
          {/* Barra Lateral Expansível YouTube Music para Telas Grandes / Desktop */}
          {isDesktop && (
            <YouTubeMusicSidebar
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
              activeTab={pendingTab ?? activeTab}
              onTabChange={handleTabChange}
              playlists={playlists}
              onSelectPlaylist={openPlaylistDetail}
              onPrefetchPlaylist={handlePrefetchPlaylist}
              onQuickCreatePlaylist={() => {
                setIsQuickCreateVisible(true);
                handleTabChange('playlists');
              }}
            />
          )}

          <View style={styles.mainContent}>
            {/* Gradiente Atmosférico de Topo Reativo (YouTube Music Deep Dark Glow) */}
            <AtmosphericGradient height={320} glowColor={activeGlowColor} />

            {isPlaylistDetailVisible ? (
              <PlaylistDetailModal
                visible={isPlaylistDetailVisible}
                playlistId={selectedPlaylistId}
                initialPlaylist={
                  playlists.find((p) => p.id === selectedPlaylistId) ?? null
                }
                currentActiveTrackId={activeTrack?.id}
                isPlaying={isPlaying}
                downloadedTrackIds={downloadedIds}
                onClose={closePlaylistDetail}
                onPlayTrack={(track, index, allTracks) => {
                  const targetId = track.trackId || track.id;
                  const realIdx = allTracks.findIndex(
                    (t) => (t.trackId || t.id) === targetId
                  );
                  handlePlayPlaylist(allTracks, realIdx >= 0 ? realIdx : index);
                }}
                onPlayAll={(allTracks) => handlePlayPlaylist(allTracks, 0)}
                onPlayNext={handlePlayNext}
                onAddToQueue={handleAddToQueue}
                onAddToPlaylist={handleOpenAddToPlaylist}
                onDownloadTrack={handleDownload}
                onShowToast={showToast}
                onPlaylistUpdated={() => loadPlaylists()}
                onPlaylistDeleted={(deletedId) => {
                  const filtered = navHistoryRef.current.filter(
                    (entry) => entry.playlistId !== deletedId
                  );
                  navHistoryRef.current = filtered.filter(
                    (entry, idx) =>
                      idx === 0 ||
                      entry.tab !== filtered[idx - 1].tab ||
                      entry.playlistId !== filtered[idx - 1].playlistId
                  );
                  loadPlaylists();
                }}
              />
            ) : (
              <Animated.View
                style={[styles.tabContent, { opacity: shellOpacity }]}
                testID="shell-transition-container"
              >
                {/* Header com Identidade Visual Sonary */}
                <BrandHeader
                  onOpenMenu={() => setIsDrawerVisible(true)}
                  downloadQueueCount={downloadQueueBadgeCount}
                  hasDownloadErrors={hasDownloadErrors}
                  hasAvailableUpdate={Boolean(availableUpdate)}
                />

                {/* Alerta de Erro */}
                {errorMessage && (
                  <View style={styles.errorBox}>
                    <AlertCircle color="#FF4E45" size={18} />
                    <Text style={styles.errorText}>{errorMessage}</Text>
                    <TouchableOpacity
                      onPress={() => setErrorMessage(null)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Fechar alerta"
                    >
                      <X color="#FF8A80" size={16} />
                    </TouchableOpacity>
                  </View>
                )}

                <Animated.View
                  style={[styles.tabContent, { opacity: tabContentOpacity }]}
                  testID="tab-transition-container"
                >

                  {/* Conteúdo da Aba Ativa */}
                  {activeTab === 'search' && (
                    <View style={styles.tabContent}>
                      {/* Barra de Pesquisa YouTube Music */}
                      <SearchBarSection
                        query={query}
                        onChangeQuery={setQuery}
                        onSearch={handleSearch}
                        isSearching={isSearching}
                        recentQueries={recentSearchQueries}
                        hasResults={searchResults.length > 0}
                        onFocusChange={setIsSearchFocused}
                        onRemoveRecentQuery={async (item) => {
                          try {
                            const next = await removeSearchHistoryItem(item);
                            setRecentSearchQueries(next);
                          } catch { }
                        }}
                        onClearHistory={async () => {
                          try {
                            await clearSearchHistory();
                            setRecentSearchQueries([]);
                          } catch { }
                        }}
                        onClearSearch={() => {
                          lastBackExitPressRef.current = 0;
                          setQuery('');
                          setSearchResults([]);
                          setSearchContinuationToken(null);
                          setLastSearchedQuery('');
                          setErrorMessage(null);
                        }}
                      />

                      {/* Lista de Resultados Online / Descoberta (oculta durante o modo busca focado) */}
                      {!isSearchFocused && (
                        <FlatList
                          data={searchResults}
                          keyExtractor={(item) => item.id}
                          keyboardShouldPersistTaps="handled"
                          contentContainerStyle={styles.listContent}
                          ListHeaderComponent={
                            searchResults.length > 0 ? (
                              <View style={styles.searchResultsHeaderContainer}>
                                <QuickPicksSection
                                  tracks={searchResults.slice(0, 8).map((t) => ({
                                    id: t.id,
                                    title: t.title,
                                    artist: t.artist,
                                    duration: t.duration,
                                    formattedDuration: t.formattedDuration,
                                    thumbnailUrl: t.thumbnailUrl,
                                  }))}
                                  activeTrackId={activeTrack?.id}
                                  isPlaying={isPlaying}
                                  downloadedTrackIds={downloadedIds}
                                  onSelectTrack={(track, index) => {
                                    const found = searchResults.find((r) => r.id === track.id);
                                    if (found) handleSelectTrack(found, index);
                                  }}
                                  onAddToPlaylist={(track) => {
                                    const found = searchResults.find((r) => r.id === track.id);
                                    if (found) handleOpenAddToPlaylist(found);
                                  }}
                                />
                                <View style={styles.resultsDivider} />
                                <View style={styles.resultsHeaderRow}>
                                  <Text style={styles.resultsHeaderTitle}>Músicas e Resultados</Text>
                                  <View style={styles.resultsBadge}>
                                    <Text style={styles.resultsBadgeText}>
                                      {`${searchResults.length} faixas`}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            ) : null
                          }
                          ListEmptyComponent={
                            isSearching ? (
                              <TrackRowSkeleton count={searchSkeletonRows} fadeBottom />
                            ) : (
                              <View style={styles.emptyContainer}>
                                {/* Seção de Descoberta Rápida por Gênero */}
                                <View style={styles.exploreSection}>
                                  <Text style={styles.exploreEyebrow}>DESCOBERTA RÁPIDA</Text>
                                  <Text style={styles.exploreTitle}>O que você quer ouvir?</Text>
                                  <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    style={styles.genreChipsScroll}
                                    contentContainerStyle={styles.genreChipsRow}
                                    testID="genre-chips-carousel"
                                  >
                                    {[
                                      { label: 'Lo-Fi', Icon: Coffee },
                                      { label: 'Pop', Icon: Headphones },
                                      { label: 'Rock', Icon: Guitar },
                                      { label: 'Acústico', Icon: Moon },
                                      { label: 'MPB', Icon: Sun },
                                      { label: 'Eletrônica', Icon: Zap },
                                      { label: 'Jazz', Icon: Disc3 },
                                      { label: 'Treino', Icon: Dumbbell },
                                    ].map(({ label, Icon }) => (
                                      <TouchableOpacity
                                        key={label}
                                        style={styles.genreChip}
                                        onPress={() => handleSearch(label)}
                                        activeOpacity={0.7}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Explorar gênero ${label}`}
                                      >
                                        <Icon color="#D4D4D8" size={14} strokeWidth={2} />
                                        <Text style={styles.genreChipText}>{label}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </ScrollView>
                                </View>

                                {/* Catálogo de Playlists em 2 colunas estilo álbum */}
                                <View style={styles.catalogSection} testID="search-playlists-catalog">
                                  <Text style={styles.exploreEyebrow}>SUAS COLEÇÕES</Text>
                                  <Text style={styles.exploreTitle}>Suas Playlists</Text>

                                  {playlists.length > 0 ? (
                                    <View style={styles.catalogGrid}>
                                      {playlists.map((pl) => {
                                        const isSystemFavorites = pl.id === FAVORITES_PLAYLIST_ID;
                                        const trackLabel = `${pl.trackCount} ${pl.trackCount === 1 ? 'música' : 'músicas'}`;
                                        return (
                                          <TouchableOpacity
                                            key={pl.id}
                                            style={styles.catalogCard}
                                            onPressIn={() => handlePrefetchPlaylist(pl.id)}
                                            onPress={() => openPlaylistDetail(pl.id)}
                                            activeOpacity={0.78}
                                            accessibilityRole="button"
                                            accessibilityLabel={`Abrir playlist ${pl.name}`}
                                          >
                                            {isSystemFavorites ? (
                                              <FavoritesRubyBadge
                                                iconSize={58}
                                                style={[
                                                  styles.catalogArtworkBox,
                                                  styles.catalogFavoritesArtworkBox,
                                                ]}
                                              />
                                            ) : (
                                              <PlaylistCover
                                                thumbnailUrl={pl.thumbnailUrl}
                                                hasCustomCover={pl.hasCustomCover}
                                                coverThumbnails={pl.coverThumbnails}
                                                borderRadius={12}
                                                iconSize={38}
                                                placeholderColor="#52525B"
                                                placeholderBackgroundColor="#16161A"
                                                style={styles.catalogArtworkBox}
                                              />
                                            )}
                                            <Text style={styles.catalogCardTitle} numberOfLines={1}>
                                              {pl.name}
                                            </Text>
                                            <Text style={styles.catalogCardMeta} numberOfLines={1}>
                                              {trackLabel}
                                            </Text>
                                          </TouchableOpacity>
                                        );
                                      })}
                                    </View>
                                  ) : (
                                    <Text style={styles.catalogEmptyText}>
                                      Pesquise por uma faixa ou crie sua primeira playlist.
                                    </Text>
                                  )}
                                </View>
                              </View>
                            )
                          }
                          renderItem={({ item, index }) => (
                            <TrackCard
                              id={item.id}
                              title={item.title}
                              artist={item.artist}
                              durationText={item.formattedDuration}
                              thumbnailUrl={item.thumbnailUrl}
                              isActive={activeTrack?.id === item.id}
                              isPlaying={isPlaying}
                              isDownloaded={downloadedIds.has(item.id)}
                              isDownloading={downloadingId === item.id}
                              isQueued={queuedDownloadIds.has(item.id)}
                              downloadProgress={downloadProgress}
                              onPress={() => handleSelectTrack(item, index)}
                              onAddToPlaylist={() => handleOpenAddToPlaylist(item)}
                              onDownload={() => handleDownload(item)}
                              onPlayNext={() => handlePlayNext(item)}
                              onAddToQueue={() => handleAddToQueue(item)}
                            />
                          )}
                          ListFooterComponent={
                            !isSearching && searchResults.length > 0 && searchContinuationToken ? (
                              <View style={styles.loadMoreContainer}>
                                <TouchableOpacity
                                  style={[
                                    styles.loadMoreButton,
                                    isLoadingMoreSearch && styles.loadMoreButtonDisabled,
                                  ]}
                                  onPress={handleLoadMoreSearch}
                                  disabled={isLoadingMoreSearch}
                                  activeOpacity={0.75}
                                  accessibilityRole="button"
                                  accessibilityLabel="Carregar mais músicas"
                                  testID="search-load-more-button"
                                >
                                  {isLoadingMoreSearch ? (
                                    <View style={styles.loadMoreInner}>
                                      <ActivityIndicator size="small" color="#FFFFFF" />
                                      <Text style={styles.loadMoreText}>Carregando mais...</Text>
                                    </View>
                                  ) : (
                                    <Text style={styles.loadMoreText}>Carregar mais</Text>
                                  )}
                                </TouchableOpacity>
                              </View>
                            ) : null
                          }
                        />
                      )}
                    </View>
                  )}

                  {/* Aba Playlists / Coleções da Biblioteca */}
                  {activeTab === 'playlists' && (
                    <View style={styles.tabContent}>
                      <LibrarySection
                        playlists={playlists}
                        isLoading={false}
                        isQuickCreateVisible={isQuickCreateVisible}
                        quickCreateName={quickCreateName}
                        onChangeQuickCreateName={setQuickCreateName}
                        onToggleQuickCreate={() => setIsQuickCreateVisible((prev) => !prev)}
                        onSubmitQuickCreate={handleQuickCreatePlaylist}
                        onSelectPlaylist={openPlaylistDetail}
                        onPrefetchPlaylist={handlePrefetchPlaylist}
                      />
                    </View>
                  )}

                  {/* Aba Músicas Baixadas (Biblioteca Offline) */}
                  {activeTab === 'downloads' && (() => {
                    const normalizedDownloadsQuery = downloadsSearchQuery.trim().toLowerCase();
                    const displayedDownloads = normalizedDownloadsQuery
                      ? downloadedTracks.filter(
                        (t) =>
                          t.title.toLowerCase().includes(normalizedDownloadsQuery) ||
                          t.artist.toLowerCase().includes(normalizedDownloadsQuery)
                      )
                      : downloadedTracks;

                    return (
                      <View style={styles.tabContent}>
                        {downloadedTracks.length > 0 && (
                          <View style={styles.downloadsSearchWrapper}>
                            <SearchPillInput
                              value={downloadsSearchQuery}
                              onChangeText={setDownloadsSearchQuery}
                              placeholder="Buscar nas baixadas..."
                              accessibilityLabel="Buscar músicas baixadas"
                              clearAccessibilityLabel="Limpar busca de baixadas"
                            />
                          </View>
                        )}
                        <FlatList
                          data={displayedDownloads}
                          keyExtractor={(item) => item.id}
                          contentContainerStyle={styles.listContent}
                          ListEmptyComponent={
                            <View style={[styles.emptyContainer, styles.emptyDownloadsContainer]}>
                              <FolderDown color="#717171" size={56} />
                              <Text style={styles.emptyTitle}>
                                {normalizedDownloadsQuery
                                  ? 'Nenhuma faixa encontrada'
                                  : 'Nenhuma música baixada'}
                              </Text>
                              <Text style={styles.emptySubtitle}>
                                {normalizedDownloadsQuery
                                  ? `Não foram encontrados resultados para "${downloadsSearchQuery}".`
                                  : 'Suas faixas salvas aparecerão aqui e podem ser ouvidas sem internet.'}
                              </Text>
                            </View>
                          }
                          renderItem={({ item }) => (
                            <TrackCard
                              id={item.id}
                              title={item.title}
                              artist={item.artist}
                              durationText={formatSeconds(item.duration)}
                              thumbnailUrl={item.thumbnailUrl}
                              isActive={activeTrack?.id === item.id}
                              isPlaying={isPlaying}
                              isOfflineList={true}
                              onPress={() => handleSelectTrack(item)}
                              onAddToPlaylist={() => handleOpenAddToPlaylist(item)}
                              onDeleteOffline={() => handleDeleteOfflineTrack(item.id)}
                              onPlayNext={() => handlePlayNext(item)}
                              onAddToQueue={() => handleAddToQueue(item)}
                            />
                          )}
                        />
                      </View>
                    );
                  })()}

                  {/* Aba Apoiar (Contribuição Voluntária via Pix) */}
                  {activeTab === 'support' && (
                    <View style={styles.tabContent}>
                      <SupportSection
                        onShowToast={setToastMessage}
                        appVersion={installedAppVersion?.versionName}
                        onCheckUpdates={() => void handleCheckUpdates(true)}
                        isCheckingUpdates={isCheckingUpdates}
                        hasAvailableUpdate={Boolean(availableUpdate)}
                      />
                    </View>
                  )}
                </Animated.View>

              </Animated.View>
            )}
          </View>
        </View>

        {/* Dock inferior flutuante no mobile para o conteúdo passar atrás do menu estilo Spotify */}
        <View
          style={!isDesktop ? styles.bottomDock : undefined}
          pointerEvents="box-none"
          onLayout={handleBottomDockLayout}
        >
          {/* Mini Player Persistente (Sincronizado Nativo com MediaSession & Tocável para Expandir) */}
          {activeTrack && (
            <Animated.View
              pointerEvents={isNowPlayingVisible ? 'none' : 'auto'}
              style={{
                zIndex: 10,
                opacity: isPersistentPlayerEnv ? 0 : miniPlayerOpacity,
              }}
            >
              <PersistentMiniPlayer
                activeTrack={activeTrack}
                isPlaying={isPlaying}
                isLoadingAudio={isLoadingAudio}
                isBuffering={isBuffering}
                progressPct={
                  !nativeActiveTrack &&
                    restoredSession &&
                    restoredSession.track.duration > 0
                    ? (restoredSession.positionSec /
                      restoredSession.track.duration) *
                    100
                    : undefined
                }
                isFavorite={isCurrentFavorite}
                repeatMode={repeatMode}
                isShuffleActive={isShuffleActive}
                volume={volume}
                onExpand={() => openNowPlayingPlayer(false)}
                onDragMove={handleMiniDragMove}
                onDragRelease={handleMiniDragRelease}
                onDragCancel={handleMiniDragCancel}
                onTogglePlay={handleTogglePlay}
                onSkipNext={handleSkipNext}
                onSkipPrevious={handleSkipPrevious}
                onToggleFavorite={handleToggleFavorite}
                onToggleRepeat={handleToggleRepeat}
                onToggleShuffle={handleToggleShuffle}
                onToggleMute={handleToggleMute}
                onSeek={handleSeekTo}
              />
            </Animated.View>
          )}

          {/* Barra de Navegação Inferior Mobile (< 768px) estilo YouTube Music */}
          {!isDesktop && (
            <Animated.View
              onLayout={(e) => {
                const h = Math.round(e.nativeEvent.layout.height);
                if (h > 20) {
                  setMeasuredNavHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
                }
              }}
              style={{
                zIndex: 1,
                opacity: navBarOpacity,
                transform: [{ translateY: navBarTranslateY }],
              }}
            >
              <NavigationTabBar
                activeTab={pendingTab ?? activeTab}
                onTabChange={handleTabChange}
                playlistCount={playlists.length}
                downloadCount={downloadedTracks.length}
              />
            </Animated.View>
          )}
        </View>

        {/* Modal de Now Playing (Tela Cheia Expandida / Mini Player Persistente dentro do shell para acompanhar o recuo 3D) */}
        {(isPersistentPlayerEnv || isNowPlayingVisible || isMiniDragging) && activeTrack && (
          <NowPlayingModal
            visible={isNowPlayingVisible || isMiniDragging}
            persistentMode={isPersistentPlayerEnv}
            isMiniDragging={isMiniDragging}
            isModalActive={isNowPlayingVisible}
            onClose={() => {
              isMiniDraggingRef.current = false;
              setIsMiniDragging(false);
              setIsNowPlayingVisible(false);
            }}
            onModalWindowShow={() => {
              isMiniDraggingRef.current = false;
              setIsMiniDragging(false);
            }}
            morphTranslateY={modalTranslateY}
            collapseDistance={collapseDistance}
            navBarHeight={navBarHeight}
            morphAnimRef={activeMorphAnimRef}
            morphEpoch={morphEpoch}
            track={activeTrack}
            isPlaying={isPlaying}
            isBuffering={isBuffering || isLoadingAudio}
            onTogglePlay={handleTogglePlay}
            onSkipNext={handleSkipNext}
            onSkipPrevious={handleSkipPrevious}
            onSeekRelative={handleSeekRelative}
            fallbackPosition={
              !nativeActiveTrack && restoredSession
                ? restoredSession.positionSec
                : undefined
            }
            onSeek={handleSeekTo}
            isFavorite={isCurrentFavorite}
            onToggleFavorite={handleToggleFavorite}
            onAddToPlaylist={() => {
              if (activeTrack) {
                handleOpenAddToPlaylist({
                  id: activeTrack.id,
                  title: activeTrack.title || 'Música',
                  artist: activeTrack.artist || 'Artista',
                  duration: activeTrack.duration || 0,
                  thumbnailUrl:
                    typeof activeTrack.artwork === 'string'
                      ? activeTrack.artwork
                      : '',
                });
              }
            }}
            onPlayNext={() => {
              if (activeTrack) {
                handlePlayNext({
                  id: activeTrack.id,
                  title: activeTrack.title || 'Música',
                  artist: activeTrack.artist || 'Artista',
                  duration: activeTrack.duration || 0,
                  formattedDuration: formatSeconds(activeTrack.duration),
                  thumbnailUrl:
                    typeof activeTrack.artwork === 'string'
                      ? activeTrack.artwork
                      : '',
                });
              }
            }}
            onAddToQueue={() => {
              if (activeTrack) {
                handleAddToQueue({
                  id: activeTrack.id,
                  title: activeTrack.title || 'Música',
                  artist: activeTrack.artist || 'Artista',
                  duration: activeTrack.duration || 0,
                  formattedDuration: formatSeconds(activeTrack.duration),
                  thumbnailUrl:
                    typeof activeTrack.artwork === 'string'
                      ? activeTrack.artwork
                      : '',
                });
              }
            }}
            repeatMode={repeatMode}
            onToggleRepeat={handleToggleRepeat}
            isShuffleActive={isShuffleActive}
            onToggleShuffle={handleToggleShuffle}
            previousTrack={activeQueueIndex > 0 ? playerQueue[activeQueueIndex - 1] : null}
            queue={upcomingQueue}
            onSelectQueueTrack={async (qTrack, qIdx) => {
              const targetIndex = activeQueueIndex + 1 + qIdx;
              await skipToIndex(targetIndex);
              await syncPlayerQueue();
            }}
            onRemoveQueueTrack={async (qIdx) => {
              const targetIndex = activeQueueIndex + 1 + qIdx;
              await removeTrackFromQueue(targetIndex);
              await syncPlayerQueue();
            }}
            onMoveQueueTrack={async (fromIdx, toIdx) => {
              const fromTarget = activeQueueIndex + 1 + fromIdx;
              const toTarget = activeQueueIndex + 1 + toIdx;
              await moveTrackInQueue(fromTarget, toTarget);
              await syncPlayerQueue();
            }}
            isDownloaded={activeTrack ? downloadedIds.has(activeTrack.id) : false}
            isDownloading={activeTrack ? downloadingId === activeTrack.id : false}
            isQueued={activeTrack ? queuedDownloadIds.has(activeTrack.id) : false}
            downloadProgress={
              activeTrack && downloadingId === activeTrack.id ? downloadProgress : 0
            }
            onDownload={
              activeTrack
                ? () => {
                  const summary: TrackSummary = {
                    id: activeTrack.id,
                    title: activeTrack.title || 'Música',
                    artist: activeTrack.artist || 'Artista',
                    duration: activeTrack.duration || 0,
                    formattedDuration: formatSeconds(activeTrack.duration),
                    thumbnailUrl:
                      typeof activeTrack.artwork === 'string'
                        ? activeTrack.artwork
                        : '',
                  };
                  handleDownload(summary);
                }
                : undefined
            }
            onStartTrackRadio={handleStartTrackRadio}
            onStartArtistRadio={handleStartArtistRadio}
            isLoadingRadio={isLoadingRadio}
            onPlayRelatedTrack={(relTrack) => {
              handleSelectTrack(relTrack);
            }}
            onAddRelatedToQueue={(relTrack) => {
              handleAddToQueue(relTrack);
            }}
            toastMessage={toastMessage}
            toastVariant={toastVariant}
            onDismissToast={() => {
              setToastMessage(null);
              setToastVariant('success');
            }}
          />
        )}
        </Animated.View>

        {/* Menu Lateral pela Direita */}
        <SideDrawerMenu
          visible={isDrawerVisible}
          progress={drawerProgress}
          onClose={() => setIsDrawerVisible(false)}
          installedVersion={installedAppVersion}
          availableUpdate={availableUpdate}
          downloadQueueCount={downloadQueueBadgeCount}
          isDevMode={isDevMode}
          onOpenDownloadQueue={() => setIsDownloadQueueVisible(true)}
          onOpenRecentHistory={() => showToast('Em breve no Sonary', 'info')}
          onOpenStats={() => showToast('Em breve no Sonary', 'info')}
          onOpenUpdates={() => void handleCheckUpdates(true)}
          onOpenSettings={() => showToast('Em breve no Sonary', 'info')}
          onOpenDevMenu={isDevMode ? () => setIsDevMenuVisible(true) : undefined}
          onOpenSupport={() => handleTabChange('support')}
        />

        {/* Modal de Fila de Downloads */}
        <DownloadQueueModal
          visible={isDownloadQueueVisible}
          queue={downloadQueue}
          onClose={() => setIsDownloadQueueVisible(false)}
          onCancelItem={(trackId) => {
            void cancelDownload(trackId);
          }}
          onRetryItem={(trackId) => {
            retryDownload(trackId);
          }}
          onCancelAll={() => {
            void cancelAllDownloads();
          }}
          onClearFinished={() => {
            clearFinishedDownloads();
          }}
        />

        {/* Modal de Atualização In-App via GitHub Releases */}
        <UpdateModal
          visible={isUpdateModalVisible}
          release={availableUpdate}
          installedVersion={installedAppVersion}
          isChecking={isCheckingUpdates}
          checkError={updateCheckError}
          onCheckNow={() => void handleCheckUpdates(true)}
          onClose={() => {
            setIsUpdateModalVisible(false);
            setUpdateCheckError(null);
          }}
          onSkipVersion={(versionName) => {
            void skipAppUpdateVersion(versionName);
            setAvailableUpdate(null);
            showToast(`Atualização v${versionName} silenciada`, 'success');
          }}
        />

        {/* Modal de Adicionar à Playlist */}
        {isAddToPlaylistVisible && (
          <AddToPlaylistModal
            visible={isAddToPlaylistVisible}
            track={trackToAddToPlaylist}
            onClose={() => setIsAddToPlaylistVisible(false)}
            onPlaylistCreated={() => loadPlaylists()}
            onTrackAdded={() => loadPlaylists()}
          />
        )}

        {/* Menu de Desenvolvimento (exibido apenas com __DEV__ ativo) */}
        {isDevMode && isDevMenuVisible && (
          <DevMenuModal
            visible={isDevMenuVisible}
            onClose={() => setIsDevMenuVisible(false)}
            onShowToast={setToastMessage}
            onNavigateToSupport={openSupportFromNotification}
          />
        )}

        {/* Toast de Feedback no topo da tela para não cobrir o player */}
        <ToastBanner
          message={!isNowPlayingVisible ? toastMessage : null}
          variant={toastVariant}
          onDismiss={() => {
            setToastMessage(null);
            setToastVariant('success');
          }}
          topOffset={
            Platform.OS === 'android'
              ? (StatusBar.currentHeight ?? 0) + 12
              : undefined
          }
        />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#030303',
  },
  appShell: {
    flex: 1,
    zIndex: 1,
    backgroundColor: '#030303',
  },
  shellContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  mainContent: {
    flex: 1,
  },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#030303',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandLogoBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  brandTitleAccent: {
    color: '#FF0000',
  },
  brandSubtitle: {
    fontSize: 12,
    color: '#AAAAAA',
    marginTop: 2,
  },
  categoryChipsWrapper: {
    paddingVertical: 6,
    backgroundColor: '#030303',
  },
  categoryChipsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  categoryChipActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  categoryChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: '#030303',
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginVertical: 6,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#141414',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabButtonActive: {
    backgroundColor: '#282828',
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  tabButtonText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tabContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#212121',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    height: 46,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
  },
  searchButton: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 9999,
    paddingHorizontal: 18,
    height: 46,
  },
  searchButtonText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 14,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 78, 69, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.3)',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#FF8A80',
    fontSize: 12,
  },
  listContent: {
    paddingBottom: 156,
  },
  emptyContainer: {
    paddingTop: 8,
    width: '100%',
    gap: 16,
  },
  emptyDownloadsContainer: {
    paddingTop: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  downloadsSearchWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emptyTitle: {
    color: '#E0E0E0',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#AAAAAA',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  searchResultsHeaderContainer: {
    marginBottom: 4,
  },
  resultsDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 12,
    marginHorizontal: 16,
  },
  resultsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 4,
  },
  resultsHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  resultsBadge: {
    backgroundColor: '#202024',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  resultsBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#AAAAAA',
  },
  loadMoreContainer: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreButton: {
    backgroundColor: '#1C1C20',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 22,
    paddingHorizontal: 24,
    paddingVertical: 11,
    minWidth: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreButtonDisabled: {
    opacity: 0.65,
  },
  loadMoreInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadMoreText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  exploreSection: {
    width: '100%',
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 16,
  },
  exploreEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8E8E93',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  exploreTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  genreChipsScroll: {
    marginHorizontal: -16,
  },
  genreChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  genreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1C1C20',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
  },
  genreChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E4E4E7',
  },
  catalogSection: {
    width: '100%',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  catalogGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 18,
  },
  catalogCard: {
    width: '48%',
  },
  catalogArtworkBox: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: '#16161A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  catalogFavoritesArtworkBox: {
    borderWidth: 0,
  },
  catalogArtworkImage: {
    width: '100%',
    height: '100%',
  },
  catalogCardTitle: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  catalogCardMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '400',
    color: '#8E8E93',
  },
  catalogEmptyText: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 4,
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    padding: 8,
    marginBottom: 8,
  },
  trackCardActive: {
    backgroundColor: '#212121',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
  },
  trackThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 4,
    backgroundColor: '#212121',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  trackTitleActive: {
    color: '#FFFFFF',
  },
  trackArtist: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  downloadButton: {
    padding: 8,
    marginLeft: 4,
  },
  downloadProgressText: {
    color: '#2BA640',
    fontSize: 11,
    fontWeight: 'bold',
  },
  deleteButton: {
    padding: 8,
    marginLeft: 4,
  },
  miniPlayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
    backgroundColor: '#212121',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  miniProgressBarTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#333333',
  },
  miniProgressBarFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
  miniThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#141414',
  },
  miniInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  miniTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  miniArtist: {
    color: '#AAAAAA',
    fontSize: 11,
  },
  miniControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniControlButton: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardActionButton: {
    padding: 8,
    marginRight: 2,
  },
  playlistTabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  sectionHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  createPlaylistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 9999,
    gap: 4,
  },
  createPlaylistButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  quickCreateBox: {
    backgroundColor: '#212121',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  quickCreateInput: {
    backgroundColor: '#141414',
    color: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  quickCreateActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  quickCreateCancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  quickCreateCancelText: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  quickCreateConfirmBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 9999,
  },
  quickCreateConfirmBtnDisabled: {
    backgroundColor: '#FFFFFF',
    opacity: 0.4,
  },
  quickCreateConfirmText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  favoritesHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF0000',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  favoritesHeroIconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  favoritesHeroInfo: {
    flex: 1,
  },
  favoritesHeroTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  favoritesHeroMeta: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginTop: 2,
  },
  playlistRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    padding: 10,
    marginBottom: 8,
  },
  playlistRowThumbnail: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 12,
  },
  playlistRowImage: {
    width: '100%',
    height: '100%',
  },
  playlistRowPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistRowInfo: {
    flex: 1,
  },
  playlistRowName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  playlistRowMeta: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 3,
  },
});
