// tests/side_drawer_menu.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const { SideDrawerMenu } = require('../components/SideDrawerMenu');
const { initDatabase, savePlaybackSession } = require('../services/database');
const { Animated, BackHandler, Dimensions } = require('./mocks/reactNativeMock');
const { actAsync, getAllText, resetAllMocks } = require('./helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test('SideDrawerMenu: hidden when closed, renders editorial layout, badges, and triggers actions on press', async () => {
  let closedTree;
  await actAsync(async () => {
    closedTree = renderer.create(
      React.createElement(SideDrawerMenu, {
        visible: false,
        onClose: () => {},
        onOpenDownloadQueue: () => {},
        onOpenRecentHistory: () => {},
        onOpenStats: () => {},
        onOpenUpdates: () => {},
        onOpenSettings: () => {},
        onOpenSupport: () => {},
      })
    );
  });
  assert.strictEqual(closedTree.toJSON(), null, 'SideDrawerMenu must render null when closed');

  const calls = [];
  const progress = new Animated.Value(0);
  const envKey = 'EXPO_PUBLIC_DEV_MENU';
  const prevEnv = process.env[envKey];
  const prevDev = global.__DEV__;
  global.__DEV__ = true;
  let openTree;
  try {
    await actAsync(async () => {
      openTree = renderer.create(
        React.createElement(SideDrawerMenu, {
          visible: true,
          progress,
          installedVersion: { versionName: '1.0.4', versionCode: 6 },
          availableUpdate: {
            versionName: '1.0.5',
            versionCode: 7,
            apkName: 'sonary-pro-v1.0.5.apk',
            apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.0.5/sonary-pro-v1.0.5.apk',
            sha256: null,
            sizeBytes: null,
            releaseNotes: '',
            releaseUrl: 'https://github.com/appsonary/sonary_app/releases/tag/v1.0.5',
          },
          downloadQueueCount: 4,
          isDevMode: true,
          onClose: () => calls.push('close'),
          onOpenDownloadQueue: () => calls.push('downloads'),
          onOpenRecentHistory: () => calls.push('recents'),
          onOpenStats: () => calls.push('stats'),
          onOpenUpdates: () => calls.push('updates'),
          onOpenSettings: () => calls.push('settings'),
          onOpenDevMenu: () => calls.push('dev'),
          onOpenSupport: () => calls.push('support'),
        })
      );
    });

    const root = openTree.root;
    const text = getAllText(root);
    assert.ok(text.includes('Sonary Pro'), 'Must display Sonary Pro brand label in footer');
    assert.ok(text.includes('v1.0.4'), 'Must display installed version pill');
    assert.ok(text.includes('Apoiar o Sonary'));
    assert.ok(text.includes('Fila de downloads'));
    assert.ok(text.includes('Histórico recente'));
    assert.ok(text.includes('Estatísticas'));
    assert.ok(text.includes('Configurações'));
    assert.ok(text.includes('Modo Desenvolvedor'));
    assert.strictEqual(text.includes('Novidades'), false, 'Novidades must be removed from SideDrawerMenu');
    assert.strictEqual(text.includes('Verificar'), false, 'Verificar must be removed from SideDrawerMenu');
    assert.ok(text.includes('Nova versão v1.0.5 disponível'), 'Must display available version in footer without mentioning GitHub');
    assert.strictEqual(/github/i.test(text), false, 'SideDrawerMenu must not mention GitHub');
    assert.ok(text.includes('Atualizar'), 'Must display Atualizar CTA when update is available');

    const header = root.find(
      (n) => n.type === 'View' && n.props && n.props.testID === 'drawer-header'
    );
    const headerBrand = root.find(
      (n) => n.type === 'View' && n.props && n.props.testID === 'drawer-header-brand'
    );
    const backBtn = header.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Voltar'
    );
    assert.ok(backBtn.find((n) => n.type === 'LucideIcon' && n.props.name === 'ArrowLeft'));
    assert.strictEqual(header.props.style.flexDirection, 'row');
    assert.strictEqual(header.props.style.justifyContent, 'space-between');
    assert.strictEqual(headerBrand.props.style.alignItems, 'flex-end');
    assert.strictEqual(header.children[0].props.accessibilityLabel, 'Voltar');
    assert.strictEqual(header.children[1].props.testID, 'drawer-header-brand');
    const logoImg = headerBrand.find(
      (n) => n.type === 'Image' && n.props.accessibilityLabel === 'Sonary'
    );
    assert.ok(logoImg, 'Drawer header must render original Sonary logo image on the right');

    const panel = root.find((n) => n.props && n.props.testID === 'side-drawer-panel');
    const menuLabels = panel
      .findAll((n) => n.type === 'TouchableOpacity')
      .map((btn) => btn.props && btn.props.accessibilityLabel)
      .filter(
        (label) =>
          label &&
          label !== 'Atualizar' &&
          label !== 'Atualizações do aplicativo' &&
          label !== 'Voltar'
      );
    assert.deepStrictEqual(
      menuLabels,
      [
        'Apoiar o Sonary',
        'Fila de downloads',
        'Histórico recente',
        'Estatísticas',
        'Configurações',
        'Modo Desenvolvedor',
      ],
      'Apoiar o Sonary must be the first option followed by grouped items without Novidades'
    );
    assert.ok(text.includes('Ajude a manter o projeto vivo'));
    assert.ok(
      root.find((n) => n.type === 'View' && n.props && n.props.testID === 'drawer-menu-group'),
      'Core items must render inside grouped card container'
    );

    const downloadsPill = root.find((n) => n.props && n.props.testID === 'drawer-downloads-pill');
    assert.ok(getAllText(downloadsPill).includes('4'), 'Downloads count pill must display 4');

    const recentsBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Histórico recente'
    );
    assert.ok(
      recentsBtn.find((n) => n.type === 'LucideIcon' && n.props.name === 'History'),
      'Histórico recente must render History icon'
    );

    const panelStyle = Object.assign({}, ...[].concat(panel.props.style).filter(Boolean));
    assert.strictEqual(panelStyle.backgroundColor, '#0B0B0C');

    // Minimalist surface: no LinearGradient glows, no right chevrons, bare back button, flat footer
    assert.strictEqual(root.findAllByType('LinearGradient').length, 0);
    assert.strictEqual(
      panel.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'ChevronRight').length,
      0,
      'Menu items must not render trailing chevrons'
    );
    assert.strictEqual(backBtn.props.style.borderWidth, undefined, 'Back button must be bare without border');
    assert.ok(
      root.find((n) => n.type === 'View' && n.props && n.props.testID === 'drawer-dev-divider'),
      'Hairline divider must separate main items from Modo Desenvolvedor'
    );
    const footer = root.find((n) => n.props && n.props.testID === 'drawer-footer-card');
    assert.strictEqual(footer.props.style.backgroundColor, undefined, 'Footer must be flat without card background');
    assert.strictEqual(footer.props.style.borderTopWidth, 1, 'Footer must have subtle top hairline divider');

    // Tap Support action -> closes smoothly then executes callback
    const supportBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Apoiar o Sonary'
    );
    await actAsync(async () => {
      supportBtn.props.onPress();
    });
    assert.deepStrictEqual(calls, ['close', 'support']);

    // Up-to-date footer omits Verificar button and production hides Modo Desenvolvedor even if isDevMode=true
    global.__DEV__ = false;
    delete process.env[envKey];
    let prodUpToDateTree;
    await actAsync(async () => {
      prodUpToDateTree = renderer.create(
        React.createElement(SideDrawerMenu, {
          visible: true,
          installedVersion: { versionName: '1.0.4', versionCode: 6 },
          availableUpdate: null,
          isDevMode: true,
          onClose: () => {},
          onOpenDownloadQueue: () => {},
          onOpenRecentHistory: () => {},
          onOpenStats: () => {},
          onOpenUpdates: () => {},
          onOpenSettings: () => {},
          onOpenDevMenu: () => {},
          onOpenSupport: () => {},
        })
      );
    });
    const prodText = getAllText(prodUpToDateTree.root);
    assert.ok(prodText.includes('Sonary Pro'));
    assert.ok(prodText.includes('v1.0.4'));
    assert.ok(prodText.includes('Atualizado'));
    assert.ok(prodText.includes('Vazia'), 'Empty download queue must show Vazia badge');
    assert.strictEqual(prodText.includes('Verificar'), false, 'Verificar text must not exist when up-to-date');
    assert.strictEqual(prodText.includes('Novidades'), false, 'Novidades must not exist');
    assert.strictEqual(
      prodText.includes('Modo Desenvolvedor'),
      false,
      'Modo Desenvolvedor must never appear outside dev mode'
    );

    await actAsync(async () => {
      closedTree.unmount();
      openTree.unmount();
      prodUpToDateTree.unmount();
    });
  } finally {
    if (prevDev === undefined) delete global.__DEV__;
    else global.__DEV__ = prevDev;
    if (prevEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = prevEnv;
  }
});

