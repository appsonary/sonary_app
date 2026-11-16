import React from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowUpDown,
  Download,
  Edit3,
  ImagePlus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react-native';
import { PlaylistDetail } from '../services/database';
import { PlaylistCover } from './PlaylistCover';
import { useBottomSheetController } from './sheetMotion';

export interface PlaylistOptionsSheetProps {
  visible: boolean;
  playlist: PlaylistDetail | null;
  isReordering: boolean;
  isDownloadingAll: boolean;
  onClose: () => void;
  onPickCustomCover: () => void;
  onResetCustomCover: () => void;
  onEditDetails: () => void;
  onToggleReorder: () => void;
  onDownloadAll: () => void;
  onDeletePlaylist: () => void;
}

export const PlaylistOptionsSheet: React.FC<PlaylistOptionsSheetProps> = ({
  visible,
  playlist,
  isReordering,
  isDownloadingAll,
  onClose,
  onPickCustomCover,
  onResetCustomCover,
  onEditDetails,
  onToggleReorder,
  onDownloadAll,
  onDeletePlaylist,
}) => {
  const isSheetVisible = Boolean(visible && playlist && !playlist.isSystem);
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

  const trackCountLabel = `${playlist.trackCount} ${
    playlist.trackCount === 1 ? 'música' : 'músicas'
  }`;
  const canDownload = playlist.tracks.length > 0 && !isDownloadingAll;
  const canReorder = playlist.tracks.length > 1;

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      animationType="none"
      onShow={onModalShow}
      onRequestClose={() => dismissSheet()}
    >
      <Animated.View style={{ flex: 1, opacity: backdropOpacity }}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => dismissSheet()}
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
              {...panResponder.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel="Arraste para baixo para recolher opções da playlist"
            >
              <View style={styles.dragHandle} />
            </View>

            {/* Cabeçalho com Capa, Nome e Subtítulo */}
            <View style={styles.header}>
              <PlaylistCover
                thumbnailUrl={playlist.thumbnailUrl}
                hasCustomCover={playlist.hasCustomCover}
                coverThumbnails={playlist.coverThumbnails}
                size={48}
                borderRadius={6}
                iconSize={20}
              />
              <View style={styles.headerInfo} {...panResponder.panHandlers}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {playlist.name}
                </Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {trackCountLabel}
                  {playlist.hasCustomCover ? ' • Capa personalizada' : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => dismissSheet()}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Fechar opções da playlist"
              >
                <X color="#FFFFFF" size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {/* Lista de ações */}
            <View style={styles.actionsList}>
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
                  {isDownloadingAll ? 'Baixando playlist...' : 'Baixar playlist'}
                </Text>
              </TouchableOpacity>

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
            </View>
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

