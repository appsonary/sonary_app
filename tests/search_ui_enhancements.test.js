// tests/search_ui_enhancements.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const { BrandHeader } = require('../components/BrandHeader');
const { SearchBarSection } = require('../components/SearchBarSection');
const { AtmosphericGradient } = require('../components/AtmosphericGradient');
const api = require('../services/api');
const {
  actAsync,
  findSearchActionButton,
  findInputByPlaceholder,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const { initDatabase } = require('../services/database');

const originalSearchTracks = api.searchTracks;

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test.afterEach(() => {
  api.searchTracks = originalSearchTracks;
});

test('Search UI: BrandHeader has balanced YouTube Music layout and refined status pill', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(BrandHeader));
  });

  const root = tree.root;
  assert.ok(root, 'BrandHeader must render');

  // Verify horizontal brand logo image exists with proportional layout styling
  const logoImage = root.find(
    (n) =>
      n.type === 'Image' &&
      n.props &&
      n.props.accessibilityLabel === 'Sonary'
  );
  assert.ok(logoImage, 'Sonary brand logo image must exist in BrandHeader');
  assert.ok(logoImage.props.source, 'BrandHeader logo image must specify a static asset source');
  assert.strictEqual(logoImage.props.resizeMode, 'contain', 'BrandHeader logo must preserve aspect ratio with contain');
  assert.ok(
    logoImage.props.style &&
    logoImage.props.style.height > 0 &&
    logoImage.props.style.width > logoImage.props.style.height &&
    Math.abs(logoImage.props.style.aspectRatio - 1222 / 420) < 0.05,
    'BrandHeader logo image must maintain horizontal aspect ratio'
  );

  // Verify notifications bell icon replaces legacy profile avatar cleanly (no pill background) and Cast button is omitted
  const notificationsIcon = root.find(
    (n) => n.props && n.props.accessibilityLabel === 'Notificações'
  );
  assert.ok(notificationsIcon, 'Notifications bell button must be present');
  assert.ok(
    !notificationsIcon.props.style || !notificationsIcon.props.style.backgroundColor,
    'Notifications bell button must stay clean without a background pill'
  );
  assert.ok(
    !notificationsIcon.props.style || !notificationsIcon.props.style.borderWidth,
    'Notifications bell button must stay clean without a border'
  );

  const bellIcon = notificationsIcon.find(
    (n) => n.type === 'LucideIcon' && n.props && n.props.name === 'Bell'
  );
  assert.ok(bellIcon, 'BrandHeader must render Bell icon inside notifications slot');

  // Verify clean download queue button exists between dev button (when enabled) and notifications Bell
  const queueBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props && n.props.accessibilityLabel === 'Fila de downloads'
  );
  assert.ok(queueBtn, 'BrandHeader must render clean download queue button');
  assert.ok(
    !queueBtn.props.style || !queueBtn.props.style.backgroundColor,
    'Download queue button must stay clean without a background pill'
  );
  assert.ok(
    !queueBtn.props.style || !queueBtn.props.style.borderWidth,
    'Download queue button must stay clean without a border'
  );

  const prevDev = global.__DEV__;
  global.__DEV__ = true;
  let devHeaderTree;
  try {
    await actAsync(async () => {
      devHeaderTree = renderer.create(
        React.createElement(BrandHeader, {
          onOpenDevMenu: () => {},
          onOpenDownloadQueue: () => {},
          downloadQueueCount: 3,
        })
      );
    });
    const devRightActions = devHeaderTree.root.find(
      (n) =>
        n.type === 'View' &&
        Array.isArray(n.children) &&
        n.children.some((c) => c.props && c.props.accessibilityLabel === 'Notificações')
    );
    const actionLabels = devRightActions.children
      .map((c) => c.props && c.props.accessibilityLabel)
      .filter(Boolean);
    assert.deepStrictEqual(
      actionLabels,
      ['Menu de desenvolvimento', 'Fila de downloads (3)', 'Notificações'],
      'Download queue button must sit between dev button and notifications'
    );
    const devBtn = devHeaderTree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props && n.props.accessibilityLabel === 'Menu de desenvolvimento'
    );
    assert.ok(
      !devBtn.props.style || !devBtn.props.style.backgroundColor,
      'Dev button must stay clean without a background pill'
    );
    assert.ok(
      !devBtn.props.style || !devBtn.props.style.borderWidth,
      'Dev button must stay clean without a border'
    );
    assert.ok(
      getAllText(devRightActions).includes('3'),
      'BrandHeader download queue button must display active/pending count badge'
    );
  } finally {
    global.__DEV__ = prevDev;
  }

  const legacyProfileAvatar = root.findAll(
    (n) => n.props && n.props.accessibilityLabel === 'Perfil do usuário'
  );
  assert.strictEqual(legacyProfileAvatar.length, 0, 'Legacy profile avatar must be removed');

  const castBtn = root.findAll(
    (n) => n.props && n.props.accessibilityLabel === 'Transmitir áudio para dispositivo'
  );
  assert.strictEqual(castBtn.length, 0, 'Cast button must not be present when device pairing is unconfigured');

  // Verify legacy slogan text is removed by default
  const text = getAllText(root);
  assert.strictEqual(text.includes('Só você e a música'), false, 'Default BrandHeader must omit removed slogan');
});

