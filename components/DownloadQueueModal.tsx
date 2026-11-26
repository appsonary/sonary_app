import React, { useCallback, useMemo } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  Music2,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react-native';
import { DownloadQueueItem } from '../services/storage';
import { useBackModalLock } from '../services/backNavigation';
import { useBottomSheetController } from './sheetMotion';
import { theme } from '../theme';

export interface DownloadQueueModalProps {
  visible: boolean;
  queue: DownloadQueueItem[];
  onClose: () => void;
  onCancelItem: (trackId: string) => void;
  onRetryItem: (trackId: string) => void;
  onRetryAllFailed?: () => void;
  onCancelAll: () => void;
  onClearFinished: () => void;
}

/**
 * Bottom sheet para acompanhar e gerenciar a fila sequencial de downloads.
 */
export const DownloadQueueModal: React.FC<DownloadQueueModalProps> = ({
  visible,
  queue,
  onClose,
  onCancelItem,
  onRetryItem,
  onRetryAllFailed,
  onCancelAll,
  onClearFinished,
}) => {
  useBackModalLock(visible);
  const {
    translateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
    panResponder,
  } = useBottomSheetController({
    visible,
    onClose,
    initialOffset: 380,
    dismissOffset: 440,
  });

  const stats = useMemo(() => {
    let downloading = 0;
    let pending = 0;
    let completed = 0;
    let error = 0;
    for (const item of queue) {
      if (item.status === 'downloading') downloading += 1;
      else if (item.status === 'pending') pending += 1;
      else if (item.status === 'completed') completed += 1;
      else if (item.status === 'error') error += 1;
    }
    return {
      downloading,
      pending,
      completed,
      error,
      activeOrPending: downloading + pending,
      finished: completed + error,
    };
  }, [queue]);

  const renderQueueItem = useCallback(
    ({ item }: { item: DownloadQueueItem }) => {
      const pct = Math.max(0, Math.min(100, Math.round(item.progress * 100)));
      const isDownloading = item.status === 'downloading';
      const isPending = item.status === 'pending';
      const isError = item.status === 'error';
      const isCompleted = item.status === 'completed';

      return (
        <View style={styles.row}>
          <View style={styles.thumbBox}>
            {item.track.thumbnailUrl ? (
              <Image source={{ uri: item.track.thumbnailUrl }} style={styles.thumb} />
            ) : (
              <Music2 color={theme.colors.textMuted} size={18} />
            )}
          </View>

          <View style={styles.rowMeta}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.track.title}
            </Text>
            <Text style={styles.rowArtist} numberOfLines={1}>
              {item.track.artist}
            </Text>

            {isDownloading && (
              <View style={styles.progressSection}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.progressLabel}>
                  {pct > 0 ? `Baixando ${pct}%` : 'Preparando...'}
                </Text>
              </View>
            )}

            {isPending && (
              <View style={styles.statusRow}>
                <Clock color="#AAAAAA" size={12} />
                <Text style={styles.statusPendingText}>Na fila</Text>
              </View>
            )}

            {isCompleted && (
              <View style={styles.statusRow}>
                <CheckCircle2 color={theme.colors.success} size={12} />
                <Text style={styles.statusCompletedText}>Salva em Baixadas</Text>
              </View>
            )}

            {isError && (
              <View style={styles.statusRow}>
                <AlertCircle color={theme.colors.danger} size={12} />
                <Text style={styles.statusErrorText} numberOfLines={1}>
                  {item.error || 'Falha ao baixar'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.rowActions}>
            {isError && (
              <TouchableOpacity
                style={styles.iconActionBtn}
                onPress={() => onRetryItem(item.track.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Tentar novamente download de ${item.track.title}`}
              >
                <RotateCcw color="#FFFFFF" size={17} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.iconActionBtn}
              onPress={() => onCancelItem(item.track.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={
                isDownloading || isPending
                  ? `Cancelar download de ${item.track.title}`
                  : `Remover ${item.track.title} da lista`
              }
            >
              <X color="#AAAAAA" size={18} />
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [onCancelItem, onRetryItem]
  );

  if (!visible) return null;

  const summaryParts: string[] = [];
  if (stats.downloading > 0) summaryParts.push(`${stats.downloading} baixando`);
  if (stats.pending > 0) summaryParts.push(`${stats.pending} na fila`);
  if (stats.error > 0) summaryParts.push(`${stats.error} com erro`);
  if (stats.completed > 0) summaryParts.push(`${stats.completed} concluído${stats.completed > 1 ? 's' : ''}`);
  const subtitle = summaryParts.length > 0 ? summaryParts.join(' • ') : 'Nenhum download na fila';

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
            style={[styles.container, { transform: [{ translateY }] }]}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e?.stopPropagation?.()}
          >
            <View
              style={styles.dragArea}
              {...panResponder.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel="Arraste para baixo para recolher fila de downloads"
            >
              <View style={styles.dragHandle} />
            </View>

            <View style={styles.header}>
              <View style={styles.headerIconBox}>
                <ArrowDownToLine color="#FFFFFF" size={20} />
              </View>
              <View style={styles.headerInfo} {...panResponder.panHandlers}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  Fila de downloads
                </Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => dismissSheet()}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Fechar fila de downloads"
              >
                <X color="#FFFFFF" size={20} />
              </TouchableOpacity>
            </View>

            {(stats.activeOrPending > 0 || stats.finished > 0) && (
              <View style={styles.bulkActionsRow}>
                {stats.error > 0 && onRetryAllFailed && (
                  <TouchableOpacity
                    style={styles.bulkButton}
                    onPress={onRetryAllFailed}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Tentar novamente ${stats.error} downloads com erro`}
                    testID="download-queue-retry-all-btn"
                  >
                    <RotateCcw color="#FFFFFF" size={14} />
                    <Text style={styles.bulkButtonText}>
                      Tentar novamente ({stats.error})
                    </Text>
                  </TouchableOpacity>
                )}
                {stats.finished > 0 && (
                  <TouchableOpacity
                    style={styles.bulkButton}
                    onPress={onClearFinished}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Limpar downloads concluídos"
                  >
                    <Trash2 color="#CCCCCC" size={14} />
                    <Text style={styles.bulkButtonText}>Limpar concluídos</Text>
                  </TouchableOpacity>
                )}
                {stats.activeOrPending > 0 && (
                  <TouchableOpacity
                    style={[styles.bulkButton, styles.bulkButtonDanger]}
                    onPress={onCancelAll}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Cancelar todos os downloads"
                  >
                    <X color="#FF4E45" size={14} />
                    <Text style={[styles.bulkButtonText, styles.bulkButtonDangerText]}>
                      Cancelar tudo
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={styles.divider} />

            {queue.length === 0 ? (
              <View style={styles.emptyBox}>
                <View style={styles.emptyIconCircle}>
                  <ArrowDownToLine color={theme.colors.textMuted} size={28} />
                </View>
                <Text style={styles.emptyTitle}>Nenhum download na fila</Text>
                <Text style={styles.emptySubtitle}>
                  Toque para salvar músicas na Busca ou em Playlists para acompanhar tudo por aqui.
                </Text>
              </View>
            ) : (
              <FlatList
                data={queue}
                keyExtractor={(item) => item.track.id}
                renderItem={renderQueueItem}
                style={styles.listScroll}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={true}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={5}
                removeClippedSubviews={true}
              />
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
    maxHeight: '78%',
    marginBottom: -72,
    paddingBottom: 92,
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
    paddingVertical: 10,
    gap: 12,
  },
  headerIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
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
  bulkActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  bulkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  bulkButtonDanger: {
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
  },
  bulkButtonText: {
    color: '#E4E4E7',
    fontSize: 12,
    fontWeight: '600',
  },
  bulkButtonDangerText: {
    color: '#FF4E45',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 20,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 36,
    gap: 10,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: '#AAAAAA',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  listScroll: {
    maxHeight: 380,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    gap: 12,
  },
  thumbBox: {
    width: 44,
    height: 44,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: 44,
    height: 44,
  },
  rowMeta: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  rowArtist: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 1,
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 1.5,
  },
  progressLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  statusPendingText: {
    color: '#AAAAAA',
    fontSize: 11,
    fontWeight: '500',
  },
  statusCompletedText: {
    color: theme.colors.success,
    fontSize: 11,
    fontWeight: '600',
  },
  statusErrorText: {
    flex: 1,
    color: theme.colors.danger,
    fontSize: 11,
    fontWeight: '500',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default DownloadQueueModal;
