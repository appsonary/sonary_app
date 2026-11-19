const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');

const FORWARDER_ACTIVITY_CLASS = 'expo.modules.notifications.service.NotificationForwarderActivity';
const DOWNLOADS_RUNNING_PROP = 'sonary.downloads.running';
const UPDATER_RUNNING_PROP = 'sonary.updater.running';

/**
 * Evita que o fechamento da task temporária NotificationForwarderActivity (expo-notifications)
 * acione StopPlaybackAndRemoveNotification -> exitProcess(0) no MusicService do RNTP,
 * e impede que exitProcess(0) mate o processo enquanto houver downloads de músicas ou
 * atualizações do app em segundo plano ativos.
 */
function patchTrackPlayerMusicService(projectRoot) {
  const musicServicePath = path.join(
    projectRoot,
    'node_modules',
    'react-native-track-player',
    'android',
    'src',
    'main',
    'java',
    'com',
    'doublesymmetry',
    'trackplayer',
    'service',
    'MusicService.kt'
  );
  if (!fs.existsSync(musicServicePath)) return false;

  const content = fs.readFileSync(musicServicePath, 'utf8');
  let nextContent = content;

  if (!nextContent.includes(FORWARDER_ACTIVITY_CLASS)) {
    const targetRegex = /(override\s+fun\s+onTaskRemoved\s*\([^)]*\)\s*\{\s*\r?\n\s*super\.onTaskRemoved\([^)]*\))/;
    if (targetRegex.test(nextContent)) {
      nextContent = nextContent.replace(
        targetRegex,
        `$1\n\n        // Ignora remoção de task transitória da notificação para não encerrar o app com exitProcess(0).\n        if (rootIntent?.component?.className == "${FORWARDER_ACTIVITY_CLASS}") return`
      );
    }
  }

  if (!nextContent.includes(UPDATER_RUNNING_PROP)) {
    const legacyGuardRegex = new RegExp(
      `if\\s*\\(System\\.getProperty\\("${DOWNLOADS_RUNNING_PROP}"\\)\\s*!=\\s*"true"\\)`
    );
    if (legacyGuardRegex.test(nextContent)) {
      nextContent = nextContent.replace(
        legacyGuardRegex,
        `if (System.getProperty("${DOWNLOADS_RUNNING_PROP}") != "true" && System.getProperty("${UPDATER_RUNNING_PROP}") != "true")`
      );
    } else if (/(\r?\n[ \t]*)exitProcess\(0\)/.test(nextContent)) {
      nextContent = nextContent.replace(
        /(\r?\n)([ \t]*)exitProcess\(0\)/,
        `$1$2if (System.getProperty("${DOWNLOADS_RUNNING_PROP}") != "true" && System.getProperty("${UPDATER_RUNNING_PROP}") != "true") {\n$2    exitProcess(0)\n$2}`
      );
    }
  }

  if (nextContent === content) return false;
  fs.writeFileSync(musicServicePath, nextContent, 'utf8');
  return true;
}

/**
 * Expo Config Plugin para Android 14+ (API 34) Foreground Service (RNTP)
 *
 * Injeta o tipo de foreground service obrigatório ("mediaPlayback"),
 * define android:exported="true" no MusicService do react-native-track-player
 * e protege MusicService.onTaskRemoved contra tasks transitórias de notificação.
 */
const withTrackPlayerFGS = (config) => {
  config = withAndroidManifest(config, async (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    mainApplication.service = mainApplication.service || [];

    const serviceName = 'com.doublesymmetry.trackplayer.service.MusicService';
    let service = mainApplication.service.find(
      (s) => s.$ && s.$['android:name'] === serviceName
    );

    if (service) {
      service.$['android:foregroundServiceType'] = 'mediaPlayback';
      service.$['android:exported'] = 'true';
    } else {
      mainApplication.service.push({
        $: {
          'android:name': serviceName,
          'android:foregroundServiceType': 'mediaPlayback',
          'android:exported': 'true',
        },
      });
    }

    return config;
  });

  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      patchTrackPlayerMusicService(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);

  return config;
};

withTrackPlayerFGS.patchTrackPlayerMusicService = patchTrackPlayerMusicService;
module.exports = withTrackPlayerFGS;