test('Search UI: AtmosphericGradient provides subtle ambient glow without harsh red saturation', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(AtmosphericGradient, { height: 180 }));
  });

  const root = tree.root;
  assert.ok(root, 'AtmosphericGradient must render');

  // Verify SVG defs & rects are constructed
  const svgElements = root.findAllByType('SvgElement');
  assert.ok(svgElements.length >= 2, 'Must contain SVG gradient defs and rect elements');
});

test('Search UI: SearchBarSection renders YouTube Music pill bar, circular search button, and recent search rows', async () => {
  const { StyleSheet } = require('react-native');
  let submittedQuery = null;
  let currentQuery = '';

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SearchBarSection, {
        query: currentQuery,
        onChangeQuery: (t) => {
          currentQuery = t;
        },
        onSearch: (overrideQ) => {
          submittedQuery = overrideQ ?? currentQuery;
        },
        isSearching: false,
        recentQueries: ['one metalica', 'greta van fleet live'],
      })
    );
  });

  const root = tree.root;

  // Verify search input, single magnifying glass, & inline search button inside pill
  const input = root.findByType('TextInput');
  assert.ok(input, 'TextInput must exist');
  assert.strictEqual(input.props.returnKeyType, 'search');

  const searchIcons = root.findAll(
    (node) => node.type === 'LucideIcon' && node.props.name === 'Search'
  );
  assert.strictEqual(searchIcons.length, 1, 'Must render only one Search icon (no duplicate outer button)');

  const searchBtn = findSearchActionButton(root);
  assert.ok(searchBtn, 'Inline search action button must exist');
  const btnStyle = StyleSheet.flatten(searchBtn.props.style) || {};
  assert.strictEqual(btnStyle.width, 32);
  assert.strictEqual(btnStyle.height, 32);
  assert.strictEqual(btnStyle.borderRadius, 16);
  assert.strictEqual(btnStyle.backgroundColor, '#FFFFFF');
  assert.strictEqual(searchIcons[0].props.color, '#030303');

  // Focusing input reveals back arrow & recent search history rows
  await actAsync(async () => {
    input.props.onFocus();
  });
  const historyList = root.findByProps({ testID: 'search-history-list' });
  assert.ok(historyList, 'Focusing search bar must display recent search queries');
  assert.ok(getAllText(historyList).includes('one metalica'));
  assert.ok(getAllText(historyList).includes('greta van fleet live'));

  // Tapping diagonal fill arrow populates query without submitting
  const fillBtn = root.findByProps({ accessibilityLabel: 'Preencher busca com one metalica' });
  await actAsync(async () => {
    fillBtn.props.onPress({ stopPropagation: () => { } });
  });
  assert.strictEqual(currentQuery, 'one metalica');
  assert.strictEqual(submittedQuery, null);

  // Tapping a recent query row submits immediately
  const recentRow = root.findByProps({ accessibilityLabel: 'Buscar novamente greta van fleet live' });
  await actAsync(async () => {
    recentRow.props.onPress();
  });
  assert.strictEqual(submittedQuery, 'greta van fleet live');

  // Submit search directly via action button
  submittedQuery = null;
  currentQuery = 'metallica';
  await actAsync(async () => {
    searchBtn.props.onPress();
  });
  assert.strictEqual(submittedQuery, 'metallica', 'Pressing circular search button must trigger onSearch');
});

