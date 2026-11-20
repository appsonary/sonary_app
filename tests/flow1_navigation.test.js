// tests/flow1_navigation.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const {
  actAsync,
  findButtonByText,
  findTextNodes,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const { initDatabase } = require('../services/database');
const { Clipboard } = require('./mocks/reactNativeMock');
const { mockPlayer } = require('./mocks/trackPlayerMock');
const YouTubeMusicSidebar = require('../components/YouTubeMusicSidebar').default;

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test('Flow 1: Initial rendering displays brand header and default search tab', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Verify brand header logo & slogan
  const brandLogo = root.find(
    (n) => n.type === 'Image' && n.props && n.props.accessibilityLabel === 'Sonary'
  );
  assert.ok(brandLogo, 'Brand logo image must exist in initial render');
  const brandText = getAllText(root);
  assert.strictEqual(brandText.includes('Só você e a música'), false);

  // Verify tab buttons exist
  const searchTabBtn = findButtonByText(root, 'Buscar');
  const playlistsTabBtn = findButtonByText(root, 'Playlists');
  const downloadsTabBtn = findButtonByText(root, 'Baixadas');
  const supportTabBtn = findButtonByText(root, 'Apoiar');

  assert.ok(searchTabBtn, 'Tab button "Buscar" must exist');
  assert.ok(playlistsTabBtn, 'Tab button "Playlists" must exist');
  assert.ok(downloadsTabBtn, 'Tab button "Baixadas" must exist');
  assert.ok(supportTabBtn, 'Tab button "Apoiar" must exist');

  const navFade = root.findByProps({ testID: 'spotify-nav-fade' });
  assert.ok(navFade, 'Bottom NavigationTabBar must render Spotify-style vertical fade gradient');
  const gradientStops = navFade.findAll(
    (n) => n.type === 'SvgElement' && n.props && n.props.tag === 'Stop'
  );
  assert.ok(gradientStops.length >= 8, 'SVG gradient must render smooth multi-stop vertical fade');

  // Verify default tab is 'search' showing playlists 2-column catalog (including Músicas Curtidas)
  const catalog = root.findByProps({ testID: 'search-playlists-catalog' });
  assert.ok(catalog, 'Search initial screen must render playlists catalog');
  assert.ok(brandText.includes('Suas Playlists'));
  assert.ok(brandText.includes('Músicas Curtidas'));
  const favoritesCard = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir playlist Músicas Curtidas'
  );
  assert.ok(favoritesCard, 'Músicas Curtidas card must be clickable in search catalog');
  assert.strictEqual(favoritesCard.props.style?.width, '48%', 'Catalog cards must form a 2-column grid');
  const { StyleSheet } = require('react-native');
  const favGradients = favoritesCard.findAllByType('LinearGradient');
  assert.strictEqual(favGradients.length, 1, 'Músicas Curtidas card must fill the cover directly with ruby gradient without nested box');
  assert.deepStrictEqual(favGradients[0].props.colors, ['#D91B2C', '#7A0B1B']);
  const favCoverStyle = StyleSheet.flatten(favGradients[0].props.style);
  assert.strictEqual(favCoverStyle.width, '100%');
  assert.strictEqual(favCoverStyle.aspectRatio, 1);
  assert.strictEqual(favCoverStyle.borderWidth, 0);
});

test('Flow 1: Navigation to "Playlists" tab loads and displays library and system favorites', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Navigate to Playlists tab
  const playlistsTabBtn = findButtonByText(root, 'Playlists');
  assert.ok(playlistsTabBtn);

  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });

  const contentText = getAllText(root);
  assert.ok(contentText.includes('Sua Biblioteca'), 'Should display "Sua Biblioteca" header');
  assert.ok(contentText.includes('Nova'), 'Should display "Nova" playlist button');
  assert.ok(contentText.includes('Músicas Curtidas'), 'Should display system Favorites card');
});

test('Flow 1: Navigation to "Baixadas" tab displays downloads view', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Navigate to Downloads tab
  const downloadsTabBtn = findButtonByText(root, 'Baixadas');
  assert.ok(downloadsTabBtn);

  await actAsync(async () => {
    downloadsTabBtn.props.onPress();
  });

  const contentText = getAllText(root);
  assert.ok(contentText.includes('Nenhuma música baixada'), 'Should display empty offline message');
  assert.ok(
    contentText.includes('podem ser ouvidas sem internet'),
    'Should display offline description'
  );
});

test('Flow 1: Navigation between all tabs maintains stable state', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // 1. Search -> Playlists
  const playlistsTabBtn = findButtonByText(root, 'Playlists');
  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });
  assert.ok(getAllText(root).includes('Sua Biblioteca'));

  // 2. Playlists -> Downloads
  const downloadsTabBtn = findButtonByText(root, 'Baixadas');
  await actAsync(async () => {
    downloadsTabBtn.props.onPress();
  });
  assert.ok(getAllText(root).includes('Nenhuma música baixada'));

  // 3. Downloads -> Support
  const supportTabBtn = findButtonByText(root, 'Apoiar');
  await actAsync(async () => {
    supportTabBtn.props.onPress();
  });
  assert.ok(getAllText(root).includes('Apoie o Sonary'));

  // 4. Support -> Search
  const searchTabBtn = findButtonByText(root, 'Buscar');
  await actAsync(async () => {
    searchTabBtn.props.onPress();
  });
  const searchScreenText = getAllText(root);
  assert.ok(searchScreenText.includes('Suas Playlists'));
  assert.ok(searchScreenText.includes('O que você quer ouvir?'));
});