test('SideDrawerMenu: dismisses on Android Back button, scrim tap, and swipe-right gesture', async () => {
  let closeCount = 0;
  let tree;

  // 1. Android hardware back closes drawer
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SideDrawerMenu, {
        visible: true,
        onClose: () => {
          closeCount += 1;
        },
        onOpenDownloadQueue: () => {},
        onOpenRecentHistory: () => {},
        onOpenStats: () => {},
        onOpenUpdates: () => {},
        onOpenSettings: () => {},
        onOpenSupport: () => {},
      })
    );
  });
  assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  assert.strictEqual(closeCount, 1);

  await actAsync(async () => {
    tree.unmount();
  });

  // 2. Scrim tap closes drawer
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SideDrawerMenu, {
        visible: true,
        onClose: () => {
          closeCount += 1;
        },
        onOpenDownloadQueue: () => {},
        onOpenRecentHistory: () => {},
        onOpenStats: () => {},
        onOpenUpdates: () => {},
        onOpenSettings: () => {},
        onOpenSupport: () => {},
      })
    );
  });
  const scrimBtn = tree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fechar menu'
  );
  await actAsync(async () => {
    scrimBtn.props.onPress();
  });
  assert.strictEqual(closeCount, 2);

  await actAsync(async () => {
    tree.unmount();
  });

  // 2b. Header Back button closes drawer
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SideDrawerMenu, {
        visible: true,
        onClose: () => {
          closeCount += 1;
        },
        onOpenDownloadQueue: () => {},
        onOpenRecentHistory: () => {},
        onOpenStats: () => {},
        onOpenUpdates: () => {},
        onOpenSettings: () => {},
        onOpenSupport: () => {},
      })
    );
  });
  const backBtn = tree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Voltar'
  );
  await actAsync(async () => {
    backBtn.props.onPress();
  });
  assert.strictEqual(closeCount, 3);

  await actAsync(async () => {
    tree.unmount();
  });

  // 3. Swipe right beyond 25% of drawer width closes drawer
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SideDrawerMenu, {
        visible: true,
        onClose: () => {
          closeCount += 1;
        },
        onOpenDownloadQueue: () => {},
        onOpenRecentHistory: () => {},
        onOpenStats: () => {},
        onOpenUpdates: () => {},
        onOpenSettings: () => {},
        onOpenSupport: () => {},
      })
    );
  });
  const panel = tree.root.find((n) => n.props && n.props.testID === 'side-drawer-panel');
  const drawerWidth = Dimensions.get('window').width * 0.78;
  await actAsync(async () => {
    panel.props.onResponderRelease({}, { dx: drawerWidth * 0.4, dy: 0, vx: 0.1 });
  });
  assert.strictEqual(closeCount, 4);

  await actAsync(async () => {
    tree.unmount();
  });
});