test('Search UI: Focused search mode renders dedicated Buscas recentes screen with Clear All, item removal, and hides Discovery in App', async () => {
  const { Keyboard, ScrollView } = require('react-native');
  const { recordSearchHistory } = require('../services/database');
  await recordSearchHistory('wanna be yours');
  await recordSearchHistory('yukon');
  await recordSearchHistory('kate bush');

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  assert.ok(root.findByProps({ testID: 'genre-chips-carousel' }), 'Discovery chips visible before focus');

  const input = findInputByPlaceholder(root, 'Buscar faixas, artistas ou álbuns...');
  await actAsync(async () => {
    input.props.onFocus();
  });

  // Discovery and Playlists are hidden while search is focused
  assert.strictEqual(root.findAllByProps({ testID: 'genre-chips-carousel' }).length, 0);
  assert.strictEqual(root.findAllByProps({ testID: 'search-playlists-catalog' }).length, 0);

  const historyList = root.findByProps({ testID: 'search-history-list' });
  assert.strictEqual(historyList.type, ScrollView, 'History list must be a ScrollView');
  assert.strictEqual(historyList.props.keyboardShouldPersistTaps, 'handled');
  assert.ok(getAllText(historyList).includes('Buscas recentes'));
  assert.ok(getAllText(historyList).includes('kate bush'));

  // Remove single query item
  const removeBtn = root.findByProps({ accessibilityLabel: 'Remover busca yukon' });
  await actAsync(async () => {
    removeBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(getAllText(root.findByProps({ testID: 'search-history-list' })).includes('yukon'), false);
  assert.ok(getAllText(root.findByProps({ testID: 'search-history-list' })).includes('wanna be yours'));

  // Clear all history
  const clearAllBtn = root.findByProps({ accessibilityLabel: 'Limpar histórico de buscas' });
  await actAsync(async () => {
    clearAllBtn.props.onPress();
  });
  assert.ok(root.findByProps({ testID: 'search-history-empty' }));

  // Closing focus restores Discovery screen
  await actAsync(async () => {
    Keyboard.__emit('keyboardDidHide');
  });
  assert.ok(root.findByProps({ testID: 'genre-chips-carousel' }), 'Discovery chips return when focus closes');
});

test('Search UI: Initial state displays genre explore chips that trigger search on tap', async () => {
  let searchedQuery = null;
  api.searchTracks = async (q) => {
    searchedQuery = q;
    return [
      {
        id: 'track_lofi_1',
        title: 'Chill Beats',
        artist: 'Lofi Producer',
        duration: 180,
        formattedDuration: '3:00',
        thumbnailUrl: 'https://example.com/lofi.jpg',
      },
    ];
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Verify explore chips render inside horizontal carousel in initial discovery state
  const carousel = root.findByProps({ testID: 'genre-chips-carousel' });
  assert.strictEqual(carousel.props.horizontal, true, 'Explore chips must be a horizontal carousel');

  const lofiChip = root.find(
    (n) => n.props && n.props.accessibilityLabel === 'Explorar gênero Lo-Fi'
  );
  assert.ok(lofiChip, 'Lo-Fi explore chip must be present in discovery section');
  const lofiIcon = lofiChip.find(
    (n) => n.type === 'LucideIcon' && n.props.name === 'Coffee'
  );
  assert.ok(lofiIcon, 'Lo-Fi explore chip must render Lucide Coffee icon instead of emoji');

  // Tap Lo-Fi chip
  await actAsync(async () => {
    lofiChip.props.onPress();
  });

  assert.strictEqual(searchedQuery, 'Lo-Fi', 'Tapping explore chip should immediately search for that genre');

  // Verify results section header appears
  const text = getAllText(root);
  assert.ok(text.includes('Músicas e Resultados'), 'Section header must distinguish search list from quick picks');
  assert.ok(text.includes('Chill Beats'), 'Result track title must be displayed');
});

test('Search UI: Search list and TrackCard rows span full width without stacked horizontal padding/margins', async () => {
  const { StyleSheet } = require('react-native');
  api.searchTracks = async (q) =>
    q === 'one metalica'
      ? [
        {
          id: 'track_ytm_1',
          title: 'One (Live)',
          artist: 'Metallica',
          duration: 446,
          formattedDuration: '7:26',
          thumbnailUrl: 'https://example.com/one.jpg',
        },
      ]
      : [];

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('one metalica');
  });
  await actAsync(async () => {
    findSearchActionButton(root).props.onPress();
  });

  const searchFlatList = root.findByType('FlatList');
  const listStyle = StyleSheet.flatten(searchFlatList.props.contentContainerStyle) || {};
  assert.strictEqual(
    listStyle.paddingHorizontal ?? 0,
    0,
    'Search FlatList contentContainerStyle must not add outer horizontal padding that squeezes rows'
  );

  const trackRow = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props?.accessibilityLabel === 'Tocar One (Live) de Metallica' &&
      n.parent?.parent?.type?.name === 'TrackCardInner'
  );
  const rowStyle = StyleSheet.flatten(trackRow.props.style) || {};
  const rowMarginX = rowStyle.marginHorizontal ?? 0;
  const rowLeft = rowStyle.paddingLeft ?? rowStyle.paddingHorizontal ?? 0;
  const rowRight = rowStyle.paddingRight ?? rowStyle.paddingHorizontal ?? 0;
  assert.strictEqual(rowMarginX + rowLeft, 16, 'TrackCard left content inset must remain 16px');
  assert.strictEqual(rowMarginX + rowRight, 8, 'TrackCard right content inset must remain 8px');
  assert.strictEqual(rowStyle.borderRadius, 12, 'TrackCard row must have rounded corners');
});

