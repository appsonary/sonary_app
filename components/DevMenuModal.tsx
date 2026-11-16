import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Bell, Code2, FastForward, HeartHandshake, Play, RotateCcw, X } from 'lucide-react-native';
import {
  getSupportNotificationState,
  incrementDailySupportPlayCount,
  resetSupportNotificationState,
  SUPPORT_DAILY_MIN_PLAYS,
  SupportNotificationState,
} from '../services/database';
import {
  sendTestSupportNotificationNow,
  SupportNotificationVariant,
  triggerSupportNotificationIfEligible,
} from '../services/supportNotifications';

export interface DevMenuModalProps {
  visible: boolean;
  onClose: () => void;
  onShowToast?: (message: string) => void;
  onNavigateToSupport?: () => void;
}

export function isDevMenuEnabled(): boolean {
  return (
    (typeof __DEV__ !== 'undefined' && Boolean(__DEV__)) ||
    process.env.EXPO_PUBLIC_DEV_MENU === '1'
  );
}

export const DevMenuModal: React.FC<DevMenuModalProps> = ({
  visible,
  onClose,
  onShowToast,
  onNavigateToSupport,
}) => {
  const isDev = isDevMenuEnabled();
  const [notifState, setNotifState] = useState<SupportNotificationState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(async () => {
    try {
      const next = await getSupportNotificationState();
      setNotifState(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (visible && isDev) {
      refreshState();
    }
  }, [visible, isDev, refreshState]);

  if (!isDev || !visible) {
    return null;
  }

  const runAction = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleSimulateOnePlay = () =>
    runAction(async () => {
      const updated = await incrementDailySupportPlayCount();
      const fired = await triggerSupportNotificationIfEligible();
      const latest = await refreshState();
      const count = latest?.dailyPlayCount ?? updated.dailyPlayCount;
      const msg = fired
        ? `Reprodução #${count} registrada — notificação disparada!`
        : `Reprodução #${count} registrada (${SUPPORT_DAILY_MIN_PLAYS + 1} para disparar).`;
      setStatusMessage(msg);
      onShowToast?.(msg);
    });

  const handleReachSixteenthPlay = () =>
    runAction(async () => {
      let current = await getSupportNotificationState();
      const needed = Math.max(1, SUPPORT_DAILY_MIN_PLAYS + 1 - current.dailyPlayCount);
      for (let i = 0; i < needed; i++) {
        current = await incrementDailySupportPlayCount();
      }
      const fired = await triggerSupportNotificationIfEligible();
      await refreshState();
      const msg = fired
        ? '16ª música atingida — notificação real disparada!'
        : `Contador em ${current.dailyPlayCount}, bloqueado por trava/permissão.`;
      setStatusMessage(msg);
      onShowToast?.(msg);
    });

  const handleForceNotificationNow = (variant?: SupportNotificationVariant) =>
    runAction(async () => {
      const now = new Date();
      const effectiveVariant: SupportNotificationVariant =
        variant ?? (now.getDate() % 2 === 1 ? 'A' : 'B');
      const result = await sendTestSupportNotificationNow(now, variant);
      const msg = result.sent
        ? `Notificação de teste enviada (Variação ${effectiveVariant})!`
        : result.reason === 'permission-denied'
          ? 'Permissão POST_NOTIFICATIONS negada neste dispositivo.'
          : `Falha ao enviar: ${result.detail ?? 'erro desconhecido'}`;
      setStatusMessage(msg);
      onShowToast?.(msg);
    });

  const handleResetNotifState = () =>
    runAction(async () => {
      await resetSupportNotificationState();
      await refreshState();
      const msg = 'Contador diário e travas zerados.';
      setStatusMessage(msg);
      onShowToast?.(msg);
    });

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleCluster}>
              <View style={styles.devBadge}>
                <Code2 color="#FF4E45" size={16} />
              </View>
              <View>
                <Text style={styles.title}>Menu Dev</Text>
                <Text style={styles.subtitle}>Somente ambiente de desenvolvimento</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fechar menu de desenvolvimento"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X color="#B3B3B3" size={18} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>Notificações de Apoio</Text>

            <View style={styles.stateBox}>
              <Text style={styles.stateLine}>
                Data local: <Text style={styles.stateValue}>{notifState?.dateKey ?? '...'}</Text>
              </Text>
              <Text style={styles.stateLine}>
                Reproduções reais (&gt;=30s):{' '}
                <Text style={styles.stateValue}>
                  {notifState?.dailyPlayCount ?? 0} / {SUPPORT_DAILY_MIN_PLAYS + 1}
                </Text>
              </Text>
              <Text style={styles.stateLine}>
                Último disparo:{' '}
                <Text style={styles.stateValue}>{notifState?.lastNotifiedDate ?? 'Nenhum'}</Text>
              </Text>
              <Text style={styles.stateLine}>
                Trava Pix até:{' '}
                <Text style={styles.stateValue}>{notifState?.snoozeUntilDate ?? 'Livre'}</Text>
              </Text>
              <Text style={styles.stateLine}>
                Cópia de hoje:{' '}
                <Text style={styles.stateValue}>
                  {new Date().getDate() % 2 === 1 ? 'Variação A (dia ímpar)' : 'Variação B (dia par)'}
                </Text>
              </Text>
            </View>

            {statusMessage ? (
              <View style={styles.statusBanner}>
                <Text style={styles.statusText}>{statusMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleSimulateOnePlay}
              disabled={busy}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Play color="#FFFFFF" size={16} />
              <Text style={styles.actionText}>Simular +1 música (&gt;= 30s)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleReachSixteenthPlay}
              disabled={busy}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <FastForward color="#FFFFFF" size={16} />
              <Text style={styles.actionText}>Completar 16ª e testar regra</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => handleForceNotificationNow()}
              disabled={busy}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Bell color="#FFFFFF" size={16} />
              <Text style={styles.actionText}>Enviar notificação agora (forçar)</Text>
            </TouchableOpacity>

            <View style={styles.variantRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.variantBtn]}
                onPress={() => handleForceNotificationNow('A')}
                disabled={busy}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Text style={styles.actionText}>Testar Variação A</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.variantBtn]}
                onPress={() => handleForceNotificationNow('B')}
                disabled={busy}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Text style={styles.actionText}>Testar Variação B</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleResetNotifState}
              disabled={busy}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <RotateCcw color="#FF8A80" size={16} />
              <Text style={[styles.actionText, styles.resetText]}>Resetar contador e travas</Text>
            </TouchableOpacity>

            {onNavigateToSupport && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => {
                  onClose();
                  onNavigateToSupport();
                }}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <HeartHandshake color="#FFFFFF" size={16} />
                <Text style={styles.actionText}>Ir para aba Apoiar</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: '#141416',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  titleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  devBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 78, 69, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 11,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#222225',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
  },
  sectionTitle: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  stateBox: {
    backgroundColor: '#1C1C20',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 12,
    gap: 4,
    marginBottom: 12,
  },
  stateLine: {
    color: '#8E8E93',
    fontSize: 12,
  },
  stateValue: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  statusBanner: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  statusText: {
    color: '#F4F4F5',
    fontSize: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#222226',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  actionBtnPrimary: {
    backgroundColor: 'rgba(255, 78, 69, 0.22)',
    borderColor: 'rgba(255, 78, 69, 0.45)',
  },
  variantRow: {
    flexDirection: 'row',
    gap: 8,
  },
  variantBtn: {
    flex: 1,
    justifyContent: 'center',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  resetText: {
    color: '#FF8A80',
  },
});

export default DevMenuModal;

