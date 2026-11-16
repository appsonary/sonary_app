import React, { useState } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ListPlus,
  Music2,
  Play,
} from 'lucide-react-native';
import { theme } from '../theme';
import { MarqueeText } from './MarqueeText';
import { PlayingEqualizer } from './PlayingEqualizer';

export interface QuickPickItem {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  formattedDuration?: string;
  thumbnailUrl: string;
  trackNumber?: number;
}

export interface QuickPicksSectionProps {
  tracks: QuickPickItem[];
  activeTrackId?: string;
  isPlaying?: boolean;
  onSelectTrack: (track: QuickPickItem, index: number) => void;
  onAddToPlaylist?: (track: QuickPickItem) => void;
}

interface QuickPickRowProps {
  track: QuickPickItem;
  isActive: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onAdd?: () => void;
}

const QuickPickRow: React.FC<QuickPickRowProps> = ({
  track,
  isActive,
  isPlaying,
  onSelect,
  onAdd,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const isWeb = Platform.OS === 'web';
  const showAction = !isWeb || isHovered || isActive;

  return (
    <TouchableOpacity
      style={[
        styles.trackRow,
        isActive && styles.trackRowActive,
        isHovered && !isActive && styles.trackRowHover,
      ]}
      onPress={onSelect}
      {...({
        onMouseEnter: () => setIsHovered(true),
        onMouseLeave: () => setIsHovered(false),
      } as any)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Tocar ${track.title} de ${track.artist}`}
    >
      <View style={styles.thumbnailContainer}>
        {track.thumbnailUrl ? (
          <Image
            source={{ uri: track.thumbnailUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Music2 color={theme.colors.textMuted} size={20} />
          </View>
        )}

        {/* Indicador de reprodução ativa (Equalizador de 3 barras vermelhas) */}
        {isActive ? (
          <PlayingEqualizer isPlaying={isPlaying} />
        ) : isHovered ? (
          <View style={styles.hoverOverlay}>
            <Play color="#FFFFFF" fill="#FFFFFF" size={16} />
          </View>
        ) : null}
      </View>

      <View style={styles.trackMeta}>
        <MarqueeText
          active={Boolean(isActive)}
          style={[styles.trackTitle, isActive && styles.trackTitleActive]}
        >
          {track.title}
        </MarqueeText>
        <MarqueeText active={Boolean(isActive)} style={styles.trackArtist}>
          {`${track.artist}${track.formattedDuration ? ` • ${track.formattedDuration}` : ''}`}
        </MarqueeText>
      </View>

      {/* Ação rápida com revelação progressiva sem layout shift */}
      <View style={[styles.actionContainer, { opacity: showAction ? 1 : 0 }]}>
        {onAdd && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              onAdd();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Adicionar ${track.title} à playlist`}
          >
            <ListPlus color={theme.colors.textSecondary} size={18} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

export const QuickPicksSection: React.FC<QuickPicksSectionProps> = ({
  tracks,
  activeTrackId,
  isPlaying = false,
  onSelectTrack,
  onAddToPlaylist,
}) => {
  if (!tracks || tracks.length === 0) return null;

  // Organiza em colunas de até 4 itens por coluna (padrão 4-row horizontal do YouTube Music)
  const columns: QuickPickItem[][] = [];
  for (let i = 0; i < tracks.length; i += 4) {
    columns.push(tracks.slice(i, i + 4));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>INICIAR RÁDIO COM UMA MÚSICA</Text>
          <Text style={styles.title}>Escolhas Rápidas</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {columns.map((column, colIdx) => (
          <View key={`col-${colIdx}`} style={styles.column}>
            {column.map((track, rowIdx) => {
              const globalIdx = colIdx * 4 + rowIdx;
              const isActive = activeTrackId === track.id;

              return (
                <QuickPickRow
                  key={track.id}
                  track={track}
                  isActive={isActive}
                  isPlaying={isPlaying}
                  onSelect={() => onSelectTrack(track, globalIdx)}
                  onAdd={onAddToPlaylist ? () => onAddToPlaylist(track) : undefined}
                />
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 14,
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  eyebrow: {
    fontSize: theme.typography.fontSize.badge,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: {
    fontSize: theme.typography.fontSize.sectionTitle,
    fontWeight: theme.typography.fontWeight.extraBold,
    color: theme.colors.textPrimary,
    letterSpacing: -0.2,
  },
  scrollContent: {
    paddingHorizontal: 8,
    gap: 16,
  },
  column: {
    width: 312,
    gap: 6,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'transparent',
    gap: 12,
    minHeight: 56,
  },
  trackRowHover: {
    backgroundColor: theme.colors.chipHover,
  },
  trackRowActive: {
    backgroundColor: '#141414',
  },
  thumbnailContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.track,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: theme.colors.card,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.track,
  },
  thumbnailFallback: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.track,
    backgroundColor: theme.colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hoverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackMeta: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: theme.typography.fontSize.trackTitle,
    fontWeight: theme.typography.fontWeight.semiBold,
    color: theme.colors.textPrimary,
  },
  trackTitleActive: {
    color: theme.colors.brandPrimary,
  },
  trackArtist: {
    fontSize: theme.typography.fontSize.caption,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  actionContainer: {
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    padding: 6,
  },
});

export default QuickPicksSection;
