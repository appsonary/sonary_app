import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { User } from 'lucide-react-native';
import type { ArtistSearchResult } from '../services/api';
import { theme } from '../theme';

export interface ArtistResultsSectionProps {
  artists: ArtistSearchResult[];
  onSelectArtist: (artist: ArtistSearchResult) => void;
}

export const ArtistResultsSection: React.FC<ArtistResultsSectionProps> = ({
  artists,
  onSelectArtist,
}) => {
  if (!artists || artists.length === 0) return null;

  return (
    <View style={styles.container} testID="artist-results-section">
      <View style={styles.header}>
        <Text style={styles.title}>Artistas</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {artists.map((artist) => (
          <TouchableOpacity
            key={artist.id}
            style={styles.artistItem}
            onPress={() => onSelectArtist(artist)}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={`Abrir perfil do artista ${artist.name}`}
          >
            <View style={styles.avatarRing}>
              {artist.thumbnailUrl ? (
                <Image
                  source={{ uri: artist.thumbnailUrl }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <User color={theme.colors.textSecondary} size={28} />
                </View>
              )}
            </View>
            <Text style={styles.artistName} numberOfLines={1} ellipsizeMode="tail">
              {artist.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.divider} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: theme.typography.fontWeight.extraBold,
    color: theme.colors.textPrimary,
    letterSpacing: -0.2,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },
  artistItem: {
    width: 82,
    alignItems: 'center',
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    borderColor: 'rgba(220, 38, 38, 0.55)',
    backgroundColor: '#161618',
    padding: 2,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    backgroundColor: theme.colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistName: {
    marginTop: 8,
    width: '100%',
    textAlign: 'center',
    fontSize: 12.5,
    fontWeight: theme.typography.fontWeight.medium,
    color: '#D4D4D8',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.borderSubtle,
    marginHorizontal: 16,
    marginTop: 14,
  },
});

export default ArtistResultsSection;
