// tests/setup.js
const Module = require('module');
const path = require('path');
const React = require('react');

// Register Babel compiler for JSX & TypeScript
require('@babel/register')({
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
    '@babel/preset-typescript',
  ],
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  ignore: [/node_modules/],
});

// Ensure .tsx and .ts have precedence over .json on Windows (prevents App -> app.json collision)
if (require.extensions['.json']) {
  const jsonHandler = require.extensions['.json'];
  delete require.extensions['.json'];
  require.extensions['.json'] = jsonHandler;
}

// Stub static image/asset imports for Node tests (matches Metro numeric asset IDs)
for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
  require.extensions[ext] = (mod) => {
    mod.exports = 1;
  };
}

const rnMock = require('./mocks/reactNativeMock');
const tpMock = require('./mocks/trackPlayerMock');
const sqliteMock = require('./mocks/sqliteMock');
const fileSystemMock = require('./mocks/fileSystemMock');

const LucideProxy = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (prop === '__esModule') return true;
      if (prop === 'default') return LucideProxy;
      const IconMock = (props) =>
        React.createElement('LucideIcon', { name: String(prop), ...props });
      IconMock.displayName = `LucideIcon(${String(prop)})`;
      return IconMock;
    },
  }
);

const VectorIconsProxy = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (prop === '__esModule') return true;
      if (prop === 'default') return VectorIconsProxy;
      const VectorIconMock = (props) =>
        React.createElement('VectorIcon', { family: String(prop), ...props });
      VectorIconMock.displayName = `VectorIcon(${String(prop)})`;
      return VectorIconMock;
    },
  }
);

