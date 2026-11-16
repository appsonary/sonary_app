import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from './Skeleton';
import { theme } from '../theme';

export interface TrackRowSkeletonProps {
  count?: number;
  thumbnailSize?: number;
  thumbnailRadius?: number;
  horizontalPadding?: number;
  showDuration?: boolean;
  fadeBottom?: boolean;
}

const TITLE_WIDTHS = ['74%', '58%', '82%', '64%', '69%', '52%'];
const ARTIST_WIDTHS = ['46%', '36%', '52%', '41%', '44%', '34%'];

export const TrackRowSkeleton: React.FC<TrackRowSkeletonProps> = ({
  count = 6,
  thumbnailSize = 48,
  thumbnailRadius = theme.radii.track,
  horizontalPadding = 16,
  showDuration = true,
  fadeBottom = false,
}) => {
  const items = Array.from({ length: count }, (_, i) => i);

  return (
    <View style={styles.container}>
      {items.map((key) => {
        // Suaviza apenas as 2 últimas linhas quando preenchendo a tela inteira
        let rowOpacity = 1;
        if (fadeBottom && count >= 4) {
          if (key === count - 1) rowOpacity = 0.32;
          else if (key === count - 2) rowOpacity = 0.64;
        }

        return (
          <View
            key={`skeleton-row-${key}`}
            style={[styles.row, { paddingHorizontal: horizontalPadding, opacity: rowOpacity }]}
          >
            <Skeleton
              width={thumbnailSize}
              height={thumbnailSize}
              borderRadius={thumbnailRadius}
              style={styles.thumbnail}
            />

            <View style={styles.meta}>
              <Skeleton
                width={TITLE_WIDTHS[key % TITLE_WIDTHS.length]}
                height={14}
                borderRadius={4}
              />
              <Skeleton
                width={ARTIST_WIDTHS[key % ARTIST_WIDTHS.length]}
                height={11}
                borderRadius={3}
              />
            </View>

            {showDuration && (
              <Skeleton width={34} height={11} borderRadius={3} style={styles.duration} />
            )}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 4,
  },
  thumbnail: {
    marginRight: 12,
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
    gap: 7,
  },
  duration: {
    marginLeft: 12,
  },
});

export default TrackRowSkeleton;
