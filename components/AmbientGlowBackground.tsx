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
  Skia,
  SkImage,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import { hasLetterboxArtwork } from '../services/api';

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
  lyricsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});

export interface LyricsBackdropPalette {
  topColor: string;
  bottomColor: string;
  miniColor: string;
}

export const DEFAULT_LYRICS_PALETTE: LyricsBackdropPalette = {
  topColor: '#242830',
  bottomColor: '#15181E',
  miniColor: '#1C2026',
};

const MAX_PALETTE_CACHE = 100;
const artworkLyricsPaletteCache = new Map<string, LyricsBackdropPalette>();
const inFlightPaletteLoads = new Map<string, Promise<LyricsBackdropPalette | null>>();
const SAMPLE_SIZE = 16;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    clamp(r).toString(16).padStart(2, '0') +
    clamp(g).toString(16).padStart(2, '0') +
    clamp(b).toString(16).padStart(2, '0')
  );
}

function clampColorForWhiteText(h: number, s: number, targetL: number, maxLuminance: number): string {
  let l = targetL;
  let rgb = hslToRgb(h, s, l);
  let lum = relativeLuminance(rgb[0], rgb[1], rgb[2]);
  if (lum > maxLuminance) {
    let lo = 0.06;
    let hi = l;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      const cand = hslToRgb(h, s, mid);
      if (relativeLuminance(cand[0], cand[1], cand[2]) > maxLuminance) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    l = lo;
    rgb = hslToRgb(h, s, l);
  }
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

/**
 * Extrai a paleta de fundo de letras a partir dos pixels RGBA reais da capa.
 * Ignora pixels quase brancos/pretos ao buscar o matiz dominante para que capas claras
 * não lavem o texto branco nem caiam em cores aleatórias, garantindo contraste WCAG >= 7:1.
 */
export function extractLyricsPaletteFromPixels(
  pixels: Uint8Array | Float32Array
): LyricsBackdropPalette {
  const isFloat = pixels instanceof Float32Array;
  const totalPixels = Math.floor(pixels.length / 4);
  if (totalPixels <= 0) return DEFAULT_LYRICS_PALETTE;

  // 12 setores de matiz (30° cada) para evitar cancelar cores opostas numa média cega
  const buckets = Array.from({ length: 12 }, () => ({
    weight: 0,
    sinSum: 0,
    cosSum: 0,
    sSum: 0,
    count: 0,
  }));

  let chromaticPixels = 0;
  let neutralR = 0;
  let neutralG = 0;
  let neutralB = 0;
  let neutralCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const a = isFloat ? pixels[idx + 3] * 255 : pixels[idx + 3];
    if (a < 128) continue;

    const r = isFloat ? pixels[idx] * 255 : pixels[idx];
    const g = isFloat ? pixels[idx + 1] * 255 : pixels[idx + 1];
    const b = isFloat ? pixels[idx + 2] * 255 : pixels[idx + 2];

    const [h, s, l] = rgbToHsl(r, g, b);

    // Acumula base neutra para capas monocromáticas/brancas puras
    if (l >= 0.08 && l <= 0.92) {
      neutralR += r;
      neutralG += g;
      neutralB += b;
      neutralCount++;
    }

    // Filtra branco/preto quase puros para extrair a cor real presente na arte
    if (s < 0.14 || l < 0.08 || l > 0.90) continue;

    chromaticPixels++;
    const bucketIdx = Math.min(11, Math.floor(h * 12));
    const lightnessBonus = 1 - Math.abs(l - 0.5) * 1.1;
    const weight = (0.2 + s * s * 3.0) * Math.max(0.2, lightnessBonus);
    const angle = h * Math.PI * 2;
    const bucket = buckets[bucketIdx];
    bucket.weight += weight;
    bucket.sinSum += Math.sin(angle) * weight;
    bucket.cosSum += Math.cos(angle) * weight;
    bucket.sSum += s * weight;
    bucket.count++;
  }

  // Capa verdadeiramente monocromática (branco/preto/cinza sem cor real)
  if (chromaticPixels < Math.max(2, totalPixels * 0.02)) {
    if (neutralCount > 0) {
      const [nh, ns] = rgbToHsl(
        neutralR / neutralCount,
        neutralG / neutralCount,
        neutralB / neutralCount
      );
      const clampedS = Math.min(ns, 0.12);
      return {
        topColor: clampColorForWhiteText(nh, clampedS, 0.22, 0.075),
        bottomColor: clampColorForWhiteText(nh, clampedS, 0.14, 0.045),
        miniColor: clampColorForWhiteText(nh, clampedS, 0.16, 0.048),
      };
    }
    return DEFAULT_LYRICS_PALETTE;
  }

  let best = buckets[0];
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].weight > best.weight) {
      best = buckets[i];
    }
  }

  let meanHue = Math.atan2(best.sinSum, best.cosSum) / (Math.PI * 2);
  if (meanHue < 0) meanHue += 1;
  const meanSat = best.weight > 0 ? best.sSum / best.weight : 0.45;
  const richSat = Math.max(0.32, Math.min(0.68, meanSat * 0.95));

  // Contraste alvo >= 7.5:1 com branco (#FFFFFF -> maxLuminance ~0.082 no topo, ~0.045 na base)
  // e >= 4.5:1 com subtítulo #B3B3B3 no mini player (maxLuminance ~0.050)
  return {
    topColor: clampColorForWhiteText(meanHue, richSat, 0.27, 0.082),
    bottomColor: clampColorForWhiteText(meanHue, Math.min(0.72, richSat * 1.05), 0.17, 0.045),
    miniColor: clampColorForWhiteText(meanHue, Math.min(0.70, richSat * 1.02), 0.19, 0.050),
  };
}

