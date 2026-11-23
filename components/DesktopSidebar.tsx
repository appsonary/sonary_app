import React, { useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Compass,
  FolderDown,
  Heart,
  ListMusic,
  Menu,
  Music2,
  Plus,
} from 'lucide-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FAVORITES_PLAYLIST_ID, PlaylistSummary } from '../services/database';
import { theme } from '../theme';
import type { MainTab } from './NavigationTabBar';

const SIDEBAR_BRAND_LOGO = require('../assets/brand-logo-header.png');

export interface DesktopSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
  playlists: PlaylistSummary[];
  onSelectPlaylist?: (playlistId: string) => void;
  onPrefetchPlaylist?: (playlistId: string) => void;
  onQuickCreatePlaylist?: () => void;
}

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  activeTab,
  onTabChange,
  playlists,
  onSelectPlaylist,
  onPrefetchPlaylist,
  onQuickCreatePlaylist,
}) => {
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);
  const [hoveredPlaylistId, setHoveredPlaylistId] = useState<string | null>(null);

  return (
    <View
      style={[
        styles.sidebarContainer,
        isCollapsed ? styles.sidebarCollapsed : styles.sidebarExpanded,
      ]}
    >
      {/* Topo da Sidebar: Menu Hamburger & Brand Logo */}
      <View style={[styles.sidebarHeader, isCollapsed && styles.sidebarHeaderCollapsed]}>
        <TouchableOpacity
          style={styles.menuToggleBtn}
          onPress={onToggleCollapse}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={isCollapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
        >
          <Menu color="#FFFFFF" size={22} />
        </TouchableOpacity>

        {!isCollapsed && (
          <View style={styles.brandContainer}>
            <Image
              source={SIDEBAR_BRAND_LOGO}
              style={styles.brandLogoImage}
              resizeMode="contain"
              accessibilityRole="image"
              accessibilityLabel="Sonary"
            />
          </View>
        )}
      </View>

      {/* Navegação Primária */}
      <View style={styles.navSection}>
        {/* Início & Busca */}
        <TouchableOpacity
          style={[
            styles.navItem,
            isCollapsed && styles.navItemCollapsed,
            activeTab === 'search' && styles.navItemActive,
            hoveredNav === 'search' && activeTab !== 'search' && styles.navItemHover,
          ]}
          onPress={() => onTabChange('search')}
          {...({
            onMouseEnter: () => setHoveredNav('search'),
            onMouseLeave: () => setHoveredNav(null),
          } as any)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Início e Busca"
        >
          <Compass
            color={activeTab === 'search' ? '#FFFFFF' : '#AAAAAA'}
            size={22}
          />
          {!isCollapsed ? (
            <Text
              style={[
                styles.navItemText,
                activeTab === 'search' && styles.navItemTextActive,
              ]}
            >
              Início & Busca
            </Text>
          ) : (
            <Text style={styles.collapsedItemLabel}>Início</Text>
          )}
        </TouchableOpacity>

        {/* Biblioteca */}
        <TouchableOpacity
          style={[
            styles.navItem,
            isCollapsed && styles.navItemCollapsed,
            activeTab === 'playlists' && styles.navItemActive,
            hoveredNav === 'playlists' && activeTab !== 'playlists' && styles.navItemHover,
          ]}
          onPress={() => onTabChange('playlists')}
          {...({
            onMouseEnter: () => setHoveredNav('playlists'),
            onMouseLeave: () => setHoveredNav(null),
          } as any)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Biblioteca de Playlists"
        >
          <ListMusic
            color={activeTab === 'playlists' ? '#FFFFFF' : '#AAAAAA'}
            size={22}
          />
          {!isCollapsed ? (
            <Text
              style={[
                styles.navItemText,
                activeTab === 'playlists' && styles.navItemTextActive,
              ]}
            >
              Biblioteca
            </Text>
          ) : (
            <Text style={styles.collapsedItemLabel}>Biblioteca</Text>
          )}
        </TouchableOpacity>

        {/* Músicas Salvas / Baixadas */}
        <TouchableOpacity
          style={[
            styles.navItem,
            isCollapsed && styles.navItemCollapsed,
            activeTab === 'downloads' && styles.navItemActive,
            hoveredNav === 'downloads' && activeTab !== 'downloads' && styles.navItemHover,
          ]}
          onPress={() => onTabChange('downloads')}
          {...({
            onMouseEnter: () => setHoveredNav('downloads'),
            onMouseLeave: () => setHoveredNav(null),
          } as any)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Músicas Baixadas"
        >
          <FolderDown
            color={activeTab === 'downloads' ? '#FFFFFF' : '#AAAAAA'}
            size={22}
          />
          {!isCollapsed ? (
            <Text
              style={[
                styles.navItemText,
                activeTab === 'downloads' && styles.navItemTextActive,
              ]}
            >
              Músicas Salvas
            </Text>
          ) : (
            <Text style={styles.collapsedItemLabel}>Salvas</Text>
          )}
        </TouchableOpacity>

        {/* Apoiar o Sonary */}
        <TouchableOpacity
          style={[
            styles.navItem,
            isCollapsed && styles.navItemCollapsed,
            activeTab === 'support' && styles.navItemActive,
            hoveredNav === 'support' && activeTab !== 'support' && styles.navItemHover,
          ]}
          onPress={() => onTabChange('support')}
          {...({
            onMouseEnter: () => setHoveredNav('support'),
            onMouseLeave: () => setHoveredNav(null),
          } as any)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Apoiar"
        >
          <MaterialCommunityIcons
            name={activeTab === 'support' ? 'hand-heart' : 'hand-heart-outline'}
            color={activeTab === 'support' ? '#FFFFFF' : '#AAAAAA'}
            size={22}
          />
          {!isCollapsed ? (
            <Text
              style={[
                styles.navItemText,
                activeTab === 'support' && styles.navItemTextActive,
              ]}
            >
              Apoiar
            </Text>
          ) : (
            <Text style={styles.collapsedItemLabel}>Apoiar</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Divisória Sutil */}
      <View style={styles.divider} />

      {/* Seção de Playlists Fixadas (Visível quando expandida) */}
      {!isCollapsed ? (
        <View style={styles.pinnedSection}>
          <View style={styles.pinnedHeader}>
            <TouchableOpacity
              onPress={() => onTabChange('playlists')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Playlists"
            >
              <Text style={styles.pinnedTitle}>Playlists</Text>
            </TouchableOpacity>
            {onQuickCreatePlaylist && (
              <TouchableOpacity
                style={styles.addPlaylistIconBtn}
                onPress={onQuickCreatePlaylist}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Criar nova playlist rápida"
              >
                <Plus color="#AAAAAA" size={18} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            style={styles.playlistsScroll}
            showsVerticalScrollIndicator={false}
          >
            {playlists.map((pl) => {
              const isFav = pl.id === FAVORITES_PLAYLIST_ID;
              const isHovered = hoveredPlaylistId === pl.id;

              return (
                <TouchableOpacity
                  key={pl.id}
                  style={[
                    styles.playlistRow,
                    isHovered && styles.playlistRowHover,
                  ]}
                  onPressIn={() => onPrefetchPlaylist?.(pl.id)}
                  onPress={() => onSelectPlaylist && onSelectPlaylist(pl.id)}
                  {...({
                    onMouseEnter: () => setHoveredPlaylistId(pl.id),
                    onMouseLeave: () => setHoveredPlaylistId(null),
                  } as any)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir playlist ${pl.name}`}
                >
                  {isFav ? (
                    <View style={styles.favIconBadge}>
                      <Heart color="#FFFFFF" fill="#FFFFFF" size={12} />
                    </View>
                  ) : (
                    <Music2 color="#AAAAAA" size={16} />
                  )}
                  <Text style={styles.playlistRowText} numberOfLines={1}>
                    {pl.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        /* Atalhos rápidos quando colapsado */
        onQuickCreatePlaylist && (
          <TouchableOpacity
            style={styles.collapsedNewBtn}
            onPress={onQuickCreatePlaylist}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Criar nova playlist rápida"
          >
            <Plus color="#FFFFFF" size={20} />
          </TouchableOpacity>
        )
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sidebarContainer: {
    backgroundColor: theme.colors.background,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    height: '100%',
    paddingVertical: 12,
    zIndex: 20,
  },
  sidebarExpanded: {
    width: theme.dimensions.sidebarExpandedWidth, // 240px
    paddingHorizontal: 16,
  },
  sidebarCollapsed: {
    width: theme.dimensions.sidebarCollapsedWidth, // 72px
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  sidebarHeaderCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    gap: 0,
  },
  menuToggleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandContainer: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogoImage: {
    height: 34,
    width: 99,
    aspectRatio: 1222 / 420,
    maxWidth: '100%',
  },
  navSection: {
    gap: 6,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.radii.chip,
  },
  navItemCollapsed: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 4,
    width: 60,
  },
  navItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  navItemHover: {
    backgroundColor: theme.colors.chipHover,
  },
  navItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  navItemTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
  },
  collapsedItemLabel: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    fontWeight: '500',
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.borderSubtle,
    marginVertical: 16,
    width: '100%',
  },
  pinnedSection: {
    flex: 1,
  },
  pinnedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  pinnedTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addPlaylistIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistsScroll: {
    flex: 1,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: theme.radii.track + 2,
  },
  playlistRowHover: {
    backgroundColor: theme.colors.chipHover,
  },
  favIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: theme.colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistRowText: {
    fontSize: 13,
    color: theme.colors.textPrimary,
    flex: 1,
  },
  collapsedNewBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
  },
});

export default DesktopSidebar;

