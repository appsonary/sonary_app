import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  CheckCircle2,
  Clock,
  Download,
  ListMusic,
  ListPlus,
  MoreVertical,
  Music2,
  Play,
  Plus,
  Radio,
  Share2,
  Trash2,
  X,
} from 'lucide-react-native';
import { getEaseOutCubic, theme } from '../theme';
import { DownloadedTrackBadge, MarqueeText, TrackMetaRow } from './MarqueeText';
import { useBottomSheetController } from './sheetMotion';
import { PlayingEqualizer } from './PlayingEqualizer';
import { useBackModalLock } from '../services/backNavigation';

export interface CircularDownloadProgressProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
}

/**
 * Indicador circular de progresso com arco branco dinâmico e percentual centralizado.
 */
export const CircularDownloadProgress: React.FC<CircularDownloadProgressProps> = ({
  progress,
  size = 36,
  strokeWidth = 2.5,
}) => {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  if (clamped <= 0) {
    return (
      <View style={[styles.ringContainer, { width: size, height: size }]}>
        <ActivityIndicator color={theme.colors.textPrimary} size="small" />
      </View>
    );
  }

  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clamped / 100);

  return (
    <View style={[styles.ringContainer, { width: size, height: size }]}>
      <Svg
        width={size}
        height={size}
        style={styles.ringSvg}
        accessible={false}
      >
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="rgba(255, 255, 255, 0.18)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#FFFFFF"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <View style={styles.ringLabelOverlay} pointerEvents="none">
        <Text style={styles.downloadProgressText} numberOfLines={1}>
          {`${clamped}%`}
        </Text>
      </View>
    </View>
  );
};

export interface TrackCardProps {
  id: string;
  title: string;
  artist: string;
  durationText?: string;
  thumbnailUrl?: string;
  trackNumber?: number;
  album?: string;
  isActive?: boolean;
  isPlaying?: boolean;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  isQueued?: boolean;
  downloadProgress?: number;
  isOfflineList?: boolean;
  showInlineActions?: boolean;
  onPress: () => void;
  onAddToPlaylist?: () => void;
  onDownload?: () => void;
  onDeleteOffline?: () => void;
  onPlayNext?: () => void;
  onAddToQueue?: () => void;
}

export interface TrackContextSheetProps {
  title: string;
  artist: string;
  durationText?: string;
  isOfflineList: boolean;
  isDownloaded: boolean;
  isDownloading?: boolean;
  isQueued?: boolean;
  downloadProgress?: number;
  onClose: () => void;
  onPress: () => void;
  onPlayNext?: () => void;
  onAddToQueue?: () => void;
  onAddToPlaylist?: () => void;
  onDownload?: () => void;
  onDeleteOffline?: () => void;
  onRemoveFromPlaylist?: () => void;
}

