import React, { useMemo, useState } from 'react';
import {
  FlatList,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {
  ChevronRight,
  Heart,
  ListMusic,
  Plus,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  FAVORITES_PLAYLIST_ID,
  PlaylistSummary,
} from '../services/database';
import { SearchPillInput } from './SearchBarSection';
import { PlaylistCover } from './PlaylistCover';
import { theme } from '../theme';
import { BACK_PRIORITY, useBackHandler } from '../services/backNavigation';

export const FAVORITES_SURFACE_COLORS = ['#2E0B12', '#17090D', '#101012'] as const;
export const FAVORITES_BADGE_COLORS = ['#D91B2C', '#7A0B1B'] as const;

export const FavoritesRubyBadge: React.FC<{
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}> = ({ iconSize = 26, style }) => (
  <LinearGradient
    colors={[...FAVORITES_BADGE_COLORS]}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={style}
  >
    <Heart color="#FFFFFF" fill="#FFFFFF" size={iconSize} />
  </LinearGradient>
);

export interface LibrarySectionProps {
  playlists: PlaylistSummary[];
  isLoading: boolean;
  isQuickCreateVisible: boolean;
  quickCreateName: string;
  onChangeQuickCreateName: (text: string) => void;
  onToggleQuickCreate: () => void;
  onSubmitQuickCreate: () => void;
  onSelectPlaylist: (playlistId: string) => void;
  onPrefetchPlaylist?: (playlistId: string) => void;
}

export const LibrarySection: React.FC<LibrarySectionProps> = ({
  playlists,
  isLoading,
  isQuickCreateVisible,
  quickCreateName,
  onChangeQuickCreateName,
  onToggleQuickCreate,
  onSubmitQuickCreate,
  onSelectPlaylist,
  onPrefetchPlaylist,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  useBackHandler(
    searchQuery.trim().length > 0,
    () => {
      setSearchQuery('');
      return true;
    },
    BACK_PRIORITY.SUBSCREEN_MODE
  );

  const filteredPlaylists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter(
      (pl) =>
        pl.name.toLowerCase().includes(q) ||
        (pl.description ? pl.description.toLowerCase().includes(q) : false)
    );
  }, [playlists, searchQuery]);

  const firstUserPlaylistId = useMemo(
    () => filteredPlaylists.find((pl) => pl.id !== FAVORITES_PLAYLIST_ID)?.id ?? null,
    [filteredPlaylists]
  );

  return (
    <View style={styles.container}>
      {/* Header com botão de Criar Playlist */}
      <View style={styles.playlistTabHeader}>
        <Text style={styles.sectionHeaderTitle}>Sua Biblioteca</Text>
        <TouchableOpacity
          style={styles.createPlaylistButton}
          onPress={onToggleQuickCreate}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Criar nova playlist"
        >
          <Plus color="#FFFFFF" size={15} />
          <Text style={styles.createPlaylistButtonText}>Nova</Text>
        </TouchableOpacity>
      </View>

      {/* Input de Criação Rápida Inline */}
      {isQuickCreateVisible && (
        <View style={styles.quickCreateBox}>
          <TextInput
            style={styles.quickCreateInput}
            placeholder="Nome da nova playlist..."
            placeholderTextColor="#757575"
            value={quickCreateName}
            onChangeText={onChangeQuickCreateName}
            autoFocus={true}
            onSubmitEditing={onSubmitQuickCreate}
            returnKeyType="done"
          />
          <View style={styles.quickCreateActions}>
            <TouchableOpacity
              style={styles.quickCreateCancelBtn}
              onPress={onToggleQuickCreate}
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
            >
              <Text style={styles.quickCreateCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.quickCreateConfirmBtn,
                !quickCreateName.trim() && styles.quickCreateConfirmBtnDisabled,
              ]}
              onPress={onSubmitQuickCreate}
              disabled={!quickCreateName.trim()}
              accessibilityRole="button"
              accessibilityLabel="Criar"
            >
              <Text style={styles.quickCreateConfirmText}>Criar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Barra de Pesquisa de Playlists */}
      {playlists.length > 0 && (
        <View style={styles.searchPillWrapper}>
          <SearchPillInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Buscar playlists..."
            accessibilityLabel="Buscar playlists"
            clearAccessibilityLabel="Limpar busca de playlists"
          />
        </View>
      )}

      {/* Lista de Playlists (sem skeleton; transição fade no App controla a troca de aba) */}
      {isLoading && playlists.length === 0 ? null : (
        <FlatList
          data={filteredPlaylists}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSystemFavorites = item.id === FAVORITES_PLAYLIST_ID;

            if (isSystemFavorites) {
              return (
                <TouchableOpacity
                  style={styles.favoritesHeroWrapper}
                  onPressIn={() => onPrefetchPlaylist?.(item.id)}
                  onPress={() => onSelectPlaylist(item.id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Abrir playlist Músicas Curtidas"
                >
                  <LinearGradient
                    colors={[...FAVORITES_SURFACE_COLORS]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.favoritesHeroCard}
                  >
                    <FavoritesRubyBadge
                      iconSize={26}
                      style={styles.favoritesHeroIconWrapper}
                    />
                    <View style={styles.favoritesHeroInfo}>
                      <Text style={styles.favoritesHeroTitle}>{item.name}</Text>
                      <Text style={styles.favoritesHeroMeta}>
                        {`${item.trackCount} ${item.trackCount === 1 ? 'música curtida' : 'músicas curtidas'}`}
                      </Text>
                    </View>
                    <ChevronRight color="#AAAAAA" size={18} />
                  </LinearGradient>
                </TouchableOpacity>
              );
            }

            const showSectionHeader = item.id === firstUserPlaylistId;

            return (
              <View>
                {showSectionHeader && (
                  <Text style={styles.userPlaylistsHeader}>SUAS PLAYLISTS</Text>
                )}
                <TouchableOpacity
                  style={styles.playlistRowCard}
                  onPressIn={() => onPrefetchPlaylist?.(item.id)}
                  onPress={() => onSelectPlaylist(item.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir playlist ${item.name}`}
                >
                  <PlaylistCover
                    thumbnailUrl={item.thumbnailUrl}
                    hasCustomCover={item.hasCustomCover}
                    coverThumbnails={item.coverThumbnails}
                    size={58}
                    borderRadius={10}
                    iconSize={24}
                    placeholderBackgroundColor={theme.colors.elevated}
                    style={styles.playlistRowThumbnail}
                  />
                  <View style={styles.playlistRowInfo}>
                    <Text style={styles.playlistRowName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.playlistRowMeta}>
                      {`Playlist • ${item.trackCount} ${item.trackCount === 1 ? 'música' : 'músicas'}`}
                    </Text>
                  </View>
                  <ChevronRight color="#717171" size={18} />
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <ListMusic color={theme.colors.textMuted} size={56} />
              <Text style={styles.emptyTitle}>
                {searchQuery.trim()
                  ? 'Nenhuma playlist encontrada'
                  : 'Nenhuma playlist criada'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery.trim()
                  ? `Não foram encontrados resultados para "${searchQuery}".`
                  : 'Toque em "Nova" acima para criar sua primeira playlist personalizada.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  playlistTabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sectionHeaderTitle: {
    fontSize: theme.typography.fontSize.sectionTitle,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textPrimary,
    letterSpacing: -0.2,
  },
  searchPillWrapper: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 12,
  },
  createPlaylistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: theme.radii.circular,
    gap: 6,
  },
  createPlaylistButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  quickCreateBox: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    padding: 12,
    backgroundColor: theme.colors.elevated,
    borderRadius: theme.radii.chip,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  quickCreateInput: {
    backgroundColor: theme.colors.card,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: theme.colors.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  quickCreateActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
  },
  quickCreateCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  quickCreateCancelText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  quickCreateConfirmBtn: {
    backgroundColor: theme.colors.chipActive,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  quickCreateConfirmBtnDisabled: {
    opacity: 0.5,
  },
  quickCreateConfirmText: {
    color: theme.colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 156,
    gap: 4,
  },
  favoritesHeroWrapper: {
    borderRadius: 14,
    marginBottom: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 5,
  },
  favoritesHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.28)',
  },
  favoritesHeroIconWrapper: {
    width: 58,
    height: 58,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  favoritesHeroInfo: {
    flex: 1,
  },
  favoritesHeroTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  favoritesHeroMeta: {
    color: '#B3B3B3',
    fontSize: 13,
    marginTop: 2,
  },
  userPlaylistsHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    color: '#717171',
    marginTop: 10,
    marginBottom: 4,
  },
  playlistRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 2,
    backgroundColor: 'transparent',
  },
  playlistRowThumbnail: {
    width: 58,
    height: 58,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: theme.colors.elevated,
    marginRight: 14,
  },
  playlistRowInfo: {
    flex: 1,
  },
  playlistRowName: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  playlistRowMeta: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default LibrarySection;
