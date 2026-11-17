import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  CheckCircle2,
  ChevronLeft,
  Disc,
  ListPlus,
  Music2,
  Play,
  Radio,
  Sparkles,
} from 'lucide-react-native';
import {
  ArtistProfile,
  getArtistProfile,
  TrackSummary,
} from '../services/api';
import { ToastBanner } from './ToastBanner';
import { SHEET_ENTER_MS, useModalEnterAnimation } from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';
import { useBackModalLock } from '../services/backNavigation';

export interface ArtistProfileModalProps {
  visible: boolean;
  onClose: () => void;
  artistName: string;
  channelId?: string;
  initialProfile?: ArtistProfile | null;
  onPlayTrack: (track: TrackSummary) => void;
  onAddToQueue?: (track: TrackSummary) => void;
  onStartArtistRadio: (artistName: string, channelId?: string) => void;
  toastMessage?: string | null;
  onDismissToast?: () => void;
}

export function ArtistProfileModal({
  visible,
  onClose,
  artistName,
  channelId,
  initialProfile,
  onPlayTrack,
  onAddToQueue,
  onStartArtistRadio,
  toastMessage = null,
  onDismissToast,
}: ArtistProfileModalProps) {
  const [profile, setProfile] = useState<ArtistProfile | null>(initialProfile || null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [discographyTab, setDiscographyTab] = useState<'albums' | 'singles'>('albums');
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalTranslateY = useRef(new Animated.Value(18)).current;
  useBackModalLock(visible);

  const { onModalShow } = useModalEnterAnimation({
    visible,
    onReset: () => {
      modalOpacity.setValue(0);
      modalTranslateY.setValue(18);
    },
    onAnimateIn: () => {
      const easeOut = getEaseOutCubic(Easing);
      const anim = Animated.parallel([
        Animated.timing(modalOpacity, {
          toValue: 1,
          duration: SHEET_ENTER_MS,
          easing: easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(modalTranslateY, {
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
    if (!visible || !artistName) return;

    if (
      initialProfile &&
      initialProfile.name.toLowerCase() ===
        artistName.split(/,|feat\.|ft\.|&/i)[0].trim().toLowerCase()
    ) {
      setProfile(initialProfile);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    getArtistProfile(artistName, channelId)
      .then((res) => {
        if (!isCancelled) {
          setProfile(res);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [visible, artistName, channelId, initialProfile]);

  if (!visible) return null;

  const displayName = profile?.name || artistName || 'Artista';
  const topTracks = profile?.topTracks || [];
  const discographyItems =
    discographyTab === 'albums'
      ? profile?.albums || []
      : profile?.singles || [];

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      onShow={onModalShow}
      onRequestClose={onClose}
    >
      <Animated.View
        style={{
          flex: 1,
          opacity: modalOpacity,
          transform: [{ translateY: modalTranslateY }],
        }}
      >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container} testID="artist-profile-modal">
          {/* Barra de Navegação Superior */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Voltar para o player"
            >
              <ChevronLeft color="#FFFFFF" size={26} />
              <Text style={styles.backButtonText}>Voltar</Text>
            </TouchableOpacity>

            <Text style={styles.topBarTitle} numberOfLines={1}>
              Perfil do Artista
            </Text>

            <View style={{ width: 68 }} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero Section com Avatar e Estatísticas */}
            <View style={styles.heroCard}>
              <View style={styles.avatarContainer}>
                {profile?.avatarUrl ? (
                  <Image
                    source={{ uri: profile.avatarUrl }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                    accessibilityRole="image"
                    accessibilityLabel={`Foto de ${displayName}`}
                  />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Sparkles color="#FFFFFF" size={36} />
                  </View>
                )}
              </View>

              <View style={styles.verifiedRow}>
                <CheckCircle2 color="#3EA6FF" size={16} />
                <Text style={styles.verifiedLabel}>
                  {profile?.subscriberCountText || 'Artista Verificado'}
                </Text>
              </View>

              <Text style={styles.artistTitle}>{displayName}</Text>
              <Text style={styles.listenersSubtitle}>
                {profile?.monthlyListenersText || 'Sonary Artist Hub'}
              </Text>

              {/* Ações Principais do Artista */}
              <View style={styles.heroActionsRow}>
                <TouchableOpacity
                  style={styles.primaryActionBtn}
                  onPress={() => {
                    onStartArtistRadio(displayName, profile?.channelId || channelId);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Iniciar rádio de ${displayName}`}
                >
                  <Radio color="#030303" size={18} />
                  <Text style={styles.primaryActionText}>Ouvir Rádio</Text>
                </TouchableOpacity>

                {topTracks.length > 0 && (
                  <TouchableOpacity
                    style={styles.secondaryActionBtn}
                    onPress={() => {
                      onPlayTrack(topTracks[0]);
                      onClose();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Tocar populares de ${displayName}`}
                  >
                    <Play color="#FFFFFF" size={16} fill="#FFFFFF" />
                    <Text style={styles.secondaryActionText}>Tocar Top 1</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {isLoading && (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#FF0000" size="small" />
                <Text style={styles.loadingText}>
                  Carregando discografia e principais faixas...
                </Text>
              </View>
            )}

            {/* Seção: Músicas Mais Populares (Top Tracks) */}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Populares</Text>

              {topTracks.length > 0 ? (
                topTracks.slice(0, 10).map((item, idx) => (
                  <TouchableOpacity
                    key={`${item.id}-${idx}`}
                    style={styles.topTrackRow}
                    onPress={() => {
                      onPlayTrack(item);
                      onClose();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Tocar ${item.title}`}
                  >
                    <Text style={styles.topTrackIndex}>{idx + 1}</Text>

                    {item.thumbnailUrl ? (
                      <Image
                        source={{ uri: item.thumbnailUrl }}
                        style={styles.topTrackThumb}
                      />
                    ) : (
                      <View style={styles.topTrackThumbFallback}>
                        <Music2 color="#888888" size={16} />
                      </View>
                    )}

                    <View style={styles.topTrackMeta}>
                      <Text style={styles.topTrackTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.topTrackSub} numberOfLines={1}>
                        {item.artist} • {item.formattedDuration || '3:30'}
                      </Text>
                    </View>

                    {onAddToQueue && (
                      <TouchableOpacity
                        style={styles.queueTrackBtn}
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          onAddToQueue(item);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Adicionar ${item.title} à fila`}
                      >
                        <ListPlus color="#AAAAAA" size={18} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.emptySectionText}>
                  Nenhuma faixa popular encontrada no momento.
                </Text>
              )}
            </View>

            {/* Seção: Discografia (Álbuns e Singles) */}
            <View style={styles.sectionBlock}>
              <View style={styles.discographyHeader}>
                <Text style={styles.sectionTitle}>Discografia</Text>
                <View style={styles.discographyTabs}>
                  <TouchableOpacity
                    style={[
                      styles.discTabBtn,
                      discographyTab === 'albums' && styles.discTabBtnActive,
                    ]}
                    onPress={() => setDiscographyTab('albums')}
                    accessibilityRole="button"
                    accessibilityLabel="Ver álbuns"
                  >
                    <Text
                      style={[
                        styles.discTabText,
                        discographyTab === 'albums' && styles.discTabTextActive,
                      ]}
                    >
                      Álbuns
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.discTabBtn,
                      discographyTab === 'singles' && styles.discTabBtnActive,
                    ]}
                    onPress={() => setDiscographyTab('singles')}
                    accessibilityRole="button"
                    accessibilityLabel="Ver singles"
                  >
                    <Text
                      style={[
                        styles.discTabText,
                        discographyTab === 'singles' && styles.discTabTextActive,
                      ]}
                    >
                      Singles & EPs
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {discographyItems.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.discographyRow}
                >
                  {discographyItems.map((release, rIdx) => (
                    <TouchableOpacity
                      key={`${release.browseId}-${rIdx}`}
                      style={styles.releaseCard}
                      onPress={() => {
                        const match = topTracks.find((t) => t.title === release.title) || topTracks[0];
                        if (match) {
                          onPlayTrack(match);
                          onClose();
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Ouvir ${release.title}`}
                    >
                      {release.thumbnailUrl ? (
                        <Image
                          source={{ uri: release.thumbnailUrl }}
                          style={styles.releaseCover}
                        />
                      ) : (
                        <View style={styles.releaseCoverFallback}>
                          <Disc color="#777777" size={28} />
                        </View>
                      )}
                      <Text style={styles.releaseTitle} numberOfLines={1}>
                        {release.title}
                      </Text>
                      <Text style={styles.releaseSub} numberOfLines={1}>
                        {release.year || (release.type === 'album' ? 'Álbum' : 'Single')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.emptySectionText}>
                  Discografia indisponível para esta seleção.
                </Text>
              )}
            </View>

            {/* Seção: Sobre / Biografia */}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Sobre</Text>
              <View style={styles.bioCard}>
                <Text style={styles.bioText}>
                  {profile?.bio ||
                    `Explore os principais sucessos e lançamentos de ${displayName}.`}
                </Text>
              </View>
            </View>
          </ScrollView>
          <ToastBanner
            message={toastMessage}
            onDismiss={onDismissToast}
            topOffset={Platform.OS === 'android' ? 12 : 54}
          />
        </View>
      </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
  },
  container: {
    flex: 1,
    backgroundColor: '#090909',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  topBarTitle: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 48,
  },
  heroCard: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: '#141414',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 24,
  },
  avatarContainer: {
    width: 104,
    height: 104,
    borderRadius: 52,
    overflow: 'hidden',
    backgroundColor: '#222222',
    marginBottom: 14,
    borderWidth: 2,
    borderColor: '#FF0000',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  verifiedLabel: {
    color: '#3EA6FF',
    fontSize: 12,
    fontWeight: '600',
  },
  artistTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  listenersSubtitle: {
    color: '#AAAAAA',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 18,
  },
  heroActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 24,
  },
  primaryActionText: {
    color: '#030303',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  secondaryActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  sectionBlock: {
    marginBottom: 26,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  topTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  topTrackIndex: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '700',
    width: 22,
  },
  topTrackThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#222222',
  },
  topTrackThumbFallback: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#222222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTrackMeta: {
    flex: 1,
    marginRight: 8,
  },
  topTrackTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  topTrackSub: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  queueTrackBtn: {
    padding: 8,
  },
  discographyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  discographyTabs: {
    flexDirection: 'row',
    gap: 6,
  },
  discTabBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  discTabBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  discTabText: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '700',
  },
  discTabTextActive: {
    color: '#030303',
  },
  discographyRow: {
    gap: 12,
    paddingVertical: 4,
  },
  releaseCard: {
    width: 132,
    backgroundColor: '#161616',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  releaseCover: {
    width: 112,
    height: 112,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#222222',
  },
  releaseCoverFallback: {
    width: 112,
    height: 112,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#222222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  releaseTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  releaseSub: {
    color: '#888888',
    fontSize: 11,
    marginTop: 2,
  },
  emptySectionText: {
    color: '#777777',
    fontSize: 13,
    fontStyle: 'italic',
  },
  bioCard: {
    backgroundColor: '#161616',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  bioText: {
    color: '#CCCCCC',
    fontSize: 14,
    lineHeight: 20,
  },
});