test('Active track UI: QuickPicksSection omits numbers and TrackCard/QuickPicks render red animated equalizer strictly by track id', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { StyleSheet } = require('react-native');
  const { QuickPicksSection } = require('../components/QuickPicksSection');
  const { TrackCard } = require('../components/TrackCard');
  const { theme } = require('../theme');

  const eqSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'components', 'PlayingEqualizer.tsx'),
    'utf8'
  );
  assert.strictEqual(
    /useNativeDriver\s*:\s*false/.test(eqSource),
    false,
    'PlayingEqualizer must use useNativeDriver: true on all animations'
  );

  const sampleTracks = [
    {
      id: 'track_exact_1',
      title: 'The Emptiness Machine',
      artist: 'Linkin Park',
      formattedDuration: '3:21',
      thumbnailUrl: 'https://example.com/lp.jpg',
    },
    {
      id: 'track_other_2',
      title: 'The Emptiness Machine',
      artist: 'Linkin Park',
      formattedDuration: '3:21',
      thumbnailUrl: 'https://example.com/lp.jpg',
    },
  ];

  // QuickPicksSection sem numeração e com equalizador apenas no id exato
  let qpTree;
  await actAsync(async () => {
    qpTree = renderer.create(
      React.createElement(QuickPicksSection, {
        tracks: sampleTracks,
        activeTrackId: 'track_exact_1',
        isPlaying: true,
        onSelectTrack: () => { },
      })
    );
  });

  const qpTexts = qpTree.root.findAllByType('Text').map((t) => t.props.children);
  assert.strictEqual(qpTexts.includes(1), false, 'QuickPicksSection must not show ordinal numbers');
  assert.strictEqual(qpTexts.includes(2), false, 'QuickPicksSection must not show ordinal numbers');

  const findEqualizers = (node) =>
    node.findAll((n) => n.type === 'View' && n.props?.testID === 'playing-equalizer');

  const qpEqualizers = findEqualizers(qpTree.root);
  assert.strictEqual(qpEqualizers.length, 1, 'Only exact activeTrackId row shows PlayingEqualizer');
  assert.strictEqual(qpEqualizers[0].props.accessibilityLabel, 'Tocando agora');

  const qpTitleNodes = qpTree.root
    .findAllByType('Text')
    .filter((t) => t.props.children === 'The Emptiness Machine');
  assert.strictEqual(
    StyleSheet.flatten(qpTitleNodes[0].props.style).color,
    theme.colors.brandPrimary
  );
  assert.notStrictEqual(
    StyleSheet.flatten(qpTitleNodes[1].props.style).color,
    theme.colors.brandPrimary
  );

  // Ao pausar, continua exibindo o equalizador vermelho (pausado) e título vermelho
  await actAsync(async () => {
    qpTree.update(
      React.createElement(QuickPicksSection, {
        tracks: sampleTracks,
        activeTrackId: 'track_exact_1',
        isPlaying: false,
        onSelectTrack: () => { },
      })
    );
  });
  const pausedEq = findEqualizers(qpTree.root);
  assert.strictEqual(pausedEq.length, 1, 'Paused active track keeps equalizer overlay');
  assert.strictEqual(pausedEq[0].props.accessibilityLabel, 'Reprodução pausada');

  // TrackCard (Músicas e Resultados / Baixadas): título vermelho + equalizador quando isActive
  let cardTree;
  await actAsync(async () => {
    cardTree = renderer.create(
      React.createElement(TrackCard, {
        id: 'track_exact_1',
        title: 'The Emptiness Machine',
        artist: 'Linkin Park',
        durationText: '3:21',
        thumbnailUrl: 'https://example.com/lp.jpg',
        isActive: true,
        isPlaying: true,
        onPress: () => { },
      })
    );
  });
  assert.strictEqual(
    findEqualizers(cardTree.root).length,
    1,
    'Active TrackCard shows PlayingEqualizer overlay'
  );
  const activeCardTitle = cardTree.root
    .findAllByType('Text')
    .find((t) => t.props.children === 'The Emptiness Machine');
  assert.strictEqual(
    StyleSheet.flatten(activeCardTitle.props.style).color,
    theme.colors.brandPrimary
  );
  const activeCardRow = cardTree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props?.accessibilityLabel === 'Tocar The Emptiness Machine de Linkin Park'
  );
  const activeCardStyle = StyleSheet.flatten(activeCardRow.props.style);
  assert.strictEqual(activeCardStyle.backgroundColor, '#141414');
  assert.strictEqual(activeCardStyle.borderRadius, 12);
});

