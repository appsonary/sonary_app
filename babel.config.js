module.exports = function (api) {
  api.cache.using(() => process.env.EXPO_PUBLIC_DEV_MENU ?? '');
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated/plugin deve ser o último plugin declarado
      'react-native-reanimated/plugin',
    ],
  };
};
