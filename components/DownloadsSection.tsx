import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronRight,
  Folder,
  FolderCog,
  FolderDown,
  HardDrive,
  ListMusic,
  Play,
  RefreshCw,
  RotateCcw,
  Smartphone,
  X,
} from 'lucide-react-native';
import {
  DownloadedTrack,
  FAVORITES_PLAYLIST_ID,
  LocalDeviceTrack,
  OfflinePlaylistSummary,
} from '../services/database';
import {
  buildLocalFoldersSummary,
  DownloadsSortMode,
} from '../services/localMedia';
import { SearchPillInput } from './SearchBarSection';
import { TrackCard } from './TrackCard';
import { FavoritesRubyBadge } from './LibrarySection';
import { PlaylistCover } from './PlaylistCover';
import { theme } from '../theme';
import { BACK_PRIORITY, useBackHandler, useBackModalLock } from '../services/backNavigation';

export type DownloadsFilterChip = 'all' | 'playlists' | 'device';

export interface UnifiedOfflineTrackItem {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  localUri: string;
  timestamp: number;
  isLocalDevice: boolean;
  isCorrupted: boolean;
  corruptionReason?: string | null;
  folderName?: string;
  downloadedTrack?: DownloadedTrack;
  localTrack?: LocalDeviceTrack;
}

export interface DownloadsSectionProps {
  downloadedTracks: DownloadedTrack[];
  localDeviceTracks: LocalDeviceTrack[];
  offlinePlaylists: OfflinePlaylistSummary[];
  excludedLocalFolders: string[];
  localMediaEnabled: boolean;
  isScanningLocalMedia: boolean;
  sortMode: DownloadsSortMode;
  searchQuery: string;
  activeTrackId?: string;
  isPlaying: boolean;
  hiddenLocalCount: number;
  onChangeSearchQuery: (q: string) => void;
  onChangeSortMode: (mode: DownloadsSortMode) => void;
  onEnableAndScanLocalMedia: () => void;
  onRescanLocalMedia: () => void;
  onToggleExcludedFolder: (folderName: string) => void;
  onRestoreHiddenLocalTracks: () => void;
  onPlayOfflineTrack: (item: UnifiedOfflineTrackItem, visibleQueue: UnifiedOfflineTrackItem[]) => void;
  onOpenOfflinePlaylist: (playlistId: string) => void;
  onPlayOfflinePlaylist: (playlistId: string) => void;
  onAddToPlaylist: (item: UnifiedOfflineTrackItem) => void;
  onDeleteDownloadedTrack: (trackId: string) => void;
  onEditLocalTrack: (track: LocalDeviceTrack) => void;
  onRevalidateLocalTrack: (track: LocalDeviceTrack) => void;
  onHideLocalTrack: (track: LocalDeviceTrack) => void;
  onDeleteLocalTrackFromDevice: (track: LocalDeviceTrack) => void;
  onPlayNext: (item: UnifiedOfflineTrackItem) => void;
  onAddToQueue: (item: UnifiedOfflineTrackItem) => void;
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
  if (hours > 0) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

const SORT_OPTIONS: Array<{ id: DownloadsSortMode; label: string }> = [
  { id: 'recent', label: 'Recentes' },
  { id: 'title', label: 'Título A–Z' },
  { id: 'artist', label: 'Artista A–Z' },
];

function sortUnifiedTracks(
  items: UnifiedOfflineTrackItem[],
  mode: DownloadsSortMode
): UnifiedOfflineTrackItem[] {
  const copy = [...items];
  if (mode === 'title') {
    return copy.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' }));
  }
  if (mode === 'artist') {
    return copy.sort(
      (a, b) =>
        a.artist.localeCompare(b.artist, 'pt-BR', { sensitivity: 'base' }) ||
        a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' })
    );
  }
  return copy.sort((a, b) => b.timestamp - a.timestamp);
}

export const DownloadsSection: React.FC<DownloadsSectionProps> = ({
  downloadedTracks,
  localDeviceTracks,
  offlinePlaylists,
  excludedLocalFolders,
  localMediaEnabled,
  isScanningLocalMedia,
  sortMode,
  searchQuery,
  activeTrackId,
  isPlaying,
  hiddenLocalCount,
  onChangeSearchQuery,
  onChangeSortMode,
  onEnableAndScanLocalMedia,
  onRescanLocalMedia,
  onToggleExcludedFolder,
  onRestoreHiddenLocalTracks,
  onPlayOfflineTrack,
  onOpenOfflinePlaylist,
  onPlayOfflinePlaylist,
  onAddToPlaylist,
  onDeleteDownloadedTrack,
  onEditLocalTrack,
  onRevalidateLocalTrack,
  onHideLocalTrack,
  onDeleteLocalTrackFromDevice,
  onPlayNext,
  onAddToQueue,
}) => {
  const [activeFilter, setActiveFilter] = useState<DownloadsFilterChip>('all');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isFoldersModalVisible, setIsFoldersModalVisible] = useState(false);
  const [isCorruptedExpanded, setIsCorruptedExpanded] = useState(false);

