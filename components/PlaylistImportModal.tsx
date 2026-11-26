import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  FileJson,
  Image as ImageIcon,
  ListMusic,
  X,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ImportPlaylistResult,
  importPlaylistFromExport,
  PickedPlaylistResult,
} from '../services/backup';
import { useBackModalLock } from '../services/backNavigation';
import { MaterialTextInput } from './MaterialTextInput';
import { PlaylistCover } from './PlaylistCover';
import { useBottomSheetController } from './sheetMotion';
import { theme } from '../theme';

const MAX_PLAYLIST_NAME_LENGTH = 50;

export interface PlaylistImportModalProps {
  visible: boolean;
  pickedPlaylist: PickedPlaylistResult | null;
  existingPlaylistNames?: string[];
  onClose: () => void;
  onImported: (result: ImportPlaylistResult) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTotalDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min`;
  }
  return `${safe} s`;
}

function formatDatePtBr(timestampMs: number): string {
  try {
    const d = new Date(timestampMs);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return '';
  }
}

export const PlaylistImportModal: React.FC<PlaylistImportModalProps> = ({
  visible,
  pickedPlaylist,
  existingPlaylistNames = [],
  onClose,
  onImported,
}) => {
  const isModalVisible = Boolean(visible && pickedPlaylist);
  useBackModalLock(isModalVisible);

  const {
    translateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
    panResponder,
  } = useBottomSheetController({
    visible: isModalVisible,
    onClose,
    initialOffset: 420,
    dismissOffset: 480,
  });

  const [playlistName, setPlaylistName] = useState('');
  const [enqueueOffline, setEnqueueOffline] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (isModalVisible && pickedPlaylist) {
      setPlaylistName(pickedPlaylist.preview.name.slice(0, MAX_PLAYLIST_NAME_LENGTH));
      setEnqueueOffline(false);
      setIsImporting(false);
      setErrorMessage(null);
    } else {
      setKeyboardHeight(0);
    }
  }, [isModalVisible, pickedPlaylist]);

  useEffect(() => {
    if (!isModalVisible || Platform.OS !== 'android') {
      setKeyboardHeight(0);
      return;
    }
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const nextHeight = event?.endCoordinates?.height ?? 0;
      setKeyboardHeight(nextHeight > 0 ? nextHeight : 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub?.remove?.();
      hideSub?.remove?.();
    };
  }, [isModalVisible]);

  const hasNameCollision = useMemo(() => {
    const trimmed = playlistName.trim().toLowerCase();
    if (!trimmed) return false;
    return existingPlaylistNames.some((n) => n.trim().toLowerCase() === trimmed);
  }, [existingPlaylistNames, playlistName]);

  if (!isModalVisible || !pickedPlaylist) return null;

  const { preview } = pickedPlaylist;
  const trimmedName = playlistName.trim();
  const canConfirm = trimmedName.length > 0 && !isImporting;

  const handleConfirmImport = async () => {
    if (!canConfirm) return;
    setErrorMessage(null);
    setIsImporting(true);
    try {
      const result = await importPlaylistFromExport(pickedPlaylist.exported, {
        nameOverride: trimmedName,
        enqueueOfflineDownloads: enqueueOffline && preview.offlineMissingCount > 0,
      });
      setIsImporting(false);
      dismissSheet(() => onImported(result));
    } catch (err) {
      setIsImporting(false);
      setErrorMessage(
        err instanceof Error ? err.message : 'Não foi possível importar a playlist.'
      );
    }
  };

  const trackCountLabel = `${preview.trackCount} ${
    preview.trackCount === 1 ? 'música' : 'músicas'
  }`;

  return (
    <Modal
      visible={isModalVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onShow={onModalShow}
      onRequestClose={() => {
        if (!isImporting) dismissSheet();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.overlay,
          Platform.OS === 'android' && keyboardHeight > 0
            ? { paddingBottom: keyboardHeight }
            : undefined,
        ]}
      >
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => {
              if (!isImporting) dismissSheet();
            }}
            accessibilityRole="button"
            accessibilityLabel="Fechar importação de playlist"
          />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          testID="playlist-import-modal-sheet"
        >
          <View style={styles.handleArea} {...(isImporting ? {} : panResponder.panHandlers)}>
            <View style={styles.handleBar} />
          </View>

          <View style={styles.header} {...(isImporting ? {} : panResponder.panHandlers)}>
            <View style={styles.headerLeft}>
              <LinearGradient
                colors={['#E62626', '#9A0C0C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.headerBadge}
              >
                <ListMusic color="#FFFFFF" size={20} strokeWidth={2.2} />
              </LinearGradient>
              <View style={styles.headerInfo}>
                <Text style={styles.title}>Importar playlist</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  Confira antes de adicionar à sua biblioteca
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (!isImporting) dismissSheet();
              }}
              style={styles.closeBtn}
              disabled={isImporting}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
            >
              <X color="#FFFFFF" size={17} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {errorMessage && (
              <View style={styles.alertError} testID="playlist-import-error-banner">
                <AlertTriangle color={theme.colors.danger} size={18} />
                <Text style={styles.alertErrorText}>{errorMessage}</Text>
              </View>
            )}

            {/* Metadados do arquivo */}
            <View style={styles.fileHeader}>
              <View style={styles.fileIconWrap}>
                <FileJson color={theme.colors.brandPrimary} size={18} />
              </View>
              <View style={styles.fileHeaderText}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {pickedPlaylist.fileName}
                </Text>
                <Text style={styles.fileMeta}>
                  Exportado em {formatDatePtBr(preview.exportedAt)} •{' '}
                  {formatBytes(pickedPlaylist.sizeBytes)}
                </Text>
              </View>
            </View>

            {/* Preview visual da playlist */}
            <View style={styles.previewCard}>
              {preview.customCoverDataUri ? (
                <Image
                  source={{ uri: preview.customCoverDataUri }}
                  style={styles.previewCover}
                />
              ) : (
                <PlaylistCover
                  thumbnailUrl={preview.coverThumbnails[0] || null}
                  hasCustomCover={false}
                  coverThumbnails={preview.coverThumbnails}
                  size={68}
                  borderRadius={10}
                  iconSize={28}
                  placeholderBackgroundColor={theme.colors.elevated}
                />
              )}

              <View style={styles.previewMetaCol}>
                <View style={styles.metaLine}>
                  <ListMusic color="#C8C8CE" size={14} />
                  <Text style={styles.metaLineText}>{trackCountLabel}</Text>
                </View>
                <View style={styles.metaLine}>
                  <Clock color="#C8C8CE" size={14} />
                  <Text style={styles.metaLineText}>
                    {formatTotalDuration(preview.totalDuration)}
                  </Text>
                </View>
                {preview.hasCustomCover && (
                  <View style={styles.metaLine}>
                    <ImageIcon color="#C8C8CE" size={14} />
                    <Text style={styles.metaLineText}>Inclui capa personalizada</Text>
                  </View>
                )}
              </View>
            </View>

            {preview.description ? (
              <Text style={styles.descriptionText} numberOfLines={2}>
                {preview.description}
              </Text>
            ) : null}

            {/* Campo editável de nome */}
            <View style={styles.inputSection}>
              <MaterialTextInput
                label="NOME DA PLAYLIST"
                placeholder="Nome da nova playlist..."
                accessibilityLabel="Nome da playlist importada"
                clearAccessibilityLabel="Limpar nome da playlist importada"
                value={playlistName}
                onChangeText={setPlaylistName}
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                editable={!isImporting}
                returnKeyType="done"
                onSubmitEditing={handleConfirmImport}
              />
              <View style={styles.inputMetaRow}>
                <Text style={styles.collisionHint}>
                  {hasNameCollision
                    ? 'Já existe uma playlist com este nome — uma nova será criada.'
                    : 'Será criada como uma nova playlist na sua biblioteca.'}
                </Text>
                <Text style={styles.charCounter}>
                  {`${playlistName.length}/${MAX_PLAYLIST_NAME_LENGTH}`}
                </Text>
              </View>
            </View>

            {/* Toggle opcional de download offline */}
            {preview.offlineMissingCount > 0 && (
              <TouchableOpacity
                style={styles.offlineToggleRow}
                onPress={() => setEnqueueOffline((prev) => !prev)}
                disabled={isImporting}
                activeOpacity={0.75}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: enqueueOffline }}
                accessibilityLabel={`Baixar ${preview.offlineMissingCount} músicas para ouvir offline`}
                testID="playlist-import-offline-toggle"
              >
                <View
                  style={[
                    styles.checkbox,
                    enqueueOffline && styles.checkboxChecked,
                  ]}
                >
                  {enqueueOffline && <Check color="#09090B" size={13} strokeWidth={3} />}
                </View>
                <View style={styles.offlineToggleTextCol}>
                  <Text style={styles.offlineToggleTitle}>
                    Baixar {preview.offlineMissingCount}{' '}
                    {preview.offlineMissingCount === 1 ? 'música' : 'músicas'} offline
                  </Text>
                  <Text style={styles.offlineToggleSubtitle}>
                    Adiciona à fila de downloads após importar
                  </Text>
                </View>
                <Download color="#AAAAAA" size={18} />
              </TouchableOpacity>
            )}

            {/* Ações */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  if (!isImporting) dismissSheet();
                }}
                disabled={isImporting}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Cancelar importação"
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmBtn, !canConfirm && styles.confirmBtnDisabled]}
                onPress={handleConfirmImport}
                disabled={!canConfirm}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Confirmar importação da playlist"
                testID="playlist-import-confirm-button"
              >
                {isImporting ? (
                  <ActivityIndicator size="small" color="#09090B" />
                ) : (
                  <Text style={styles.confirmBtnText}>Importar playlist</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  sheet: {
    backgroundColor: '#141416',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    maxHeight: '88%',
    paddingBottom: 24,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  headerBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
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
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 14,
  },
  alertError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.35)',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  alertErrorText: {
    flex: 1,
    color: '#FF9E99',
    fontSize: 13,
    lineHeight: 18,
  },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 12,
    padding: 10,
    gap: 10,
  },
  fileIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileHeaderText: {
    flex: 1,
  },
  fileName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  fileMeta: {
    color: '#AAAAAA',
    fontSize: 11.5,
    marginTop: 2,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 14,
    padding: 12,
    gap: 14,
  },
  previewCover: {
    width: 68,
    height: 68,
    borderRadius: 10,
    backgroundColor: theme.colors.elevated,
  },
  previewMetaCol: {
    flex: 1,
    gap: 6,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  metaLineText: {
    color: '#D4D4D8',
    fontSize: 13,
    fontWeight: '500',
  },
  descriptionText: {
    color: '#AAAAAA',
    fontSize: 12.5,
    lineHeight: 17,
  },
  inputSection: {
    gap: 6,
  },
  inputMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  collisionHint: {
    flex: 1,
    color: '#AAAAAA',
    fontSize: 11.5,
    lineHeight: 15,
  },
  charCounter: {
    color: '#71717A',
    fontSize: 11.5,
  },
  offlineToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  offlineToggleTextCol: {
    flex: 1,
  },
  offlineToggleTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  offlineToggleSubtitle: {
    color: '#AAAAAA',
    fontSize: 11.5,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  cancelBtnText: {
    color: '#D4D4D8',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.35,
  },
  confirmBtnText: {
    color: '#09090B',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default PlaylistImportModal;
