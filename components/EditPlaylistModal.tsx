import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { ImagePlus, RotateCcw, X } from 'lucide-react-native';
import { PlaylistDetail } from '../services/database';
import {
  PickedCoverAsset,
  pickPlaylistCoverFromGallery,
} from '../services/storage';
import { PlaylistCover } from './PlaylistCover';
import { CoverCropModal } from './CoverCropModal';
import { SHEET_ENTER_MS, useModalEnterAnimation } from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';
import { useBackModalLock } from '../services/backNavigation';

type CoverDraft =
  | { type: 'keep' }
  | { type: 'custom'; uri: string }
  | { type: 'reset' };

export interface EditPlaylistSavePayload {
  name: string;
  description: string;
  customCoverSourceUri?: string;
  resetCustomCover?: boolean;
}

export interface EditPlaylistModalProps {
  visible: boolean;
  playlist: PlaylistDetail | null;
  onClose: () => void;
  onSave: (payload: EditPlaylistSavePayload) => Promise<void>;
}

export const EditPlaylistModal: React.FC<EditPlaylistModalProps> = ({
  visible,
  playlist,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverDraft, setCoverDraft] = useState<CoverDraft>({ type: 'keep' });
  const [pendingCropAsset, setPendingCropAsset] = useState<PickedCoverAsset | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(24)).current;
  const isDialogVisible = Boolean(visible && playlist && !pendingCropAsset);
  useBackModalLock(Boolean(visible && playlist));

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
    if (visible && playlist) {
      setName(playlist.name);
      setDescription(playlist.description || '');
      setCoverDraft({ type: 'keep' });
      setPendingCropAsset(null);
      setErrorMessage(null);
      setIsSaving(false);
    }
  }, [visible, playlist?.id]);

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

  if (!visible || !playlist) return null;

  const autoThumbnails = playlist.tracks
    .map((t) => t.thumbnailUrl)
    .filter((uri): uri is string => Boolean(uri))
    .slice(0, 4);

  const previewHasCustomCover =
    coverDraft.type === 'custom'
      ? true
      : coverDraft.type === 'reset'
        ? false
        : Boolean(playlist.hasCustomCover);

  const previewThumbnailUrl =
    coverDraft.type === 'custom'
      ? coverDraft.uri
      : coverDraft.type === 'reset'
        ? autoThumbnails[0] || null
        : playlist.thumbnailUrl;

  const previewCoverThumbnails = previewHasCustomCover ? [] : autoThumbnails;

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

  const handleResetCover = () => {
    setErrorMessage(null);
    setCoverDraft({ type: 'reset' });
  };

  const handleConfirmSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isSaving) return;

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onSave({
        name: trimmedName,
        description: description.trim(),
        customCoverSourceUri:
          coverDraft.type === 'custom' ? coverDraft.uri : undefined,
        resetCustomCover: coverDraft.type === 'reset',
      });
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível salvar as alterações.'
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
          {/* Cabeçalho */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Editar playlist</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => !isSaving && onClose()}
              disabled={isSaving}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Fechar edição da playlist"
            >
              <X color="#AAAAAA" size={22} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Preview da capa + Ações de capa */}
            <View style={styles.coverSection}>
              <PlaylistCover
                thumbnailUrl={previewThumbnailUrl}
                hasCustomCover={previewHasCustomCover}
                coverThumbnails={previewCoverThumbnails}
                size={156}
                borderRadius={12}
                iconSize={48}
                style={styles.coverPreview}
              />

              <View style={styles.coverButtonsRow}>
                <TouchableOpacity
                  style={styles.coverActionBtn}
                  onPress={handlePickImage}
                  disabled={isSaving}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Alterar capa"
                >
                  <ImagePlus color="#FFFFFF" size={16} />
                  <Text style={styles.coverActionText}>Alterar capa</Text>
                </TouchableOpacity>

                {previewHasCustomCover && (
                  <TouchableOpacity
                    style={styles.coverResetBtn}
                    onPress={handleResetCover}
                    disabled={isSaving}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Usar capa automática no modal de edição"
                  >
                    <RotateCcw color="#AAAAAA" size={15} />
                    <Text style={styles.coverResetText}>Usar capa automática</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {errorMessage && (
              <Text style={styles.errorText}>{errorMessage}</Text>
            )}

            {/* Campos de texto */}
            <Text style={styles.fieldLabel}>Nome</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Nome da playlist"
              placeholderTextColor="#717171"
              maxLength={100}
              editable={!isSaving}
              accessibilityLabel="Nome da playlist"
            />

            <Text style={styles.fieldLabel}>Descrição</Text>
            <TextInput
              style={[styles.input, styles.descInput]}
              value={description}
              onChangeText={setDescription}
              placeholder="Adicione uma descrição (opcional)"
              placeholderTextColor="#717171"
              multiline
              maxLength={280}
              editable={!isSaving}
              accessibilityLabel="Descrição da playlist"
            />
          </ScrollView>

          {/* Ações finais */}
          <View style={styles.footerActions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel="Cancelar edição da playlist"
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                (!name.trim() || isSaving) && styles.saveBtnDisabled,
              ]}
              onPress={handleConfirmSave}
              disabled={!name.trim() || isSaving}
              accessibilityRole="button"
              accessibilityLabel="Salvar alterações da playlist"
            >
              {isSaving ? (
                <ActivityIndicator color="#000000" size="small" />
              ) : (
                <Text style={styles.saveText}>Salvar</Text>
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
        setPendingCropAsset(null);
        setCoverDraft({ type: 'custom', uri: croppedUri });
      }}
    />
  </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 18,
    padding: 20,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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
    marginBottom: 16,
  },
  coverPreview: {
    marginBottom: 12,
  },
  coverButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  coverActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.elevated,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  coverActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  coverResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  coverResetText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '500',
  },
  errorText: {
    color: '#FF4E45',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  fieldLabel: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.colors.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#FFFFFF',
    fontSize: 15,
    marginBottom: 14,
  },
  descInput: {
    minHeight: 74,
    textAlignVertical: 'top',
  },
  footerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 6,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 10,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
});