export const TrackContextSheet: React.FC<TrackContextSheetProps> = ({
  title,
  artist,
  durationText,
  isOfflineList,
  isDownloaded,
  isDownloading = false,
  isQueued = false,
  downloadProgress = 0,
  onClose,
  onPress,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onDownload,
  onDeleteOffline,
  onRemoveFromPlaylist,
}) => {
  useBackModalLock(true);
  const {
    translateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
    panResponder,
  } = useBottomSheetController({
    visible: true,
    onClose,
    initialOffset: 300,
  });

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      animationType="none"
      onShow={onModalShow}
      onRequestClose={() => dismissSheet()}
    >
      <Animated.View style={{ flex: 1, opacity: backdropOpacity }}>
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => dismissSheet()}
        >
          <Animated.View
            renderToHardwareTextureAndroid
            style={[
              styles.sheetContainer,
              {
                transform: [{ translateY }],
              },
            ]}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e?.stopPropagation?.()}
          >
            {/* Área de arrasto superior acessível com PanResponder para recolher */}
            <View
              style={styles.sheetDragArea}
              {...panResponder.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel="Arraste para baixo para recolher o menu"
            >
              <View style={styles.sheetDragHandle} />
            </View>

            {/* Cabeçalho com Título, Artista, Duração e Botão Fechar */}
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderInfo} {...panResponder.panHandlers}>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>
                  {artist}
                  {durationText ? ` • ${durationText}` : ''}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.sheetCloseButton}
                onPress={() => dismissSheet()}
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
              {onPlayNext && (
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onClose();
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
              )}

              <TouchableOpacity
                style={styles.quickTile}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onClose();
                  onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel="Iniciar rádio"
              >
                <Radio color="#FFFFFF" size={22} />
                <Text style={styles.quickTileText} numberOfLines={1}>
                  Iniciar rádio
                </Text>
              </TouchableOpacity>

              {onAddToPlaylist ? (
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onClose();
                    onAddToPlaylist();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Adicionar à playlist"
                >
                  <Plus color="#FFFFFF" size={22} />
                  <Text style={styles.quickTileText} numberOfLines={1}>
                    Playlist
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Compartilhar"
                >
                  <Share2 color="#FFFFFF" size={22} />
                  <Text style={styles.quickTileText} numberOfLines={1}>
                    Compartilhar
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
                    onClose();
                    onAddToQueue();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Adicionar ao fim da fila"
                >
                  <ListMusic color="#FFFFFF" size={22} />
                  <Text style={styles.sheetActionText}>Adicionar ao fim da fila</Text>
                </TouchableOpacity>
              )}

              {!isOfflineList && onDownload && (
                <TouchableOpacity
                  style={styles.sheetActionRow}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onClose();
                    if (!isDownloaded && !isDownloading && !isQueued) {
                      onDownload();
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Salvar offline"
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
                        ? `Baixando${downloadProgress && downloadProgress > 0 ? ` (${downloadProgress}%)` : '...'}`
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
                    onClose();
                    onAddToPlaylist();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Adicionar à playlist"
                >
                  <Plus color="#FFFFFF" size={22} />
                  <Text style={styles.sheetActionText}>Adicionar à playlist</Text>
                </TouchableOpacity>
              )}

              {isOfflineList && onDeleteOffline && (
                <TouchableOpacity
                  style={styles.sheetActionRow}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onClose();
                    onDeleteOffline();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Remover dos baixados"
                >
                  <Trash2 color="#FF4E45" size={22} />
                  <Text style={[styles.sheetActionText, { color: '#FF4E45' }]}>
                    Remover dos downloads
                  </Text>
                </TouchableOpacity>
              )}

              {onRemoveFromPlaylist && (
                <TouchableOpacity
                  style={styles.sheetActionRow}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onClose();
                    onRemoveFromPlaylist();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Remover da playlist"
                >
                  <Trash2 color="#FF4E45" size={22} />
                  <Text style={[styles.sheetActionText, { color: '#FF4E45' }]}>
                    Remover da playlist
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

const TrackCardInner: React.FC<TrackCardProps> = ({
  id,
  title,
  artist,
  durationText,
  thumbnailUrl,
  trackNumber,
  album,
  isActive = false,
  isPlaying = false,
  isDownloaded = false,
  isDownloading = false,
  isQueued = false,
  downloadProgress = 0,
  isOfflineList = false,
  showInlineActions,
  onPress,
  onAddToPlaylist,
  onDownload,
  onDeleteOffline,
  onPlayNext,
  onAddToQueue,
}) => {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);

  const hasMenu = Boolean(onPlayNext || onAddToQueue);
  const showDirectActions = showInlineActions ?? !hasMenu;

  const handleToggleMenu = (e?: any) => {
    e?.stopPropagation?.();
    setShowContextMenu((prev) => !prev);
  };

  // No mobile, ações secundárias mantêm visibilidade para acessibilidade ao toque
  const isWeb = Platform.OS === 'web';
  const showActions = !isWeb || isHovered || isActive;

  const artistMetaText = album ? `${artist} • ${album}` : artist;

  return (
    <TouchableOpacity
      style={[
        styles.trackCard,
        isActive && styles.trackCardActive,
        isHovered && !isActive && styles.trackCardHover,
      ]}
      onPress={onPress}
      {...({
        onMouseEnter: () => setIsHovered(true),
        onMouseLeave: () => setIsHovered(false),
        onFocus: () => setIsHovered(true),
        onBlur: () => setIsHovered(false),
      } as any)}
      accessibilityRole="button"
      accessibilityLabel={`Tocar ${title} de ${artist}`}
      activeOpacity={0.7}
    >
      {/* Indicador de Número da Faixa ou Botão de Play no Hover (se fornecido) */}
      {trackNumber !== undefined && (
        <View style={styles.numberContainer}>
          {isHovered || isActive ? (
            <Play
              color={isActive ? theme.colors.brandPrimary : theme.colors.textPrimary}
              fill={isActive ? theme.colors.brandPrimary : theme.colors.textPrimary}
              size={14}
            />
          ) : (
            <Text style={[styles.trackNumberText, isActive && styles.trackNumberActive]}>
              {trackNumber}
            </Text>
          )}
        </View>
      )}

      {/* Thumbnail da Faixa com Scrim e Play no Hover */}
      <View style={styles.thumbnailContainer}>
        {thumbnailUrl && !imageError ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.trackThumbnail}
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Music2 color={theme.colors.textMuted} size={20} />
          </View>
        )}

        {/* Indicador de reprodução ativa ou Hover Play overlay */}
        {isActive ? (
          <PlayingEqualizer isPlaying={isPlaying} />
        ) : isHovered ? (
          <View style={styles.thumbnailHoverOverlay}>
            <Play color="#FFFFFF" fill="#FFFFFF" size={16} />
          </View>
        ) : null}
      </View>

      {/* Informações da Faixa */}
      <View style={styles.trackInfo}>
        <MarqueeText
          active={Boolean(isActive)}
          style={[
            styles.trackTitle,
            isActive && styles.trackTitleActive,
          ]}
        >
          {title}
        </MarqueeText>
        <TrackMetaRow
          active={Boolean(isActive)}
          leading={isDownloaded && !isOfflineList ? <DownloadedTrackBadge /> : undefined}
          artistText={artistMetaText}
          textStyle={styles.trackArtist}
        />
      </View>

      {isDownloading && !showDirectActions ? (
        <View style={styles.inlineDownloadingBadge} accessibilityLabel="Baixando música">
          <CircularDownloadProgress progress={downloadProgress} />
        </View>
      ) : isQueued && !isDownloaded && !showDirectActions ? (
        <View style={styles.inlineQueuedBadge} accessibilityLabel="Na fila de downloads">
          <Clock color="#AAAAAA" size={13} />
          <Text style={styles.queuedBadgeText} numberOfLines={1}>
            Na fila
          </Text>
        </View>
      ) : durationText ? (
        <Text style={styles.trackDuration} numberOfLines={1}>
          {durationText}
        </Text>
      ) : null}

      {/* Grupo de Ações com Revelação Progressiva (Zero Layout Shift) */}
      <View
        style={[
          styles.cardActionGroup,
          { opacity: showActions ? 1 : 0 },
        ]}
      >
        {/* Botão de Adicionar à Playlist (visível apenas se não houver menu 3-pontinhos) */}
        {showDirectActions && onAddToPlaylist && (
          <TouchableOpacity
            style={styles.cardActionButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              onAddToPlaylist();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Adicionar ${title} à playlist`}
          >
            <ListPlus color={theme.colors.textSecondary} size={20} />
          </TouchableOpacity>
        )}

        {/* Botão de Remover Download (Aba Baixadas) */}
        {showDirectActions && isOfflineList && onDeleteOffline && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              onDeleteOffline();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Remover download de ${title}`}
          >
            <Trash2 color={theme.colors.textSecondary} size={18} />
          </TouchableOpacity>
        )}

        {/* Botão de Download (Aba de Busca) */}
        {showDirectActions && !isOfflineList && onDownload && (
          <TouchableOpacity
            style={styles.downloadButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              onDownload();
            }}
            disabled={isDownloaded || isDownloading || isQueued}
            accessibilityRole="button"
            accessibilityLabel={
              isDownloaded
                ? 'Música já baixada'
                : isQueued
                  ? 'Na fila de downloads'
                  : `Baixar ${title}`
            }
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {isDownloading ? (
              <CircularDownloadProgress progress={downloadProgress} />
            ) : isQueued ? (
              <Clock color={theme.colors.textSecondary} size={18} />
            ) : isDownloaded ? (
              <CheckCircle2 color={theme.colors.success} size={20} />
            ) : (
              <Download color={theme.colors.textSecondary} size={20} />
            )}
          </TouchableOpacity>
        )}

        {/* Botão Menu Contextual (Mais Opções) */}
        {hasMenu && (
          <View collapsable={false}>
            <TouchableOpacity
              style={styles.cardActionButton}
              onPress={handleToggleMenu}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Mais opções para ${title}`}
            >
              <MoreVertical color={theme.colors.textSecondary} size={20} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Menu Bottom Sheet montado sob demanda */}
      {hasMenu && showContextMenu && (
        <TrackContextSheet
          title={title}
          artist={artist}
          durationText={durationText}
          isOfflineList={isOfflineList}
          isDownloaded={isDownloaded}
          isDownloading={isDownloading}
          isQueued={isQueued}
          downloadProgress={downloadProgress}
          onClose={() => setShowContextMenu(false)}
          onPress={onPress}
          onPlayNext={onPlayNext}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
          onDownload={onDownload}
          onDeleteOffline={onDeleteOffline}
        />
      )}
    </TouchableOpacity>
  );
};

export const TrackCard = memo(TrackCardInner);

const styles = StyleSheet.create({
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 0,
    marginHorizontal: 8,
    marginBottom: 2,
    borderRadius: 12,
    backgroundColor: 'transparent',
    // Zero layout shift
    minHeight: 64,
  },
  trackCardHover: {
    backgroundColor: theme.colors.chipHover,
  },
  trackCardActive: {
    backgroundColor: '#141414',
  },
  numberContainer: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  trackNumberText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  trackNumberActive: {
    color: theme.colors.brandPrimary,
    fontWeight: '700',
  },
  thumbnailContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.track,
    overflow: 'hidden',
    backgroundColor: theme.colors.card,
    position: 'relative',
  },
  trackThumbnail: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.track,
  },
  thumbnailFallback: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.track,
    backgroundColor: theme.colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailHoverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    fontSize: theme.typography.fontSize.trackTitle,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    marginBottom: 3,
  },
  trackTitleActive: {
    color: theme.colors.brandPrimary,
    fontWeight: theme.typography.fontWeight.bold,
  },
  trackArtist: {
    fontSize: theme.typography.fontSize.caption,
    color: theme.colors.textSecondary,
  },
  trackDuration: {
    fontSize: theme.typography.fontSize.caption,
    color: theme.colors.textSecondary,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
    marginLeft: 8,
  },
  cardActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 4,
    minWidth: 32,
    justifyContent: 'flex-end',
  },
  cardActionButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 36,
  },
  ringContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ringSvg: {
    transform: [{ rotate: '-90deg' }],
  },
  ringLabelOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadProgressText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    includeFontPadding: false,
  },
  inlineDownloadingBadge: {
    marginLeft: 8,
    marginRight: -4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineQueuedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  queuedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#AAAAAA',
  },
  deleteButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  sheetContainer: {
    backgroundColor: '#181818',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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
    paddingTop: 10,
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
    backgroundColor: '#2A2A2A',
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

export default TrackCard;
