import React from 'react';
import { Image, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Menu } from 'lucide-react-native';

const HEADER_LOGO = require('../assets/brand-logo-header.png');
const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;

export interface BrandHeaderProps {
  subtitle?: string;
  onOpenMenu?: () => void;
  downloadQueueCount?: number;
  hasDownloadErrors?: boolean;
  hasAvailableUpdate?: boolean;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({
  subtitle,
  onOpenMenu,
  downloadQueueCount = 0,
  hasDownloadErrors = false,
  hasAvailableUpdate = false,
}) => {
  const showNotificationDot =
    hasAvailableUpdate || downloadQueueCount > 0 || hasDownloadErrors;

  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        {/* Identidade visual Sonary */}
        <View style={styles.brandLeftCluster}>
          <View style={styles.titleWrapper}>
            <Image
              source={HEADER_LOGO}
              style={styles.brandLogoImage}
              resizeMode="contain"
              accessibilityRole="image"
              accessibilityLabel="Sonary"
            />
            {subtitle ? (
              <Text style={styles.brandSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Botão único de Menu Lateral com ponto de notificação discreto */}
        <TouchableOpacity
          style={styles.menuButton}
          onPress={onOpenMenu}
          disabled={typeof onOpenMenu !== 'function'}
          activeOpacity={0.75}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Abrir menu"
        >
          <Menu color="#FFFFFF" size={24} />
          {showNotificationDot ? (
            <View style={styles.notificationDot} testID="header-menu-dot" />
          ) : null}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUS_BAR_HEIGHT + 10 : 10,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  brandLeftCluster: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleWrapper: {
    flexShrink: 1,
    justifyContent: 'center',
  },
  brandLogoImage: {
    height: 38,
    width: 111,
    aspectRatio: 1222 / 420,
    maxWidth: '100%',
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
  },
  notificationDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF233C',
  },
  brandSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: '#8E8E93',
    letterSpacing: 0.1,
    marginTop: 2,
  },
});

export default BrandHeader;