  useBackModalLock(isFoldersModalVisible);

  useBackHandler(
    selectedFolder !== null && activeFilter === 'device',
    () => {
      setSelectedFolder(null);
      return true;
    },
    BACK_PRIORITY.SUBSCREEN_MODE
  );

  const excludedFolderSet = useMemo(
    () => new Set(excludedLocalFolders.map((f) => f.toLowerCase())),
    [excludedLocalFolders]
  );

  const foldersSummary = useMemo(
    () => buildLocalFoldersSummary(localDeviceTracks, excludedLocalFolders),
    [localDeviceTracks, excludedLocalFolders]
  );

  const activeFolders = useMemo(
    () => foldersSummary.filter((f) => !f.isExcluded),
    [foldersSummary]
  );

  const visibleLocalTracks = useMemo(
    () =>
      localDeviceTracks.filter(
        (t) => !excludedFolderSet.has((t.folderName || 'Armazenamento').toLowerCase())
      ),
    [localDeviceTracks, excludedFolderSet]
  );

  const validLocalItems = useMemo<UnifiedOfflineTrackItem[]>(
    () =>
      visibleLocalTracks
        .filter((t) => !t.isCorrupted)
        .map((t) => {
          const rawTs = t.dateModified || t.scannedAt;
          // MediaStore.DATE_MODIFIED retorna segundos; normaliza para ms para comparar com downloadedAt
          const timestampMs = rawTs > 0 && rawTs < 1_000_000_000_000 ? rawTs * 1000 : rawTs;
          return {
            id: t.id,
            title: t.title,
            artist: t.artist,
            duration: t.duration,
            thumbnailUrl: t.thumbnailUrl,
            localUri: t.contentUri,
            timestamp: timestampMs,
            isLocalDevice: true,
            isCorrupted: false,
            folderName: t.folderName,
            localTrack: t,
          };
        }),
    [visibleLocalTracks]
  );

  const corruptedLocalTracks = useMemo(
    () => visibleLocalTracks.filter((t) => t.isCorrupted),
    [visibleLocalTracks]
  );

