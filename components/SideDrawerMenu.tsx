import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  Code2,
  HardDriveDownload,
  Heart,
  History,
  RefreshCw,
  Settings,
} from 'lucide-react-native';
import { BACK_PRIORITY, useBackHandler } from '../services/backNavigation';
import type {
  InstalledAppVersion,
  RemoteReleaseInfo,
  UpdateDownloadState,
} from '../services/updater';
import { getEaseOutCubic } from '../theme';
import { isDevMenuEnabled } from './DevMenuModal';

const HEADER_LOGO = require('../assets/brand-logo-header.png');
const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;

export const DRAWER_WIDTH_RATIO = 0.78;
export const DRAWER_SHELL_TRANSLATE_RATIO = DRAWER_WIDTH_RATIO;
export const DRAWER_OPEN_MS = 260;
export const DRAWER_CLOSE_MS = 200;
const DISMISS_VELOCITY_THRESHOLD = 0.45;
const DISMISS_DISTANCE_RATIO = 0.25;

function getDrawerEasing(): ((t: number) => number) | undefined {
  if (typeof Easing?.bezier === 'function') {
    return Easing.bezier(0.22, 1, 0.36, 1);
  }
  return getEaseOutCubic(Easing);
}

export interface SideDrawerMenuProps {
  visible: boolean;
  progress?: Animated.Value;
  onClose: () => void;
  onTransitionStateChange?: (active: boolean) => void;
  installedVersion?: InstalledAppVersion | null;
  availableUpdate?: RemoteReleaseInfo | null;
  updateDownloadState?: UpdateDownloadState | null;
  downloadQueueCount?: number;
  isDevMode?: boolean;
  onOpenDownloadQueue: () => void;
  onOpenRecentHistory: () => void;
  onOpenStats: () => void;
  onOpenUpdates: () => void;
  onOpenBackup?: () => void;
  onOpenSettings: () => void;
  onOpenDevMenu?: () => void;
  onOpenSupport: () => void;
}