test('App integration: persistent mini player renders inside 3D perspective shell underneath SideDrawerMenu', async () => {
  await savePlaybackSession({
    track: {
      id: 'kate_1',
      title: 'Running Up That Hill',
      artist: 'KateBushMusic',
      duration: 298,
      thumbnailUrl: 'https://example.com/kate.jpg',
    },
    positionSec: 15,
    playlistContext: { type: 'search' },
    savedAt: Date.now(),
  });

  const prevRaf = global.requestAnimationFrame;
  const prevCancelRaf = global.cancelAnimationFrame;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);

  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    const menuBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir menu'
    );
    await actAsync(async () => {
      menuBtn.props.onPress();
    });

    const shellLayer = root.find(
      (n) => n.props && n.props.testID === 'app-shell-perspective-layer'
    );
    const drawerOverlay = root.find(
      (n) => n.props && n.props.testID === 'side-drawer-overlay'
    );

    assert.ok(
      shellLayer.findAll((n) => n.props && n.props.testID === 'now-playing-modal-content').length > 0,
      'Persistent mini player / NowPlayingModal must live inside app-shell-perspective-layer so it scales and shifts with the shell'
    );
    assert.strictEqual(
      shellLayer.findAll((n) => n.props && n.props.testID === 'side-drawer-overlay').length,
      0,
      'SideDrawerMenu must stay outside app-shell-perspective-layer above the mini player'
    );

    const safeArea = root.findByType('SafeAreaView');
    const shellIdx = safeArea.children.findIndex(
      (c) => c.props && c.props.testID === 'app-shell-perspective-layer'
    );
    const drawerIdx = safeArea.children.findIndex(
      (c) =>
        typeof c.findAll === 'function' &&
        c.findAll((n) => n.props && n.props.testID === 'side-drawer-overlay').length > 0
    );
    assert.ok(shellIdx >= 0 && drawerIdx > shellIdx, 'SideDrawerMenu must render after appShell in SafeAreaView');
    assert.ok(drawerOverlay, 'SideDrawerMenu overlay must be visible');
  } finally {
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
    global.requestAnimationFrame = prevRaf;
    global.cancelAnimationFrame = prevCancelRaf;
  }
});

