import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Folder } from 'lucide-react-native';

export interface MarqueeTextProps {
  children: string;
  active?: boolean;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  gap?: number;
  speedPxPerSec?: number;
  pauseMs?: number;
}

export interface TrackMetaRowProps {
  artistText: string;
  durationText?: string;
  active?: boolean;
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  artistContainerStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  durationStyle?: StyleProp<TextStyle>;
}

const DEFAULT_GAP = 48;
const DEFAULT_SPEED_PX_PER_SEC = 38;
const DEFAULT_PAUSE_MS = 1400;

/**
 * Renderiza texto em linha única com efeito carrossel (marquee) contínuo na UI thread
 * somente quando `active` é verdadeiro e o texto ultrapassa a largura disponível.
 */
export const MarqueeText: React.FC<MarqueeTextProps> = ({
  children,
  active = false,
  style,
  containerStyle,
  gap = DEFAULT_GAP,
  speedPxPerSec = DEFAULT_SPEED_PX_PER_SEC,
  pauseMs = DEFAULT_PAUSE_MS,
}) => {
  const text = children ?? '';
  const flatStyle = StyleSheet.flatten(style);
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const shouldAnimate =
    Boolean(active) &&
    text.length > 0 &&
    containerWidth > 0 &&
    textWidth > containerWidth + 2;

  const renderedTextWidth = textWidth > 0 ? textWidth + 4 : 0;
  const loopSpan = renderedTextWidth + gap;

  useEffect(() => {
    setTextWidth(0);
    translateX.setValue(0);
  }, [text, active, translateX]);

  useEffect(() => {
    animRef.current?.stop();
    animRef.current = null;
    translateX.setValue(0);

    if (!shouldAnimate || loopSpan <= gap) {
      return undefined;
    }

    const scrollDuration = Math.max(2200, Math.round((loopSpan / speedPxPerSec) * 1000));
    const linearEasing = Easing?.linear;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: pauseMs,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: -loopSpan,
          duration: scrollDuration,
          ...(linearEasing ? { easing: linearEasing } : {}),
          useNativeDriver: true,
        }),
      ])
    );

    animRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
      animRef.current = null;
      translateX.setValue(0);
    };
  }, [shouldAnimate, loopSpan, speedPxPerSec, pauseMs, translateX]);

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.floor(event.nativeEvent.layout.width);
    setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth));
  };

  const handleTextLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    setTextWidth((prev) => (prev === nextWidth ? prev : nextWidth));
  };

  if (!active) {
    if (containerStyle) {
      return (
        <View style={[styles.container, containerStyle]}>
          <Text style={style} numberOfLines={1} ellipsizeMode="tail">
            {text}
          </Text>
        </View>
      );
    }
    return (
      <Text style={style} numberOfLines={1} ellipsizeMode="tail">
        {text}
      </Text>
    );
  }

  return (
    <View style={[styles.container, containerStyle]} onLayout={handleContainerLayout}>
      <Text
        style={shouldAnimate ? [flatStyle, styles.hiddenPlaceholder] : style}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {text}
      </Text>

      <View
        pointerEvents="none"
        style={styles.measureProbe}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          key={text}
          numberOfLines={1}
          onLayout={handleTextLayout}
          style={[flatStyle, styles.measureProbeText]}
        >
          {text}
        </Text>
      </View>

      {shouldAnimate && (
        <View
          pointerEvents="none"
          style={styles.marqueeOverlay}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.View
            style={[
              styles.marqueeTrack,
              {
                width: loopSpan * 2,
                transform: [{ translateX }],
              },
            ]}
          >
            <Text numberOfLines={1} style={[flatStyle, { width: renderedTextWidth }]}>
              {text}
            </Text>
            <View style={{ width: gap }} />
            <Text numberOfLines={1} style={[flatStyle, { width: renderedTextWidth }]}>
              {text}
            </Text>
            <View style={{ width: gap }} />
          </Animated.View>
        </View>
      )}
    </View>
  );
};

/**
 * Ícone padrão de faixa salva offline (pastinha verde compartilhada entre playlists e busca).
 */
export const DownloadedTrackBadge: React.FC = () => (
  <View style={styles.downloadedBadge} accessibilityLabel="Baixada">
    <Folder color="#2BA640" size={12} />
  </View>
);

/**
 * Linha padronizada de metadados de faixa: artista flexível (truncado com "..." quando inativo
 * ou carrossel quando ativo) à esquerda e duração fixa alinhada à direita.
 */
export const TrackMetaRow: React.FC<TrackMetaRowProps> = ({
  artistText,
  durationText,
  active = false,
  leading,
  style,
  artistContainerStyle,
  textStyle,
  durationStyle,
}) => (
  <View style={[styles.metaRow, style]}>
    {leading}
    <MarqueeText
      active={active}
      containerStyle={[
        styles.metaArtistContainer,
        leading ? styles.metaArtistWithLeading : null,
        artistContainerStyle,
      ]}
      style={textStyle}
    >
      {artistText}
    </MarqueeText>
    {durationText ? (
      <Text
        style={[textStyle, styles.metaDuration, durationStyle]}
        numberOfLines={1}
      >
        {durationText}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
    minWidth: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  downloadedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  metaArtistContainer: {
    flex: 1,
    minWidth: 0,
  },
  metaArtistWithLeading: {
    marginLeft: 5,
  },
  metaDuration: {
    flexShrink: 0,
    marginLeft: 8,
    fontVariant: ['tabular-nums'],
  },
  hiddenPlaceholder: {
    opacity: 0,
  },
  measureProbe: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 10000,
    flexDirection: 'row',
    opacity: 0,
    zIndex: -1,
  },
  measureProbeText: {
    color: 'transparent',
  },
  marqueeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  marqueeTrack: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});

export default MarqueeText;
