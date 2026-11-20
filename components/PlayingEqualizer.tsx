import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { theme } from '../theme';

export interface PlayingEqualizerProps {
  isPlaying?: boolean;
  variant?: 'overlay' | 'inline';
}

const BAR_HEIGHT = 14;

interface BarConfig {
  pausedValue: number;
  steps: { toValue: number; duration: number }[];
}

const BAR_CONFIGS: BarConfig[] = [
  {
    pausedValue: 0.45,
    steps: [
      { toValue: 0.95, duration: 280 },
      { toValue: 0.35, duration: 240 },
      { toValue: 0.75, duration: 220 },
      { toValue: 0.45, duration: 260 },
    ],
  },
  {
    pausedValue: 0.85,
    steps: [
      { toValue: 0.4, duration: 250 },
      { toValue: 1.0, duration: 270 },
      { toValue: 0.5, duration: 230 },
      { toValue: 0.85, duration: 250 },
    ],
  },
  {
    pausedValue: 0.6,
    steps: [
      { toValue: 1.0, duration: 300 },
      { toValue: 0.32, duration: 260 },
      { toValue: 0.82, duration: 240 },
      { toValue: 0.6, duration: 280 },
    ],
  },
];

/**
 * Overlay de equalizador com 3 barras vermelhas sobre a capa da faixa ativa.
 * Usa scaleY + translateY com useNativeDriver: true para animar na UI thread sem layout thrashing.
 */
export const PlayingEqualizer: React.FC<PlayingEqualizerProps> = ({
  isPlaying = false,
  variant = 'overlay',
}) => {
  const isInline = variant === 'inline';
  const barValues = useRef(BAR_CONFIGS.map((cfg) => new Animated.Value(cfg.pausedValue))).current;

  useEffect(() => {
    if (!isPlaying) {
      barValues.forEach((val, idx) => {
        val.setValue(BAR_CONFIGS[idx].pausedValue);
      });
      return;
    }

    const loops = barValues.map((val, idx) => {
      const sequence = BAR_CONFIGS[idx].steps.map((step) =>
        Animated.timing(val, {
          toValue: step.toValue,
          duration: step.duration,
          useNativeDriver: true,
        })
      );
      return Animated.loop(Animated.sequence(sequence));
    });

    loops.forEach((loop) => loop.start());
    return () => {
      loops.forEach((loop) => loop.stop());
    };
  }, [isPlaying, barValues]);

  return (
    <View
      style={isInline ? styles.inlineContainer : styles.overlay}
      testID="playing-equalizer"
      accessibilityLabel={isPlaying ? 'Tocando agora' : 'Reprodução pausada'}
    >
      <View style={styles.barsContainer}>
        {barValues.map((val, idx) => {
          const translateY = val.interpolate({
            inputRange: [0.3, 1],
            outputRange: [BAR_HEIGHT * 0.35, 0],
          });
          return (
            <Animated.View
              key={idx}
              style={[
                styles.bar,
                { transform: [{ translateY }, { scaleY: val }] },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineContainer: {
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: BAR_HEIGHT,
  },
  bar: {
    width: 2,
    height: BAR_HEIGHT,
    backgroundColor: theme.colors.brandPrimary,
    borderRadius: 1,
  },
});

export default PlayingEqualizer;

