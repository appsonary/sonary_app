import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Check,
  Heart,
  Plus,
  X,
} from 'lucide-react-native';
import {
  addTrackToPlaylist,
  createPlaylist,
  getCachedPlaylists,
  getPlaylists,
  isTrackInPlaylist,
  PlaylistSummary,
  TrackInput,
} from '../services/database';
import { PlaylistCover } from './PlaylistCover';
import { useBottomSheetController } from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';
import { useBackModalLock } from '../services/backNavigation';

export interface AddToPlaylistModalProps {
  visible: boolean;
  onClose: () => void;
  track: TrackInput | null;
  onPlaylistCreated?: (newPlaylist: PlaylistSummary) => void;
  onTrackAdded?: (playlistId: string, playlistName: string) => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  visible,
  onClose,
  track,
  onPlaylistCreated,
  onTrackAdded,
}) => {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(
    () => getCachedPlaylists() ?? []
  );
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [addedPlaylistId, setAddedPlaylistId] = useState<string | null>(null);
  const [duplicateWarningPlaylist, setDuplicateWarningPlaylist] = useState<PlaylistSummary | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const { height: windowHeight } = useWindowDimensions();
  const listOpacity = useRef(new Animated.Value(0)).current;
  const fadeRef = useRef<Animated.CompositeAnimation | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useBackModalLock(visible);
  const {
    translateY: sheetTranslateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
  } = useBottomSheetController({
    visible,
    onClose,
    initialOffset: 320,
  });

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const fetchPlaylists = async () => {
    try {
      const list = await getPlaylists();
      setPlaylists(list);
      fadeRef.current?.stop();
      const easing = getEaseOutCubic(Easing);
      const anim = Animated.timing(listOpacity, {
        toValue: 1,
        duration: theme.transitions.screenInMs,
        easing,
        useNativeDriver: true,
      });
      fadeRef.current = anim;
      anim.start();
    } catch (err) {
      console.error('[AddToPlaylistModal] Falha ao carregar playlists:', err);
      listOpacity.setValue(1);
    }
  };

  useEffect(() => {
    fadeRef.current?.stop();
    clearCloseTimer();
    if (visible) {
      const cached = getCachedPlaylists();
      if (cached && cached.length > 0) {
        setPlaylists(cached);
        listOpacity.setValue(1);
      } else {
        listOpacity.setValue(playlists.length > 0 ? 1 : 0);
      }
      setIsCreating(false);
      setNewPlaylistName('');
      setAddedPlaylistId(null);
      setDuplicateWarningPlaylist(null);
      fetchPlaylists();
    }
    return () => {
      fadeRef.current?.stop();
      clearCloseTimer();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
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
  }, [visible]);

  const executeAdd = async (playlist: PlaylistSummary) => {
    if (!track) return;
    try {
      setIsSubmitting(true);
      await addTrackToPlaylist(playlist.id, track);
      setAddedPlaylistId(playlist.id);
      setDuplicateWarningPlaylist(null);
      onTrackAdded?.(playlist.id, playlist.name);

      // Feedback visual rápido de sucesso antes de fechar
      clearCloseTimer();
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setIsSubmitting(false);
        onClose();
      }, 500);
    } catch (err) {
      console.error('[AddToPlaylistModal] Falha ao adicionar faixa:', err);
      setIsSubmitting(false);
    }
  };

  const handleSelectPlaylist = async (playlist: PlaylistSummary) => {
    if (!track) return;
    try {
      setIsSubmitting(true);
      const isDuplicate = await isTrackInPlaylist(playlist.id, track.id);
      if (isDuplicate) {
        setIsSubmitting(false);
        setDuplicateWarningPlaylist(playlist);
        return;
      }
      await executeAdd(playlist);
    } catch (err) {
      console.error('[AddToPlaylistModal] Falha ao checar duplicata:', err);
      await executeAdd(playlist);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!track || !newPlaylistName.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      const newPl = await createPlaylist(newPlaylistName.trim());
      await addTrackToPlaylist(newPl.id, track);

      onPlaylistCreated?.(newPl);
      onTrackAdded?.(newPl.id, newPl.name);
      setAddedPlaylistId(newPl.id);

      clearCloseTimer();
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setIsSubmitting(false);
        onClose();
      }, 500);
    } catch (err) {
      console.error('[AddToPlaylistModal] Falha ao criar playlist:', err);
      setIsSubmitting(false);
    }
  };

  const handleRequestClose = () => {
    if (duplicateWarningPlaylist) {
      setDuplicateWarningPlaylist(null);
      return;
    }
    if (isCreating && addedPlaylistId === null) {
      setIsCreating(false);
      setNewPlaylistName('');
      return;
    }
    clearCloseTimer();
    setIsSubmitting(false);
    dismissSheet();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      onShow={onModalShow}
      onRequestClose={handleRequestClose}
    >
      <Animated.View style={{ flex: 1, opacity: backdropOpacity }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.overlay,
          Platform.OS === 'android' && keyboardHeight > 0 && { paddingBottom: keyboardHeight },
        ]}
      >
        <Animated.View
          style={[
            styles.sheetContainer,
            keyboardHeight > 0 && {
              maxHeight: Math.max(240, windowHeight - keyboardHeight - 40),
            },
            { transform: [{ translateY: sheetTranslateY }] },
          ]}
        >
        <SafeAreaView>
          {/* Header do Bottom Sheet */}
          <View style={styles.header}>
            <View style={styles.headerInfo}>
              <Text style={styles.headerTitle}>Adicionar à playlist</Text>
              {track && (
                <Text style={styles.trackSubtitle} numberOfLines={1}>
                  {track.title} • {track.artist}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => dismissSheet()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Fechar modal"
            >
              <X color="#AAAAAA" size={24} />
            </TouchableOpacity>
          </View>

          {/* Botão / Formulário de Criação de Nova Playlist */}
          {!isCreating ? (
            <TouchableOpacity
              style={styles.newPlaylistButton}
              onPress={() => setIsCreating(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Criar nova playlist"
            >
              <View style={styles.newPlaylistIconWrapper}>
                <Plus color="#FFFFFF" size={22} />
              </View>
              <Text style={styles.newPlaylistText}>Nova playlist</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.createForm}>
              <TextInput
                style={styles.createInput}
                placeholder="Dê um nome para a sua playlist"
                placeholderTextColor="#717171"
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                autoFocus={true}
                returnKeyType="done"
                onSubmitEditing={handleCreateAndAdd}
                accessibilityLabel="Nome da nova playlist"
              />
              <View style={styles.createFormActions}>
                <TouchableOpacity
                  style={styles.cancelCreateButton}
                  onPress={() => {
                    setIsCreating(false);
                    setNewPlaylistName('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar criação de playlist"
                >
                  <Text style={styles.cancelCreateText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmCreateButton,
                    !newPlaylistName.trim() && styles.confirmCreateButtonDisabled,
                  ]}
                  onPress={handleCreateAndAdd}
                  disabled={!newPlaylistName.trim() || isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar criação e adicionar faixa"
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#000000" size="small" />
                  ) : (
                    <Text style={styles.confirmCreateText}>Criar e adicionar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Divisor Visual */}
          <View style={styles.divider} />

          {/* Alerta de Faixa Duplicada */}
          {duplicateWarningPlaylist && (
            <View style={styles.duplicateWarningContainer}>
              <Text style={styles.duplicateWarningTitle}>Música já adicionada</Text>
              <Text style={styles.duplicateWarningText}>
                Esta música já está nesta playlist. Deseja adicionar novamente ou cancelar?
              </Text>
              <View style={styles.duplicateWarningActions}>
                <TouchableOpacity
                  style={styles.duplicateCancelBtn}
                  onPress={() => setDuplicateWarningPlaylist(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                >
                  <Text style={styles.duplicateCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.duplicateConfirmBtn}
                  onPress={() => executeAdd(duplicateWarningPlaylist)}
                  accessibilityRole="button"
                  accessibilityLabel="Adicionar novamente"
                >
                  <Text style={styles.duplicateConfirmText}>Adicionar novamente</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Lista de Playlists Existentes (fade suave sem skeleton flash) */}
          <Animated.View
            style={{
              opacity: listOpacity,
              maxHeight:
                keyboardHeight > 0
                  ? Math.max(72, windowHeight - keyboardHeight - 250)
                  : 360,
            }}
          >
            <FlatList
              data={playlists}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = addedPlaylistId === item.id;

                return (
                  <TouchableOpacity
                    style={[
                      styles.playlistItem,
                      isSelected && styles.playlistItemSelected,
                    ]}
                    onPress={() => handleSelectPlaylist(item)}
                    disabled={isSubmitting}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Adicionar à playlist ${item.name}`}
                  >
                    {/* Thumbnail ou Ícone da Playlist */}
                    {item.isSystem ? (
                      <View style={styles.thumbnailWrapper}>
                        <View style={styles.favoritesIconWrapper}>
                          <Heart color="#FFFFFF" fill="#FFFFFF" size={20} />
                        </View>
                      </View>
                    ) : (
                      <PlaylistCover
                        thumbnailUrl={item.thumbnailUrl}
                        hasCustomCover={item.hasCustomCover}
                        coverThumbnails={item.coverThumbnails}
                        size={48}
                        borderRadius={8}
                        iconSize={22}
                        placeholderColor="#AAAAAA"
                        placeholderBackgroundColor="#282828"
                        style={styles.thumbnailWrapper}
                      />
                    )}

                    {/* Informações da Playlist */}
                    <View style={styles.playlistInfo}>
                      <Text style={styles.playlistName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.playlistMeta}>
                        {item.trackCount} {item.trackCount === 1 ? 'música' : 'músicas'}
                      </Text>
                    </View>

                    {/* Status de Selecionado */}
                    {isSelected && (
                      <View style={styles.checkWrapper}>
                        <Check color="#FFFFFF" size={20} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </Animated.View>
        </SafeAreaView>
        </Animated.View>
      </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#212121',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 20 : 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  headerInfo: {
    flex: 1,
    marginRight: 16,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  trackSubtitle: {
    color: '#AAAAAA',
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  newPlaylistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  newPlaylistIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  newPlaylistText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  createForm: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  createInput: {
    backgroundColor: '#141414',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  createFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  cancelCreateButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelCreateText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '500',
  },
  confirmCreateButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 9999,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCreateButtonDisabled: {
    backgroundColor: '#FFFFFF',
    opacity: 0.4,
  },
  confirmCreateText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 6,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  playlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  playlistItemSelected: {
    opacity: 0.8,
  },
  thumbnailWrapper: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 14,
  },
  favoritesIconWrapper: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistInfo: {
    flex: 1,
  },
  playlistName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  playlistMeta: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  checkWrapper: {
    marginLeft: 12,
  },
  duplicateWarningContainer: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    marginHorizontal: 20,
    marginVertical: 10,
    padding: 16,
  },
  duplicateWarningTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  duplicateWarningText: {
    color: '#CCCCCC',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  duplicateWarningActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  duplicateCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9999,
  },
  duplicateCancelText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '600',
  },
  duplicateConfirmBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9999,
  },
  duplicateConfirmText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
});
