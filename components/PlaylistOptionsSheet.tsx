import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  ArrowUpDown,
  Download,
  Edit3,
  HardDriveDownload,
  ImagePlus,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from 'lucide-react-native';
import { PlaylistDetail } from '../services/database';
import { FavoritesRubyBadge } from './LibrarySection';
import { PlaylistCover } from './PlaylistCover';
import { useBottomSheetController } from './sheetMotion';
import { useBackModalLock } from '../services/backNavigation';

export interface PlaylistOptionsSheetProps {
  visible: boolean;
  playlist: PlaylistDetail | null;
  isReordering: boolean;
  isDownloadingAll: boolean;
  hasUnqueuedMissingTracks?: boolean;
  offlineOnly?: boolean;
  onClose: () => void;
  onPickCustomCover: () => void;
  onResetCustomCover: () => void;
  onEditDetails: () => void;
  onToggleReorder: () => void;
  onDownloadAll: () => void;
  onSharePlaylistFile?: () => Promise<void> | void;
  onSavePlaylistToDevice?: () => Promise<void> | void;
  onDeletePlaylist: () => void;
}

export const PlaylistOptionsSheet: React.FC<PlaylistOptionsSheetProps> = ({
  visible,
  playlist,
  isReordering,
  isDownloadingAll,
  hasUnqueuedMissingTracks = false,
  offlineOnly = false,
  onClose,
  onPickCustomCover,
  onResetCustomCover,
  onEditDetails,
  onToggleReorder,
  onDownloadAll,
  onSharePlaylistFile,
  onSavePlaylistToDevice,
  onDeletePlaylist,
}) => {
  const isSheetVisible = Boolean(visible && playlist);
  const [step, setStep] = useState<'menu' | 'export'>('menu');
  const [busyAction, setBusyAction] = useState<'share' | 'save' | null>(null);

  useEffect(() => {
    if (!isSheetVisible) {
      setStep('menu');
      setBusyAction(null);
    }
  }, [isSheetVisible]);

  useBackModalLock(isSheetVisible);
  const {
    translateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
    panResponder,
  } = useBottomSheetController({
    visible: isSheetVisible,
    onClose,
    initialOffset: 320,
    dismissOffset: 360,
  });

  if (!isSheetVisible || !playlist) return null;

  const isBusy = busyAction !== null;
  const trackCountLabel = `${playlist.trackCount} ${
    playlist.trackCount === 1 ? 'música' : 'músicas'
  }`;
  const isDownloadBlocked = isDownloadingAll && !hasUnqueuedMissingTracks;
  const canDownload = playlist.tracks.length > 0 && !isDownloadBlocked;
  const canReorder = playlist.tracks.length > 1;
  const canExport = Boolean(onSharePlaylistFile || onSavePlaylistToDevice);

  const handleRequestClose = () => {
    if (isBusy) return;
    if (step === 'export') {
      setStep('menu');
      return;
    }
    dismissSheet();
  };

  const handleExportAction = async (
    action: 'share' | 'save',
    callback?: () => Promise<void> | void
  ) => {
    if (!callback || isBusy) return;
    setBusyAction(action);
    try {
      await callback();
      setBusyAction(null);
      dismissSheet();
    } catch {
      setBusyAction(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      animationType="none"
      onShow={onModalShow}
      onRequestClose={handleRequestClose}
    >
      <Animated.View style={{ flex: 1, opacity: backdropOpacity }}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => {
            if (!isBusy) dismissSheet();
          }}
        >
          <Animated.View
            renderToHardwareTextureAndroid
            style={[
              styles.container,
              { transform: [{ translateY }] },
            ]}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e?.stopPropagation?.()}
          >
            {/* Barra de arrasto */}
            <View
              style={styles.dragArea}
              {...(isBusy ? {} : panResponder.panHandlers)}
              accessibilityRole="adjustable"
              accessibilityLabel="Arraste para baixo para recolher opções da playlist"
            >
              <View style={styles.dragHandle} />
            </View>

            {/* Cabeçalho com Capa, Nome e Subtítulo */}
            <View style={styles.header}>
              {step === 'export' ? (
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => {
                    if (!isBusy) setStep('menu');
                  }}
                  disabled={isBusy}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Voltar às opções da playlist"
                >
                  <ArrowLeft color="#FFFFFF" size={20} />
                </TouchableOpacity>
              ) : playlist.isSystem ? (
                <FavoritesRubyBadge iconSize={22} style={styles.systemCoverBadge} />
              ) : (
                <PlaylistCover
                  thumbnailUrl={playlist.thumbnailUrl}
                  hasCustomCover={playlist.hasCustomCover}
                  coverThumbnails={playlist.coverThumbnails}
                  size={48}
                  borderRadius={6}
                  iconSize={20}
                />
              )}
              <View style={styles.headerInfo} {...(isBusy ? {} : panResponder.panHandlers)}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {step === 'export' ? 'Exportar playlist' : playlist.name}
                </Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {step === 'export'
                    ? `${playlist.name} • ${trackCountLabel}`
                    : `${trackCountLabel}${playlist.hasCustomCover ? ' • Capa personalizada' : ''}`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => {
                  if (!isBusy) dismissSheet();
                }}
                disabled={isBusy}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Fechar opções da playlist"
              >
                <X color="#FFFFFF" size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {step === 'export' ? (
              <View style={styles.exportStepList} testID="playlist-export-submenu">
                {onSharePlaylistFile && (
                  <TouchableOpacity
                    style={[styles.exportCard, isBusy && styles.actionRowDisabled]}
                    onPress={() => void handleExportAction('share', onSharePlaylistFile)}
                    disabled={isBusy}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Compartilhar arquivo da playlist"
                  >
                    <View style={styles.exportIconBox}>
                      {busyAction === 'share' ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Share2 color="#FFFFFF" size={20} />
                      )}
                    </View>
                    <View style={styles.exportTextCol}>
                      <Text style={styles.exportCardTitle}>Compartilhar arquivo</Text>
                      <Text style={styles.exportCardSubtitle}>
                        Envie o JSON pelo WhatsApp, Telegram, Drive ou outros apps
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}

                {onSavePlaylistToDevice && (
                  <TouchableOpacity
                    style={[styles.exportCard, isBusy && styles.actionRowDisabled]}
                    onPress={() => void handleExportAction('save', onSavePlaylistToDevice)}
                    disabled={isBusy}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Salvar playlist no dispositivo"
                  >
                    <View style={styles.exportIconBox}>
                      {busyAction === 'save' ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <HardDriveDownload color="#FFFFFF" size={20} />
                      )}
                    </View>
                    <View style={styles.exportTextCol}>
                      <Text style={styles.exportCardTitle}>Salvar no dispositivo</Text>
                      <Text style={styles.exportCardSubtitle}>
                        Escolha uma pasta local para guardar o arquivo .json
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              /* Lista de ações */
              <View style={styles.actionsList}>
                {!playlist.isSystem && (
                  <>
                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={() => dismissSheet(onPickCustomCover)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Alterar capa pela galeria"
                    >
                      <ImagePlus color="#FFFFFF" size={21} />
                      <Text style={styles.actionText}>Alterar capa (galeria)</Text>
                    </TouchableOpacity>

                    {playlist.hasCustomCover && (
                      <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() => dismissSheet(onResetCustomCover)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Usar capa automática"
                      >
                        <RotateCcw color="#FFFFFF" size={21} />
                        <Text style={styles.actionText}>Usar capa automática</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={() => dismissSheet(onEditDetails)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Editar nome e detalhes da playlist"
                    >
                      <Edit3 color="#FFFFFF" size={21} />
                      <Text style={styles.actionText}>Nome e detalhes</Text>
                    </TouchableOpacity>

                    {!offlineOnly && (
                      <TouchableOpacity
                        style={[styles.actionRow, !canReorder && styles.actionRowDisabled]}
                        onPress={() => {
                          if (!canReorder) return;
                          dismissSheet(onToggleReorder);
                        }}
                        disabled={!canReorder}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Ordenar faixas da playlist"
                      >
                        <ArrowUpDown color={canReorder ? '#FFFFFF' : '#717171'} size={21} />
                        <Text style={[styles.actionText, !canReorder && styles.actionTextDisabled]}>
                          {isReordering ? 'Concluir ordenação' : 'Ordenar faixas'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {!offlineOnly && (
                  <TouchableOpacity
                    style={[styles.actionRow, !canDownload && styles.actionRowDisabled]}
                    onPress={() => {
                      if (!canDownload) return;
                      dismissSheet(onDownloadAll);
                    }}
                    disabled={!canDownload}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Baixar playlist"
                  >
                    <Download color={canDownload ? '#FFFFFF' : '#717171'} size={21} />
                    <Text style={[styles.actionText, !canDownload && styles.actionTextDisabled]}>
                      {isDownloadBlocked ? 'Baixando playlist...' : 'Baixar playlist'}
                    </Text>
                  </TouchableOpacity>
                )}

                {canExport && (
                  <TouchableOpacity
                    style={styles.actionRow}
                    onPress={() => setStep('export')}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Exportar playlist em JSON"
                  >
                    <Share2 color="#FFFFFF" size={21} />
                    <Text style={styles.actionText}>Exportar playlist (.json)</Text>
                  </TouchableOpacity>
                )}

                {!playlist.isSystem && (
                  <>
                    <View style={styles.destructiveDivider} />

                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={() => dismissSheet(onDeletePlaylist)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Excluir playlist"
                    >
                      <Trash2 color="#FF4E45" size={21} />
                      <Text style={[styles.actionText, styles.destructiveText]}>
                        Excluir playlist
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  container: {
    backgroundColor: '#181818',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginBottom: -72,
    paddingBottom: 96,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  dragArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemCoverBadge: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportStepList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 10,
  },
  exportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 14,
    padding: 14,
    gap: 14,
  },
  exportIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportTextCol: {
    flex: 1,
    gap: 2,
  },
  exportCardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  exportCardSubtitle: {
    color: '#AAAAAA',
    fontSize: 12,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 20,
    marginBottom: 6,
  },
  actionsList: {
    paddingTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 16,
  },
  actionRowDisabled: {
    opacity: 0.45,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },
  actionTextDisabled: {
    color: '#717171',
  },
  destructiveDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 20,
    marginVertical: 4,
  },
  destructiveText: {
    color: '#FF4E45',
  },
});

