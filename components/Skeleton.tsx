import React, { useEffect } from 'react';
import { Animated, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { theme } from '../theme';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

const PULSE_MIN_OPACITY = 0.52;
const PULSE_MAX_OPACITY = 0.96;

// Pulso compartilhado para que todos os placeholders da tela respirem em sincronia
const sharedPulseAnim = new Animated.Value(PULSE_MIN_OPACITY);
let activeSubscribers = 0;
let sharedLoop: Animated.CompositeAnimation | null = null;

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 16,
  borderRadius = 4,
  style,
}) => {
  useEffect(() => {
    activeSubscribers += 1;
    if (
      activeSubscribers === 1 &&
      typeof Animated.sequence === 'function' &&
      typeof Animated.loop === 'function'
    ) {
      sharedPulseAnim.setValue(PULSE_MIN_OPACITY);
      sharedLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(sharedPulseAnim, {
            toValue: PULSE_MAX_OPACITY,
            duration: 850,
            useNativeDriver: true,
          }),
          Animated.timing(sharedPulseAnim, {
            toValue: PULSE_MIN_OPACITY,
            duration: 850,
            useNativeDriver: true,
          }),
        ])
      );
      sharedLoop.start();
    }

    return () => {
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      if (activeSubscribers === 0) {
        sharedLoop?.stop();
        sharedLoop = null;
        sharedPulseAnim.setValue(PULSE_MIN_OPACITY);
      }
    };
  }, []);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as any,
          height: height as any,
          borderRadius,
          opacity: sharedPulseAnim,
        },
        style,
      ]}
      accessibilityRole="none"
      accessibilityLabel="Carregando..."
    />
  );
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: theme.colors.skeletonHighlight,
  },
});

export default Skeleton;
