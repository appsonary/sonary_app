import React from 'react';
import { Image, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bell, Code2 } from 'lucide-react-native';
import { isDevMenuEnabled } from './DevMenuModal';

const HEADER_LOGO = require('../assets/brand-logo-header.png');
const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;

export interface BrandHeaderProps {
  subtitle?: string;
  onOpenDevMenu?: () => void;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({ subtitle, onOpenDevMenu }) => {
  const showDevButton = isDevMenuEnabled() && typeof onOpenDevMenu === 'function';

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

        {/* Notificações e botão exclusivo de desenvolvimento */}
        <View style={styles.headerRightActions}>
          {showDevButton && (
            <TouchableOpacity
              style={styles.devButton}
              onPress={onOpenDevMenu}
              activeOpacity={0.75}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Menu de desenvolvimento"
            >
              <Code2 color="#FFFFFF" size={16} />
            </TouchableOpacity>
          )}
          <View style={styles.notificationsButton} accessibilityLabel="Notificações">
            <Bell color="#FFFFFF" size={22} />
          </View>
        </View>
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
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
  devButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#262628',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  notificationsButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
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


