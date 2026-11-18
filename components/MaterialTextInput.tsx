import React, { forwardRef, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getEaseOutCubic } from '../theme';

const UNDERLINE_COLORS = ['#C81428', '#FF4E45', '#C81428'] as const;

export interface MaterialTextInputProps extends TextInputProps {
  label?: string;
  showClearButton?: boolean;
  clearAccessibilityLabel?: string;
  onClear?: () => void;
  leftAccessory?: React.ReactNode;
  rightAccessory?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export const MaterialTextInput = forwardRef<TextInput, MaterialTextInputProps>(
  (
    {
      label,
      value = '',
      onChangeText,
      showClearButton = true,
      clearAccessibilityLabel = 'Limpar texto',
      onClear,
      leftAccessory,
      rightAccessory,
      containerStyle,
      inputStyle,
      style,
      onFocus,
      onBlur,
      editable = true,
      multiline = false,
      placeholderTextColor = '#71717A',
      selectionColor = '#FF4E45',
      ...rest
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const underlineFocusAnim = useRef(new Animated.Value(0)).current;

    const animateUnderline = (focused: boolean) => {
      setIsFocused(focused);
      Animated.timing(underlineFocusAnim, {
        toValue: focused ? 1 : 0,
        duration: 180,
        easing: getEaseOutCubic(Easing),
        useNativeDriver: true,
      }).start();
    };

    const underlineScaleX = underlineFocusAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.35, 1],
    });
    const underlineOpacity = underlineFocusAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.4, 1],
    });

    const canClear = showClearButton && editable !== false && value.length > 0;

    return (
      <View style={containerStyle}>
        {label ? (
          <Text style={[styles.eyebrow, isFocused && styles.eyebrowFocused]}>
            {label}
          </Text>
        ) : null}
        <View style={[styles.inputRow, multiline && styles.inputRowMultiline]}>
          {leftAccessory}
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            editable={editable}
            multiline={multiline}
            placeholderTextColor={placeholderTextColor}
            selectionColor={selectionColor}
            onFocus={(e) => {
              animateUnderline(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              animateUnderline(false);
              onBlur?.(e);
            }}
            style={[styles.input, style, inputStyle]}
            {...rest}
          />
          {canClear && (
            <TouchableOpacity
              style={[styles.clearBtn, multiline && styles.clearBtnMultiline]}
              onPress={() => (onClear ? onClear() : onChangeText?.(''))}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={clearAccessibilityLabel}
            >
              <X color="#71717A" size={16} />
            </TouchableOpacity>
          )}
          {rightAccessory}
        </View>
        <View style={styles.underlineContainer}>
          <View style={styles.underlineTrack} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.underlineActive,
              {
                opacity: underlineOpacity,
                transform: [{ scaleX: underlineScaleX }],
              },
            ]}
          >
            <LinearGradient
              colors={[...UNDERLINE_COLORS]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.underlineGradient}
            />
          </Animated.View>
        </View>
      </View>
    );
  }
);

MaterialTextInput.displayName = 'MaterialTextInput';

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#9A9AA0',
    marginBottom: 4,
  },
  eyebrowFocused: {
    color: '#E5484D',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputRowMultiline: {
    alignItems: 'flex-start',
  },
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 6,
    fontSize: 17,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  clearBtn: {
    padding: 2,
  },
  clearBtnMultiline: {
    marginTop: 8,
  },
  underlineContainer: {
    position: 'relative',
    height: 2,
    justifyContent: 'center',
  },
  underlineTrack: {
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 1,
  },
  underlineActive: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    shadowColor: '#FF2E43',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 6,
    elevation: 3,
  },
  underlineGradient: {
    flex: 1,
    borderRadius: 1,
  },
});

export default MaterialTextInput;
