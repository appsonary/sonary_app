import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Check, Copy, RefreshCw } from 'lucide-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { theme } from '../theme';
import {
  PIX_CONFIG,
  PIX_PRESET_OPTIONS,
  PixPresetId,
  buildPixPayload,
  buildQrMatrix,
  copyTextToClipboard,
  formatPixAmountBrl,
  parsePixAmount,
  qrMatrixToSvgPath,
} from '../services/pixMock';
import { snoozeSupportNotificationsUntilNextMonth } from '../services/database';

export interface SupportSectionProps {
  onShowToast?: (message: string) => void;
  onPixCopied?: () => void;
  appVersion?: string;
  onCheckUpdates?: () => void;
  isCheckingUpdates?: boolean;
  hasAvailableUpdate?: boolean;
}

export const SupportSection: React.FC<SupportSectionProps> = ({
  onShowToast,
  onPixCopied,
  appVersion,
  onCheckUpdates,
  isCheckingUpdates = false,
  hasAvailableUpdate = false,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<PixPresetId>('5');
  const [customAmountText, setCustomAmountText] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const selectedAmount = useMemo(() => {
    if (selectedPreset === 'other') {
      return parsePixAmount(customAmountText);
    }
    const preset = PIX_PRESET_OPTIONS.find((opt) => opt.id === selectedPreset);
    return preset ? preset.amount : 5;
  }, [selectedPreset, customAmountText]);

  const pixPayload = useMemo(
    () => buildPixPayload(selectedAmount),
    [selectedAmount]
  );

  // Em "Outro" sem valor digitado, copia apenas a chave Pix aleatória (como definido pelo banco).
  const isKeyOnlyCopy = selectedPreset === 'other' && selectedAmount === null;
  const copyPayload = isKeyOnlyCopy ? PIX_CONFIG.pixKey : pixPayload;
  const ctaDefaultLabel = isKeyOnlyCopy ? 'Copiar chave Pix' : 'Copiar código Pix';
  const ctaCopiedLabel = isKeyOnlyCopy ? 'Chave copiada!' : 'Código copiado!';
  const copyToastMessage = isKeyOnlyCopy ? 'Chave Pix copiada!' : 'Código Pix copiado!';

  const { qrSize, qrSvgPath } = useMemo(() => {
    const matrix = buildQrMatrix(pixPayload);
    return {
      qrSize: matrix.length,
      qrSvgPath: qrMatrixToSvgPath(matrix),
    };
  }, [pixPayload]);

  const amountBadgeText = formatPixAmountBrl(selectedAmount);

  const copyAndSnooze = async (text: string, toastMessage: string, markMainButton: boolean) => {
    await copyTextToClipboard(text);
    await snoozeSupportNotificationsUntilNextMonth().catch(() => {});
    onPixCopied?.();
    if (markMainButton) {
      setCopied(true);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      const timer = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
      if (timer && typeof (timer as any).unref === 'function') {
        (timer as any).unref();
      }
      copyTimerRef.current = timer;
    }
    onShowToast?.(toastMessage);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Cabeçalho */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PROJETO INDEPENDENTE</Text>
          <Text style={styles.title}>Apoie o Sonary</Text>
          <Text style={styles.subtitle}>
            100% gratuito e sem anúncios. Sua contribuição ajuda a manter o
            desenvolvimento vivo.
          </Text>
        </View>

        {/* Chips de Valor Sugerido */}
        <View style={styles.chipsSection}>
          <View style={styles.chipsRow}>
            {PIX_PRESET_OPTIONS.map((option) => {
              const isSelected = selectedPreset === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => {
                    setSelectedPreset(option.id);
                    setCopied(false);
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`Valor ${option.label}`}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {selectedPreset === 'other' && (
            <View style={styles.customAmountBox}>
              <TextInput
                style={styles.customAmountInput}
                value={customAmountText}
                onChangeText={(txt) => {
                  setCustomAmountText(txt);
                  setCopied(false);
                }}
                placeholder="Digite o valor em R$ (opcional)"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Valor personalizado para apoio"
              />
              <Text style={styles.customAmountHint}>
                Se preferir deixar em branco, você define qualquer valor
                diretamente no app do seu banco.
              </Text>
            </View>
          )}
        </View>

        {/* Card Pix para contribuir */}
        <View style={styles.pixCard}>
          <View style={styles.pixCardHeader}>
            <View style={styles.pixCardTitleRow}>
              <MaterialCommunityIcons
                name="hand-heart"
                color={theme.colors.brandPrimary}
                size={18}
              />
              <Text style={styles.pixCardTitle}>Pix para contribuir</Text>
            </View>
            <View style={styles.amountPill}>
              <Text style={styles.amountPillText}>{amountBadgeText}</Text>
            </View>
          </View>

          {/* QR Code real escaneável em superfície branca */}
          <View style={styles.qrFrame}>
            <Svg
              width={188}
              height={188}
              viewBox={`0 0 ${qrSize} ${qrSize}`}
              testID="support-qr-code"
              accessibilityLabel={`QR Code Pix para ${amountBadgeText}`}
            >
              <Path d={qrSvgPath} fill={theme.colors.textInverse} />
            </Svg>
          </View>

          {/* Instrução discreta sem expor dados/chave na tela */}
          <Text style={styles.qrInstruction}>
            {isKeyOnlyCopy
              ? 'Escaneie o QR Code acima ou copie a chave Pix aleatória abaixo para transferir qualquer valor no app do seu banco.'
              : 'Escaneie o QR Code acima ou toque abaixo para copiar o Pix Copia e Cola no app do seu banco.'}
          </Text>

          {/* Botão CTA Principal */}
          <TouchableOpacity
            style={[styles.ctaButton, copied && styles.ctaButtonCopied]}
            onPress={() => copyAndSnooze(copyPayload, copyToastMessage, true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={copied ? ctaCopiedLabel : ctaDefaultLabel}
          >
            {copied ? (
              <Check color="#FFFFFF" size={18} strokeWidth={2.5} />
            ) : (
              <Copy color="#FFFFFF" size={18} strokeWidth={2.2} />
            )}
            <Text style={styles.ctaButtonText}>
              {copied ? ctaCopiedLabel : ctaDefaultLabel}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Rodapé de Transparência */}
        <Text style={styles.transparencyFooter}>
          Contribuição voluntária • Sem cobrança recorrente • Acesso livre para
          todos
        </Text>

        {typeof onCheckUpdates === 'function' && (
          <TouchableOpacity
            style={styles.updateButton}
            onPress={onCheckUpdates}
            disabled={isCheckingUpdates}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Verificar atualizações do aplicativo"
          >
            <RefreshCw color="#FFFFFF" size={14} />
            <Text style={styles.updateButtonText}>
              {isCheckingUpdates
                ? 'Verificando atualizações...'
                : hasAvailableUpdate
                  ? `Atualização disponível${appVersion ? ` (atual: v${appVersion})` : ''}`
                  : `Verificar atualizações${appVersion ? ` • v${appVersion}` : ''}`}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: 164,
    gap: theme.spacing.lg,
  },
  header: {
    gap: 6,
  },
  eyebrow: {
    fontSize: theme.typography.fontSize.badge,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textSecondary,
    letterSpacing: 1.2,
  },
  title: {
    fontSize: theme.typography.fontSize.display,
    lineHeight: theme.typography.lineHeight.display,
    fontWeight: theme.typography.fontWeight.extraBold,
    color: theme.colors.textPrimary,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: theme.typography.fontSize.trackTitle,
    lineHeight: theme.typography.lineHeight.trackTitle,
    color: theme.colors.textSecondary,
  },
  chipsSection: {
    gap: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    height: 40,
    borderRadius: theme.radii.chip,
    backgroundColor: theme.colors.chipInactive,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  chipSelected: {
    backgroundColor: 'rgba(255, 0, 0, 0.14)',
    borderColor: theme.colors.brandPrimary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: theme.typography.fontWeight.semiBold,
    color: theme.colors.textSecondary,
  },
  chipTextSelected: {
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.fontWeight.bold,
  },
  customAmountBox: {
    gap: 6,
  },
  customAmountInput: {
    height: 44,
    backgroundColor: '#0B0B0B',
    borderRadius: theme.radii.chip,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  customAmountHint: {
    fontSize: theme.typography.fontSize.caption,
    lineHeight: 17,
    color: theme.colors.textSecondary,
  },
  pixCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 18,
    gap: 16,
  },
  pixCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pixCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pixCardTitle: {
    fontSize: theme.typography.fontSize.cardTitle,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textPrimary,
  },
  amountPill: {
    backgroundColor: '#0B0B0B',
    borderRadius: theme.radii.circular,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  amountPillText: {
    fontSize: theme.typography.fontSize.caption,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textPrimary,
  },
  qrFrame: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
  },
  qrInstruction: {
    fontSize: theme.typography.fontSize.caption,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  ctaButton: {
    width: '100%',
    height: 48,
    borderRadius: theme.radii.circular,
    backgroundColor: theme.colors.brandPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaButtonCopied: {
    backgroundColor: theme.colors.success,
  },
  ctaButtonText: {
    fontSize: 15,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textPrimary,
  },
  transparencyFooter: {
    fontSize: theme.typography.fontSize.caption,
    lineHeight: 18,
    color: theme.colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  updateButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.radii.circular,
    backgroundColor: '#16161A',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  updateButtonText: {
    fontSize: theme.typography.fontSize.caption,
    fontWeight: theme.typography.fontWeight.semiBold,
    color: theme.colors.textPrimary,
  },
});

export default SupportSection;

