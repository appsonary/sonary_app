import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  Blur,
  Canvas,
  Fill,
  FractalNoise,
  Group,
  Image,
  LinearGradient,
  Rect,
  SkImage,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';

interface AmbientGlowBackgroundProps {
  artworkUri?: string | null;
  crossfadeDurationMs?: number;
}

const GLOW_OPACITY = 0.76;
const GLOW_BLUR_RADIUS = 85;
const CROSSFADE_DURATION_MS = 450;

// Curva S suave de 7 stops estendida verticalmente até ~86% da tela para envolver capa, título e controles
const VIGNETTE_COLORS = [
  'rgba(0, 0, 0, 0.22)',
  'rgba(0, 0, 0, 0.04)',
  'rgba(0, 0, 0, 0.04)',
  'rgba(0, 0, 0, 0.18)',
  'rgba(0, 0, 0, 0.46)',
  'rgba(0, 0, 0, 0.78)',
  '#000000',
];
const VIGNETTE_POSITIONS = [0, 0.16, 0.34, 0.52, 0.66, 0.77, 0.86];

export function AmbientGlowBackground({
  artworkUri,
  crossfadeDurationMs = CROSSFADE_DURATION_MS,
}: AmbientGlowBackgroundProps) {
  const windowSize = useWindowDimensions();
  const [canvasSize, setCanvasSize] = useState({
    width: Math.max(1, windowSize.width || 390),
    height: Math.max(1, windowSize.height || 844),
  });

  const loadedImage = useImage(artworkUri || null);
  const [images, setImages] = useState<{ prev: SkImage | null; curr: SkImage | null }>({
    prev: null,
    curr: loadedImage,
  });
  const currImageRef = useRef<SkImage | null>(loadedImage);
  const currUriRef = useRef<string | null>(loadedImage && artworkUri ? artworkUri : null);
  const transitionIdRef = useRef(0);

  const prevOpacity = useSharedValue(0);
  const currOpacity = useSharedValue(loadedImage ? GLOW_OPACITY : 0);

  const clearPrevImage = useCallback((transitionId: number) => {
    if (transitionId !== transitionIdRef.current) return;
    setImages((state) => (state.prev ? { prev: null, curr: state.curr } : state));
  }, []);

  const clearAllImages = useCallback((transitionId: number) => {
    if (transitionId !== transitionIdRef.current) return;
    currImageRef.current = null;
    currUriRef.current = null;
    setImages({ prev: null, curr: null });
  }, []);

  useEffect(() => {
    if (!artworkUri) {
      if (!currImageRef.current) return;
      const tid = ++transitionIdRef.current;
      currUriRef.current = null;
      prevOpacity.value = withTiming(0, { duration: crossfadeDurationMs });
      currOpacity.value = withTiming(0, { duration: crossfadeDurationMs }, (finished) => {
        if (finished) {
          runOnJS(clearAllImages)(tid);
        }
      });
      return;
    }

    // Mantém a imagem anterior visível enquanto a nova carrega no useImage para evitar piscar preto
    if (!loadedImage || loadedImage === currImageRef.current || currUriRef.current === artworkUri) {
      return;
    }

    const prevImg = currImageRef.current;
    currImageRef.current = loadedImage;
    currUriRef.current = artworkUri;
    const tid = ++transitionIdRef.current;

    if (prevImg) {
      prevOpacity.value = GLOW_OPACITY;
      currOpacity.value = 0;
      setImages({ prev: prevImg, curr: loadedImage });
      prevOpacity.value = withTiming(0, { duration: crossfadeDurationMs });
      currOpacity.value = withTiming(
        GLOW_OPACITY,
        { duration: crossfadeDurationMs },
        (finished) => {
          if (finished) {
            runOnJS(clearPrevImage)(tid);
          }
        }
      );
    } else {
      prevOpacity.value = 0;
      currOpacity.value = 0;
      setImages({ prev: null, curr: loadedImage });
      currOpacity.value = withTiming(GLOW_OPACITY, { duration: crossfadeDurationMs });
    }
  }, [artworkUri, loadedImage, crossfadeDurationMs, prevOpacity, currOpacity, clearPrevImage, clearAllImages]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setCanvasSize((prev) =>
        Math.abs(prev.width - width) > 1 || Math.abs(prev.height - height) > 1
          ? { width, height }
          : prev
      );
    }
  }, []);

  const { width, height } = canvasSize;
  const glowWidth = width * 1.16;
  const glowHeight = height * 0.74;
  const glowX = (width - glowWidth) / 2;
  const glowY = 0;

  return (
    <View
      pointerEvents="none"
      style={styles.container}
      onLayout={handleLayout}
      testID="ambient-glow-background"
    >
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill color="#000000" />

        {images.prev ? (
          <Group opacity={prevOpacity} dither={true}>
            <Image
              image={images.prev}
              x={glowX}
              y={glowY}
              width={glowWidth}
              height={glowHeight}
              fit="cover"
            >
              <Blur blur={GLOW_BLUR_RADIUS} mode="decal" />
            </Image>
          </Group>
        ) : null}

        {images.curr ? (
          <Group opacity={currOpacity} dither={true}>
            <Image
              image={images.curr}
              x={glowX}
              y={glowY}
              width={glowWidth}
              height={glowHeight}
              fit="cover"
            >
              <Blur blur={GLOW_BLUR_RADIUS} mode="decal" />
            </Image>
          </Group>
        ) : null}

        <Rect x={0} y={0} width={width} height={height} dither={true}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={VIGNETTE_COLORS}
            positions={VIGNETTE_POSITIONS}
          />
        </Rect>

        {/* Micro-granulação procedural em overlay: elimina color banding de 8 bits no Blur sem afetar o #000000 */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height * 0.88}
          opacity={0.035}
          blendMode="overlay"
          dither={true}
        >
          <FractalNoise freqX={0.8} freqY={0.8} octaves={3} seed={7} />
        </Rect>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    overflow: 'hidden',
    zIndex: 0,
  },
});