function extractPaletteFromSkImage(image: SkImage, artworkUri?: string | null): LyricsBackdropPalette | null {
  if (!image || typeof image.width !== 'function' || typeof Skia?.Surface?.Make !== 'function') {
    return null;
  }
  const imgW = image.width();
  const imgH = image.height();
  if (imgW <= 0 || imgH <= 0) return null;

  const surface = Skia.Surface.Make(SAMPLE_SIZE, SAMPLE_SIZE);
  if (!surface) return null;

  let paint: ReturnType<typeof Skia.Paint> | null = null;
  let snapshot: SkImage | null = null;
  let nonTexImg: SkImage | null = null;
  try {
    paint = Skia.Paint();
    const isLetterboxedThumb = hasLetterboxArtwork(artworkUri);
    const cropY = isLetterboxedThumb ? Math.round(imgH * 0.13) : 0;
    const srcRect = Skia.XYWHRect(0, cropY, imgW, Math.max(1, imgH - cropY * 2));
    const destRect = Skia.XYWHRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const sourceImg =
      typeof image.makeNonTextureImage === 'function'
        ? (nonTexImg = image.makeNonTextureImage())
        : image;

    surface.getCanvas().drawImageRect(sourceImg, srcRect, destRect, paint);
    snapshot = surface.makeImageSnapshot();
    const pixels = snapshot.readPixels();
    if (!pixels || pixels.length < 4) return null;
    return extractLyricsPaletteFromPixels(pixels);
  } catch {
    return null;
  } finally {
    snapshot?.dispose?.();
    if (nonTexImg && nonTexImg !== image) {
      nonTexImg.dispose?.();
    }
    paint?.dispose?.();
    surface.dispose?.();
  }
}

function cacheArtworkPalette(artworkUri: string, palette: LyricsBackdropPalette): void {
  if (artworkLyricsPaletteCache.size >= MAX_PALETTE_CACHE) {
    const oldest = artworkLyricsPaletteCache.keys().next().value;
    if (oldest !== undefined) artworkLyricsPaletteCache.delete(oldest);
  }
  artworkLyricsPaletteCache.set(artworkUri, palette);
}

export function clearArtworkPaletteCacheForTest(): void {
  artworkLyricsPaletteCache.clear();
  inFlightPaletteLoads.clear();
}

function loadArtworkPaletteAsync(artworkUri: string): Promise<LyricsBackdropPalette | null> {
  const cached = artworkLyricsPaletteCache.get(artworkUri);
  if (cached) return Promise.resolve(cached);

  if (
    typeof Skia?.Data?.fromURI !== 'function' ||
    typeof Skia?.Image?.MakeImageFromEncoded !== 'function' ||
    typeof Skia?.Surface?.Make !== 'function'
  ) {
    return Promise.resolve(null);
  }

  const existing = inFlightPaletteLoads.get(artworkUri);
  if (existing) return existing;

  const task = (async (): Promise<LyricsBackdropPalette | null> => {
    let data: Awaited<ReturnType<typeof Skia.Data.fromURI>> | null = null;
    let decodedImg: SkImage | null = null;
    try {
      data = await Skia.Data.fromURI(artworkUri);
      if (!data) return null;
      decodedImg = Skia.Image.MakeImageFromEncoded(data);
      if (!decodedImg) return null;
      const extracted = extractPaletteFromSkImage(decodedImg, artworkUri);
      if (extracted) {
        cacheArtworkPalette(artworkUri, extracted);
      }
      return extracted;
    } catch {
      return null;
    } finally {
      decodedImg?.dispose?.();
      data?.dispose?.();
      inFlightPaletteLoads.delete(artworkUri);
    }
  })();

  inFlightPaletteLoads.set(artworkUri, task);
  return task;
}