test('Active track UI: PlaylistDetailModal shows red title and PlayingEqualizer strictly on active track', async () => {
  const { StyleSheet } = require('react-native');
  const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
  const { createPlaylist, addTrackToPlaylist } = require('../services/database');
  const { theme } = require('../theme');

  const pl = await createPlaylist('Rock Mix');
  await addTrackToPlaylist(pl.id, {
    id: 'pl_track_1',
    title: 'The Emptiness Machine',
    artist: 'Linkin Park',
    duration: 201,
    formattedDuration: '3:21',
    thumbnailUrl: 'https://example.com/lp.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'pl_track_2',
    title: 'Heavy Is the Crown',
    artist: 'Linkin Park',
    duration: 167,
    formattedDuration: '2:47',
    thumbnailUrl: 'https://example.com/lp2.jpg',
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        onClose: () => { },
        playlistId: pl.id,
        currentActiveTrackId: 'pl_track_1',
        isPlaying: true,
        onPlayTrack: () => { },
      })
    );
  });

  const eqs = tree.root.findAll((n) => n.type === 'View' && n.props?.testID === 'playing-equalizer');
  assert.strictEqual(eqs.length, 1, 'PlaylistDetailModal must render PlayingEqualizer only on active track');

  const activeTitle = tree.root
    .findAllByType('Text')
    .find((t) => t.props.children === 'The Emptiness Machine');
  const inactiveTitle = tree.root
    .findAllByType('Text')
    .find((t) => t.props.children === 'Heavy Is the Crown');
  assert.strictEqual(
    StyleSheet.flatten(activeTitle.props.style).color,
    theme.colors.brandPrimary
  );
  assert.notStrictEqual(
    StyleSheet.flatten(inactiveTitle.props.style).color,
    theme.colors.brandPrimary
  );
});

