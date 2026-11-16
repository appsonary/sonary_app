import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  canTriggerSupportNotification,
  getSupportNotificationState,
  markSupportNotificationSent,
} from './database';

export const SUPPORT_NOTIFICATION_CHANNEL_ID = 'support-reminders';
export const MIN_REAL_PLAYTIME_SEC = 30;
export const MAX_CONTINUOUS_DELTA_SEC = 2.5;

export interface SupportNotificationCopy {
  title: string;
  body: string;
}

const SUPPORT_COPY_VARIATION_A: SupportNotificationCopy = {
  title: 'Obrigado por ouvir no Sonary ❤️',
  body: 'O app segue 100% grátis e sem anúncios. Se ele faz parte do seu dia, conheça a aba Apoiar.',
};

const SUPPORT_COPY_VARIATION_B: SupportNotificationCopy = {
  title: 'Curtiu suas músicas de hoje?',
  body: 'O Sonary é mantido de forma independente. Toque aqui se quiser apoiar o projeto.',
};

let handlerConfigured = false;

export function configureSupportNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Ignora silenciosamente caso o módulo nativo não esteja disponível
  }
}

configureSupportNotificationHandler();

export type SupportNotificationVariant = 'A' | 'B';

/**
 * Alterna entre as duas variações de copy conforme a paridade do dia do mês.
 */
export function getSupportNotificationContent(
  date: Date = new Date(),
  variant?: SupportNotificationVariant
): SupportNotificationCopy {
  if (variant === 'A') return SUPPORT_COPY_VARIATION_A;
  if (variant === 'B') return SUPPORT_COPY_VARIATION_B;
  return date.getDate() % 2 === 1 ? SUPPORT_COPY_VARIATION_A : SUPPORT_COPY_VARIATION_B;
}

/**
 * Garante o canal Android silencioso (LOW, sem som e sem vibração) para não gerar audio ducking.
 */
export async function ensureSupportNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(SUPPORT_NOTIFICATION_CHANNEL_ID, {
      name: 'Agradecimento e Apoio',
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      vibrationPattern: null,
      showBadge: false,
    });
  } catch {
    // Ignora falhas de criação de canal em dispositivos não suportados
  }
}

async function hasNotificationPermissionSilent(): Promise<boolean> {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    return permissions?.granted === true || permissions?.status === 'granted';
  } catch {
    return false;
  }
}

async function dispatchSupportNotificationNow(
  now: Date,
  variant?: SupportNotificationVariant
): Promise<boolean> {
  const granted = await hasNotificationPermissionSilent();
  if (!granted) {
    return false;
  }

  await ensureSupportNotificationChannel();
  const copy = getSupportNotificationContent(now, variant);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: copy.title,
      body: copy.body,
      sound: false,
      data: { targetTab: 'support' },
    },
    // Expo Notifications Android rejeita ChannelAwareTrigger puro em ExpoSchedulingDelegate;
    // usar TimeIntervalTrigger (1s) com channelId garante canal LOW silencioso e agendamento válido.
    trigger:
      Platform.OS === 'android'
        ? { seconds: 1, repeats: false, channelId: SUPPORT_NOTIFICATION_CHANNEL_ID }
        : null,
  });
  return true;
}

/**
 * Dispara a notificação local de apoio caso contagem diária > 15, travas livres e permissão concedida.
 */
export async function triggerSupportNotificationIfEligible(
  now: Date = new Date()
): Promise<boolean> {
  try {
    const state = await getSupportNotificationState(now);
    if (!canTriggerSupportNotification(state, now)) {
      return false;
    }

    const sent = await dispatchSupportNotificationNow(now);
    if (!sent) {
      return false;
    }

    await markSupportNotificationSent(now);
    return true;
  } catch (err) {
    console.warn('[SupportNotifications] Erro ao agendar notificação:', err);
    return false;
  }
}

/**
 * Dispara imediatamente uma notificação de apoio ignorando contagem e travas (apenas DEV).
 */
