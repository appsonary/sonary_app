import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { theme } from '../theme';

export interface AtmosphericGradientProps {
  height?: number;
  glowColor?: string;
  style?: any;
}

export const AtmosphericGradient: React.FC<AtmosphericGradientProps> = ({
  height = 300,
  glowColor,
  style,
}) => {
  const primaryStop = glowColor || '#6E000D';
  const midStop = glowColor || '#4A0009';

  return (
    <View style={[styles.container, { height }, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {/* Brilho Radial atmosférico no topo: curva exponencial suave para zerar sem arco visível */}
          <RadialGradient
            id="radialGlow"
            cx="42%"
            cy="4%"
            rx="80%"
            ry="80%"
            fx="42%"
            fy="4%"
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0%" stopColor={primaryStop} stopOpacity="0.48" />
            <Stop offset="32%" stopColor={midStop} stopOpacity="0.3" />
            <Stop offset="58%" stopColor="#260006" stopOpacity="0.14" />
            <Stop offset="80%" stopColor="#260006" stopOpacity="0.04" />
            <Stop offset="100%" stopColor="#260006" stopOpacity="0" />
          </RadialGradient>

          {/* Suavização vertical contínua até o fundo #030303 sem degrau */}
          <LinearGradient id="verticalFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={primaryStop} stopOpacity="0.22" />
            <Stop offset="36%" stopColor="#260006" stopOpacity="0.11" />
            <Stop offset="68%" stopColor="#260006" stopOpacity="0.03" />
            <Stop offset="100%" stopColor="#260006" stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="100%" height="100%" fill="url(#verticalFade)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#radialGlow)" />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 0,
  },
});

export default AtmosphericGradient;