test('Active track UI: NowPlayingModal Queue sheet highlights only the currently playing track in red with PlayingEqualizer', async () => {
  const { StyleSheet } = require('react-native');
  const NowPlayingModal = require('../components/NowPlayingModal').default;
  const { theme } = require('../theme');

  const currentTrack = {
    id: 'sw_current_1',
    url: 'https://example.com/sw1.mp4',
    title: 'Across the Stars',
    artist: 'John Williams - Topic',
    artwork: 'https://example.com/sw.jpg',
    duration: 330,
  };
  const nextTrack = {
    id: 'sw_next_2',
    url: 'https://example.com/sw2.mp4',
    title: 'Duel of the Fates',
    artist: 'John Williams - Topic',
    artwork: 'https://example.com/sw2.jpg',
    duration: 254,
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => { },
        track: currentTrack,
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => { },
        onSkipNext: () => { },
        onSkipPrevious: () => { },
        onSeekRelative: () => { },
        queue: [currentTrack, nextTrack],
      })
    );
  });

  const openQueueBtn = tree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props?.accessibilityLabel === 'Fila'
  );
  await actAsync(async () => {
    openQueueBtn.props.onPress();
  });

  const eqs = tree.root.findAll(
    (n) => n.type === 'View' && n.props?.testID === 'playing-equalizer'
  );
  assert.strictEqual(
    eqs.length,
    1,
    'NowPlayingModal queue must render PlayingEqualizer only on the active track'
  );

  const queueTitles = tree.root
    .findAllByType('Text')
    .filter((t) => t.props.children === 'Across the Stars');
  assert.ok(queueTitles.length >= 2, 'Active track title appears in player and queue header row');
  const redQueueTitles = queueTitles.filter(
    (t) => StyleSheet.flatten(t.props.style).color === theme.colors.brandPrimary
  );
  assert.strictEqual(
    redQueueTitles.length,
    1,
    'Exactly one title (the queue now-playing row) must be highlighted in brandPrimary'
  );

  const nextQueueTitle = tree.root
    .findAllByType('Text')
    .find((t) => t.props.children === 'Duel of the Fates');
  assert.notStrictEqual(
    StyleSheet.flatten(nextQueueTitle.props.style).color,
    theme.colors.brandPrimary
  );
});