const sharedSkiaNamespace = {};
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'react-native') {
    return rnMock;
  }
  if (request === 'react-native-track-player') {
    return tpMock;
  }
  if (request === 'expo-sqlite') {
    return sqliteMock;
  }
  if (request === 'expo-file-system') {
    return fileSystemMock;
  }
  if (request === 'lucide-react-native') {
    return LucideProxy;
  }
  if (request === '@expo/vector-icons') {
    return VectorIconsProxy;
  }
  if (request === 'expo-status-bar') {
    return {
      StatusBar: (props) => React.createElement('ExpoStatusBar', props, null),
    };
  }
  if (request === 'expo-image') {
    return {
      Image: (props) => React.createElement('ExpoImage', props, props.children),
    };
  }
  if (request === '@shopify/react-native-skia') {
    const createSkiaComp = (name) => (props) =>
      React.createElement('SkiaElement', { tag: name, ...props }, props.children);
    return {
      __esModule: true,
      Canvas: (props) => React.createElement('SkiaCanvas', props, props.children),
      Fill: createSkiaComp('Fill'),
      FractalNoise: createSkiaComp('FractalNoise'),
      Group: createSkiaComp('Group'),
      Image: createSkiaComp('Image'),
      Blur: createSkiaComp('Blur'),
      Rect: createSkiaComp('Rect'),
      LinearGradient: createSkiaComp('LinearGradient'),
      Skia: sharedSkiaNamespace,
      useImage: (uri) => React.useMemo(() => (uri ? { __mockSkImage: true, uri } : null), [uri]),
      vec: (x = 0, y = 0) => ({ x, y }),
    };
  }
  if (request === 'expo-linear-gradient') {
    return {
      LinearGradient: (props) => React.createElement('LinearGradient', props, props.children),
    };
  }
  if (request === 'expo-image-picker') {
    return {
      MediaTypeOptions: { Images: 'Images', Videos: 'Videos', All: 'All' },
      requestMediaLibraryPermissionsAsync: (...args) =>
        global.__imagePickerMock?.requestMediaLibraryPermissionsAsync
          ? global.__imagePickerMock.requestMediaLibraryPermissionsAsync(...args)
          : Promise.resolve({ status: 'granted', granted: true }),
      launchImageLibraryAsync: (...args) =>
        global.__imagePickerMock?.launchImageLibraryAsync
          ? global.__imagePickerMock.launchImageLibraryAsync(...args)
          : Promise.resolve({ canceled: true, assets: null }),
    };
  }
  if (request === 'expo-image-manipulator') {
    return {
      SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
      FlipType: { Horizontal: 'horizontal', Vertical: 'vertical' },
      manipulateAsync: (...args) =>
        global.__imageManipulatorMock?.manipulateAsync
          ? global.__imageManipulatorMock.manipulateAsync(...args)
          : Promise.resolve({
              uri: args[0] ? `${args[0]}.manipulated.jpg` : 'file:///tmp/manipulated.jpg',
              width: 600,
              height: 600,
            }),
    };
  }
  if (request === 'expo-notifications') {
    return require('./mocks/notificationsMock');
  }
  if (request === 'react-native-gesture-handler') {
    const createMockPanGesture = () => {
      const state = {
        enabled: true,
        handlers: {},
      };
      const api = {
        _state: state,
        enabled: (val) => {
          state.enabled = val;
          return api;
        },
        minDistance: () => api,
        activeOffsetY: () => api,
        activeOffsetX: () => api,
        failOffsetX: () => api,
        failOffsetY: () => api,
        onBegin: (cb) => {
          state.handlers.onBegin = cb;
          return api;
        },
        onStart: (cb) => {
          state.handlers.onStart = cb;
          return api;
        },
        onUpdate: (cb) => {
          state.handlers.onUpdate = cb;
          return api;
        },
        onEnd: (cb) => {
          state.handlers.onEnd = cb;
          return api;
        },
        onFinalize: (cb) => {
          state.handlers.onFinalize = cb;
          return api;
        },
      };
      return api;
    };

    return {
      GestureHandlerRootView: (props) =>
        React.createElement('GestureHandlerRootView', props, props.children),
      GestureDetector: (props) =>
        React.createElement('GestureDetector', props, props.children),
      Gesture: {
        Pan: createMockPanGesture,
      },
      PanGestureHandler: React.forwardRef((props, ref) =>
        React.createElement('PanGestureHandler', { ...props, ref }, props.children)
      ),
      ScrollView: React.forwardRef((props, ref) =>
        React.createElement('ScrollView', { ...props, ref }, props.children)
      ),
      State: {
        UNDETERMINED: 0,
        FAILED: 1,
        BEGAN: 2,
        CANCELLED: 3,
        ACTIVE: 4,
        END: 5,
      },
    };
  }
  if (request === 'react-native-reanimated') {
    return {
      __esModule: true,
      default: {
        View: rnMock.View,
        Text: rnMock.Text,
        ScrollView: rnMock.ScrollView,
        createAnimatedComponent: (Comp) => Comp,
      },
      useSharedValue: (val) => {
        const ref = React.useRef(null);
        if (!ref.current) {
          ref.current = { value: val };
        }
        return ref.current;
      },
      useAnimatedStyle: (fn) => {
        const fnRef = React.useRef(fn);
        fnRef.current = fn;
        const styleRef = React.useRef(null);
        if (!styleRef.current) {
          styleRef.current = new Proxy(
            {},
            {
              get: (_target, prop) => fnRef.current()?.[prop],
              has: (_target, prop) => prop in (fnRef.current() || {}),
              ownKeys: () => Object.keys(fnRef.current() || {}),
              getOwnPropertyDescriptor: (_target, prop) => {
                const obj = fnRef.current() || {};
                if (prop in obj) {
                  return { enumerable: true, configurable: true, value: obj[prop] };
                }
                return undefined;
              },
            }
          );
        }
        return styleRef.current;
      },
      useAnimatedReaction: () => {},
      useAnimatedRef: () => ({ current: null }),
      scrollTo: () => {},
      cancelAnimation: () => {},
      runOnJS: (fn) => (...args) => fn(...args),
      runOnUI: (fn) => (...args) => fn(...args),
      withTiming: (val, _config, cb) => {
        if (typeof cb === 'function') cb(true);
        return val;
      },
      withSpring: (val) => val,
    };
  }
  if (request === 'react-native-svg') {
    return new Proxy(
      {},
      {
        get: (target, prop) => {
          if (prop === '__esModule') return true;
          return (props) => React.createElement('SvgElement', { tag: String(prop), ...props });
        },
      }
    );
  }

  return originalLoad.apply(this, arguments);
};

// Global test helper: flush microtasks and timeouts
global.flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
