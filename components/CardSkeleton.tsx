import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Skeleton } from './Skeleton';
import { theme } from '../theme';

export interface CardSkeletonProps {
  count?: number;
  shape?: 'square' | 'circle';
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({
  count = 4,
  shape = 'square',
}) => {
  const items = Array.from({ length: count }, (_, i) => i);
  const isCircle = shape === 'circle';

  return (
    <View style={styles.container}>
      {/* Header Skeleton */}
      <View style={styles.header}>
        <Skeleton width={120} height={18} borderRadius={4} style={styles.headerTitle} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((key) => (
          <View key={`skeleton-card-${key}`} style={styles.card}>
            <Skeleton
              width={156}
              height={156}
              borderRadius={isCircle ? theme.radii.circular : theme.radii.card}
              style={styles.cover}
            />
            <Skeleton
              width={isCircle ? 100 : 130}
              height={14}
              borderRadius={3}
              style={[styles.title, isCircle && { alignSelf: 'center' }]}
            />
            <Skeleton
              width={isCircle ? 70 : 90}
              height={11}
              borderRadius={3}
              style={[styles.subtitle, isCircle && { alignSelf: 'center' }]}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 18,
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  headerTitle: {
    marginBottom: 4,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 16,
  },
  card: {
    width: 156,
  },
  cover: {
    marginBottom: 8,
  },
  title: {
    marginBottom: 4,
  },
  subtitle: {
    marginTop: 2,
  },
});

export default CardSkeleton;

