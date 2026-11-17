import React from 'react';
import { Image, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowDownToLine, Bell, Code2 } from 'lucide-react-native';
import { isDevMenuEnabled } from './DevMenuModal';

const HEADER_LOGO = require('../assets/brand-logo-header.png');
const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;

export interface BrandHeaderProps {
  subtitle?: string;
  onOpenDevMenu?: () => void;
  onOpenDownloadQueue?: () => void;
  downloadQueueCount?: number;
  hasDownloadErrors?: boolean;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({
  subtitle,
  onOpenDevMenu,
  onOpenDownloadQueue,
  downloadQueueCount = 0,
  hasDownloadErrors = false,
}) => {
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

        {/* Dev (em debug), Fila de Downloads (clean) e Notificações */}
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
              <Code2 color="#FFFFFF" size={21} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.downloadQueueButton}
            onPress={onOpenDownloadQueue}
            disabled={typeof onOpenDownloadQueue !== 'function'}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={
              downloadQueueCount > 0
                ? `Fila de downloads (${downloadQueueCount})`
                : 'Fila de downloads'
            }
          >
            <ArrowDownToLine color="#FFFFFF" size={21} />
            {downloadQueueCount > 0 ? (
              <View style={styles.queueBadge}>
                <Text style={styles.queueBadgeText}>
                  {downloadQueueCount > 9 ? '9+' : downloadQueueCount}
                </Text>
              </View>
            ) : hasDownloadErrors ? (
              <View style={styles.queueErrorDot} />
            ) : null}
          </TouchableOpacity>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadQueueButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  queueBadge: {
    position: 'absolute',
    top: 1,
    right: -2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  queueErrorDot: {
    position: 'absolute',
    top: 4,
    right: 2,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF4E45',
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


