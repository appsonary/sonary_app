import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, PanResponderInstance } from 'react-native';
import { getEaseOutCubic } from '../theme';

export const SHEET_ENTER_MS = 220;
export const SHEET_EXIT_MS = 160;
const INITIAL_SHEET_OFFSET = 320;
const DISMISS_SHEET_OFFSET = 560;
const MODAL_SHOW_FALLBACK_MS = 180;

/**
 * Agenda execução no próximo frame de UI quando `requestAnimationFrame` está disponível
 * (React Native Android/iOS), garantindo que o frame inicial oculto seja pintado antes
 * da transição iniciar. Em ambiente de teste headless sem rAF, executa imediatamente.
 */
export function scheduleNextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  callback();
  return () => {};
}

export interface UseModalEnterOptions {
  visible: boolean;
  onReset: () => void;
  onAnimateIn: () => Animated.CompositeAnimation | void;
}

/**
 * Sincroniza animações de entrada dentro de `<Modal>` com o evento nativo `onShow`.
 * No Android, `<Modal>` cria a janela Dialog de forma assíncrona (~60–120ms); iniciar
 * animações curtas antes do `onShow` faz a transição terminar antes do Dialog aparecer.
 */
export function useModalEnterAnimation({
  visible,
  onReset,
  onAnimateIn,
}: UseModalEnterOptions): { onModalShow: () => void } {
  const hasEnteredRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelFrameRef = useRef<(() => void) | null>(null);

  const callbacksRef = useRef({ onReset, onAnimateIn });
  callbacksRef.current = { onReset, onAnimateIn };

  const clearPendingTimers = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (cancelFrameRef.current) {
      cancelFrameRef.current();
      cancelFrameRef.current = null;
    }
  }, []);

  const triggerEnter = useCallback(() => {
    if (!visibleRef.current || hasEnteredRef.current) return;
    hasEnteredRef.current = true;
    clearPendingTimers();

    cancelFrameRef.current = scheduleNextFrame(() => {
      cancelFrameRef.current = null;
      if (!visibleRef.current) return;
      animRef.current?.stop();
      const maybeAnim = callbacksRef.current.onAnimateIn();
      if (maybeAnim && typeof maybeAnim.stop === 'function') {
        animRef.current = maybeAnim;
      }
    });
  }, [clearPendingTimers]);

  useEffect(() => {
    clearPendingTimers();
    animRef.current?.stop();
    animRef.current = null;

    if (!visible) {
      hasEnteredRef.current = false;
      callbacksRef.current.onReset();
      return;
    }

    if (!hasEnteredRef.current) {
      callbacksRef.current.onReset();
      // Fallback de segurança caso alguma build/mock não dispare `onShow`
      fallbackTimerRef.current = setTimeout(triggerEnter, MODAL_SHOW_FALLBACK_MS);
    }

    return () => {
      clearPendingTimers();
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [visible, clearPendingTimers, triggerEnter]);

  return { onModalShow: triggerEnter };
}

export interface UseBottomSheetOptions {
  visible: boolean;
  onClose: () => void;
  initialOffset?: number;
  dismissOffset?: number;
  enterDurationMs?: number;
  exitDurationMs?: number;
}

export interface BottomSheetController {
  translateY: Animated.Value;
  backdropOpacity: Animated.Value;
  onModalShow: () => void;
  dismissSheet: (afterDismiss?: () => void) => void;
  panResponder: PanResponderInstance;
}

/**
 * Controlador compartilhado para Bottom Sheets com entrada sincronizada ao `<Modal onShow>`,
 * gesto de arrasto com elástico superior e saída animada antes do `onClose`.
 */
export function useBottomSheetController({
  visible,
  onClose,
  initialOffset = INITIAL_SHEET_OFFSET,
  dismissOffset = DISMISS_SHEET_OFFSET,
  enterDurationMs = SHEET_ENTER_MS,
  exitDurationMs = SHEET_EXIT_MS,
}: UseBottomSheetOptions): BottomSheetController {
  const translateY = useRef(new Animated.Value(initialOffset)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const isDismissingRef = useRef(false);
  const exitAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      isDismissingRef.current = false;
    }
    return () => {
      exitAnimRef.current?.stop();
    };
  }, [visible]);

  const { onModalShow } = useModalEnterAnimation({
    visible,
    onReset: () => {
      isDismissingRef.current = false;
      translateY.setValue(initialOffset);
      backdropOpacity.setValue(0);
    },
    onAnimateIn: () => {
      const easeOut = getEaseOutCubic(Easing);
      const anim = Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: enterDurationMs,
          easing: easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: enterDurationMs,
          easing: easeOut,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
      return anim;
    },
  });

  const dismissSheet = useCallback(
    (afterDismiss?: () => void) => {
      if (isDismissingRef.current) return;
      isDismissingRef.current = true;
      const easeOut = getEaseOutCubic(Easing);
      exitAnimRef.current?.stop();
      const anim = Animated.parallel([
        Animated.timing(translateY, {
          toValue: dismissOffset,
          duration: exitDurationMs,
          easing: easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: exitDurationMs,
          easing: easeOut,
          useNativeDriver: true,
        }),
      ]);
      exitAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) {
          onCloseRef.current();
          afterDismiss?.();
        } else {
          isDismissingRef.current = false;
        }
      });
    },
    [translateY, backdropOpacity, dismissOffset, exitDurationMs]
  );

  const dismissRef = useRef(dismissSheet);
  dismissRef.current = dismissSheet;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) =>
          Math.abs(gs.dy) > 3 && Math.abs(gs.dy) > Math.abs(gs.dx),
        onPanResponderMove: (_, gs) => {
          translateY.setValue(
            gs.dy > 0 ? gs.dy : Math.max(-56, gs.dy * 0.15)
          );
        },
        onPanResponderRelease: (_, gs) => {
          if (gs.dy > 70 || gs.vy > 0.5) {
            dismissRef.current();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              damping: 20,
              stiffness: 240,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            damping: 20,
            stiffness: 240,
            useNativeDriver: true,
          }).start();
        },
      }),
    [translateY]
  );

  return {
    translateY,
    backdropOpacity,
    onModalShow,
    dismissSheet,
    panResponder,
  };
}