export async function sendTestSupportNotificationNow(
  now: Date = new Date(),
  variant?: SupportNotificationVariant
): Promise<{ sent: boolean; reason?: 'permission-denied' | 'error'; detail?: string }> {
  try {
    const sent = await dispatchSupportNotificationNow(now, variant);
    return sent ? { sent: true } : { sent: false, reason: 'permission-denied' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[SupportNotifications] Erro ao enviar notificação de teste:', detail);
    return { sent: false, reason: 'error', detail };
  }
}

const handledNotificationIds = new Set<string>();
const SUPPORT_DEEP_LINK_PREFIX = 'com.sonarypro.app://support';

/**
 * Extrai a aba de destino a partir do payload de resposta da notificação (com fallback para dataString).
 */
export function getTargetTabFromNotificationResponse(
  response: Notifications.NotificationResponse | null | undefined
): string | null {
  const content = response?.notification?.request?.content as
    | { data?: unknown; dataString?: unknown }
    | undefined;
  if (!content) return null;

  let data = content.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  if (data && typeof (data as Record<string, unknown>).targetTab === 'string') {
    return (data as Record<string, string>).targetTab;
  }

  if (typeof content.dataString === 'string') {
    try {
      const parsed = JSON.parse(content.dataString);
      if (parsed && typeof parsed.targetTab === 'string') {
        return parsed.targetTab;
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return null;
}

function parseSupportDeepLinkNotificationId(url: string | null | undefined): string | null | undefined {
  if (!url || !url.startsWith(SUPPORT_DEEP_LINK_PREFIX)) return undefined;
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return null;
  const query = url.slice(queryIndex + 1);
  for (const part of query.split('&')) {
    const [rawKey, rawVal = ''] = part.split('=');
    if (rawKey === 'nid' && rawVal) {
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

/**
 * Conecta listeners de resposta da notificação, deep link do intent nativo e rechecagens em cold start / foreground.
 */
export function attachSupportNotificationListeners(
  onNavigateToSupport: () => void
): () => void {
  let cancelled = false;

  const navigateOnceForId = (identifier: string | null | undefined) => {
    if (cancelled) return;
    if (identifier) {
      if (handledNotificationIds.has(identifier)) return;
      handledNotificationIds.add(identifier);
    }
    Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
    onNavigateToSupport();
  };

  const handleResponse = (response: Notifications.NotificationResponse | null | undefined) => {
    if (cancelled || !response) return;
    if (getTargetTabFromNotificationResponse(response) !== 'support') return;
    navigateOnceForId(response.notification?.request?.identifier);
  };

  const handleDeepLinkUrl = (url: string | null | undefined) => {
    const nid = parseSupportDeepLinkNotificationId(url);
    if (nid !== undefined) {
      navigateOnceForId(nid);
    }
  };

  const checkLastResponse = () => {
    if (cancelled) return;
    try {
      Notifications.getLastNotificationResponseAsync()
        .then((response) => handleResponse(response))
        .catch(() => {});
    } catch {
      // noop
    }
  };

  checkLastResponse();

  // Recheca brevemente após a montagem para cobrir latência do BroadcastReceiver no cold start do Android
  const retryTimers: ReturnType<typeof setTimeout>[] = [450, 1200].map((delayMs) => {
    const timer = setTimeout(() => {
      checkLastResponse();
    }, delayMs);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    return timer;
  });

  try {
    Linking.getInitialURL?.()
      .then((url) => handleDeepLinkUrl(url))
      .catch(() => {});
  } catch {
    // noop
  }

  let responseSub: { remove: () => void } | null = null;
  try {
    responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleResponse(response);
    });
  } catch {
    responseSub = null;
  }

  let linkingSub: { remove?: () => void } | null = null;
  try {
    linkingSub = Linking.addEventListener?.('url', (event) => {
      handleDeepLinkUrl(event?.url);
    }) ?? null;
  } catch {
    linkingSub = null;
  }

  let appStateSub: { remove?: () => void } | null = null;
  try {
    appStateSub = AppState.addEventListener?.('change', (nextState) => {
      if (nextState === 'active') {
        checkLastResponse();
      }
    }) ?? null;
  } catch {
    appStateSub = null;
  }

  return () => {
    cancelled = true;
    for (const timer of retryTimers) {
      clearTimeout(timer);
    }
    responseSub?.remove?.();
    linkingSub?.remove?.();
    appStateSub?.remove?.();
  };
}

/**
 * Rastreia tempo real contínuo de reprodução por execução, ignorando seeks e pulos < 30s.
 */
export class RealPlaytimeTracker {
  private activeTrackId: string | null = null;
  private lastPosition: number | null = null;
  private accumulatedSec = 0;
  private countedCurrentPlay = false;

  reset(): void {
    this.activeTrackId = null;
    this.lastPosition = null;
    this.accumulatedSec = 0;
    this.countedCurrentPlay = false;
  }

  recordProgressSample(trackId: string | null | undefined, positionSec: number): boolean {
    if (!trackId || !Number.isFinite(positionSec) || positionSec < 0) {
      return false;
    }

    if (trackId !== this.activeTrackId) {
      this.activeTrackId = trackId;
      this.lastPosition = positionSec;
      this.accumulatedSec = positionSec <= MAX_CONTINUOUS_DELTA_SEC ? positionSec : 0;
      this.countedCurrentPlay = false;
      return false;
    }

    if (this.lastPosition === null) {
      this.lastPosition = positionSec;
      return false;
    }

    const delta = positionSec - this.lastPosition;

    // Detecta reinício/loop da mesma faixa para contabilizar repetições legítimas
    if (this.lastPosition > 5 && positionSec <= 3) {
      this.lastPosition = positionSec;
      this.accumulatedSec = positionSec <= MAX_CONTINUOUS_DELTA_SEC ? positionSec : 0;
      this.countedCurrentPlay = false;
      return false;
    }

    // Ignora seek para trás ou avanços bruscos na barra de progresso
    if (delta < 0 || delta > MAX_CONTINUOUS_DELTA_SEC) {
      this.lastPosition = positionSec;
      return false;
    }

    this.accumulatedSec += delta;
    this.lastPosition = positionSec;

    if (!this.countedCurrentPlay && this.accumulatedSec >= MIN_REAL_PLAYTIME_SEC) {
      this.countedCurrentPlay = true;
      return true;
    }

    return false;
  }
}