  const sonaryDownloadedItems = useMemo<UnifiedOfflineTrackItem[]>(
    () =>
      downloadedTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        thumbnailUrl: t.thumbnailUrl,
        localUri: t.localUri,
        timestamp: t.downloadedAt,
        isLocalDevice: false,
        isCorrupted: false,
        downloadedTrack: t,
      })),
    [downloadedTracks]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const allTracksSorted = useMemo(() => {
    const combined = [...sonaryDownloadedItems, ...validLocalItems];
    const filtered = normalizedQuery
      ? combined.filter(
          (t) =>
            t.title.toLowerCase().includes(normalizedQuery) ||
            t.artist.toLowerCase().includes(normalizedQuery)
        )
      : combined;
    return sortUnifiedTracks(filtered, sortMode);
  }, [sonaryDownloadedItems, validLocalItems, normalizedQuery, sortMode]);

  const filteredPlaylists = useMemo(() => {
    if (!normalizedQuery) return offlinePlaylists;
    return offlinePlaylists.filter(
      (pl) =>
        pl.name.toLowerCase().includes(normalizedQuery) ||
        (pl.description ? pl.description.toLowerCase().includes(normalizedQuery) : false)
    );
  }, [offlinePlaylists, normalizedQuery]);

  const deviceValidTracksSorted = useMemo(() => {
    const byFolder = selectedFolder
      ? validLocalItems.filter((t) => t.folderName === selectedFolder)
      : validLocalItems;
    const filtered = normalizedQuery
      ? byFolder.filter(
          (t) =>
            t.title.toLowerCase().includes(normalizedQuery) ||
            t.artist.toLowerCase().includes(normalizedQuery) ||
            (t.folderName || '').toLowerCase().includes(normalizedQuery)
        )
      : byFolder;
    return sortUnifiedTracks(filtered, sortMode);
  }, [validLocalItems, selectedFolder, normalizedQuery, sortMode]);

  const deviceCorruptedFiltered = useMemo(() => {
    const byFolder = selectedFolder
      ? corruptedLocalTracks.filter((t) => t.folderName === selectedFolder)
      : corruptedLocalTracks;
    if (!normalizedQuery) return byFolder;
    return byFolder.filter(
      (t) =>
        t.title.toLowerCase().includes(normalizedQuery) ||
        t.fileName.toLowerCase().includes(normalizedQuery) ||
        (t.corruptionReason || '').toLowerCase().includes(normalizedQuery)
    );
  }, [corruptedLocalTracks, selectedFolder, normalizedQuery]);

  const totalPlayableCount = sonaryDownloadedItems.length + validLocalItems.length;

  const confirmDeleteLocalFile = (track: LocalDeviceTrack) => {
    Alert.alert(
      'Apagar arquivo do dispositivo?',
      `Isso vai apagar permanentemente "${track.fileName}" do armazenamento do celular (pasta ${track.folderName}). O Android pedirá sua confirmação.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar arquivo',
          style: 'destructive',
          onPress: () => onDeleteLocalTrackFromDevice(track),
        },
      ]
    );
  };

  const handlePressCorruptedTrack = (track: LocalDeviceTrack) => {
    Alert.alert(
      'Arquivo corrompido',
      `"${track.fileName}" não pôde ser reproduzido.\n\nMotivo: ${
        track.corruptionReason || 'Arquivo corrompido ou formato incompatível'
      }`,
      [
        { text: 'Revalidar', onPress: () => onRevalidateLocalTrack(track) },
        { text: 'Ocultar do Sonary', onPress: () => onHideLocalTrack(track) },
        {
          text: 'Apagar do dispositivo',
          style: 'destructive',
          onPress: () => confirmDeleteLocalFile(track),
        },
        { text: 'Fechar', style: 'cancel' },
      ]
    );
  };

  const cycleSortMode = () => {
    const idx = SORT_OPTIONS.findIndex((opt) => opt.id === sortMode);
    const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length];
    onChangeSortMode(next.id);
  };

  const currentSortLabel =
    SORT_OPTIONS.find((opt) => opt.id === sortMode)?.label || 'Recentes';

  const renderUnifiedTrackCard = (
    item: UnifiedOfflineTrackItem,
    queueContext: UnifiedOfflineTrackItem[]
  ) => (
    <TrackCard
      id={item.id}
      title={item.title}
      artist={item.artist}
      durationText={formatSeconds(item.duration)}
      thumbnailUrl={item.thumbnailUrl}
      isActive={activeTrackId === item.id}
      isPlaying={isPlaying}
      isOfflineList={true}
      isLocalDevice={item.isLocalDevice}
      onPress={() => onPlayOfflineTrack(item, queueContext)}
      onAddToPlaylist={() => onAddToPlaylist(item)}
      onDeleteOffline={
        !item.isLocalDevice ? () => onDeleteDownloadedTrack(item.id) : undefined
      }
      onEditMetadata={
        item.isLocalDevice && item.localTrack
          ? () => onEditLocalTrack(item.localTrack!)
          : undefined
      }
      onHideLocal={
        item.isLocalDevice && item.localTrack
          ? () => onHideLocalTrack(item.localTrack!)
          : undefined
      }
      onDeleteDeviceFile={
        item.isLocalDevice && item.localTrack
          ? () => confirmDeleteLocalFile(item.localTrack!)
          : undefined
      }
      onPlayNext={() => onPlayNext(item)}
      onAddToQueue={() => onAddToQueue(item)}
    />
  );

  const showSearchAndSort =
    !(activeFilter === 'device' && !localMediaEnabled) &&
    ((activeFilter === 'device' && localMediaEnabled) ||
      totalPlayableCount > 0 ||
      offlinePlaylists.length > 0 ||
      corruptedLocalTracks.length > 0);

  return (
    <View style={styles.container} testID="downloads-section">
      {/* Chips de filtro no topo: Tudo 12 | Playlists 1 | No dispositivo 12 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsRow}
      >
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
          onPress={() => setActiveFilter('all')}
          activeOpacity={0.8}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeFilter === 'all' }}
          testID="downloads-chip-all"
        >
          <Text
            style={[
              styles.filterChipText,
              activeFilter === 'all' && styles.filterChipTextActive,
            ]}
          >
            Tudo
          </Text>
          <Text
            style={[
              styles.filterChipCount,
              activeFilter === 'all' && styles.filterChipCountActive,
            ]}
          >
            {totalPlayableCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'playlists' && styles.filterChipActive]}
          onPress={() => setActiveFilter('playlists')}
          activeOpacity={0.8}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeFilter === 'playlists' }}
          testID="downloads-chip-playlists"
        >
          <Text
            style={[
              styles.filterChipText,
              activeFilter === 'playlists' && styles.filterChipTextActive,
            ]}
          >
            Playlists
          </Text>
          <Text
            style={[
              styles.filterChipCount,
              activeFilter === 'playlists' && styles.filterChipCountActive,
            ]}
          >
            {offlinePlaylists.length}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'device' && styles.filterChipActive]}
          onPress={() => setActiveFilter('device')}
          activeOpacity={0.8}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeFilter === 'device' }}
          testID="downloads-chip-device"
        >
          <Text
            style={[
              styles.filterChipText,
              activeFilter === 'device' && styles.filterChipTextActive,
            ]}
          >
            No dispositivo
          </Text>
          {localMediaEnabled && (
            <Text
              style={[
                styles.filterChipCount,
                activeFilter === 'device' && styles.filterChipCountActive,
              ]}
            >
              {validLocalItems.length}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Busca (SearchPillInput preservado) + Botões compactos de ícone (Ordenar, Re-escanear, Pastas) */}
      {showSearchAndSort && (
        <View style={styles.searchAndSortRow}>
          <View style={styles.searchFlex}>
            <SearchPillInput
              value={searchQuery}
              onChangeText={onChangeSearchQuery}
              placeholder={
                activeFilter === 'playlists'
                  ? 'Buscar playlists offline...'
                  : activeFilter === 'device'
                    ? 'Buscar músicas do dispositivo...'
                    : 'Buscar nas baixadas...'
              }
              accessibilityLabel="Buscar músicas baixadas"
              clearAccessibilityLabel="Limpar busca de baixadas"
            />
          </View>

          {activeFilter !== 'playlists' && (
            <TouchableOpacity
              style={[
                styles.iconActionBtn,
                sortMode !== 'recent' && styles.iconActionBtnActive,
              ]}
              onPress={cycleSortMode}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Ordenar por ${currentSortLabel}`}
              testID="downloads-sort-button"
            >
              <ArrowUpDown
                color={sortMode !== 'recent' ? '#FFFFFF' : '#CCCCCC'}
                size={18}
              />
            </TouchableOpacity>
          )}

          {activeFilter === 'device' && localMediaEnabled && (
            <>
              <TouchableOpacity
                style={styles.iconActionBtn}
                onPress={onRescanLocalMedia}
                disabled={isScanningLocalMedia}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Re-escanear músicas do dispositivo"
                testID="local-media-rescan-button"
              >
                {isScanningLocalMedia ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <RefreshCw color="#CCCCCC" size={18} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconActionBtn}
                onPress={() => setIsFoldersModalVisible(true)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Gerenciar pastas do dispositivo (${activeFolders.length} de ${foldersSummary.length})`}
                testID="local-media-folders-button"
              >
                <FolderCog color="#CCCCCC" size={18} />
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Aviso compacto de arquivos corrompidos no chip Tudo */}
      {activeFilter === 'all' && corruptedLocalTracks.length > 0 && (
        <TouchableOpacity
          style={styles.corruptedBanner}
          onPress={() => {
            setActiveFilter('device');
            setIsCorruptedExpanded(true);
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          testID="downloads-corrupted-banner"
        >
          <AlertTriangle color="#FF4E45" size={17} />
          <Text style={styles.corruptedBannerText} numberOfLines={1}>
            {corruptedLocalTracks.length === 1
              ? '1 arquivo corrompido encontrado'
              : `${corruptedLocalTracks.length} arquivos corrompidos encontrados`}
          </Text>
          <View style={styles.corruptedBannerAction}>
            <Text style={styles.corruptedBannerActionText}>Ver</Text>
            <ChevronRight color="#FF5A52" size={15} />
          </View>
        </TouchableOpacity>
      )}

      {/* CONTEÚDO 1: CHIP TUDO */}
      {activeFilter === 'all' && (
        <FlatList
          data={allTracksSorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <FolderDown color="#717171" size={56} />
              <Text style={styles.emptyTitle}>
                {normalizedQuery ? 'Nenhuma faixa encontrada' : 'Nenhuma música baixada'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {normalizedQuery
                  ? `Não foram encontrados resultados para "${searchQuery}".`
                  : 'Suas faixas salvas aparecerão aqui e podem ser ouvidas sem internet. Você também pode tocar em "No dispositivo" para reconhecer arquivos já salvos no celular.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => renderUnifiedTrackCard(item, allTracksSorted)}
        />
      )}

      {/* CONTEÚDO 2: CHIP PLAYLISTS */}
      {activeFilter === 'playlists' && (
        <FlatList
          data={filteredPlaylists}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <ListMusic color="#717171" size={52} />
              <Text style={styles.emptyTitle}>
                {normalizedQuery
                  ? 'Nenhuma playlist offline encontrada'
                  : 'Nenhuma playlist com músicas baixadas'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {normalizedQuery
                  ? `Não foram encontrados resultados para "${searchQuery}".`
                  : 'Baixe músicas de uma playlist (ou adicione faixas do dispositivo) para acessá-las aqui mesmo sem internet.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isFavorites = item.id === FAVORITES_PLAYLIST_ID || item.isSystem;
            const progressText =
              item.downloadedTrackCount === item.totalTrackCount
                ? `${item.downloadedTrackCount} ${item.downloadedTrackCount === 1 ? 'música baixada' : 'músicas baixadas'}`
                : `${item.downloadedTrackCount} de ${item.totalTrackCount} baixadas`;
            return (
              <TouchableOpacity
                style={styles.playlistRow}
                onPress={() => onOpenOfflinePlaylist(item.id)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Abrir playlist offline ${item.name}`}
                testID={`offline-playlist-row-${item.id}`}
              >
                {isFavorites ? (
                  <FavoritesRubyBadge iconSize={24} style={styles.playlistFavoritesBadge} />
                ) : (
                  <PlaylistCover
                    thumbnailUrl={item.thumbnailUrl}
                    hasCustomCover={item.hasCustomCover}
                    coverThumbnails={item.coverThumbnails}
                    size={54}
                    borderRadius={8}
                    iconSize={22}
                  />
                )}

                <View style={styles.playlistInfo}>
                  <Text style={styles.playlistName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.playlistMeta} numberOfLines={1}>
                    {`${progressText} • ${formatTotalDuration(item.downloadedDuration)}`}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.playlistPlayBtn}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onPlayOfflinePlaylist(item.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Tocar faixas offline de ${item.name}`}
                  testID={`offline-playlist-play-${item.id}`}
                >
                  <Play color="#030303" fill="#030303" size={16} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* CONTEÚDO 3: CHIP NO DISPOSITIVO */}
      {activeFilter === 'device' && (
        !localMediaEnabled ? (
          <View style={styles.emptyContainer} testID="local-media-optin-card">
            <View style={styles.optInIconCircle}>
              <HardDrive color="#FFFFFF" size={32} />
            </View>
            <Text style={styles.emptyTitle}>Músicas do seu dispositivo</Text>
            <Text style={styles.emptySubtitle}>
              O Sonary pode encontrar automaticamente músicas salvas em Download, Music e outras pastas do aparelho, identificar arquivos corrompidos e permitir editar título, artista e capa.
            </Text>
            <TouchableOpacity
              style={styles.primaryOptInBtn}
              onPress={onEnableAndScanLocalMedia}
              disabled={isScanningLocalMedia}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Permitir e escanear dispositivo"
              testID="local-media-enable-button"
            >
              {isScanningLocalMedia ? (
                <ActivityIndicator color="#030303" size="small" />
              ) : (
                <Text style={styles.primaryOptInBtnText}>Permitir e escanear dispositivo</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.deviceTabWrap}>
            {/* Abas minimalistas com sublinhado para pastas ativas */}
            {activeFolders.length > 1 && (
              <View style={styles.folderTabsBar}>
                <ScrollView
                  horizontal
                  nestedScrollEnabled={true}
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                  style={styles.folderChipsScroll}
                  contentContainerStyle={styles.folderChipsRow}
                >
                  <TouchableOpacity
                    style={[
                      styles.folderTab,
                      selectedFolder === null && styles.folderTabActive,
                    ]}
                    onPress={() => setSelectedFolder(null)}
                    activeOpacity={0.75}
                  >
                    <Folder
                      color={selectedFolder === null ? '#FFFFFF' : '#9A9A9A'}
                      size={14}
                    />
                    <Text
                      style={[
                        styles.folderTabText,
                        selectedFolder === null && styles.folderTabTextActive,
                      ]}
                    >
                      Todas
                    </Text>
                  </TouchableOpacity>
                  {activeFolders.map((folder) => {
                    const isSelected = selectedFolder === folder.folderName;
                    return (
                      <TouchableOpacity
                        key={folder.folderName}
                        style={[
                          styles.folderTab,
                          isSelected && styles.folderTabActive,
                        ]}
                        onPress={() =>
                          setSelectedFolder((prev) =>
                            prev === folder.folderName ? null : folder.folderName
                          )
                        }
                        activeOpacity={0.75}
                      >
                        <Folder
                          color={isSelected ? '#FFFFFF' : '#9A9A9A'}
                          size={14}
                        />
                        <Text
                          style={[
                            styles.folderTabText,
                            isSelected && styles.folderTabTextActive,
                          ]}
                        >
                          {`${folder.folderName} · ${folder.validCount}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <FlatList
              data={deviceValidTracksSorted}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                deviceCorruptedFiltered.length > 0 ? (
                  <View style={styles.corruptedWrapper} testID="corrupted-tracks-section">
                    <TouchableOpacity
                      style={styles.corruptedBanner}
                      onPress={() => setIsCorruptedExpanded((prev) => !prev)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isCorruptedExpanded
                          ? 'Ocultar arquivos corrompidos'
                          : 'Ver arquivos corrompidos'
                      }
                    >
                      <AlertTriangle color="#FF4E45" size={17} />
                      <Text style={styles.corruptedBannerText} numberOfLines={1}>
                        {deviceCorruptedFiltered.length === 1
                          ? '1 arquivo corrompido encontrado'
                          : `${deviceCorruptedFiltered.length} arquivos corrompidos encontrados`}
                      </Text>
                      <View style={styles.corruptedBannerAction}>
                        <Text style={styles.corruptedBannerActionText}>
                          {isCorruptedExpanded ? 'Ocultar' : 'Ver'}
                        </Text>
                        <ChevronRight color="#FF5A52" size={15} />
                      </View>
                    </TouchableOpacity>

                    {isCorruptedExpanded && (
                      <View style={styles.corruptedExpandedList}>
                        <Text style={styles.corruptedSectionSubtitle}>
                          Estes arquivos estão corrompidos ou em formato incompatível e não entram na fila de reprodução.
                        </Text>
                        {deviceCorruptedFiltered.map((track) => (
                          <TrackCard
                            key={track.id}
                            id={track.id}
                            title={track.title || track.fileName}
                            artist={track.folderName}
                            thumbnailUrl={track.thumbnailUrl}
                            isOfflineList={true}
                            isLocalDevice={true}
                            isCorrupted={true}
                            corruptionReason={
                              track.corruptionReason || 'Arquivo corrompido ou incompatível'
                            }
                            onPress={() => handlePressCorruptedTrack(track)}
                            onRevalidateLocal={() => onRevalidateLocalTrack(track)}
                            onHideLocal={() => onHideLocalTrack(track)}
                            onDeleteDeviceFile={() => confirmDeleteLocalFile(track)}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                ) : null
              }
              ListEmptyComponent={
                deviceCorruptedFiltered.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Smartphone color="#717171" size={48} />
                    <Text style={styles.emptyTitle}>
                      {normalizedQuery
                        ? 'Nenhuma música local encontrada'
                        : 'Nenhum arquivo de áudio encontrado'}
                    </Text>
                    <Text style={styles.emptySubtitle}>
                      {normalizedQuery
                        ? `Não foram encontrados resultados para "${searchQuery}".`
                        : 'Verifique se há arquivos em Download/Music ou ajuste as pastas ocultas em "Pastas".'}
                    </Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) =>
                renderUnifiedTrackCard(item, deviceValidTracksSorted)
              }
            />
          </View>
        )
      )}

      {/* Modal de Gerenciamento de Pastas & Ocultas */}
      <Modal
        visible={isFoldersModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setIsFoldersModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pastas do dispositivo</Text>
              <TouchableOpacity
                onPress={() => setIsFoldersModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Fechar pastas"
              >
                <X color="#AAAAAA" size={22} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalHint}>
              Escolha quais pastas do aparelho aparecem na biblioteca do Sonary.
            </Text>

            <ScrollView style={styles.modalList}>
              {foldersSummary.length === 0 ? (
                <Text style={styles.modalEmptyText}>Nenhuma pasta detectada ainda.</Text>
              ) : (
                foldersSummary.map((folder) => (
                  <TouchableOpacity
                    key={folder.folderName}
                    style={styles.folderManageRow}
                    onPress={() => onToggleExcludedFolder(folder.folderName)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: !folder.isExcluded }}
                  >
                    <View style={styles.folderManageInfo}>
                      <Folder
                        color={folder.isExcluded ? '#717171' : '#FFFFFF'}
                        size={18}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.folderManageName,
                            folder.isExcluded && styles.folderManageNameMuted,
                          ]}
                          numberOfLines={1}
                        >
                          {folder.folderName}
                        </Text>
                        <Text style={styles.folderManageCount}>
                          {`${folder.validCount} ${folder.validCount === 1 ? 'faixa' : 'faixas'}${
                            folder.corruptedCount > 0
                              ? ` • ${folder.corruptedCount} corrompido(s)`
                              : ''
                          }`}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.togglePill,
                        !folder.isExcluded && styles.togglePillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.togglePillText,
                          !folder.isExcluded && styles.togglePillTextActive,
                        ]}
                      >
                        {folder.isExcluded ? 'Oculta' : 'Visível'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            {hiddenLocalCount > 0 && (
              <TouchableOpacity
                style={styles.restoreHiddenBtn}
                onPress={() => {
                  onRestoreHiddenLocalTracks();
                  setIsFoldersModalVisible(false);
                }}
                accessibilityRole="button"
              >
                <RotateCcw color="#FFFFFF" size={15} />
                <Text style={styles.restoreHiddenText}>
                  {`Restaurar ${hiddenLocalCount} ${
                    hiddenLocalCount === 1 ? 'música ocultada' : 'músicas ocultadas'
                  }`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 6,
    marginBottom: 12,
  },
  chipsRow: {
    paddingHorizontal: 16,
    paddingVertical: 2,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    gap: 6,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  filterChipActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  filterChipText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '500',
    includeFontPadding: false,
  },
  filterChipTextActive: {
    color: '#030303',
    fontWeight: '700',
  },
  filterChipCount: {
    color: '#9A9A9A',
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  filterChipCountActive: {
    color: '#444444',
    fontWeight: '500',
  },
  searchAndSortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 10,
  },
  searchFlex: {
    flex: 1,
  },
  iconActionBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconActionBtnActive: {
    borderColor: 'rgba(255, 255, 255, 0.34)',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  corruptedWrapper: {
    marginTop: 10,
    marginBottom: 6,
  },
  corruptedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(130, 24, 24, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.42)',
  },
  corruptedBannerText: {
    flex: 1,
    color: '#F2E8E8',
    fontSize: 13.5,
    fontWeight: '500',
    lineHeight: 18,
    includeFontPadding: false,
  },
  corruptedBannerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  corruptedBannerActionText: {
    color: '#FF5A52',
    fontSize: 13.5,
    fontWeight: '600',
    includeFontPadding: false,
  },
  corruptedExpandedList: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 78, 69, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.24)',
  },
  listContent: {
    paddingBottom: 180,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 56,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#AAAAAA',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
  },
  playlistFavoritesBadge: {
    width: 54,
    height: 54,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistInfo: {
    flex: 1,
    minWidth: 0,
  },
  playlistName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  playlistMeta: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 3,
  },
  playlistPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optInIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOptInBtn: {
    marginTop: 22,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 220,
    alignItems: 'center',
  },
  primaryOptInBtnText: {
    color: '#030303',
    fontSize: 14,
    fontWeight: '700',
  },
  deviceTabWrap: {
    flex: 1,
  },
  folderTabsBar: {
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.14)',
    marginBottom: 4,
  },
  folderChipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  folderChipsRow: {
    paddingHorizontal: 16,
    gap: 20,
    alignItems: 'center',
  },
  folderTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  folderTabActive: {
    borderBottomColor: '#FFFFFF',
  },
  folderTabText: {
    color: '#9A9A9A',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    includeFontPadding: false,
  },
  folderTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  corruptedSectionSubtitle: {
    color: '#CCA5A3',
    fontSize: 12,
    paddingHorizontal: 10,
    marginBottom: 6,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: theme.colors.elevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  modalHint: {
    color: '#AAAAAA',
    fontSize: 13,
    marginBottom: 14,
  },
  modalList: {
    maxHeight: 340,
  },
  modalEmptyText: {
    color: '#888888',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  folderManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 12,
  },
  folderManageInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  folderManageName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  folderManageNameMuted: {
    color: '#717171',
  },
  folderManageCount: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  togglePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  togglePillActive: {
    backgroundColor: '#FFFFFF',
  },
  togglePillText: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '600',
  },
  togglePillTextActive: {
    color: '#030303',
  },
  restoreHiddenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  restoreHiddenText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