test('App integration: BrandHeader opens SideDrawerMenu with 3D perspective shell and runs menu actions', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  const shellLayer = root.find(
    (n) => n.props && n.props.testID === 'app-shell-perspective-layer'
  );
  const closedStyle = Object.assign({}, ...[].concat(shellLayer.props.style).filter(Boolean));
  assert.strictEqual(closedStyle.borderRadius, undefined);
  assert.strictEqual(closedStyle.transform[0].translateX._value, 0);

  // Open drawer via BrandHeader hamburger button
  const menuBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir menu'
  );
  await actAsync(async () => {
    menuBtn.props.onPress();
  });

  const openShellLayer = root.find(
    (n) => n.props && n.props.testID === 'app-shell-perspective-layer'
  );
  const openStyle = Object.assign({}, ...[].concat(openShellLayer.props.style).filter(Boolean));
  assert.strictEqual(openStyle.overflow, 'hidden');
  assert.strictEqual(openStyle.borderRadius, undefined);
  assert.strictEqual(openStyle.transform.length, 1);
  assert.strictEqual(
    openStyle.transform[0].translateX._value,
    -Dimensions.get('window').width * 0.78
  );

  // Tapping Histórico recente closes drawer and shows info toast
  const recentsBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Histórico recente'
  );
  await actAsync(async () => {
    recentsBtn.props.onPress();
  });
  assert.ok(getAllText(root).includes('Em breve no Sonary'));
  assert.strictEqual(
    root.findAll((n) => n.props && n.props.testID === 'side-drawer-overlay').length,
    0,
    'Drawer must close after selecting an item'
  );

  // Re-open drawer and navigate to Apoiar o Sonary
  await actAsync(async () => {
    menuBtn.props.onPress();
  });
  const supportBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Apoiar o Sonary'
  );
  await actAsync(async () => {
    supportBtn.props.onPress();
  });
  assert.ok(getAllText(root).includes('Apoie o Sonary'), 'Must navigate to support tab');

  await actAsync(async () => {
    tree.unmount();
  });
});
