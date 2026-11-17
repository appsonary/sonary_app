// tests/mocks/reactNativeMock.js
const React = require('react');

const View = React.forwardRef((props, ref) =>
  React.createElement('View', { ...props, ref }, props.children)
);
View.displayName = 'View';

const Text = (props) => React.createElement('Text', props, props.children);
Text.displayName = 'Text';

const TouchableOpacity = (props) => {
  const { children, onPress, disabled, ...rest } = props;
  return React.createElement(
    'TouchableOpacity',
    {
      ...rest,
      disabled,
      onPress: disabled ? undefined : onPress,
    },
    children
  );
};
TouchableOpacity.displayName = 'TouchableOpacity';

const TextInput = React.forwardRef((props, ref) => {
  const { value, onChangeText, onSubmitEditing, placeholder, ...rest } = props;
  return React.createElement(
    'TextInput',
    {
      ...rest,
      ref,
      value,
      placeholder,
      onChangeText,
      onSubmitEditing,
    },
    value
  );
});
TextInput.displayName = 'TextInput';

const Image = (props) => React.createElement('Image', props, null);
Image.displayName = 'Image';

const ActivityIndicator = (props) => React.createElement('ActivityIndicator', props, null);
ActivityIndicator.displayName = 'ActivityIndicator';

const SafeAreaView = (props) => React.createElement('SafeAreaView', props, props.children);
SafeAreaView.displayName = 'SafeAreaView';

const ScrollView = React.forwardRef((props, ref) =>
  React.createElement('ScrollView', { ...props, ref }, props.children)
);
ScrollView.displayName = 'ScrollView';

const StatusBar = (props) => React.createElement('StatusBar', props, null);
StatusBar.displayName = 'StatusBar';

const Modal = (props) => {
  const { visible = true, children, onRequestClose, onShow, ...rest } = props;
  const onShowRef = React.useRef(onShow);
  onShowRef.current = onShow;
  React.useEffect(() => {
    if (visible && typeof onShowRef.current === 'function') {
      onShowRef.current();
    }
  }, [visible]);
  if (!visible) return null;
  return React.createElement('Modal', { ...rest, onRequestClose, onShow }, children);
};
Modal.displayName = 'Modal';

const KeyboardAvoidingView = (props) =>
  React.createElement('KeyboardAvoidingView', props, props.children);
KeyboardAvoidingView.displayName = 'KeyboardAvoidingView';

const FlatList = (props) => {
  const {
    data,
    renderItem,
    keyExtractor,
    ListEmptyComponent,
    ListHeaderComponent,
    ListFooterComponent,
    ...rest
  } = props;
  const children = [];

  if (ListHeaderComponent) {
    if (React.isValidElement(ListHeaderComponent)) {
      children.push(React.cloneElement(ListHeaderComponent, { key: 'header' }));
    } else if (typeof ListHeaderComponent === 'function') {
      children.push(React.createElement(ListHeaderComponent, { key: 'header' }));
    }
  }

  if (!data || data.length === 0) {
    if (ListEmptyComponent) {
      if (React.isValidElement(ListEmptyComponent)) {
        children.push(React.cloneElement(ListEmptyComponent, { key: 'empty' }));
      } else if (typeof ListEmptyComponent === 'function') {
        children.push(React.createElement(ListEmptyComponent, { key: 'empty' }));
      }
    }
  } else {
    data.forEach((item, index) => {
      const key = keyExtractor ? keyExtractor(item, index) : String(index);
      const rendered = renderItem({ item, index });
      if (rendered) {
        children.push(React.createElement(React.Fragment, { key }, rendered));
      }
    });
  }

  if (ListFooterComponent) {
    if (React.isValidElement(ListFooterComponent)) {
      children.push(React.cloneElement(ListFooterComponent, { key: 'footer' }));
    } else if (typeof ListFooterComponent === 'function') {
      children.push(React.createElement(ListFooterComponent, { key: 'footer' }));
    }
  }

  return React.createElement('FlatList', rest, children);
};
FlatList.displayName = 'FlatList';

