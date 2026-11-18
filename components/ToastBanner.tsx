import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react-native';
import { getEaseOutCubic, theme } from '../theme';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastBannerProps {
  message: string | null | undefined;
  variant?: ToastVariant;
  onDismiss?: () => void;
  topOffset?: number;
}

/**
 * Toast flutuante no topo para confirmar ações sem cobrir o mini player.
 * Renderizado dentro de cada janela ativa (App ou Modal) porque React Native
 * Modals no Android sobem uma Dialog Window acima da Activity principal.
 */
export function ToastBanner({
  message,
  variant = 'success',
  onDismiss,
  topOffset = Platform.OS === 'android' ? 12 : 10,
}: ToastBannerProps) {
  const isError = variant === 'error';
  const isInfo = variant === 'info';
  const translateY = useRef(new Animated.Value(-16)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    const easeOut = getEaseOutCubic(Easing);
    translateY.setValue(-16);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: theme.transitions.toastMs,
        easing: easeOut,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: theme.transitions.toastMs,
        easing: easeOut,
        useNativeDriver: true,
      }),
    ]).start();
  }, [message, translateY, opacity]);

  if (!message) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: topOffset,
        left: 16,
        right: 16,
        alignItems: 'center',
        zIndex: 9999,
      }}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[
          styles.toastBox,
          isError && styles.toastBoxError,
          isInfo && styles.toastBoxInfo,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.toastTouchable}
          activeOpacity={0.85}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={
            isError
              ? 'Fechar notificação de erro'
              : isInfo
                ? 'Fechar notificação informativa'
                : 'Fechar notificação de sucesso'
          }
        >
          <View
            style={[
              styles.toastIconBadge,
              isError && styles.toastIconBadgeError,
              isInfo && styles.toastIconBadgeInfo,
            ]}
          >
            {isError ? (
              <AlertCircle color="#FF4E45" size={15} />
            ) : isInfo ? (
              <Info color="#60A5FA" size={15} />
            ) : (
              <CheckCircle2 color="#2BA640" size={15} />
            )}
          </View>
          <Text style={styles.toastText} numberOfLines={1} ellipsizeMode="tail">
            {message}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  toastBox: {
    maxWidth: '100%',
    backgroundColor: 'rgba(24, 24, 24, 0.96)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(43, 166, 64, 0.35)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  toastBoxError: {
    borderColor: 'rgba(255, 78, 69, 0.45)',
  },
  toastBoxInfo: {
    borderColor: 'rgba(96, 165, 250, 0.35)',
  },
  toastTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 8,
  },
  toastIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(43, 166, 64, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastIconBadgeError: {
    backgroundColor: 'rgba(255, 78, 69, 0.18)',
  },
  toastIconBadgeInfo: {
    backgroundColor: 'rgba(96, 165, 250, 0.16)',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
});

export default ToastBanner;

