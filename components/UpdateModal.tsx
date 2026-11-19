import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  AudioLines,
  Check,
  Code2,
  Download,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react-native';
import {
  cancelBackgroundUpdateDownload,
  canRequestPackageInstalls,
  downloadUpdateApk,
  getUpdateDownloadState,
  InstalledAppVersion,
  installUpdateApk,
  normalizeVersionName,
  openInstallPermissionSettings,
  RemoteReleaseInfo,
  startBackgroundUpdateDownload,
  subscribeUpdateDownload,
  supportsBackgroundUpdateDownload,
  UpdateDownloadState,
} from '../services/updater';
import { useBackModalLock } from '../services/backNavigation';
import { isDevMenuEnabled } from './DevMenuModal';
import { useBottomSheetController } from './sheetMotion';

export interface UpdateModalProps {
  visible: boolean;
  release: RemoteReleaseInfo | null;
  installedVersion: InstalledAppVersion | null;
  isChecking?: boolean;
  checkError?: string | null;
  autoInstallOnOpen?: boolean;
  onCheckNow?: () => void;
  onClose: () => void;
  onSkipVersion?: (versionName: string) => void;
}

type UpdateStage =
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'permission_required'
  | 'error'
  | 'simulated_installed';

const SIMULATED_DOWNLOAD_DURATION_MS = 5000;
const SIMULATED_DOWNLOAD_TICK_MS = 250;

const DEFAULT_RELEASE_NOTES =
  'Melhorias de desempenho, estabilidade e correções de áudio.';

interface ParsedNoteItem {
  text: string;
  isBullet: boolean;
}

function formatMegabytes(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseReleaseNotes(raw?: string | null): ParsedNoteItem[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return [{ text: DEFAULT_RELEASE_NOTES, isBullet: false }];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 1 && !/^[-*•]\s+/.test(lines[0])) {
    return [{ text: trimmed, isBullet: false }];
  }

  const hasExplicitBullets = lines.some((line) => /^[-*•]\s+/.test(line));
  return lines.map((line) => {
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      return { text: bulletMatch[1], isBullet: true };
    }
    return { text: line, isBullet: !hasExplicitBullets };
  });
}

function renderBulletIcon(text: string): React.ReactNode {
  if (/áudio|audio|player|som|reprodução|música/i.test(text)) {
    return <AudioLines color="#D63344" size={16} />;
  }
  if (/desempenho|rápid|velocidade|carregamento|performance|memória|bateria/i.test(text)) {
    return <Zap color="#D63344" size={16} />;
  }
  return <Sparkles color="#D63344" size={16} />;
}