const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) => {
    if (!style) return {};
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.filter(Boolean));
    }
    return style;
  },
};

const Platform = {
  OS: 'android',
  Version: 33,
  select: (obj) => (obj.android !== undefined ? obj.android : obj.default),
};

const PermissionsAndroid = {
  PERMISSIONS: {
    POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
  },
  check: async () => true,
  request: async () => 'granted',
};

const Dimensions = {
  get: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
  addEventListener: () => ({ remove: () => {} }),
};

const PanResponder = {
  create: (config = {}) => ({
    panHandlers: {
      onStartShouldSetResponder: config.onStartShouldSetPanResponder || (() => true),
      onMoveShouldSetResponder: config.onMoveShouldSetPanResponder || (() => true),
      onStartShouldSetResponderCapture: config.onStartShouldSetPanResponderCapture || (() => false),
      onMoveShouldSetResponderCapture: config.onMoveShouldSetPanResponderCapture || (() => false),
      onResponderGrant: config.onPanResponderGrant,
      onResponderMove: config.onPanResponderMove,
      onResponderRelease: config.onPanResponderRelease,
      onResponderTerminate: config.onPanResponderTerminate,
    },
    ...config,
  }),
};

const Alert = {
  alert: (title, message, buttons) => {
    // Stores or auto-executes confirm if needed
    if (buttons && buttons.length > 0) {
      const confirmBtn = buttons.find((b) => b.style === 'destructive' || b.text === 'Excluir');
      if (confirmBtn && confirmBtn.onPress) {
        confirmBtn.onPress();
      }
    }
  },
};

const Clipboard = {
  _content: '',
  setString: (text) => {
    Clipboard._content = String(text ?? '');
  },
  getString: async () => Clipboard._content,
  reset: () => {
    Clipboard._content = '';
  },
};

class AnimatedValue {
  constructor(val) {
    this._value = val;
  }
  setValue(val) {
    this._value = val;
  }
  interpolate(config) {
    return this;
  }
}

const Animated = {
  Value: AnimatedValue,
  timing: (val, config) => ({
    start: (cb) => {
      if (config && config.toValue !== undefined && val && typeof val.setValue === 'function') {
        val.setValue(config.toValue);
      }
      if (cb) cb({ finished: true });
    },
    stop: () => {},
  }),
  spring: (val, config) => ({
    start: (cb) => {
      if (config && config.toValue !== undefined && val && typeof val.setValue === 'function') {
        val.setValue(config.toValue);
      }
      if (cb) cb({ finished: true });
    },
    stop: () => {},
  }),
  sequence: (animations) => ({
    start: (cb) => {
      if (Array.isArray(animations)) {
        animations.forEach((anim) => {
          if (anim && typeof anim.start === 'function') anim.start();
        });
      }
      if (cb) cb({ finished: true });
    },
    stop: () => {},
  }),
  loop: (animation) => ({
    start: (cb) => {
      if (animation && typeof animation.start === 'function') animation.start();
      if (cb) cb({ finished: true });
    },
    stop: () => {},
  }),
  parallel: (animations) => ({
    start: (cb) => {
      if (Array.isArray(animations)) {
        animations.forEach((anim) => {
          if (anim && typeof anim.start === 'function') anim.start();
        });
      }
      if (cb) cb({ finished: true });
    },
    stop: () => {},
  }),
  View: View,
  Text: Text,
  Image: Image,
  ScrollView: ScrollView,
  event: (argMapping) => (...args) => {
    const assignMapping = (pattern, payload) => {
      if (!pattern || !payload || typeof pattern !== 'object') return;
      for (const [k, target] of Object.entries(pattern)) {
        if (target && typeof target.setValue === 'function') {
          if (typeof payload[k] === 'number') target.setValue(payload[k]);
        } else if (
          target &&
          typeof target === 'object' &&
          payload[k] &&
          typeof payload[k] === 'object'
        ) {
          assignMapping(target, payload[k]);
        }
      }
    };
    if (Array.isArray(argMapping)) {
      argMapping.forEach((pattern, idx) => assignMapping(pattern, args[idx]));
    }
  },
  createAnimatedComponent: (Comp) => Comp,
};

