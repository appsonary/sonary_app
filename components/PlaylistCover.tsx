import React from 'react';
import {
  Image,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { ListMusic } from 'lucide-react-native';
import { theme } from '../theme';

export interface PlaylistCoverProps {
  thumbnailUrl?: string | null;
  hasCustomCover?: boolean;
  coverThumbnails?: string[];
  size?: number;
  borderRadius?: number;
  iconSize?: number;
  placeholderColor?: string;
  placeholderBackgroundColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function hasYouTubeLetterbox(uri?: string | null): boolean {
  return Boolean(uri && /(?:hqdefault|sddefault)\.jpg/i.test(uri));
}

export const PlaylistCover: React.FC<PlaylistCoverProps> = ({
  thumbnailUrl,
  hasCustomCover = false,
  coverThumbnails = [],
  size,
  borderRadius = 10,
  iconSize = 24,
  placeholderColor = theme.colors.textMuted,
  placeholderBackgroundColor = '#1E1E1E',
  style,
  testID,
}) => {
  const sizeStyle: ViewStyle | undefined =
    typeof size === 'number'
      ? { width: size, height: size, aspectRatio: 1 }
      : undefined;

  const baseStyle: StyleProp<ViewStyle> = [
    styles.container,
    sizeStyle,
    { borderRadius },
    style,
  ];

  // 1. Capa personalizada escolhida pelo usuário na galeria
  if (hasCustomCover && thumbnailUrl) {
    return (
      <View style={baseStyle} testID={testID}>
        <Image
          source={{ uri: thumbnailUrl }}
          style={styles.fullImage}
          resizeMode="cover"
        />
      </View>
    );
  }

  // 2. Capa padrão em colagem 2x2 (apenas quando há pelo menos 4 músicas)
  const validCovers = (coverThumbnails || []).filter(Boolean);
  if (validCovers.length >= 4) {
    const four = validCovers.slice(0, 4);
    return (
      <View style={baseStyle} testID={testID}>
        <View style={styles.collageRow}>
          {[four[0], four[1]].map((uri, idx) => (
            <View key={`top-${idx}`} style={styles.collageCell}>
              <Image
                source={{ uri }}
                style={[
                  styles.fullImage,
                  hasYouTubeLetterbox(uri) && styles.letterboxCrop,
                ]}
                resizeMode="cover"
              />
            </View>
          ))}
        </View>
        <View style={styles.collageRow}>
          {[four[2], four[3]].map((uri, idx) => (
            <View key={`bottom-${idx}`} style={styles.collageCell}>
              <Image
                source={{ uri }}
                style={[
                  styles.fullImage,
                  hasYouTubeLetterbox(uri) && styles.letterboxCrop,
                ]}
                resizeMode="cover"
              />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // 3. Playlist com 1 a 3 músicas: exibe apenas a capa da primeira música
  const singleUri = validCovers[0] || thumbnailUrl || null;
  if (singleUri) {
    return (
      <View style={baseStyle} testID={testID}>
        <Image
          source={{ uri: singleUri }}
          style={[
            styles.fullImage,
            hasYouTubeLetterbox(singleUri) && styles.letterboxCrop,
          ]}
          resizeMode="cover"
        />
      </View>
    );
  }

  // 4. Playlist vazia
  return (
    <View
      style={[
        baseStyle,
        { backgroundColor: placeholderBackgroundColor },
        styles.placeholder,
      ]}
      testID={testID}
    >
      <ListMusic color={placeholderColor} size={iconSize} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#1E1E1E',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  letterboxCrop: {
    transform: [{ scale: 1.35 }],
  },
  collageRow: {
    flex: 1,
    flexDirection: 'row',
  },
  collageCell: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