function buildSimulatedRelease(installedVersion: InstalledAppVersion | null): RemoteReleaseInfo {
  const base = (installedVersion?.versionName || '1.0.0').trim().replace(/^v/i, '');
  const parts = base.split('.').map((n) => parseInt(n, 10));
  const nextVersion =
    parts.length >= 3 && parts.every((n) => Number.isFinite(n))
      ? `${parts[0]}.${parts[1]}.${parts[2] + 1}`
      : '9.9.9';

  return {
    versionName: nextVersion,
    versionCode: (installedVersion?.versionCode ?? 1) + 1,
    apkName: `sonary-pro-v${nextVersion}.apk`,
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/latest',
    sha256: null,
    sizeBytes: Math.round(124.3 * 1024 * 1024),
    releaseNotes: [
      '- Áudio: Correções de estabilidade na reprodução',
      '- Desempenho: Carregamento mais rápido do app',
      '- Interface: Pequenos ajustes visuais',
    ].join('\n'),
    releaseUrl: 'https://github.com/appsonary/sonary_app/releases',
  };
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  release,
  installedVersion,
  isChecking = false,
  checkError = null,
  autoInstallOnOpen = false,
  onCheckNow,
  onClose,
  onSkipVersion,
}) => {
  useBackModalLock(visible);
  const isDev = isDevMenuEnabled();
  const [stage, setStage] = useState<UpdateStage>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const [simulatedRelease, setSimulatedRelease] = useState<RemoteReleaseInfo | null>(null);
  const resumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const cancelledRef = useRef(false);
  const simTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSimulatingDownloadRef = useRef(false);
  const effectiveRelease = release ?? (isDev ? simulatedRelease : null);
  const isSimulated = Boolean(!release && isDev && simulatedRelease);

  const clearSimulationTimer = useCallback(() => {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    isSimulatingDownloadRef.current = false;
  }, []);

  useEffect(() => clearSimulationTimer, [clearSimulationTimer]);

  const {
    translateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
    panResponder,
  } = useBottomSheetController({
    visible,
    onClose,
    initialOffset: 380,
    dismissOffset: 440,
  });

  const tryInstallUri = useCallback(async (uri: string) => {
    try {
      const result = await installUpdateApk(uri);
      if (result === 'permission_required') {
        setStage('permission_required');
        return;
      }
      setStage('idle');
      dismissSheet();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível abrir o instalador.');
      setStage('error');
    }
  }, [dismissSheet]);

  const applyNativeDownloadState = useCallback(
    (state: UpdateDownloadState, autoInstallIfForeground: boolean) => {
      const targetVersion = effectiveRelease?.versionName
        ? normalizeVersionName(effectiveRelease.versionName)
        : null;
      const stateVersion = state.versionName ? normalizeVersionName(state.versionName) : null;
      if (targetVersion && stateVersion && targetVersion !== stateVersion) {
        return;
      }

      if (state.status === 'downloading') {
        setStage('downloading');
        setProgress(Math.round(state.progress * 100));
        setErrorMsg(null);
      } else if (state.status === 'ready' && state.localUri) {
        setDownloadedUri(state.localUri);
        setProgress(100);
        setErrorMsg(null);
        setStage('ready');
        if (autoInstallIfForeground && AppState.currentState === 'active') {
          void tryInstallUri(state.localUri);
        }
      } else if (state.status === 'error') {
        setErrorMsg(state.error || 'Falha ao baixar atualização.');
        setStage('error');
      } else if (state.status === 'idle') {
        setStage((prev) => (prev === 'downloading' ? 'idle' : prev));
        setProgress(0);
      }
    },
    [effectiveRelease?.versionName, tryInstallUri]
  );

  const applyNativeDownloadStateRef = useRef(applyNativeDownloadState);
  applyNativeDownloadStateRef.current = applyNativeDownloadState;

  useEffect(() => {
    if (!visible) {
      clearSimulationTimer();
      return;
    }
    cancelledRef.current = false;
    clearSimulationTimer();
    setSimulatedRelease(null);
    resumableRef.current = null;

    if (!supportsBackgroundUpdateDownload()) {
      setStage('idle');
      setProgress(0);
      setErrorMsg(null);
      setDownloadedUri(null);
      return;
    }

    let active = true;
    void getUpdateDownloadState().then((state) => {
      if (!active) return;
      const targetVersion = release?.versionName ? normalizeVersionName(release.versionName) : null;
      const stateVersion = state.versionName ? normalizeVersionName(state.versionName) : null;
      if (state.status === 'idle' || (targetVersion && stateVersion && targetVersion !== stateVersion)) {
        setStage('idle');
        setProgress(0);
        setErrorMsg(null);
        setDownloadedUri(null);
        return;
      }
      applyNativeDownloadStateRef.current(state, autoInstallOnOpen);
    });

    return () => {
      active = false;
    };
  }, [visible, release?.versionName, autoInstallOnOpen]);

  useEffect(() => {
    if (!visible || !supportsBackgroundUpdateDownload()) return;
    return subscribeUpdateDownload((state) => {
      applyNativeDownloadState(state, true);
    });
  }, [visible, applyNativeDownloadState]);

  useEffect(() => {
    if (!visible || stage !== 'permission_required' || !downloadedUri) return;
    const sub = AppState.addEventListener?.('change', (nextState) => {
      if (nextState === 'active') {
        void canRequestPackageInstalls().then((allowed) => {
          if (allowed) {
            void tryInstallUri(downloadedUri);
          }
        });
      }
    });
    return () => {
      sub?.remove?.();
    };
  }, [visible, stage, downloadedUri, tryInstallUri]);

  if (!visible) return null;

  const handleStartUpdate = async () => {
    if (!effectiveRelease || stage === 'downloading') return;
    if (isSimulated) {
      handleSimulateDownloadAndInstall();
      return;
    }
    if (downloadedUri) {
      await tryInstallUri(downloadedUri);
      return;
    }

    cancelledRef.current = false;
    setStage('downloading');
    setProgress(0);
    setErrorMsg(null);

    if (supportsBackgroundUpdateDownload()) {
      try {
        await startBackgroundUpdateDownload(effectiveRelease);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Falha ao iniciar download em segundo plano.');
        setStage('error');
      }
      return;
    }

    try {
      const { localUri } = await downloadUpdateApk(
        effectiveRelease,
        (ratio) => setProgress(Math.round(ratio * 100)),
        {
          shouldAbort: () => cancelledRef.current,
          onResumableCreated: (r) => {
            resumableRef.current = r;
          },
        }
      );
      resumableRef.current = null;
      if (cancelledRef.current) return;
      setDownloadedUri(localUri);
      await tryInstallUri(localUri);
    } catch (err) {
      resumableRef.current = null;
      if (cancelledRef.current) {
        setStage('idle');
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao baixar atualização.');
      setStage('error');
    }
  };

  const handleSimulateDownloadAndInstall = () => {
    if (!isDev || !effectiveRelease || stage === 'downloading') return;
    clearSimulationTimer();
    cancelledRef.current = false;
    isSimulatingDownloadRef.current = true;
    setStage('downloading');
    setProgress(0);
    setErrorMsg(null);

    const totalSteps = Math.max(1, Math.round(SIMULATED_DOWNLOAD_DURATION_MS / SIMULATED_DOWNLOAD_TICK_MS));
    let step = 0;
    simTimerRef.current = setInterval(() => {
      step += 1;
      const nextPct = Math.min(100, Math.round((step / totalSteps) * 100));
      setProgress(nextPct);
      if (step >= totalSteps) {
        clearSimulationTimer();
        setStage('simulated_installed');
      }
    }, SIMULATED_DOWNLOAD_TICK_MS);
    if (typeof (simTimerRef.current as any)?.unref === 'function') {
      (simTimerRef.current as any).unref();
    }
  };

  const handleCancelDownload = () => {
    cancelledRef.current = true;
    if (isSimulatingDownloadRef.current) {
      clearSimulationTimer();
      setStage('idle');
      setProgress(0);
      return;
    }
    if (supportsBackgroundUpdateDownload()) {
      void cancelBackgroundUpdateDownload().catch(() => {});
    } else {
      const r = resumableRef.current;
      if (r && typeof r.cancelAsync === 'function') {
        void r.cancelAsync().catch(() => {});
      }
    }
    setStage('idle');
    setProgress(0);
  };

  const sizeLabel = formatMegabytes(effectiveRelease?.sizeBytes);
  const parsedNotes = effectiveRelease ? parseReleaseNotes(effectiveRelease.releaseNotes) : [];

  const handleOpenReleaseUrl = async () => {
    const url = effectiveRelease?.releaseUrl;
    if (!url) return;
    try {
      const canOpen =
        typeof Linking.canOpenURL === 'function' ? await Linking.canOpenURL(url) : true;
      if (canOpen && typeof Linking.openURL === 'function') {
        await Linking.openURL(url);
      }
    } catch {
      // Ignora falha ao abrir navegador externo
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      animationType="none"
      onShow={onModalShow}
      onRequestClose={() => dismissSheet()}
    >
      <Animated.View style={{ flex: 1, opacity: backdropOpacity }}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => {
            if (stage !== 'downloading' || supportsBackgroundUpdateDownload()) {
              dismissSheet();
            }
          }}
        >
          <Animated.View
            renderToHardwareTextureAndroid
            style={[styles.container, { transform: [{ translateY }] }]}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e?.stopPropagation?.()}
          >
            {effectiveRelease && (
              <View style={styles.sheetTopGlow} pointerEvents="none">
                <Svg width="100%" height="100%">
                  <Defs>
                    <RadialGradient
                      id="sheetBadgeGlow"
                      cx="48"
                      cy="56"
                      rx="130"
                      ry="100"
                      fx="48"
                      fy="56"
                      gradientUnits="userSpaceOnUse"
                    >
                      <Stop offset="0%" stopColor="#DC2626" stopOpacity="0.34" />
                      <Stop offset="45%" stopColor="#991B1B" stopOpacity="0.14" />
                      <Stop offset="100%" stopColor="#131315" stopOpacity="0" />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheetBadgeGlow)" />
                </Svg>
              </View>
            )}

            <View style={styles.dragArea} {...panResponder.panHandlers}>
              <View style={styles.dragHandle} />
            </View>

            {effectiveRelease ? (
              <>
                <View style={styles.header}>
                  <View style={styles.badgeWrapper}>
                    <View style={styles.badgeAura} pointerEvents="none">
                      <Svg width="100%" height="100%">
                        <Defs>
                          <RadialGradient id="badgeAura" cx="50%" cy="50%" r="50%">
                            <Stop offset="0%" stopColor="#EF4444" stopOpacity="0.55" />
                            <Stop offset="55%" stopColor="#B91C1C" stopOpacity="0.22" />
                            <Stop offset="100%" stopColor="#B91C1C" stopOpacity="0" />
                          </RadialGradient>
                        </Defs>
                        <Rect x="0" y="0" width="100%" height="100%" fill="url(#badgeAura)" />
                      </Svg>
                    </View>
                    <View style={styles.badgeIcon}>
                      <Sparkles color="#FFFFFF" size={24} />
                    </View>
                  </View>
                  <View style={styles.headerText}>
                    <Text style={styles.title}>Atualização disponível</Text>
                    <View style={styles.subtitleRow}>
                      {installedVersion && (
                        <Text style={styles.subtitleText}>
                          {`v${installedVersion.versionName} →`}
                        </Text>
                      )}
                      <View style={styles.versionBadge}>
                        <Text style={styles.versionBadgeText}>{`v${effectiveRelease.versionName}`}</Text>
                      </View>
                      {sizeLabel && (
                        <Text style={styles.subtitleText}>{`• ${sizeLabel}`}</Text>
                      )}
                    </View>
                  </View>
                </View>

                <View style={styles.notesCard}>
                  <View style={styles.notesCardHeader}>
                    <Text style={styles.notesLabel}>NOVIDADES DA VERSÃO</Text>
                    {!!effectiveRelease.releaseUrl && (
                      <TouchableOpacity
                        onPress={() => void handleOpenReleaseUrl()}
                        activeOpacity={0.75}
                        accessibilityRole="link"
                        accessibilityLabel="Ver novidades no GitHub"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.githubLink}>Ver no GitHub ↗</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <ScrollView
                    style={styles.notesScroll}
                    contentContainerStyle={styles.notesContent}
                    nestedScrollEnabled={true}
                    showsVerticalScrollIndicator={false}
                  >
                    {parsedNotes.map((item, idx) =>
                      item.isBullet ? (
                        <View key={`${idx}-${item.text}`} style={styles.noteBulletRow}>
                          <View style={styles.noteBulletIcon}>
                            {renderBulletIcon(item.text)}
                          </View>
                          <Text style={styles.noteItemText}>{item.text}</Text>
                        </View>
                      ) : (
                        <Text key={`${idx}-${item.text}`} style={styles.notesText}>
                          {item.text}
                        </Text>
                      )
                    )}
                  </ScrollView>
                </View>

                {stage === 'downloading' && (
                  <View style={styles.statusBox}>
                    <View style={styles.progressHeader}>
                      <ActivityIndicator size="small" color="#E11D48" />
                      <Text style={styles.statusText}>
                        {`Baixando APK oficial do GitHub... ${progress}%`}
                      </Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                  </View>
                )}

                {stage === 'permission_required' && (
                  <View style={styles.permissionBox}>
                    <ShieldCheck color="#FFC107" size={18} />
                    <Text style={styles.permissionText}>
                      Autorize &quot;Instalar apps desconhecidos&quot; para o Sonary nas configurações do Android para concluir a atualização.
                    </Text>
                  </View>
                )}

                {stage === 'error' && errorMsg && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                )}

                {stage === 'simulated_installed' && (
                  <View style={styles.simulatedSuccessBox}>
                    <Check color="#4ADE80" size={18} strokeWidth={2.5} />
                    <Text style={styles.simulatedSuccessText}>
                      {`Atualização v${effectiveRelease.versionName} instalada com sucesso (simulação dev).`}
                    </Text>
                  </View>
                )}

                <View style={styles.actions}>
                  {stage === 'downloading' ? (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={handleCancelDownload}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Cancelar download da atualização"
                    >
                      <Text style={styles.secondaryButtonText}>Cancelar download</Text>
                    </TouchableOpacity>
                  ) : stage === 'simulated_installed' ? (
                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => dismissSheet()}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel="Fechar após instalação simulada"
                    >
                      <Text style={styles.primaryButtonText}>Fechar</Text>
                    </TouchableOpacity>
                  ) : stage === 'permission_required' ? (
                    <>
                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={() => void openInstallPermissionSettings()}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Permitir instalação nas configurações"
                      >
                        <ShieldCheck color="#030303" size={18} />
                        <Text style={styles.primaryButtonText}>Abrir configurações</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => downloadedUri && void tryInstallUri(downloadedUri)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Tentar instalar novamente"
                      >
                        <RefreshCw color="#FFFFFF" size={16} />
                        <Text style={styles.secondaryButtonText}>Já autorizei, instalar</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={() => void handleStartUpdate()}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Atualizar agora"
                      >
                        <Download color="#030303" size={18} />
                        <Text style={styles.primaryButtonText}>
                          {stage === 'ready'
                            ? 'Instalar atualização'
                            : stage === 'error'
                              ? 'Tentar novamente'
                              : sizeLabel
                                ? `Atualizar agora (${sizeLabel})`
                                : 'Atualizar agora'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => dismissSheet()}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Atualizar depois"
                      >
                        <Text style={styles.secondaryButtonText}>Lembrar mais tarde</Text>
                      </TouchableOpacity>

                      {onSkipVersion && (
                        <View style={styles.skipRow}>
                          <TouchableOpacity
                            style={styles.skipButton}
                            onPress={() => {
                              if (isSimulated) {
                                setSimulatedRelease(null);
                              } else {
                                onSkipVersion(effectiveRelease.versionName);
                              }
                              dismissSheet();
                            }}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel="Ignorar esta versão"
                          >
                            <Text style={styles.skipButtonText}>Pular esta versão</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </>
                  )}
                </View>
              </>
            ) : (
              <>
                {isChecking || checkError ? (
                  <>
                    <View style={styles.header}>
                      <View style={styles.badgeIcon}>
                        <RefreshCw color="#FFFFFF" size={22} />
                      </View>
                      <View style={styles.headerText}>
                        <Text style={styles.title}>
                          {isChecking ? 'Verificando atualizações...' : 'Falha ao verificar'}
                        </Text>
                        <Text style={[styles.subtitleText, { marginTop: 4 }]}>
                          {installedVersion
                            ? `Versão atual: v${installedVersion.versionName}`
                            : isChecking
                              ? 'Consultando GitHub Releases'
                              : 'Não foi possível consultar o GitHub'}
                        </Text>
                      </View>
                    </View>

                    {isChecking ? (
                      <View style={styles.statusBox}>
                        <View style={styles.progressHeader}>
                          <ActivityIndicator size="small" color="#E11D48" />
                          <Text style={styles.statusText}>
                            Buscando a versão mais recente no GitHub...
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{checkError}</Text>
                      </View>
                    )}

                    <View style={styles.actions}>
                      {checkError && onCheckNow && (
                        <TouchableOpacity
                          style={styles.primaryButton}
                          onPress={onCheckNow}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel="Tentar verificar atualizações novamente"
                        >
                          <RefreshCw color="#030303" size={18} />
                          <Text style={styles.primaryButtonText}>Tentar novamente</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={checkError && onCheckNow ? styles.secondaryButton : styles.primaryButton}
                        onPress={() => dismissSheet()}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Fechar menu de atualizações"
                      >
                        <Text
                          style={
                            checkError && onCheckNow
                              ? styles.secondaryButtonText
                              : styles.primaryButtonText
                          }
                        >
                          Fechar
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.upToDateHeader}>
                      <View style={styles.upToDateIcon}>
                        <Check color="#4ADE80" size={20} strokeWidth={2.5} />
                      </View>
                      <View style={styles.headerText}>
                        <Text style={styles.upToDateTitle}>App atualizado</Text>
                        <Text style={styles.upToDateSubtitle}>
                          {'Você já está na versão mais recente'}
                          {installedVersion ? (
                            <Text style={styles.upToDateVersion}>
                              {` (v${installedVersion.versionName})`}
                            </Text>
                          ) : null}
                          {'.'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.upToDateActions}>
                      {onCheckNow && (
                        <TouchableOpacity
                          style={styles.upToDateSecondaryBtn}
                          onPress={onCheckNow}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                          accessibilityLabel="Verificar atualizações novamente"
                        >
                          <RefreshCw color="#E4E4E7" size={16} />
                          <Text style={styles.upToDateSecondaryText}>Verificar</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.upToDatePrimaryBtn}
                        onPress={() => dismissSheet()}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Fechar menu de atualizações"
                      >
                        <Text style={styles.upToDatePrimaryText}>Fechar</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {isDev && !isChecking && (
                  <View style={styles.devSimulateRow}>
                    <TouchableOpacity
                      style={styles.devSimulateLink}
                      onPress={() => setSimulatedRelease(buildSimulatedRelease(installedVersion))}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Simular atualização disponível"
                    >
                      <Code2 color="#8E8E93" size={13} />
                      <Text style={styles.devSimulateLinkText}>
                        Simular atualização disponível
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#131315',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    marginBottom: -72,
    paddingBottom: 96,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  sheetTopGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  dragArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 14,
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  badgeWrapper: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badgeAura: {
    position: 'absolute',
    width: 92,
    height: 92,
    top: -20,
    left: -20,
  },
  badgeIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#A91B29',
    borderWidth: 1,
    borderColor: 'rgba(255, 130, 145, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upToDateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 22,
  },
  upToDateIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(43, 166, 64, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upToDateTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  upToDateSubtitle: {
    color: '#9A9AA4',
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 3,
  },
  upToDateVersion: {
    color: '#E4E4E7',
    fontWeight: '600',
  },
  upToDateActions: {
    flexDirection: 'row',
    gap: 10,
  },
  upToDateSecondaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 9999,
    backgroundColor: '#232327',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  upToDateSecondaryText: {
    color: '#E4E4E7',
    fontSize: 14.5,
    fontWeight: '600',
  },
  upToDatePrimaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upToDatePrimaryText: {
    color: '#111113',
    fontSize: 14.5,
    fontWeight: '700',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  subtitleText: {
    color: '#9A9AA4',
    fontSize: 13.5,
    fontWeight: '500',
  },
  versionBadge: {
    backgroundColor: 'rgba(190, 45, 62, 0.28)',
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  versionBadgeText: {
    color: '#F4A3AC',
    fontSize: 13,
    fontWeight: '600',
  },
  notesCard: {
    backgroundColor: '#19191D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 20,
  },
  notesCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  notesLabel: {
    color: '#8E8E98',
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  githubLink: {
    color: '#B8B8C2',
    fontSize: 12.5,
    fontWeight: '500',
  },
  notesScroll: {
    maxHeight: 164,
  },
  notesContent: {
    gap: 13,
  },
  noteBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  noteBulletIcon: {
    width: 18,
    alignItems: 'center',
    marginTop: 2,
  },
  noteItemText: {
    flex: 1,
    color: '#ECECF0',
    fontSize: 13.5,
    lineHeight: 20,
  },
  notesText: {
    color: '#ECECF0',
    fontSize: 13.5,
    lineHeight: 20,
  },
  statusBox: {
    backgroundColor: '#1C1C20',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
    gap: 10,
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#E11D48',
    borderRadius: 3,
  },
  permissionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.35)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  permissionText: {
    flex: 1,
    color: '#FFE082',
    fontSize: 12.5,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.35)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#FF8A80',
    fontSize: 12.5,
    lineHeight: 18,
  },
  simulatedSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.35)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  simulatedSuccessText: {
    flex: 1,
    color: '#BBF7D0',
    fontSize: 12.5,
    lineHeight: 18,
  },
  actions: {
    gap: 12,
  },
  primaryButton: {
    height: 50,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#111113',
    fontSize: 15.5,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 50,
    borderRadius: 9999,
    backgroundColor: '#232327',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    color: '#F4F4F6',
    fontSize: 15,
    fontWeight: '600',
  },
  skipRow: {
    alignItems: 'center',
    paddingTop: 4,
  },
  skipButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  skipButtonText: {
    color: '#9A9AA4',
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  devSimulateRow: {
    alignItems: 'center',
    paddingTop: 12,
  },
  devSimulateLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  devSimulateLinkText: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});

export default UpdateModal;
