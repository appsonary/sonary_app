const test = require('node:test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const React = require('react');
const renderer = require('react-test-renderer');
require('./setup');

const TrackCard = require('../components/TrackCard').default;
const NavigationTabBar = require('../components/NavigationTabBar').default;
const {
  computeAndroidAssetsHash,
  syncGradleVersions,
  syncAndroidAppName,
} = require('../scripts/patch-android');
const { patchTrackPlayerMusicService } = require('../plugins/withTrackPlayerFGS');

test('Android icon cache guard: app.json bumps versionCode and patch-android.js syncs Gradle & detects asset hash changes', () => {
  const rootDir = path.resolve(__dirname, '..');
  const appJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'app.json'), 'utf8'));

  assert.strictEqual(appJson.expo?.name, 'Sonary', 'app.json expo.name must be "Sonary"');
  assert.ok(
    Number.isInteger(appJson.expo?.android?.versionCode) && appJson.expo.android.versionCode >= 3,
    `app.json expo.android.versionCode should be >= 3 (got ${appJson.expo?.android?.versionCode})`
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonary-patch-test-'));
  try {
    const tmpAppJsonPath = path.join(tmpRoot, 'app.json');
    const tmpAssetsDir = path.join(tmpRoot, 'assets');
    const tmpGradlePath = path.join(tmpRoot, 'build.gradle');
    const tmpAndroidDir = path.join(tmpRoot, 'android');
    const tmpValuesDir = path.join(tmpAndroidDir, 'app', 'src', 'main', 'res', 'values');
    fs.mkdirSync(tmpAssetsDir, { recursive: true });
    fs.mkdirSync(tmpValuesDir, { recursive: true });
    fs.writeFileSync(
      tmpAppJsonPath,
      JSON.stringify({
        expo: {
          name: 'Sonary',
          version: '1.0.5',
          icon: './assets/icon.png',
          android: {
            versionCode: 7,
            adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#000000' },
          },
        },
      })
    );
    fs.writeFileSync(path.join(tmpAssetsDir, 'icon.png'), 'icon-v1');
    fs.writeFileSync(path.join(tmpAssetsDir, 'adaptive-icon.png'), 'adaptive-v1');
    fs.writeFileSync(
      tmpGradlePath,
      'defaultConfig {\n  versionCode 1\n  versionName "1.0.0"\n}\n'
    );
    fs.writeFileSync(
      path.join(tmpValuesDir, 'strings.xml'),
      '<resources>\n  <string name="app_name">Sonary Pro</string>\n</resources>\n'
    );
    fs.writeFileSync(
      path.join(tmpAndroidDir, 'settings.gradle'),
      "rootProject.name = 'Sonary Pro'\n"
    );

    const hash1 = computeAndroidAssetsHash(tmpRoot);
    fs.writeFileSync(path.join(tmpAssetsDir, 'adaptive-icon.png'), 'adaptive-v2');
    const hash2 = computeAndroidAssetsHash(tmpRoot);
    assert.notStrictEqual(hash1, hash2, 'Assets hash must change when adaptive-icon.png changes');

    const synced = syncGradleVersions(tmpGradlePath, JSON.parse(fs.readFileSync(tmpAppJsonPath, 'utf8')));
    assert.strictEqual(synced, true, 'syncGradleVersions should update mismatched versionCode/versionName');
    const updatedGradle = fs.readFileSync(tmpGradlePath, 'utf8');
    assert.ok(updatedGradle.includes('versionCode 7'), 'Gradle versionCode should match app.json');
    assert.ok(updatedGradle.includes('versionName "1.0.5"'), 'Gradle versionName should match app.json');

    const nameSynced = syncAndroidAppName(tmpAndroidDir, JSON.parse(fs.readFileSync(tmpAppJsonPath, 'utf8')));
    assert.strictEqual(nameSynced, true, 'syncAndroidAppName should update strings.xml and settings.gradle');
    assert.ok(
      fs.readFileSync(path.join(tmpValuesDir, 'strings.xml'), 'utf8').includes('<string name="app_name">Sonary</string>'),
      'strings.xml app_name must match app.json name'
    );
    assert.ok(
      fs.readFileSync(path.join(tmpAndroidDir, 'settings.gradle'), 'utf8').includes("rootProject.name = 'Sonary'"),
      'settings.gradle rootProject.name must match app.json name'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('NavigationTabBar renders 4 equal tabs including Apoiar and continuous SVG LinearGradient overlay', () => {
  let lastTab = null;
  let tree;
  renderer.act(() => {
    tree = renderer.create(
      React.createElement(NavigationTabBar, {
        activeTab: 'support',
        onTabChange: (tab) => {
          lastTab = tab;
        },
        playlistCount: 2,
        downloadCount: 1,
      })
    );
  });

  const fadeContainer = tree.root.findByProps({ testID: 'spotify-nav-fade' });
  const linearGradients = fadeContainer.findAll((n) => n.props?.tag === 'LinearGradient');
  const stops = fadeContainer.findAll((n) => n.props?.tag === 'Stop');

  assert.strictEqual(linearGradients.length, 1, 'Expected a single continuous SVG LinearGradient');
  assert.ok(stops.length >= 8, `Expected smooth multi-stop gradient (got ${stops.length})`);

  const tabs = tree.root
    .findAllByType('TouchableOpacity')
    .filter((n) => n.props?.accessibilityRole === 'tab');
  assert.strictEqual(tabs.length, 4, 'NavigationTabBar must render 4 equal tabs');
  const supportTab = tabs.find((t) => t.props?.accessibilityLabel === 'Apoiar');
  assert.ok(supportTab, '4th tab must have accessibilityLabel="Apoiar"');
  assert.strictEqual(supportTab.props.accessibilityState?.selected, true);
  assert.strictEqual(supportTab.props.style?.flex, 1);

  const heartIcon = supportTab.find(
    (n) => n.type === 'VectorIcon' && n.props?.family === 'MaterialCommunityIcons'
  );
  assert.strictEqual(heartIcon.props.name, 'hand-heart');
  assert.strictEqual(heartIcon.props.size, 22);
  assert.strictEqual(heartIcon.props.color, '#FFFFFF');

  renderer.act(() => {
    tabs[0].props.onPress();
  });
  assert.strictEqual(lastTab, 'search');

  renderer.act(() => {
    tree.update(
      React.createElement(NavigationTabBar, {
        activeTab: 'search',
        onTabChange: () => {},
        playlistCount: 2,
        downloadCount: 1,
      })
    );
  });
  const inactiveHeartIcon = tree.root
    .findAllByType('TouchableOpacity')
    .find((n) => n.props?.accessibilityLabel === 'Apoiar')
    .find((n) => n.type === 'VectorIcon' && n.props?.family === 'MaterialCommunityIcons');
  assert.strictEqual(inactiveHeartIcon.props.name, 'hand-heart-outline');
  assert.strictEqual(inactiveHeartIcon.props.color, '#B3B3B3');
});

test('Animation UI-thread audit: zero useNativeDriver: false, isolated useProgress, and lazy TrackContextSheet', async () => {
  const rootDir = path.resolve(__dirname, '..');
  const trackCardSrc = fs.readFileSync(path.join(rootDir, 'components', 'TrackCard.tsx'), 'utf8');
  const nowPlayingSrc = fs.readFileSync(
    path.join(rootDir, 'components', 'NowPlayingModal.tsx'),
    'utf8'
  );

  assert.strictEqual(
    /useNativeDriver\s*:\s*false/.test(trackCardSrc),
    false,
    'TrackCard.tsx must never use useNativeDriver: false'
  );
  assert.strictEqual(
    /useNativeDriver\s*:\s*false/.test(nowPlayingSrc),
    false,
    'NowPlayingModal.tsx must never use useNativeDriver: false'
  );

  const nowPlayingBody = nowPlayingSrc.slice(
    nowPlayingSrc.indexOf('export default function NowPlayingModal')
  );
  assert.strictEqual(
    /\buseProgress\s*\(/.test(nowPlayingBody),
    false,
    'Root NowPlayingModal must not call useProgress(250) directly'
  );

  let cardTree;
  await renderer.act(async () => {
    cardTree = renderer.create(
      React.createElement(TrackCard, {
        track: { id: 't1', title: 'Track One', artist: 'Artist One', duration: 180 },
        onPress: () => {},
        onAddToPlaylist: () => {},
      })
    );
  });

  assert.strictEqual(
    cardTree.root.findAllByType('Modal').length,
    0,
    'Closed TrackCard must not eagerly mount its bottom sheet Modal'
  );

  // PanGestureHandler com Animated.event(..., { useNativeDriver: true }) exige Animated.View como filho direto no Hermes/Android
  const horizontalPanSnippet = nowPlayingSrc.slice(
    nowPlayingSrc.indexOf('testID="player-horizontal-pan"'),
    nowPlayingSrc.indexOf('testID="player-horizontal-pan"') + 1200
  );
  assert.ok(
    horizontalPanSnippet.includes('<Animated.View style={styles.container}>'),
    'player-horizontal-pan must wrap an Animated.View so native Animated.event attaches cleanly without RCTView error'
  );
  assert.ok(
    /\.onEnd\([\s\S]{0,400}basePositionsSV\.value = \{ \.\.\.positionsSV\.value \}/.test(
      nowPlayingSrc
    ) && nowPlayingSrc.includes('stableQueueKeysRef'),
    'Queue drop must commit basePositionsSV atomically on UI thread in onEnd and keep React DOM order fixed'
  );
  assert.ok(
    nowPlayingSrc.includes('renderToHardwareTextureAndroid={!isQueueSheetVisible && !showContextMenu}'),
    'NowPlayingModal must disable outer hardware texture layer when queue or context sheet is open'
  );
  const queueSheetSnippet = nowPlayingSrc.slice(
    nowPlayingSrc.indexOf('styles.queueSheetContainer') - 120,
    nowPlayingSrc.indexOf('styles.queueSheetContainer') + 120
  );
  assert.strictEqual(
    queueSheetSnippet.includes('renderToHardwareTextureAndroid'),
    false,
    'queueSheetContainer must not permanently enable renderToHardwareTextureAndroid while reordering rows'
  );
  const queueThumbSnippet = nowPlayingSrc.slice(
    nowPlayingSrc.indexOf('styles.queueThumbImg') - 180,
    nowPlayingSrc.indexOf('styles.queueThumbImg') + 60
  );
  assert.ok(
    queueThumbSnippet.includes('fadeDuration={0}'),
    'QueueTrackRow artwork thumbnail must set fadeDuration={0} to prevent Android drop flash'
  );
  const appSrc = fs.readFileSync(path.join(rootDir, 'App.tsx'), 'utf8');
  assert.ok(
    appSrc.includes('upcomingQueue') && appSrc.includes('queue={upcomingQueue}'),
    'App.tsx must pass memoized upcomingQueue prop to NowPlayingModal'
  );
});

test('TrackPlayer MusicService guard: patchTrackPlayerMusicService skips NotificationForwarderActivity task removal idempotently', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonary-rntp-guard-'));
  try {
    const svcDir = path.join(
      tmpRoot,
      'node_modules',
      'react-native-track-player',
      'android',
      'src',
      'main',
      'java',
      'com',
      'doublesymmetry',
      'trackplayer',
      'service'
    );
    fs.mkdirSync(svcDir, { recursive: true });
    const svcPath = path.join(svcDir, 'MusicService.kt');
    fs.writeFileSync(
      svcPath,
      'class MusicService {\n  override fun onTaskRemoved(rootIntent: Intent?) {\n    super.onTaskRemoved(rootIntent)\n    if (!::player.isInitialized) return\n  }\n}\n'
    );

    assert.strictEqual(patchTrackPlayerMusicService(tmpRoot), true);
    const patched = fs.readFileSync(svcPath, 'utf8');
    assert.ok(
      patched.includes('if (rootIntent?.component?.className == "expo.modules.notifications.service.NotificationForwarderActivity") return'),
      'MusicService.onTaskRemoved should ignore NotificationForwarderActivity task removal'
    );
    assert.strictEqual(patchTrackPlayerMusicService(tmpRoot), false, 'Second call must be idempotent');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});