export const SideDrawerMenu: React.FC<SideDrawerMenuProps> = ({
  visible,
  progress: externalProgress,
  onClose,
  onTransitionStateChange,
  installedVersion,
  availableUpdate,
  updateDownloadState,
  downloadQueueCount = 0,
  isDevMode = false,
  onOpenDownloadQueue,
  onOpenRecentHistory,
  onOpenStats,
  onOpenUpdates,
  onOpenBackup,
  onOpenSettings,
  onOpenDevMenu,
  onOpenSupport,
}) => {
  const { width } = useWindowDimensions();
  const drawerWidth = width * DRAWER_WIDTH_RATIO;
  const drawerWidthRef = useRef(drawerWidth);
  drawerWidthRef.current = drawerWidth;

  const internalProgress = useRef(new Animated.Value(0)).current;
  const progress = externalProgress ?? internalProgress;

  const [shouldRender, setShouldRender] = useState(visible);
  const activeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const isClosingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onTransitionRef = useRef(onTransitionStateChange);
  onTransitionRef.current = onTransitionStateChange;

  const finishClose = useCallback((afterClose?: () => void) => {
    isClosingRef.current = false;
    setShouldRender(false);
    onTransitionRef.current?.(false);
    onCloseRef.current();
    afterClose?.();
  }, []);

  const dismissDrawer = useCallback(
    (afterClose?: () => void) => {
      if (isClosingRef.current) return;
      isClosingRef.current = true;
      activeAnimRef.current?.stop();

      const anim = Animated.parallel([
        Animated.timing(progress, {
          toValue: 0,
          duration: DRAWER_CLOSE_MS,
          easing: getDrawerEasing(),
          useNativeDriver: true,
        }),
      ]);
      activeAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) {
          finishClose(afterClose);
        } else {
          isClosingRef.current = false;
        }
      });
    },
    [progress, finishClose]
  );

  const dismissRef = useRef(dismissDrawer);
  dismissRef.current = dismissDrawer;

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      setShouldRender(true);
      onTransitionRef.current?.(true);
      activeAnimRef.current?.stop();
      const anim = Animated.parallel([
        Animated.timing(progress, {
          toValue: 1,
          duration: DRAWER_OPEN_MS,
          easing: getDrawerEasing(),
          useNativeDriver: true,
        }),
      ]);
      activeAnimRef.current = anim;
      anim.start();
    } else if (shouldRender && !isClosingRef.current) {
      isClosingRef.current = true;
      activeAnimRef.current?.stop();
      const anim = Animated.parallel([
        Animated.timing(progress, {
          toValue: 0,
          duration: DRAWER_CLOSE_MS,
          easing: getDrawerEasing(),
          useNativeDriver: true,
        }),
      ]);
      activeAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) {
          isClosingRef.current = false;
          setShouldRender(false);
          onTransitionRef.current?.(false);
        } else {
          isClosingRef.current = false;
        }
      });
    }
  }, [visible, progress, shouldRender]);

  useEffect(() => {
    return () => {
      activeAnimRef.current?.stop();
    };
  }, []);

  // Overlay inline na camada Activity: usa useBackHandler para interceptar o Voltar do Android
  useBackHandler(
    shouldRender,
    () => {
      dismissDrawer();
      return true;
    },
    BACK_PRIORITY.INLINE_OVERLAY
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gs) =>
          gs.dx > 6 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.2,
        onPanResponderMove: (_, gs) => {
          const w = Math.max(1, drawerWidthRef.current);
          const clampedDx = Math.min(w, Math.max(0, gs.dx));
          progress.setValue(1 - clampedDx / w);
        },
        onPanResponderRelease: (_, gs) => {
          const w = Math.max(1, drawerWidthRef.current);
          if (
            gs.dx > w * DISMISS_DISTANCE_RATIO ||
            gs.vx > DISMISS_VELOCITY_THRESHOLD
          ) {
            dismissRef.current();
          } else {
            activeAnimRef.current?.stop();
            const anim = Animated.parallel([
              Animated.timing(progress, {
                toValue: 1,
                duration: 180,
                easing: getDrawerEasing(),
                useNativeDriver: true,
              }),
            ]);
            activeAnimRef.current = anim;
            anim.start();
          }
        },
        onPanResponderTerminate: () => {
          activeAnimRef.current?.stop();
          const anim = Animated.parallel([
            Animated.timing(progress, {
              toValue: 1,
              duration: 180,
              easing: getDrawerEasing(),
              useNativeDriver: true,
            }),
          ]);
          activeAnimRef.current = anim;
          anim.start();
        },
      }),
    [progress]
  );

  const scrimOpacity = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.55],
        extrapolate: 'clamp',
      }),
    [progress]
  );

  const drawerTranslateX = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [drawerWidth, 0],
        extrapolate: 'clamp',
      }),
    [progress, drawerWidth]
  );

  if (!shouldRender) {
    return null;
  }

  const versionName = installedVersion?.versionName || '1.0.4';
  const isDownloadingUpdate = updateDownloadState?.status === 'downloading';
  const isUpdateReady = updateDownloadState?.status === 'ready';
  const updateProgressPct = Math.round((updateDownloadState?.progress || 0) * 100);
  const updateTargetVersion =
    availableUpdate?.versionName || updateDownloadState?.versionName || null;
  const hasUpdate = Boolean(availableUpdate || isDownloadingUpdate || isUpdateReady);
  const showDevItem =
    Boolean(isDevMode) &&
    isDevMenuEnabled() &&
    typeof onOpenDevMenu === 'function';

  const groupedItems: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    onPress: () => void;
    rightAccessory?: React.ReactNode;
  }> = [
    {
      id: 'downloads',
      label: 'Fila de downloads',
      icon: <ArrowDownToLine color="#D4D4D8" size={20} strokeWidth={1.6} />,
      onPress: () => dismissDrawer(onOpenDownloadQueue),
      rightAccessory:
        downloadQueueCount > 0 ? (
          <View style={styles.countPill} testID="drawer-downloads-pill">
            <Text style={styles.countPillText}>{downloadQueueCount}</Text>
          </View>
        ) : (
          <Text style={styles.emptyStatusText} testID="drawer-downloads-empty-pill">
            Vazia
          </Text>
        ),
    },
    {
      id: 'recents',
      label: 'Histórico recente',
      icon: <History color="#D4D4D8" size={20} strokeWidth={1.6} />,
      onPress: () => dismissDrawer(onOpenRecentHistory),
    },
    {
      id: 'stats',
      label: 'Estatísticas',
      icon: <BarChart2 color="#D4D4D8" size={20} strokeWidth={1.6} />,
      onPress: () => dismissDrawer(onOpenStats),
    },
    ...(typeof onOpenBackup === 'function'
      ? [
          {
            id: 'backup',
            label: 'Backup e dados',
            icon: <HardDriveDownload color="#D4D4D8" size={20} strokeWidth={1.6} />,
            onPress: () => dismissDrawer(onOpenBackup),
          },
        ]
      : []),
    {
      id: 'settings',
      label: 'Configurações',
      icon: <Settings color="#D4D4D8" size={20} strokeWidth={1.6} />,
      onPress: () => dismissDrawer(onOpenSettings),
    },
  ];

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none" testID="side-drawer-overlay">
      <Animated.View
        style={[styles.scrim, { opacity: scrimOpacity }]}
        pointerEvents="auto"
      >
        <TouchableOpacity
          style={styles.scrimTouchTarget}
          activeOpacity={1}
          onPress={() => dismissDrawer()}
          accessibilityRole="button"
          accessibilityLabel="Fechar menu"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawerPanel,
          {
            width: drawerWidth,
            transform: [{ translateX: drawerTranslateX }],
          },
        ]}
        testID="side-drawer-panel"
        {...panResponder.panHandlers}
      >
        <View style={styles.drawerInner}>
          <ScrollView
            style={styles.menuScroll}
            contentContainerStyle={styles.menuScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Cabeçalho: seta voltar minimalista à esquerda + logo original Sonary à direita */}
            <View style={styles.header} testID="drawer-header">
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => dismissDrawer()}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Voltar"
              >
                <ArrowLeft color="#E4E4E7" size={22} strokeWidth={1.8} />
              </TouchableOpacity>
              <View style={styles.headerBrandRight} testID="drawer-header-brand">
                <Image
                  source={HEADER_LOGO}
                  style={styles.logoImage}
                  resizeMode="contain"
                  accessibilityRole="image"
                  accessibilityLabel="Sonary"
                />
              </View>
            </View>

            {/* Card neutro em destaque: Apoiar o Sonary */}
            <TouchableOpacity
              style={styles.supportCard}
              onPress={() => dismissDrawer(onOpenSupport)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Apoiar o Sonary"
            >
              <View style={styles.supportIconWrap}>
                <Heart color="#E53935" size={22} strokeWidth={1.8} />
              </View>
              <View style={styles.supportTextCol}>
                <Text style={styles.supportTitle} numberOfLines={1}>
                  Apoiar o Sonary
                </Text>
                <Text style={styles.supportSubtitle} numberOfLines={2}>
                  Ajude a manter o projeto vivo
                </Text>
              </View>
              <ArrowUpRight color="#8E8E93" size={18} strokeWidth={1.7} />
            </TouchableOpacity>

            {/* Lista limpa com as opções principais */}
            <View style={styles.menuGroup} testID="drawer-menu-group">
              {groupedItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.menuItem}
                  onPress={item.onPress}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <View style={styles.menuItemLeft}>
                    {item.icon}
                    <Text style={styles.menuItemLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                  {item.rightAccessory ? (
                    <View style={styles.menuItemRight}>{item.rightAccessory}</View>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>

            {/* Separador sutil + Modo Desenvolvedor discreto (apenas em dev) */}
            {showDevItem && onOpenDevMenu ? (
              <>
                <View style={styles.sectionDivider} testID="drawer-dev-divider" />
                <TouchableOpacity
                  style={styles.devItem}
                  onPress={() => dismissDrawer(onOpenDevMenu)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Modo Desenvolvedor"
                >
                  <Code2 color="#71717A" size={20} strokeWidth={1.6} />
                  <Text style={styles.devItemLabel} numberOfLines={1}>
                    Modo Desenvolvedor
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>

          {/* Rodapé minimalista com versão e status de atualização */}
          <View style={styles.footer} testID="drawer-footer-card">
            <View style={styles.versionBlock}>
              <View style={styles.versionTitleRow}>
                <Text style={styles.versionBrand}>Sonary</Text>
                <Text style={styles.versionText} testID="drawer-version-pill">
                  {`v${versionName}`}
                </Text>
              </View>
              <View style={styles.versionStatusRow}>
                <View
                  style={[
                    styles.statusDot,
                    hasUpdate && !isUpdateReady && styles.statusDotUpdate,
                  ]}
                />
                <Text
                  style={[
                    styles.versionStatusText,
                    hasUpdate && !isUpdateReady && styles.versionStatusTextUpdate,
                  ]}
                  numberOfLines={1}
                >
                  {isDownloadingUpdate
                    ? `Baixando${updateTargetVersion ? ` v${updateTargetVersion}` : ''}... ${updateProgressPct}%`
                    : isUpdateReady
                      ? `${updateTargetVersion ? `v${updateTargetVersion} pronta` : 'Atualização pronta'} para instalar`
                      : hasUpdate && availableUpdate
                        ? `Nova versão v${availableUpdate.versionName} disponível`
                        : 'Atualizado'}
                </Text>
              </View>
            </View>

            {hasUpdate ? (
              <TouchableOpacity
                style={styles.updatePillButton}
                onPress={() => dismissDrawer(onOpenUpdates)}
                activeOpacity={0.8}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel={isUpdateReady ? 'Instalar atualização' : 'Atualizar'}
              >
                <Text style={styles.updateRightActionText}>
                  {isDownloadingUpdate
                    ? `${updateProgressPct}%`
                    : isUpdateReady
                      ? 'Instalar'
                      : 'Atualizar'}
                </Text>
                <ArrowRight color="#FFFFFF" size={14} strokeWidth={2} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.footerRefreshButton}
                onPress={() => dismissDrawer(onOpenUpdates)}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Atualizações do aplicativo"
              >
                <RefreshCw color="#8E8E93" size={19} strokeWidth={1.7} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlayRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    backgroundColor: '#000000',
  },
  scrimTouchTarget: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  drawerPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    backgroundColor: '#0B0B0C',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  drawerInner: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUS_BAR_HEIGHT + 12 : 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  menuScroll: {
    flex: 1,
  },
  menuScrollContent: {
    paddingBottom: 16,
  },
  header: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerBrandRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  logoImage: {
    height: 34,
    width: Math.round(34 * (1222 / 420)),
    aspectRatio: 1222 / 420,
  },
  supportCard: {
    backgroundColor: '#171719',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 20,
  },
  supportIconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportTextCol: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8,
  },
  supportTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  supportSubtitle: {
    fontSize: 12.5,
    lineHeight: 17,
    color: '#8E8E93',
    marginTop: 2,
  },
  menuGroup: {
    paddingHorizontal: 4,
  },
  menuItem: {
    height: 50,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  menuItemLabel: {
    fontSize: 15.5,
    fontWeight: '400',
    color: '#F4F4F5',
    letterSpacing: -0.15,
  },
  countPill: {
    minWidth: 24,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyStatusText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#71717A',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 10,
    marginBottom: 8,
  },
  devItem: {
    height: 48,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  devItemLabel: {
    fontSize: 15,
    fontWeight: '400',
    color: '#71717A',
    letterSpacing: -0.1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 16,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  versionBlock: {
    flex: 1,
    gap: 5,
  },
  versionTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  versionBrand: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#F4F4F5',
    letterSpacing: -0.1,
  },
  versionText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#71717A',
  },
  versionStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2BA640',
  },
  statusDotUpdate: {
    backgroundColor: '#EF233C',
  },
  versionStatusText: {
    fontSize: 12.5,
    fontWeight: '400',
    color: '#8E8E93',
    flexShrink: 1,
  },
  versionStatusTextUpdate: {
    color: '#D4D4D8',
  },
  updatePillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#C81428',
    borderRadius: 15,
    height: 30,
    paddingHorizontal: 12,
  },
  updateRightActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  footerRefreshButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SideDrawerMenu;
