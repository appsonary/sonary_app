import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

export const BACK_PRIORITY = {
  TAB_HISTORY: 10,
  SUBSCREEN: 30,
  SUBSCREEN_MODE: 40,
  INLINE_OVERLAY: 50,
} as const;

export type BackHandlerCallback = () => boolean | void;

interface BackHandlerEntry {
  id: number;
  priority: number;
  order: number;
  handlerRef: { current: BackHandlerCallback };
}

let nextId = 1;
let nextOrder = 1;
const entries = new Map<number, BackHandlerEntry>();
const modalLocks = new Set<number>();
let nativeSubscription: { remove?: () => void } | null = null;

/**
 * Executa os handlers registrados em ordem decrescente de prioridade (desempate LIFO).
 * Retorna true se algum handler consumiu o evento de voltar.
 */
export function dispatchBackPress(): boolean {
  if (modalLocks.size > 0) {
    return false;
  }

  const ordered = Array.from(entries.values()).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.order - a.order;
  });

  for (const entry of ordered) {
    const result = entry.handlerRef.current();
    if (result !== false) {
      return true;
    }
  }
  return false;
}

function syncNativeListener(): void {
  if (entries.size > 0 && !nativeSubscription) {
    if (typeof BackHandler?.addEventListener === 'function') {
      nativeSubscription = BackHandler.addEventListener(
        'hardwareBackPress',
        dispatchBackPress
      );
    }
  } else if (entries.size === 0 && nativeSubscription) {
    nativeSubscription.remove?.();
    nativeSubscription = null;
  }
}

export function resetBackHandlersForTest(): void {
  entries.clear();
  modalLocks.clear();
  nativeSubscription?.remove?.();
  nativeSubscription = null;
}

/**
 * Bloqueia os handlers da camada Activity enquanto um `<Modal>` nativo estiver visível,
 * evitando que eventos vazados ou testes disparem telas subjacentes ao Dialog.
 */
export function useBackModalLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const lockId = nextId++;
    modalLocks.add(lockId);
    return () => {
      modalLocks.delete(lockId);
    };
  }, [locked]);
}

/**
 * Registra um interceptador do botão/gesto Voltar do Android enquanto `enabled` for true.
 * Handlers com maior `priority` (e, em empate, os mais recentes) executam primeiro.
 */
export function useBackHandler(
  enabled: boolean,
  onBack: BackHandlerCallback,
  priority: number = BACK_PRIORITY.SUBSCREEN
): void {
  const handlerRef = useRef<BackHandlerCallback>(onBack);
  handlerRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;

    const id = nextId++;
    entries.set(id, {
      id,
      priority,
      order: nextOrder++,
      handlerRef,
    });
    syncNativeListener();

    return () => {
      entries.delete(id);
      syncNativeListener();
    };
  }, [enabled, priority]);
}