const _linkingListeners = new Set();
let _initialUrl = null;
const Linking = {
  getInitialURL: async () => _initialUrl,
  addEventListener: (event, listener) => {
    if (event === 'url' && typeof listener === 'function') {
      _linkingListeners.add(listener);
    }
    return {
      remove: () => {
        _linkingListeners.delete(listener);
      },
    };
  },
  __setInitialUrl: (url) => {
    _initialUrl = url;
  },
  __emitUrl: (url) => {
    for (const listener of Array.from(_linkingListeners)) {
      listener({ url });
    }
  },
  __reset: () => {
    _initialUrl = null;
    _linkingListeners.clear();
  },
};

const _appStateListeners = new Set();
const AppState = {
  currentState: 'active',
  addEventListener: (event, listener) => {
    if (event === 'change' && typeof listener === 'function') {
      _appStateListeners.add(listener);
    }
    return {
      remove: () => {
        _appStateListeners.delete(listener);
      },
    };
  },
  __emitState: (nextState) => {
    AppState.currentState = nextState;
    for (const listener of Array.from(_appStateListeners)) {
      listener(nextState);
    }
  },
};

const _backListeners = [];
const BackHandler = {
  addEventListener: (event, listener) => {
    if (event === 'hardwareBackPress' && typeof listener === 'function') {
      _backListeners.push(listener);
    }
    return {
      remove: () => {
        const idx = _backListeners.indexOf(listener);
        if (idx !== -1) {
          _backListeners.splice(idx, 1);
        }
      },
    };
  },
  removeEventListener: (event, listener) => {
    if (event === 'hardwareBackPress') {
      const idx = _backListeners.indexOf(listener);
      if (idx !== -1) {
        _backListeners.splice(idx, 1);
      }
    }
  },
  exitApp: () => {},
  __emitHardwareBackPress: () => {
    for (let i = _backListeners.length - 1; i >= 0; i--) {
      if (_backListeners[i]() === true) {
        return true;
      }
    }
    return false;
  },
  __reset: () => {
    _backListeners.length = 0;
  },
};

const _keyboardListeners = new Map();
const Keyboard = {
  dismiss: () => {},
  addListener: (event, listener) => {
    if (!_keyboardListeners.has(event)) {
      _keyboardListeners.set(event, new Set());
    }
    if (typeof listener === 'function') {
      _keyboardListeners.get(event).add(listener);
    }
    return {
      remove: () => {
        _keyboardListeners.get(event)?.delete(listener);
      },
    };
  },
  __emit: (event, payload) => {
    for (const listener of Array.from(_keyboardListeners.get(event) || [])) {
      listener(payload);
    }
  },
  __reset: () => {
    _keyboardListeners.clear();
  },
};

const _nativeEventListeners = new Map();
class NativeEventEmitter {
  addListener(event, listener) {
    if (!_nativeEventListeners.has(event)) {
      _nativeEventListeners.set(event, new Set());
    }
    if (typeof listener === 'function') {
      _nativeEventListeners.get(event).add(listener);
    }
    return {
      remove: () => {
        _nativeEventListeners.get(event)?.delete(listener);
      },
    };
  }
  removeAllListeners(event) {
    if (event) {
      _nativeEventListeners.delete(event);
    } else {
      _nativeEventListeners.clear();
    }
  }
  static __emit(event, payload) {
    for (const listener of Array.from(_nativeEventListeners.get(event) || [])) {
      listener(payload);
    }
  }
  static __reset() {
    _nativeEventListeners.clear();
  }
}

module.exports = {
  __esModule: true,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Modal,
  KeyboardAvoidingView,
  FlatList,
  StyleSheet,
  Platform,
  PermissionsAndroid,
  Dimensions,
  PanResponder,
  Alert,
  Clipboard,
  Linking,
  AppState,
  BackHandler,
  Keyboard,
  NativeModules: { Clipboard },
  NativeEventEmitter,
  Animated,
  useWindowDimensions: () => Dimensions.get('window'),
};
