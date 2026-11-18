import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Download, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react-native';
import {
  canRequestPackageInstalls,
  downloadUpdateApk,
  InstalledAppVersion,
  installUpdateApk,
  openInstallPermissionSettings,
  RemoteReleaseInfo,
} from '../services/updater';
import { useBackModalLock } from '../services/backNavigation';
import { useBottomSheetController } from './sheetMotion';
import { theme } from '../theme';

export interface UpdateModalProps {
  visible: boolean;
  release: RemoteReleaseInfo | null;
  installedVersion: InstalledAppVersion | null;
  onClose: () => void;
  onSkipVersion?: (versionName: string) => void;
}

type UpdateStage = 'idle' | 'downloading' | 'permission_required' | 'error';

function formatMegabytes(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  release,
  installedVersion,
  onClose,
  onSkipVersion,
}) => {
  useBackModalLock(visible);
  const [stage, setStage] = useState<UpdateStage>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const resumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const cancelledRef = useRef(false);

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

  useEffect(() => {
    if (visible) {
      cancelledRef.current = false;
      setStage('idle');
      setProgress(0);
      setErrorMsg(null);
      setDownloadedUri(null);
      resumableRef.current = null;
    }
  }, [visible, release?.versionName]);

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

  if (!visible || !release) return null;

  const handleStartUpdate = async () => {
    if (stage === 'downloading') return;
    if (downloadedUri) {
      await tryInstallUri(downloadedUri);
      return;
    }

    cancelledRef.current = false;
    setStage('downloading');
    setProgress(0);
    setErrorMsg(null);

    try {
      const { localUri } = await downloadUpdateApk(
        release,
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

  const handleCancelDownload = () => {
    cancelledRef.current = true;
    const r = resumableRef.current;
    if (r && typeof r.cancelAsync === 'function') {
      void r.cancelAsync().catch(() => {});
    }
    setStage('idle');
    setProgress(0);
  };

  const sizeLabel = formatMegabytes(release.sizeBytes);

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
            if (stage !== 'downloading') dismissSheet();
          }}
        >
          <Animated.View
            renderToHardwareTextureAndroid
            style={[styles.container, { transform: [{ translateY }] }]}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e?.stopPropagation?.()}
          >
            <View style={styles.dragArea} {...panResponder.panHandlers}>
              <View style={styles.dragHandle} />
            </View>

            <View style={styles.header}>
              <View style={styles.badgeIcon}>
                <Sparkles color="#FFFFFF" size={18} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Nova versão disponível</Text>
                <Text style={styles.subtitle}>
                  {`v${release.versionName}${installedVersion ? ` (atual: v${installedVersion.versionName})` : ''}${sizeLabel ? ` • ${sizeLabel}` : ''}`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => {
                  if (stage === 'downloading') handleCancelDownload();
                  dismissSheet();
                }}
                accessibilityRole="button"
                accessibilityLabel="Fechar atualização"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X color="#FFFFFF" size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.notesScroll} contentContainerStyle={styles.notesContent}>
              <Text style={styles.notesLabel}>NOVIDADES DA RELEASE</Text>
              <Text style={styles.notesText}>
                {release.releaseNotes ||
                  'Melhorias de desempenho, estabilidade e correções de áudio.'}
              </Text>
            </ScrollView>

            {stage === 'downloading' && (
              <View style={styles.statusBox}>
                <View style={styles.progressHeader}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
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
                      {stage === 'error' ? 'Tentar novamente' : 'Atualizar agora'}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.secondaryRow}>
                    {onSkipVersion && (
                      <TouchableOpacity
                        style={styles.ghostButton}
                        onPress={() => {
                          onSkipVersion(release.versionName);
                          dismissSheet();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Ignorar esta versão"
                      >
                        <Text style={styles.ghostButtonText}>Pular versão</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.ghostButton}
                      onPress={() => dismissSheet()}
                      accessibilityRole="button"
                      accessibilityLabel="Atualizar depois"
                    >
                      <Text style={styles.ghostButtonText}>Mais tarde</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#141418',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 18,
    paddingBottom: 24,
    maxHeight: '80%',
  },
  dragArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 8,
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  badgeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesScroll: {
    maxHeight: 160,
    backgroundColor: '#0D0D10',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 14,
  },
  notesContent: {
    padding: 12,
    gap: 6,
  },
  notesLabel: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  notesText: {
    color: '#E4E4E7',
    fontSize: 13,
    lineHeight: 19,
  },
  statusBox: {
    backgroundColor: '#1C1C22',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 14,
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
    backgroundColor: '#FFFFFF',
  },
  permissionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  permissionText: {
    flex: 1,
    color: '#FFE082',
    fontSize: 12,
    lineHeight: 17,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    color: '#FF8A80',
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    gap: 10,
  },
  primaryButton: {
    height: 46,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#030303',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 44,
    borderRadius: 9999,
    backgroundColor: '#212126',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 2,
  },
  ghostButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  ghostButtonText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default UpdateModal;
