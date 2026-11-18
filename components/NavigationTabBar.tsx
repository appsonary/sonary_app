import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Search, ListMusic, FolderDown } from 'lucide-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type MainTab = 'search' | 'playlists' | 'downloads' | 'support';

export interface NavigationTabBarProps {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
  playlistCount: number;
  downloadCount: number;
}

const GRADIENT_STOPS = [
  { offset: '0%', opacity: '0' },
  { offset: '12.5%', opacity: '0.2747' },
  { offset: '25%', opacity: '0.4987' },
  { offset: '37.5%', opacity: '0.6764' },
  { offset: '50%', opacity: '0.8105' },
  { offset: '62.5%', opacity: '0.9049' },
  { offset: '75%', opacity: '0.9640' },
  { offset: '87.5%', opacity: '1' },
  { offset: '100%', opacity: '1' },
];

export const NavigationTabBar: React.FC<NavigationTabBarProps> = ({
  activeTab,
  onTabChange,
  playlistCount,
  downloadCount,
}) => {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {/* Shader SVG contínuo estilo Spotify sem frestas subpixel em telas de alta densidade */}
      <View
        pointerEvents="none"
        collapsable={false}
        style={styles.gradientContainer}
        testID="spotify-nav-fade"
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 1 94"
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id="spotifyNavFade" x1="0" y1="0" x2="0" y2="1">
              {GRADIENT_STOPS.map((stop) => (
                <Stop
                  key={stop.offset}
                  offset={stop.offset}
                  stopColor="#000000"
                  stopOpacity={stop.opacity}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="1" height="96" fill="url(#spotifyNavFade)" />
        </Svg>
      </View>

      {/* Aba Buscar */}
      <TouchableOpacity
        style={styles.tabItem}
        onPress={() => onTabChange('search')}
        accessibilityRole="tab"
        accessibilityLabel="Buscar"
        accessibilityState={{ selected: activeTab === 'search' }}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
      >
        <View style={styles.iconWrapper}>
          <Search
            color={activeTab === 'search' ? '#FFFFFF' : '#B3B3B3'}
            size={22}
            strokeWidth={activeTab === 'search' ? 2.5 : 1.8}
          />
        </View>
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'search' && styles.tabLabelActive,
          ]}
        >
          Buscar
        </Text>
      </TouchableOpacity>

      {/* Aba Playlists */}
      <TouchableOpacity
        style={styles.tabItem}
        onPress={() => onTabChange('playlists')}
        accessibilityRole="tab"
        accessibilityLabel={`Playlists (${playlistCount})`}
        accessibilityState={{ selected: activeTab === 'playlists' }}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
      >
        <View style={styles.iconWrapper}>
          <ListMusic
            color={activeTab === 'playlists' ? '#FFFFFF' : '#B3B3B3'}
            size={22}
            strokeWidth={activeTab === 'playlists' ? 2.5 : 1.8}
          />
          {playlistCount > 0 && (
            <View
              style={[
                styles.badge,
                activeTab === 'playlists' && styles.badgeActive,
              ]}
            >
              <Text style={styles.badgeText}>
                {playlistCount > 99 ? '99+' : playlistCount}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'playlists' && styles.tabLabelActive,
          ]}
        >
          Playlists
        </Text>
      </TouchableOpacity>

      {/* Aba Baixadas */}
      <TouchableOpacity
        style={styles.tabItem}
        onPress={() => onTabChange('downloads')}
        accessibilityRole="tab"
        accessibilityLabel={`Baixadas (${downloadCount})`}
        accessibilityState={{ selected: activeTab === 'downloads' }}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
      >
        <View style={styles.iconWrapper}>
          <FolderDown
            color={activeTab === 'downloads' ? '#FFFFFF' : '#B3B3B3'}
            size={22}
            strokeWidth={activeTab === 'downloads' ? 2.5 : 1.8}
          />
          {downloadCount > 0 && (
            <View
              style={[
                styles.badge,
                activeTab === 'downloads' && styles.badgeActive,
              ]}
            >
              <Text style={styles.badgeText}>
                {downloadCount > 99 ? '99+' : downloadCount}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'downloads' && styles.tabLabelActive,
          ]}
        >
          Baixadas
        </Text>
      </TouchableOpacity>

      {/* Aba Apoiar */}
      <TouchableOpacity
        style={styles.tabItem}
        onPress={() => onTabChange('support')}
        accessibilityRole="tab"
        accessibilityLabel="Apoiar"
        accessibilityState={{ selected: activeTab === 'support' }}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
      >
        <View style={styles.iconWrapper}>
          <MaterialCommunityIcons
            name={activeTab === 'support' ? 'hand-heart' : 'hand-heart-outline'}
            color={activeTab === 'support' ? '#FFFFFF' : '#B3B3B3'}
            size={22}
          />
        </View>
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'support' && styles.tabLabelActive,
          ]}
        >
          Apoiar
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    height: 94,
    marginTop: -28,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-around',
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  gradientContainer: {
    ...StyleSheet.absoluteFillObject,
    bottom: -4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 32,
    paddingBottom: 6,
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 24,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '400',
    color: '#B3B3B3',
    marginTop: 3,
    letterSpacing: 0.1,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  tabLabelActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: {
    backgroundColor: '#FF0000',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default NavigationTabBar;