test('Search UI: Unified YouTube Music pill search design renders and filters across PlaylistDetailModal, LibrarySection, and Downloads tab', async () => {
  const { StyleSheet } = require('react-native');
  const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
  const { LibrarySection } = require('../components/LibrarySection');
  const {
    createPlaylist,
    addTrackToPlaylist,
    saveDownloadedTrack,
  } = require('../services/database');
  const { findButtonByText } = require('./helpers/testUtils');

  const assertPillDesign = (inputNode, contextName) => {
    let pillContainer = inputNode.parent;
    while (pillContainer && pillContainer.type !== 'View') {
      pillContainer = pillContainer.parent;
    }
    assert.ok(pillContainer, `${contextName}: search pill View container must exist`);
    const pillStyle = StyleSheet.flatten(pillContainer.props.style) || {};
    assert.strictEqual(pillStyle.borderRadius, 24, `${contextName}: search pill must have borderRadius 24`);
    assert.strictEqual(pillStyle.height, 48, `${contextName}: search pill must have height 48`);
    assert.strictEqual(pillStyle.backgroundColor, '#212121', `${contextName}: search pill must use #212121 fill`);
  };

  // 1. PlaylistDetailModal
  const pl = await createPlaylist('Rock Classics');
  await addTrackToPlaylist(pl.id, {
    id: 'pl_t1',
    title: 'Paranoid',
    artist: 'Black Sabbath',
    duration: 170,
    thumbnailUrl: 'https://example.com/paranoid.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'pl_t2',
    title: 'Hallowed Be Thy Name',
    artist: 'Iron Maiden',
    duration: 430,
    thumbnailUrl: 'https://example.com/maiden.jpg',
  });

  let plTree;
  await actAsync(async () => {
    plTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        onClose: () => { },
        playlistId: pl.id,
        onPlayTrack: () => { },
        onPlayAll: () => { },
      })
    );
  });

  const plSearchInput = findInputByPlaceholder(plTree.root, 'Buscar nesta playlist');
  assert.ok(plSearchInput, 'PlaylistDetailModal must render playlist search input');
  assertPillDesign(plSearchInput, 'PlaylistDetailModal');

  await actAsync(async () => {
    plSearchInput.props.onChangeText('Maiden');
  });
  assert.ok(getAllText(plTree.root).includes('Hallowed Be Thy Name'));
  assert.strictEqual(getAllText(plTree.root).includes('Paranoid'), false);

  const clearPlBtn = plTree.root.findByProps({ accessibilityLabel: 'Limpar busca interna' });
  await actAsync(async () => {
    clearPlBtn.props.onPress();
  });
  assert.ok(getAllText(plTree.root).includes('Paranoid'));

  // 2. LibrarySection (Aba Playlists)
  let libTree;
  await actAsync(async () => {
    libTree = renderer.create(
      React.createElement(LibrarySection, {
        playlists: [
          { id: 'p_1', name: 'Treino Pesado', trackCount: 12, isSystem: false },
          { id: 'p_2', name: 'Chill Acoustic', trackCount: 5, isSystem: false },
        ],
        isLoading: false,
        isQuickCreateVisible: false,
        quickCreateName: '',
        onChangeQuickCreateName: () => { },
        onToggleQuickCreate: () => { },
        onSubmitQuickCreate: () => { },
        onSelectPlaylist: () => { },
      })
    );
  });

  const libSearchInput = findInputByPlaceholder(libTree.root, 'Buscar playlists');
  assert.ok(libSearchInput, 'LibrarySection must render playlist search input');
  assertPillDesign(libSearchInput, 'LibrarySection');

  await actAsync(async () => {
    libSearchInput.props.onChangeText('Acoustic');
  });
  assert.ok(getAllText(libTree.root).includes('Chill Acoustic'));
  assert.strictEqual(getAllText(libTree.root).includes('Treino Pesado'), false);

  await actAsync(async () => {
    libSearchInput.props.onChangeText('Inexistente');
  });
  assert.ok(getAllText(libTree.root).includes('Nenhuma playlist encontrada'));

  // 3. App Downloads tab (Aba Baixadas)
  const FileSystem = require('expo-file-system');
  const dl1Uri = `${FileSystem.documentDirectory}tracks/dl_1.m4a`;
  const dl2Uri = `${FileSystem.documentDirectory}tracks/dl_2.m4a`;
  FileSystem.files.set(dl1Uri, { isDirectory: false, size: 1024 * 1024 });
  FileSystem.files.set(dl2Uri, { isDirectory: false, size: 1024 * 1024 });

  await saveDownloadedTrack({
    id: 'dl_1',
    title: 'Master of Puppets',
    artist: 'Metallica',
    duration: 515,
    thumbnailUrl: 'https://example.com/mop.jpg',
    localUri: dl1Uri,
    downloadedAt: Date.now(),
  });
  await saveDownloadedTrack({
    id: 'dl_2',
    title: 'Back in Black',
    artist: 'AC/DC',
    duration: 255,
    thumbnailUrl: 'https://example.com/bib.jpg',
    localUri: dl2Uri,
    downloadedAt: Date.now(),
  });

  let appTree;
  await actAsync(async () => {
    appTree = renderer.create(React.createElement(App));
  });

  const downloadsTabBtn = findButtonByText(appTree.root, 'Baixadas');
  await actAsync(async () => {
    downloadsTabBtn.props.onPress();
  });

  const dlSearchInput = findInputByPlaceholder(appTree.root, 'Buscar nas baixadas');
  assert.ok(dlSearchInput, 'Downloads tab must render pill search input when offline tracks exist');
  assertPillDesign(dlSearchInput, 'Downloads Tab');

  await actAsync(async () => {
    dlSearchInput.props.onChangeText('Metallica');
  });
  assert.ok(getAllText(appTree.root).includes('Master of Puppets'));
  assert.strictEqual(getAllText(appTree.root).includes('Back in Black'), false);

  await actAsync(async () => {
    dlSearchInput.props.onChangeText('NadaAqui');
  });
  assert.ok(getAllText(appTree.root).includes('Nenhuma faixa encontrada'));
});




