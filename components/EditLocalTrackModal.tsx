import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { ImagePlus, Music2, RotateCcw, X } from 'lucide-react-native';
import { LocalDeviceTrack } from '../services/database';
import {
  PickedCoverAsset,
  pickPlaylistCoverFromGallery,
} from '../services/storage';
import { CoverCropModal } from './CoverCropModal';
import { SHEET_ENTER_MS, useModalEnterAnimation } from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';
import { useBackModalLock } from '../services/backNavigation';

type CoverDraft =
  | { type: 'keep' }
  | { type: 'custom'; uri: string }
  | { type: 'reset' };

export interface EditLocalTrackSavePayload {
  title: string;
  artist: string;
  customCoverSourceUri?: string;
  resetCustomCover?: boolean;
  resetAllMetadata?: boolean;
}

export interface EditLocalTrackModalProps {
  visible: boolean;
  track: LocalDeviceTrack | null;
  onClose: () => void;
  onSave: (payload: EditLocalTrackSavePayload) => Promise<void>;
}

export const EditLocalTrackModal: React.FC<EditLocalTrackModalProps> = ({
  visible,
  track,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [coverDraft, setCoverDraft] = useState<CoverDraft>({ type: 'keep' });
  const [pendingCropAsset, setPendingCropAsset] = useState<PickedCoverAsset | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(24)).current;
  const isDialogVisible = Boolean(visible && track && !pendingCropAsset);
  useBackModalLock(Boolean(visible && track));

  const { onModalShow } = useModalEnterAnimation({
    visible: isDialogVisible,
    onReset: () => {
      cardOpacity.setValue(0);
      cardTranslateY.setValue(24);
    },
    onAnimateIn: () => {
      const easeOut = getEaseOutCubic(Easing);
      const anim = Animated.parallel([
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: SHEET_ENTER_MS,
          easing: easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
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

  useEffect(() => {
    if (visible && track) {
      setTitle(track.title);
      setArtist(track.artist);
      setCoverDraft({ type: 'keep' });
      setPendingCropAsset(null);
      setErrorMessage(null);
      setIsSaving(false);
    }
  }, [visible, track?.id]);

  useEffect(() => {
    if (!isDialogVisible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard?.addListener?.(showEvent, (event: any) => {
      const h = event?.endCoordinates?.height;
      setKeyboardHeight(typeof h === 'number' && h > 0 ? h : 0);
    });
    const hideSub = Keyboard?.addListener?.(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub?.remove?.();
      hideSub?.remove?.();
    };
  }, [isDialogVisible]);

  if (!visible || !track) return null;

  const previewArtworkUri =
    coverDraft.type === 'custom'
      ? coverDraft.uri
      : coverDraft.type === 'reset'
        ? track.artworkUri
        : track.customArtworkUri || track.artworkUri;

  const hasCustomOverrides = Boolean(
    track.customTitle || track.customArtist || track.customArtworkUri
  );

  const handlePickImage = async () => {
    setErrorMessage(null);
    try {
      const pickedAsset = await pickPlaylistCoverFromGallery();
      if (pickedAsset) {
        setPendingCropAsset(pickedAsset);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível selecionar uma imagem da galeria.'
      );
    }
  };

  const handleConfirmSave = async () => {
    const trimmedTitle = title.trim();
    const trimmedArtist = artist.trim();
    if (!trimmedTitle || isSaving) return;

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onSave({
        title: trimmedTitle,
        artist: trimmedArtist || 'Artista desconhecido',
        customCoverSourceUri: coverDraft.type === 'custom' ? coverDraft.uri : undefined,
        resetCustomCover: coverDraft.type === 'reset',
      });
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Não foi possível salvar as alterações.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onSave({
        title: track.rawTitle,
        artist: track.rawArtist,
        resetAllMetadata: true,
      });
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Não foi possível restaurar os metadados.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible && !pendingCropAsset}
        transparent
        statusBarTranslucent={true}
        hardwareAccelerated={true}
        animationType="none"
        onShow={onModalShow}
        onRequestClose={() => !isSaving && onClose()}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.overlay,
            Platform.OS === 'android' && keyboardHeight > 0 && { paddingBottom: keyboardHeight },
          ]}
        >
          <Animated.View
            style={[
              styles.card,
              keyboardHeight > 0 && {
                maxHeight: Math.max(240, windowHeight - keyboardHeight - 40),
              },
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardTranslateY }],
              },
            ]}
          >
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Editar música local</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => !isSaving && onClose()}
                disabled={isSaving}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Fechar edição da música"
              >
                <X color="#AAAAAA" size={22} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.coverSection}>
                <View style={styles.coverPreview}>
                  {previewArtworkUri ? (
                    <Image
                      source={{ uri: previewArtworkUri }}
                      style={styles.coverImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <Music2 color="#717171" size={48} />
                  )}
                </View>

                <View style={styles.coverButtonsRow}>
                  <TouchableOpacity
                    style={styles.coverActionBtn}
                    onPress={handlePickImage}
                    disabled={isSaving}
                    accessibilityRole="button"
                    accessibilityLabel="Escolher capa da galeria"
                  >
                    <ImagePlus color="#FFFFFF" size={16} />
                    <Text style={styles.coverActionBtnText}>Escolher capa</Text>
                  </TouchableOpacity>

                  {(track.customArtworkUri || coverDraft.type === 'custom') && (
                    <TouchableOpacity
                      style={styles.coverResetBtn}
                      onPress={() => setCoverDraft({ type: 'reset' })}
                      disabled={isSaving}
                      accessibilityRole="button"
                      accessibilityLabel="Restaurar capa original"
                    >
                      <RotateCcw color="#AAAAAA" size={15} />
                      <Text style={styles.coverResetBtnText}>Restaurar capa original</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <Text style={styles.fieldLabel}>Título</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Nome da música"
                placeholderTextColor="#717171"
                maxLength={140}
                editable={!isSaving}
                accessibilityLabel="Título da música"
              />

              <Text style={styles.fieldLabel}>Artista</Text>
              <TextInput
                style={styles.input}
                value={artist}
                onChangeText={setArtist}
                placeholder="Artista desconhecido"
                placeholderTextColor="#717171"
                maxLength={120}
                editable={!isSaving}
                accessibilityLabel="Artista da música"
              />

              <Text style={styles.fileHint} numberOfLines={2}>
                Arquivo: {track.fileName} ({track.folderName})
              </Text>
              <Text style={styles.localNote}>
                As alterações são salvas apenas no Sonary e não modificam o arquivo original no dispositivo.
              </Text>

              {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

              {hasCustomOverrides && (
                <TouchableOpacity
                  style={styles.resetAllBtn}
                  onPress={handleResetAll}
                  disabled={isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Restaurar metadados originais"
                >
                  <RotateCcw color="#AAAAAA" size={15} />
                  <Text style={styles.resetAllText}>Restaurar dados originais</Text>
                </TouchableOpacity>
              )}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onClose}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancelar"
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, (!title.trim() || isSaving) && styles.saveBtnDisabled]}
                onPress={handleConfirmSave}
                disabled={!title.trim() || isSaving}
                accessibilityRole="button"
                accessibilityLabel="Salvar alterações"
              >
                {isSaving ? (
                  <ActivityIndicator color="#030303" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Salvar</Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <CoverCropModal
        visible={Boolean(pendingCropAsset)}
        asset={pendingCropAsset}
        onCancel={() => setPendingCropAsset(null)}
        onConfirm={(croppedUri) => {
          setCoverDraft({ type: 'custom', uri: croppedUri });
          setPendingCropAsset(null);
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '88%',
    backgroundColor: theme.colors.elevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  coverSection: {
    alignItems: 'center',
    marginBottom: 18,
  },
  coverPreview: {
    width: 156,
    height: 156,
    borderRadius: 12,
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  coverActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  coverActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  coverResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  coverResetBtnText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '500',
  },
  fieldLabel: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#141414',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#FFFFFF',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 12,
  },
  fileHint: {
    color: '#888888',
    fontSize: 12,
    marginTop: 2,
  },
  localNote: {
    color: '#717171',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    marginTop: 10,
  },
  resetAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 8,
  },
  resetAllText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  cancelBtnText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 92,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    color: '#030303',
    fontSize: 14,
    fontWeight: '700',
  },
});
