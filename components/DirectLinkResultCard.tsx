import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CheckCircle2,
  Clock,
  Download,
  Link2,
  ListPlus,
  ListStart,
  Music2,
  Pause,
  Play,
} from 'lucide-react-native';
import type { TrackSummary } from '../services/api';
import { theme } from '../theme';
import { DownloadedTrackBadge } from './MarqueeText';
import { CircularDownloadProgress } from './TrackCard';

export interface DirectLinkResultCardProps {
  track: TrackSummary;
  isActive: boolean;
  isPlaying: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  isQueued: boolean;
  downloadProgress: number;
  onPlay: () => void;
  onTogglePlay: () => void;
  onPlayNext: () => void;
  onAddToPlaylist: () => void;
  onDownload: () => void;
}

export const DirectLinkResultCard: React.FC<DirectLinkResultCardProps> = ({
  track,
  isActive,
  isPlaying,
  isDownloaded,
  isDownloading,
  isQueued,
  downloadProgress,
  onPlay,
  onTogglePlay,
  onPlayNext,
  onAddToPlaylist,
  onDownload,
}) => {
  const handlePrimaryAction = isActive ? onTogglePlay : onPlay;
  const primaryA11yLabel = isActive
    ? isPlaying
      ? `Pausar ${track.title}`
      : `Continuar ${track.title}`
    : `Tocar ${track.title} de ${track.artist}`;

  const subtitle = track.formattedDuration
    ? `${track.artist} • ${track.formattedDuration}`
    : track.artist;

  const downloadLabel = isDownloading
    ? 'Baixando...'
    : isQueued
      ? 'Na fila'
      : isDownloaded
        ? 'Baixada'
        : 'Baixar';

  return (
    <View style={styles.section} testID="direct-link-result-section">
      <View style={styles.header}>
        <View style={styles.eyebrowRow}>
          <Text style={styles.eyebrow}>ENCONTRADO PELO LINK</Text>
          <Link2 color={theme.colors.textSecondary} size={12} strokeWidth={2.2} />
        </View>
        <Text style={styles.sectionTitle}>Resultado Preciso</Text>
      </View>

      <View style={styles.cardShell}>
        <TouchableOpacity
          style={styles.heroBanner}
          onPress={handlePrimaryAction}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={primaryA11yLabel}
        >
          {track.thumbnailUrl ? (
            <Image
              source={{ uri: track.thumbnailUrl }}
              style={styles.heroArtwork}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.heroArtworkFallback}>
              <Music2 color={theme.colors.textMuted} size={44} />
            </View>
          )}

          <LinearGradient
            colors={[
              'rgba(0, 0, 0, 0.04)',
              'rgba(4, 4, 6, 0.56)',
              'rgba(6, 6, 8, 0.94)',
              '#08080A',
            ]}
            locations={[0, 0.42, 0.78, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.heroScrim}
          />

          <View style={styles.heroContentRow}>
            <View style={styles.metaColumn}>
              <Text style={styles.trackTitle} numberOfLines={2}>
                {track.title}
              </Text>
              <View style={styles.subtitleRow}>
                {isDownloaded ? <DownloadedTrackBadge /> : null}
                <Text style={styles.trackSubtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.playCircleButton}
              onPress={handlePrimaryAction}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={primaryA11yLabel}
              testID="direct-link-play-button"
            >
              {isActive && isPlaying ? (
                <Pause color="#030303" fill="#030303" size={22} />
              ) : (
                <Play
                  color="#030303"
                  fill="#030303"
                  size={22}
                  style={styles.playIconOpticalShift}
                />
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        <View style={styles.actionsBar}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonPlayNext]}
            onPress={onPlayNext}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Tocar ${track.title} a seguir`}
          >
            <ListStart color="#D4D4D8" size={15} strokeWidth={1.9} />
            <Text style={styles.actionText} numberOfLines={1}>
              Tocar a seguir
            </Text>
          </TouchableOpacity>

          <View style={styles.actionVerticalDivider} />

          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonPlaylist]}
            onPress={onAddToPlaylist}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Salvar ${track.title} na playlist`}
          >
            <ListPlus color="#D4D4D8" size={16} strokeWidth={1.9} />
            <Text style={styles.actionText} numberOfLines={1}>
              Salvar na playlist
            </Text>
          </TouchableOpacity>

          <View style={styles.actionVerticalDivider} />

          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonDownload]}
            onPress={onDownload}
            disabled={isDownloading || isQueued}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={
              isDownloaded
                ? `${track.title} já salva offline`
                : `Baixar ${track.title}`
            }
          >
            {isDownloading ? (
              <CircularDownloadProgress progress={downloadProgress} size={16} strokeWidth={2} />
            ) : isQueued ? (
              <Clock color={theme.colors.textSecondary} size={15} strokeWidth={1.9} />
            ) : isDownloaded ? (
              <CheckCircle2 color={theme.colors.success} size={15} strokeWidth={2.2} />
            ) : (
              <Download color="#D4D4D8" size={15} strokeWidth={1.9} />
            )}
            <Text
              style={[
                styles.actionText,
                isDownloaded && styles.actionTextDownloaded,
              ]}
              numberOfLines={1}
            >
              {downloadLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 12,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  eyebrow: {
    fontSize: theme.typography.fontSize.badge,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: theme.typography.fontSize.sectionTitle,
    fontWeight: theme.typography.fontWeight.extraBold,
    color: theme.colors.textPrimary,
    letterSpacing: -0.2,
  },
  cardShell: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#08080A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroBanner: {
    width: '100%',
    height: 192,
    justifyContent: 'flex-end',
    position: 'relative',
    backgroundColor: '#0A0A0C',
  },
  heroArtwork: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroArtworkFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContentRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 12,
  },
  metaColumn: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: 19,
    fontWeight: theme.typography.fontWeight.bold,
    color: '#FFFFFF',
    lineHeight: 24,
    letterSpacing: -0.25,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  trackSubtitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: theme.typography.fontWeight.regular,
    color: '#B8B8BE',
  },
  playCircleButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  playIconOpticalShift: {
    marginLeft: 2,
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    backgroundColor: '#08080A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionButton: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 6,
  },
  actionButtonPlayNext: {
    flex: 1.05,
  },
  actionButtonPlaylist: {
    flex: 1.25,
  },
  actionButtonDownload: {
    flex: 0.78,
  },
  actionVerticalDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionText: {
    fontSize: 12,
    fontWeight: theme.typography.fontWeight.medium,
    color: '#D4D4D8',
  },
  actionTextDownloaded: {
    color: theme.colors.success,
  },
});