test('Flow 1: Support tab renders Pix mock flow, updates amount chips, copies key with toast, and keeps playback active', async () => {
  await mockPlayer.add({
    id: 'track-playing-1',
    url: 'https://example.com/audio.mp3',
    title: 'Música em Execução',
    artist: 'Banda Teste',
    duration: 210,
  });
  await mockPlayer.play();

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const supportTabBtn = findButtonByText(root, 'Apoiar');
  assert.ok(supportTabBtn, 'Tab "Apoiar" must render in NavigationTabBar');

  await actAsync(async () => {
    supportTabBtn.props.onPress();
  });

  assert.strictEqual(
    supportTabBtn.props.accessibilityState?.selected,
    true,
    'Support tab must expose selected accessibilityState'
  );

  const { StyleSheet } = require('react-native');
  const { AtmosphericGradient } = require('../components/AtmosphericGradient');
  const { SupportSection } = require('../components/SupportSection');
  assert.strictEqual(
    root.findAllByType(AtmosphericGradient).length,
    1,
    'Support tab must reuse the single App-level AtmosphericGradient without a duplicate stacked glow'
  );
  const supportRootStyle = StyleSheet.flatten(
    root.findByType(SupportSection).findAllByType('View')[0].props.style
  );
  assert.strictEqual(
    supportRootStyle.backgroundColor,
    'transparent',
    'SupportSection root container must be transparent so the top glow flows seamlessly below BrandHeader'
  );

  const supportText = getAllText(root);
  assert.ok(supportText.includes('PROJETO INDEPENDENTE'), 'Should show eyebrow');
  assert.ok(supportText.includes('Apoie o Sonary'), 'Should show main title');
  assert.ok(
    supportText.includes('divulgando o Sonary para mais pessoas'),
    'Should display friendly sharing message while Pix/QR is hidden'
  );
  assert.strictEqual(
    root.findAll((n) => n.props?.testID === 'support-qr-code').length,
    0,
    'QR code must be hidden by default'
  );
  assert.ok(
    root.findByProps({ testID: 'support-community-card' }),
    'Friendly community card must render when Pix/QR is hidden'
  );
  assert.ok(
    supportText.includes('Música em Execução'),
    'PersistentMiniPlayer must remain visible and playing on Apoiar tab'
  );

  // Preserved Pix/QR flow remains intact when explicitly enabled via showPixSupport
  let pixToast = null;
  let pixTree;
  await actAsync(async () => {
    pixTree = renderer.create(
      React.createElement(SupportSection, {
        showPixSupport: true,
        onShowToast: (msg) => {
          pixToast = msg;
        },
      })
    );
  });
  const pixRoot = pixTree.root;
  const pixText = getAllText(pixRoot);
  assert.ok(pixText.includes('Pix para contribuir'), 'Should show Pix card title');
  assert.strictEqual(
    pixText.includes('00000000-0000-4000-8000-000000000000'),
    false,
    'Raw Pix key must not be exposed visually on screen'
  );
  assert.strictEqual(
    pixText.includes('Sonary App'),
    false,
    'Recipient identifier must not be exposed visually on screen'
  );
  assert.ok(
    pixText.includes('Escaneie o QR Code acima'),
    'Should display clean scan/copy instruction'
  );
  assert.ok(
    pixText.includes('Contribuição voluntária • Sem cobrança recorrente • Acesso livre para todos'),
    'Should show transparency footer'
  );

  const qrSvg = pixRoot.findByProps({ testID: 'support-qr-code' });
  const initialQrPath = qrSvg.find((n) => n.props?.tag === 'Path').props.d;
  assert.ok(initialQrPath && initialQrPath.length > 20, 'QR SVG path must render real QR modules');

  // Default R$ 5 chip is selected (matching fixed bank charge)
  const chip10 = findButtonByText(pixRoot, 'R$ 10');
  const chip25 = findButtonByText(pixRoot, 'R$ 25');
  const chip5 = findButtonByText(pixRoot, 'R$ 5');
  const chipOther = findButtonByText(pixRoot, 'Outro');
  assert.ok(chip5 && chip10 && chip25 && chipOther, 'All 4 amount chips must be rendered');
  assert.strictEqual(chip5.props.accessibilityState?.selected, true, 'R$ 5 must be selected by default');

  // Tap CTA "Copiar código Pix" with default R$ 5 -> must copy exact bank payload verbatim
  const copyBtn = findButtonByText(pixRoot, 'Copiar código Pix');
  assert.ok(copyBtn, 'Primary CTA button "Copiar código Pix" must exist');
  await actAsync(async () => {
    await copyBtn.props.onPress();
  });
  const defaultCopied = await Clipboard.getString();
  assert.strictEqual(
    defaultCopied,
    '00020126580014BR.GOV.BCB.PIX013600000000-0000-4000-8000-00000000000052040000530398654045.005802BR5910SONARY APP6009SAO PAULO61080100100062070503***6304F3E7',
    'Default R$ 5 copy must match mock Pix BR Code'
  );

  // Switch to R$ 10 and verify exact mock payload
  await actAsync(async () => {
    chip10.props.onPress();
  });
  assert.strictEqual(findButtonByText(pixRoot, 'R$ 10').props.accessibilityState?.selected, true);
  await actAsync(async () => {
    await findButtonByText(pixRoot, 'Copiar código Pix').props.onPress();
  });
  assert.strictEqual(
    await Clipboard.getString(),
    '00020126580014BR.GOV.BCB.PIX013600000000-0000-4000-8000-000000000000520400005303986540510.005802BR5910SONARY APP6009SAO PAULO61080100100062070503***6304483A',
    'R$ 10 copy must match mock Pix BR Code'
  );

  // Switch to R$ 25 and verify selection, QR update, and exact mock payload
  await actAsync(async () => {
    chip25.props.onPress();
  });
  assert.strictEqual(findButtonByText(pixRoot, 'R$ 25').props.accessibilityState?.selected, true);
  assert.strictEqual(findButtonByText(pixRoot, 'R$ 5').props.accessibilityState?.selected, false);
  const updatedQrPath = pixRoot
    .findByProps({ testID: 'support-qr-code' })
    .find((n) => n.props?.tag === 'Path').props.d;
  assert.notStrictEqual(updatedQrPath, initialQrPath, 'QR code matrix must update when amount changes');
  await actAsync(async () => {
    await findButtonByText(pixRoot, 'Copiar código Pix').props.onPress();
  });
  assert.strictEqual(
    await Clipboard.getString(),
    '00020126580014BR.GOV.BCB.PIX013600000000-0000-4000-8000-000000000000520400005303986540525.005802BR5910SONARY APP6009SAO PAULO61080100100062070503***63045696',
    'R$ 25 copy must match mock Pix BR Code'
  );

  // Select Outro without amount -> must copy only the mock Pix key
  await actAsync(async () => {
    findButtonByText(pixRoot, 'Outro').props.onPress();
  });
  const copyKeyBtn = findButtonByText(pixRoot, 'Copiar chave Pix');
  assert.ok(copyKeyBtn, 'CTA must read "Copiar chave Pix" when Outro has no custom value');
  await actAsync(async () => {
    await copyKeyBtn.props.onPress();
  });
  assert.strictEqual(
    await Clipboard.getString(),
    '00000000-0000-4000-8000-000000000000',
    'Outro without custom value must copy only the mock Pix key'
  );

  // Type optional custom value under Outro -> copies EMV BR Code with amount
  const customInput = pixRoot.find(
    (n) => n.type === 'TextInput' && n.props?.accessibilityLabel === 'Valor personalizado para apoio'
  );
  assert.ok(customInput, 'Custom amount input should appear when "Outro" is selected');
  await actAsync(async () => {
    customInput.props.onChangeText('42,50');
  });

  // Tap CTA "Copiar código Pix" for custom amount
  await actAsync(async () => {
    await findButtonByText(pixRoot, 'Copiar código Pix').props.onPress();
  });

  const copiedText = await Clipboard.getString();
  assert.ok(copiedText.includes('00000000-0000-4000-8000-000000000000'), 'Clipboard must receive mock Pix key');
  assert.ok(copiedText.includes('42.50'), 'Clipboard payload must reflect custom selected amount');

  const afterCopyText = getAllText(pixRoot);
  assert.ok(afterCopyText.includes('Código copiado!'), 'CTA button must show immediate copied confirmation');
  assert.strictEqual(pixToast, 'Código Pix copiado!', 'Toast callback must receive copy confirmation');
  await actAsync(async () => {
    pixTree.unmount();
  });
});

test('Flow 1: YouTubeMusicSidebar supports "support" tab parity', async () => {
  let selectedTab = 'search';
  let sidebarTree;
  await actAsync(async () => {
    sidebarTree = renderer.create(
      React.createElement(YouTubeMusicSidebar, {
        isCollapsed: false,
        onToggleCollapse: () => {},
        activeTab: 'search',
        onTabChange: (tab) => {
          selectedTab = tab;
        },
        playlists: [],
      })
    );
  });

  const supportSidebarBtn = findButtonByText(sidebarTree.root, 'Apoiar');
  assert.ok(supportSidebarBtn, 'Desktop sidebar must include "Apoiar" navigation item');
  await actAsync(async () => {
    supportSidebarBtn.props.onPress();
  });
  assert.strictEqual(selectedTab, 'support', 'Clicking Apoiar in sidebar must switch to support tab');
});
