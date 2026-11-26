import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CloudUpload,
  Download,
  FileJson,
  HardDriveDownload,
  Heart,
  History,
  Info,
  ListMusic,
  Music2,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  exportBackupToFile,
  getLocalBackupSummary,
  ImportBackupMode,
  LocalBackupSummary,
  pickBackupFile,
  PickedBackupResult,
  restoreBackup,
  RestoreBackupResult,
  saveBackupToDevice,
} from '../services/backup';
import { useBackModalLock } from '../services/backNavigation';
import { useBottomSheetController } from './sheetMotion';
import { theme } from '../theme';

export interface BackupModalProps {
  visible: boolean;
  onClose: () => void;
  onBackupExported?: (fileName: string) => void;
  onBackupRestored?: (result: RestoreBackupResult) => void;
}

function formatDateTimePtBr(timestampMs: number): string {
  try {
    const d = new Date(timestampMs);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} às ${hh}:${min}`;
  } catch {
    return '';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Bottom sheet de Backup & Restauração (local-first).
 */
export const BackupModal: React.FC<BackupModalProps> = ({
  visible,
  onClose,
  onBackupExported,
  onBackupRestored,
}) => {
  useBackModalLock(visible);
  const {
    translateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
    panResponder,
  } = useBottomSheetController({
    visible,
    onClose,
    initialOffset: 420,
    dismissOffset: 480,
  });

  const [isSavingToDevice, setIsSavingToDevice] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [step, setStep] = useState<'home' | 'export'>('home');
  const [pickedBackup, setPickedBackup] = useState<PickedBackupResult | null>(null);
  const [localSummary, setLocalSummary] = useState<LocalBackupSummary | null>(null);
  const [importMode, setImportMode] = useState<ImportBackupMode>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [enqueueOffline, setEnqueueOffline] = useState(true);

  useEffect(() => {
    if (!visible) {
      setStep('home');
      setErrorMessage(null);
      setSuccessMessage(null);
      setPickedBackup(null);
      setImportMode('merge');
      setConfirmReplace(false);
      setEnqueueOffline(true);
      return;
    }
    let cancelled = false;
    void getLocalBackupSummary()
      .then((summary) => {
        if (!cancelled) setLocalSummary(summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible) return null;

  const isBusy = isSavingToDevice || isExporting || isPicking || isRestoring;

  const handleSaveToDevice = async () => {
    if (isBusy) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSavingToDevice(true);
    try {
      const result = await saveBackupToDevice();
      if (!result.shared) {
        return;
      }
      setSuccessMessage(
        `Backup ${result.fileName} (${formatBytes(result.sizeBytes)}) salvo no dispositivo.`
      );
      onBackupExported?.(result.fileName);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Não foi possível salvar o backup no dispositivo.'
      );
    } finally {
      setIsSavingToDevice(false);
    }
  };

  const handleExport = async () => {
    if (isBusy) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsExporting(true);
    try {
      const result = await exportBackupToFile();
      if (!result.shared) {
        setErrorMessage('Compartilhamento cancelado ou indisponível neste dispositivo.');
      }
      // Android Share Sheet não informa se o usuário enviou ou fechou; evita falso banner de sucesso
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Não foi possível compartilhar o backup.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handlePickFile = async () => {
    if (isBusy) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsPicking(true);
    try {
      const picked = await pickBackupFile();
      if (!picked) return;
      setPickedBackup(picked);
      setImportMode('merge');
      setConfirmReplace(false);
      setEnqueueOffline(picked.preview.offlineMissingCount > 0);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Arquivo de backup inválido ou corrompido.'
      );
    } finally {
      setIsPicking(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pickedBackup || isBusy) return;
    if (importMode === 'replace' && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsRestoring(true);
    try {
      const result = await restoreBackup(pickedBackup.backup, {
        mode: importMode,
        enqueueOfflineDownloads:
          enqueueOffline && pickedBackup.preview.offlineMissingCount > 0,
      });
      setPickedBackup(null);
      setConfirmReplace(false);
      onBackupRestored?.(result);
      dismissSheet();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Falha ao restaurar o backup.'
      );
    } finally {
      setIsRestoring(false);
    }
  };

  const handleCancelPreview = () => {
    if (isBusy) return;
    setPickedBackup(null);
    setConfirmReplace(false);
    setErrorMessage(null);
  };

  const handleOpenExportStep = () => {
    if (isBusy) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setStep('export');
  };

  const handleBackToHome = () => {
    if (isBusy) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setStep('home');
  };

  const headerTitle = pickedBackup
    ? 'Restaurar backup'
    : step === 'export'
      ? 'Fazer backup'
      : 'Backup e dados';

  const headerSubtitle = pickedBackup
    ? 'Confira o que será recuperado'
    : step === 'export'
      ? 'Escolha onde guardar sua cópia'
      : 'Proteja sua biblioteca';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onShow={onModalShow}
      onRequestClose={() => {
        if (isBusy) return;
        if (pickedBackup) {
          handleCancelPreview();
        } else if (step === 'export') {
          handleBackToHome();
        } else {
          dismissSheet();
        }
      }}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => {
              if (!isBusy) dismissSheet();
            }}
            accessibilityRole="button"
            accessibilityLabel="Fechar backup e dados"
          />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          testID="backup-modal-sheet"
        >
          <View style={styles.handleArea} {...(isBusy ? {} : panResponder.panHandlers)}>
            <View style={styles.handleBar} />
          </View>

          <View style={styles.header} {...(isBusy ? {} : panResponder.panHandlers)}>
            <View style={styles.headerLeft}>
              <LinearGradient
                colors={['#E62626', '#9A0C0C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.headerBadge}
              >
                <CloudUpload color="#FFFFFF" size={22} strokeWidth={2} />
              </LinearGradient>
              <View style={styles.headerInfo}>
                <Text style={styles.title}>{headerTitle}</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {headerSubtitle}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (!isBusy) dismissSheet();
              }}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              disabled={isBusy}
            >
              <X color="#FFFFFF" size={17} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {errorMessage && (
              <View style={styles.alertError} testID="backup-error-banner">
                <AlertTriangle color={theme.colors.danger} size={18} />
                <Text style={styles.alertErrorText}>{errorMessage}</Text>
              </View>
            )}

            {successMessage && (
              <View style={styles.alertSuccess} testID="backup-success-banner">
                <CheckCircle2 color={theme.colors.success} size={18} />
                <Text style={styles.alertSuccessText}>{successMessage}</Text>
              </View>
            )}

            {pickedBackup ? (
              <View style={styles.previewContainer} testID="backup-preview-panel">
                <View style={styles.fileHeader}>
                  <View style={styles.fileIconWrap}>
                    <FileJson color={theme.colors.brandPrimary} size={20} />
                  </View>
                  <View style={styles.fileHeaderText}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {pickedBackup.fileName}
                    </Text>
                    <Text style={styles.fileMeta}>
                      Salvo em {formatDateTimePtBr(pickedBackup.preview.exportedAt)} •{' '}
                      {formatBytes(pickedBackup.sizeBytes)}
                    </Text>
                  </View>
                </View>

                <View style={styles.statsCard}>
                  <View style={styles.statCol}>
                    <ListMusic color="#C8C8CE" size={17} />
                    <Text style={styles.statValue}>{pickedBackup.preview.userPlaylistCount}</Text>
                    <Text style={styles.statLabel}>Playlists</Text>
                  </View>
                  <View style={styles.statColDivider} />
                  <View style={styles.statCol}>
                    <Heart color="#E05252" size={17} />
                    <Text style={styles.statValue}>{pickedBackup.preview.favoritesCount}</Text>
                    <Text style={styles.statLabel}>Curtidas</Text>
                  </View>
                  <View style={styles.statColDivider} />
                  <View style={styles.statCol}>
                    <Music2 color="#C8C8CE" size={17} />
                    <Text style={styles.statValue}>{pickedBackup.preview.totalPlaylistTracks}</Text>
                    <Text style={styles.statLabel}>Faixas</Text>
                  </View>
                  <View style={styles.statColDivider} />
                  <View style={styles.statCol}>
                    <History color="#C8C8CE" size={17} />
                    <Text style={styles.statValue}>{pickedBackup.preview.playbackHistoryCount}</Text>
                    <Text style={styles.statLabel}>Histórico</Text>
                  </View>
                </View>

                {pickedBackup.preview.customCoverCount > 0 && (
                  <Text style={styles.extraMetaText}>
                    Inclui {pluralize(pickedBackup.preview.customCoverCount, 'capa personalizada', 'capas personalizadas')}.
                  </Text>
                )}

                <Text style={styles.sectionLabel}>Como deseja restaurar?</Text>
                <View style={styles.modeRow}>
                  <TouchableOpacity
                    style={[
                      styles.modeOption,
                      importMode === 'merge' && styles.modeOptionSelected,
                    ]}
                    onPress={() => {
                      setImportMode('merge');
                      setConfirmReplace(false);
                    }}
                    disabled={isBusy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: importMode === 'merge' }}
                    testID="backup-mode-merge"
                  >
                    <Text style={styles.modeTitle}>Somar com os dados atuais (Recomendado)</Text>
                    <Text style={styles.modeDesc}>
                      Mantém o que você já tem e adiciona o que vier do backup.
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modeOption,
                      importMode === 'replace' && styles.modeOptionDangerSelected,
                    ]}
                    onPress={() => {
                      setImportMode('replace');
                      setConfirmReplace(false);
                    }}
                    disabled={isBusy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: importMode === 'replace' }}
                    testID="backup-mode-replace"
                  >
                    <Text style={styles.modeTitle}>Substituir tudo</Text>
                    <Text style={styles.modeDesc}>
                      Troca suas playlists e histórico atuais pelos do backup.
                    </Text>
                  </TouchableOpacity>
                </View>

                {pickedBackup.preview.offlineMissingCount > 0 && (
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setEnqueueOffline((prev) => !prev)}
                    disabled={isBusy}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: enqueueOffline }}
                    testID="backup-enqueue-offline-toggle"
                  >
                    <View
                      style={[
                        styles.checkboxBox,
                        enqueueOffline && styles.checkboxBoxChecked,
                      ]}
                    >
                      {enqueueOffline && <Check color="#030303" size={14} strokeWidth={3} />}
                    </View>
                    <View style={styles.checkboxTextWrap}>
                      <Text style={styles.checkboxLabel}>
                        Re-baixar {pluralize(pickedBackup.preview.offlineMissingCount, 'música offline', 'músicas offline')}
                      </Text>
                      <Text style={styles.checkboxSublabel}>
                        Coloca na fila de downloads automaticamente em segundo plano.
                      </Text>
                    </View>
                    <HardDriveDownload color={theme.colors.textSecondary} size={18} />
                  </TouchableOpacity>
                )}

                {importMode === 'replace' && confirmReplace && (
                  <View style={styles.confirmDangerBox} testID="backup-replace-confirm-box">
                    <AlertTriangle color={theme.colors.danger} size={18} />
                    <Text style={styles.confirmDangerText}>
                      Confirmação: suas playlists atuais e histórico serão substituídos pelo
                      backup (as músicas já baixadas no celular continuam salvas). Toque
                      novamente para confirmar.
                    </Text>
                  </View>
                )}

                <View style={styles.footerActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={handleCancelPreview}
                    disabled={isBusy}
                    accessibilityRole="button"
                    accessibilityLabel="Voltar"
                  >
                    <Text style={styles.cancelBtnText}>Voltar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.restoreBtn,
                      importMode === 'replace' && styles.restoreBtnDanger,
                    ]}
                    onPress={handleConfirmRestore}
                    disabled={isBusy}
                    accessibilityRole="button"
                    accessibilityLabel="Restaurar backup"
                    testID="backup-confirm-restore-btn"
                  >
                    {isRestoring ? (
                      <ActivityIndicator
                        color={importMode === 'replace' ? '#FFFFFF' : '#030303'}
                        size="small"
                      />
                    ) : (
                      <>
                        <RefreshCw
                          color={importMode === 'replace' ? '#FFFFFF' : '#030303'}
                          size={16}
                        />
                        <Text
                          style={[
                            styles.restoreBtnText,
                            importMode === 'replace' && styles.restoreBtnTextDanger,
                          ]}
                        >
                          {importMode === 'replace' && confirmReplace
                            ? 'Confirmar substituição'
                            : 'Restaurar backup'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : step === 'export' ? (
              <View style={styles.exportStepContainer} testID="backup-export-step">
                <Text style={styles.leadDescription}>
                  Salve a cópia direto em uma pasta do celular ou envie para a nuvem para usar
                  quando precisar.
                </Text>

                <TouchableOpacity
                  style={styles.heroBtnTouchable}
                  onPress={handleSaveToDevice}
                  disabled={isBusy}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Salvar no celular"
                  testID="backup-save-device-btn"
                >
                  <LinearGradient
                    colors={['#EE2B2B', '#B80F0F']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.heroBtnGradient}
                  >
                    {isSavingToDevice ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <View style={styles.heroBtnTitleRow}>
                          <HardDriveDownload color="#FFFFFF" size={18} strokeWidth={2.2} />
                          <Text style={styles.heroBtnTitle}>Salvar no celular</Text>
                        </View>
                        <Text style={styles.heroBtnSubtitle}>
                          Escolher uma pasta do aparelho para baixar
                        </Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryHeroBtn}
                  onPress={handleExport}
                  disabled={isBusy}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel="Enviar cópia"
                  testID="backup-export-btn"
                >
                  {isExporting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <View style={styles.heroBtnTitleRow}>
                        <Share2 color="#FFFFFF" size={18} strokeWidth={2.2} />
                        <Text style={styles.heroBtnTitle}>Enviar cópia</Text>
                      </View>
                      <Text style={styles.secondaryHeroSubtitle}>
                        Google Drive, WhatsApp, e-mail ou Quick Share
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.backStepBtn}
                  onPress={handleBackToHome}
                  disabled={isBusy}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel="Voltar para opções de backup"
                  testID="backup-export-back-btn"
                >
                  <ArrowLeft color="#FFFFFF" size={16} />
                  <Text style={styles.backStepBtnText}>Voltar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.leadDescription}>
                  Guarde uma cópia das suas playlists, curtidas e histórico para não perder nada
                  ao trocar de celular.
                </Text>

                {localSummary && (
                  <View style={styles.statsCard} testID="backup-local-summary">
                    <View style={styles.statCol}>
                      <ListMusic color="#C8C8CE" size={18} />
                      <Text style={styles.statValue}>{localSummary.userPlaylistCount}</Text>
                      <Text style={styles.statLabel}>Playlists</Text>
                    </View>
                    <View style={styles.statColDivider} />
                    <View style={styles.statCol}>
                      <Heart color="#E05252" size={18} />
                      <Text style={styles.statValue}>{localSummary.favoritesCount}</Text>
                      <Text style={styles.statLabel}>Curtidas</Text>
                    </View>
                    <View style={styles.statColDivider} />
                    <View style={styles.statCol}>
                      <History color="#C8C8CE" size={18} />
                      <Text style={styles.statValue}>{localSummary.playbackHistoryCount}</Text>
                      <Text style={styles.statLabel}>Histórico</Text>
                    </View>
                  </View>
                )}

                <View style={styles.actionsGroup}>
                  <TouchableOpacity
                    style={styles.heroBtnTouchable}
                    onPress={handleOpenExportStep}
                    disabled={isBusy}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Fazer backup agora"
                    testID="backup-start-export-btn"
                  >
                    <LinearGradient
                      colors={['#EE2B2B', '#B80F0F']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.heroBtnGradient}
                    >
                      <View style={styles.heroBtnTitleRow}>
                        <CloudUpload color="#FFFFFF" size={19} strokeWidth={2.2} />
                        <Text style={styles.heroBtnTitle}>Fazer backup agora</Text>
                      </View>
                      <Text style={styles.heroBtnSubtitle}>Salvar cópia de segurança</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryHeroBtn}
                    onPress={handlePickFile}
                    disabled={isBusy}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="Restaurar backup"
                    testID="backup-import-btn"
                  >
                    {isPicking ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <View style={styles.heroBtnTitleRow}>
                          <Download color="#FFFFFF" size={19} strokeWidth={2.2} />
                          <Text style={styles.heroBtnTitle}>Restaurar backup</Text>
                        </View>
                        <Text style={styles.secondaryHeroSubtitle}>
                          Recuperar de um backup salvo
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.footnoteRow}>
                  <Info color="#8E8E96" size={14} style={styles.footnoteIcon} />
                  <Text style={styles.footnote}>
                    Músicas offline não entram no backup e podem ser re-baixadas automaticamente
                    ao restaurar.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  sheet: {
    backgroundColor: '#181818',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '88%',
    paddingBottom: 24,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.75,
    shadowRadius: 20,
    elevation: 24,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 10,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.32)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    flex: 1,
    marginRight: 12,
  },
  headerBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 160, 0.28)',
    shadowColor: '#FF1A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    color: '#B3B3B8',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    maxHeight: 560,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 16,
  },
  leadDescription: {
    color: '#B8B8BE',
    fontSize: 13.5,
    lineHeight: 19,
  },
  alertError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.35)',
  },
  alertErrorText: {
    flex: 1,
    color: '#FFB4B0',
    fontSize: 13,
    lineHeight: 18,
  },
  alertSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(43, 166, 64, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(43, 166, 64, 0.38)',
  },
  alertSuccessText: {
    flex: 1,
    color: '#A7F3B5',
    fontSize: 13,
    lineHeight: 18,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statColDivider: {
    width: 1,
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  statLabel: {
    color: '#9E9EA6',
    fontSize: 12,
    fontWeight: '500',
  },
  exportStepContainer: {
    gap: 12,
  },
  heroBtnTouchable: {
    borderRadius: 16,
    shadowColor: '#FF1A1A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 10,
  },
  heroBtnGradient: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 145, 145, 0.32)',
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 62,
  },
  heroBtnTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroBtnTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  heroBtnSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
  },
  secondaryHeroBtn: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 62,
  },
  secondaryHeroSubtitle: {
    color: '#A0A0A8',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
  },
  backStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 4,
  },
  backStepBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  actionsGroup: {
    gap: 12,
  },
  footnoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  footnoteIcon: {
    marginTop: 2,
  },
  footnote: {
    flexShrink: 1,
    color: '#8E8E96',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  previewContainer: {
    gap: 14,
  },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#242424',
  },
  fileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 0, 0, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileHeaderText: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  fileMeta: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  extraMetaText: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  sectionLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  modeRow: {
    gap: 8,
  },
  modeOption: {
    padding: 13,
    borderRadius: 12,
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    gap: 3,
  },
  modeOptionSelected: {
    borderColor: '#FFFFFF',
    backgroundColor: '#2A2A2A',
  },
  modeOptionDangerSelected: {
    borderColor: theme.colors.danger,
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
  },
  modeTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modeDesc: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderRadius: 12,
    backgroundColor: '#222222',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#AAAAAA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  checkboxTextWrap: {
    flex: 1,
    gap: 2,
  },
  checkboxLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  checkboxSublabel: {
    color: '#AAAAAA',
    fontSize: 11,
  },
  confirmDangerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 78, 69, 0.45)',
  },
  confirmDangerText: {
    flex: 1,
    color: '#FFD0CD',
    fontSize: 12,
    lineHeight: 17,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  restoreBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  restoreBtnDanger: {
    backgroundColor: theme.colors.danger,
  },
  restoreBtnText: {
    color: '#030303',
    fontSize: 14,
    fontWeight: '700',
  },
  restoreBtnTextDanger: {
    color: '#FFFFFF',
  },
});

export default BackupModal;