export function useArtworkLyricsPalette(artworkUri?: string | null): LyricsBackdropPalette {
  const cached = artworkUri ? artworkLyricsPaletteCache.get(artworkUri) : undefined;
  const [resolved, setResolved] = useState<{
    uri: string | null;
    palette: LyricsBackdropPalette;
  }>({
    uri: cached && artworkUri ? artworkUri : null,
    palette: cached ?? DEFAULT_LYRICS_PALETTE,
  });

  useEffect(() => {
    if (!artworkUri) {
      setResolved({ uri: null, palette: DEFAULT_LYRICS_PALETTE });
      return;
    }
    const hit = artworkLyricsPaletteCache.get(artworkUri);
    if (hit) {
      setResolved({ uri: artworkUri, palette: hit });
      return;
    }

    let cancelled = false;
    void loadArtworkPaletteAsync(artworkUri).then((extracted) => {
      if (!cancelled && extracted) {
        setResolved({ uri: artworkUri, palette: extracted });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artworkUri]);

  if (!artworkUri) return DEFAULT_LYRICS_PALETTE;
  if (cached) return cached;
  return resolved.uri === artworkUri ? resolved.palette : DEFAULT_LYRICS_PALETTE;
}

/**
 * Retorna a cor de fundo real extraída da capa para o mini player recolhido,
 * compartilhando o mesmo cache LRU da tela de letras e usando fallback seguro
 * enquanto a imagem carrega ou em ambientes sem decodificador Skia nativo.
 */
export function useArtworkMiniPlayerColor(
  artworkUri?: string | null,
  fallbackColor: string = DEFAULT_LYRICS_PALETTE.miniColor
): string {
  const cached = artworkUri ? artworkLyricsPaletteCache.get(artworkUri) : undefined;
  const [resolved, setResolved] = useState<{ uri: string | null; color: string } | null>(
    cached && artworkUri ? { uri: artworkUri, color: cached.miniColor } : null
  );

  useEffect(() => {
    if (!artworkUri) {
      setResolved(null);
      return;
    }
    const hit = artworkLyricsPaletteCache.get(artworkUri);
    if (hit) {
      setResolved({ uri: artworkUri, color: hit.miniColor });
      return;
    }

    let cancelled = false;
    void loadArtworkPaletteAsync(artworkUri).then((extracted) => {
      if (!cancelled && extracted) {
        setResolved({ uri: artworkUri, color: extracted.miniColor });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artworkUri]);

  if (!artworkUri) return fallbackColor;
  if (cached) return cached.miniColor;
  return resolved && resolved.uri === artworkUri ? resolved.color : fallbackColor;
}

/**
 * Fundo dedicado para a tela cheia de Letras: extrai a cor real da capa via Skia
 * com contraste WCAG AAA garantido e renderiza gradiente dithered sem banding.
 */
export function LyricsBackdropBackground({ artworkUri }: { artworkUri?: string | null }) {
  const palette = useArtworkLyricsPalette(artworkUri);
  const windowSize = useWindowDimensions();
  const [size, setSize] = useState({
    width: Math.max(1, windowSize.width || 390),
    height: Math.max(1, windowSize.height || 844),
  });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setSize((prev) =>
        Math.abs(prev.width - width) > 1 || Math.abs(prev.height - height) > 1
          ? { width, height }
          : prev
      );
    }
  }, []);

  return (
    <View
      pointerEvents="none"
      style={[styles.lyricsBackdrop, { backgroundColor: palette.topColor }]}
      onLayout={handleLayout}
      testID="lyrics-backdrop-background"
    >
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={size.width} height={size.height} dither={true}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, size.height)}
            colors={[palette.topColor, palette.bottomColor]}
          />
        </Rect>
        <Rect
          x={0}
          y={0}
          width={size.width}
          height={size.height}
          opacity={0.025}
          blendMode="overlay"
          dither={true}
        >
          <FractalNoise freqX={0.8} freqY={0.8} octaves={3} seed={7} />
        </Rect>
      </Canvas>
    </View>
  );
}
