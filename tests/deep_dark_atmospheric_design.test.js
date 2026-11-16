// tests/deep_dark_atmospheric_design.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const { theme } = require('../theme');
const { AtmosphericGradient } = require('../components/AtmosphericGradient');
const { Skeleton } = require('../components/Skeleton');
const { TrackRowSkeleton } = require('../components/TrackRowSkeleton');
const { CardSkeleton } = require('../components/CardSkeleton');
const { TrackCard } = require('../components/TrackCard');
const { AmbientGlowBackground } = require('../components/AmbientGlowBackground');
const NowPlayingModal = require('../components/NowPlayingModal').default;
const App = require('../App').default;
const { actAsync, resetAllMocks, findInputByPlaceholder, findSearchActionButton } = require('./helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
});

test('Theme Tokens: Deep Dark Mode & YouTube Music Palette are strictly defined', () => {
  // 1. Pitch Black OLED base
  assert.strictEqual(theme.colors.background, '#030303');
  // 2. Surfaces and Elevation
  assert.strictEqual(theme.colors.surface, '#0f0f0f');
  assert.strictEqual(theme.colors.card, '#181818');
  assert.strictEqual(theme.colors.elevated, '#212121');
  assert.strictEqual(theme.colors.chipInactive, '#1d1d1d');
  assert.strictEqual(theme.colors.chipHover, '#2b2b2b');
  assert.strictEqual(theme.colors.chipActive, '#FFFFFF');
  // 3. Brand & Typography
  assert.strictEqual(theme.colors.brandPrimary, '#FF0000');
  assert.strictEqual(theme.colors.textPrimary, '#FFFFFF');
  assert.strictEqual(theme.colors.textSecondary, '#AAAAAA');
  assert.strictEqual(theme.colors.textMuted, '#717171');
  assert.strictEqual(theme.colors.border, 'rgba(255, 255, 255, 0.1)');
  // 4. Radii
  assert.strictEqual(theme.radii.track, 4);
  assert.strictEqual(theme.radii.card, 8);
  assert.strictEqual(theme.radii.chip, 8);
  assert.strictEqual(theme.radii.dialog, 12);
  assert.strictEqual(theme.radii.circular, 9999);
  // 5. Emil Kowalski Micro-interactions & Standardized Motion Durations
  assert.strictEqual(theme.transitions.pressScale, 0.97);
  assert.strictEqual(theme.transitions.screenOutMs, 30);
  assert.strictEqual(theme.transitions.screenInMs, 65);
  assert.strictEqual(theme.transitions.sheetInMs, 100);
  assert.strictEqual(theme.transitions.sheetOutMs, 90);
  assert.strictEqual(theme.transitions.toastMs, 85);
  assert.strictEqual(theme.transitions.glowEntryMs, 65);
  assert.strictEqual(theme.colors.overlayDark, 'rgba(0, 0, 0, 0.5)');
});

test('Atmospheric Gradient: Renders top ambient glow with SVG elements', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(AtmosphericGradient, {
      height: 250,
      glowColor: 'rgba(255, 0, 0, 0.18)',
    }));
  });

  const root = tree.root;
  assert.ok(root, 'AtmosphericGradient must render successfully');

  // Verify SVG defs & rects are constructed
  const svgElements = root.findAllByType('SvgElement');
  assert.ok(svgElements.length >= 2, 'Must contain SVG gradient defs and rect elements');
});

test('Skeletons: Pulsating placeholders for track rows and cards render with zero errors', async () => {
  // 1. Base Skeleton
  let skeletonTree;
  await actAsync(async () => {
    skeletonTree = renderer.create(React.createElement(Skeleton, {
      width: 120,
      height: 20,
      borderRadius: 6,
    }));
  });
  assert.ok(skeletonTree.root, 'Base Skeleton must render');

  // 2. TrackRowSkeleton
  let trackRowTree;
  await actAsync(async () => {
    trackRowTree = renderer.create(React.createElement(TrackRowSkeleton, { count: 5 }));
  });
  assert.ok(trackRowTree.root, 'TrackRowSkeleton must render with specified count');

  // 3. CardSkeleton (Square and Circle)
  let cardTree;
  await actAsync(async () => {
    cardTree = renderer.create(React.createElement(CardSkeleton, { count: 3, shape: 'square' }));
  });
  assert.ok(cardTree.root, 'Square CardSkeleton must render');

  let circleCardTree;
  await actAsync(async () => {
    circleCardTree = renderer.create(React.createElement(CardSkeleton, { count: 3, shape: 'circle' }));
  });
  assert.ok(circleCardTree.root, 'Circle CardSkeleton must render for artist cards');
});

test('TrackCard: Progressive disclosure, hover state, track numbers, and zero layout shift', async () => {
  let wasPressed = false;
  let wasAdded = false;
  let wasDownloaded = false;

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(TrackCard, {
      id: 'track_test_1',
      title: 'Midnight City',
      artist: 'M83',
      durationText: '4:03',
      thumbnailUrl: 'https://example.com/art.jpg',
      trackNumber: 3,
      onPress: () => { wasPressed = true; },
      onAddToPlaylist: () => { wasAdded = true; },
      onDownload: () => { wasDownloaded = true; },
    }));
  });

  const root = tree.root;
  assert.ok(root, 'TrackCard must render');

  // Initial state has track number '3'
  const allTexts = root.findAllByType('Text').map((t) => t.props.children);
  assert.ok(allTexts.includes(3), 'Must render track number in initial resting state');

  // Click row triggers onPress
  const touchable = root.findByProps({ accessibilityLabel: 'Tocar Midnight City de M83' });
  await actAsync(async () => {
    touchable.props.onPress();
  });
  assert.strictEqual(wasPressed, true, 'TrackCard click triggers onPress');

  // Trigger hover
  await actAsync(async () => {
    touchable.props.onMouseEnter();
  });

  // Action buttons trigger handlers without layout shifts
  const addBtn = root.findByProps({ accessibilityLabel: 'Adicionar Midnight City à playlist' });
  await actAsync(async () => {
    addBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(wasAdded, true, 'Add to playlist clicked');

  const downloadBtn = root.findByProps({ accessibilityLabel: 'Baixar Midnight City' });
  await actAsync(async () => {
    downloadBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(wasDownloaded, true, 'Download clicked');
});

test('App Shell: Includes top Atmospheric Gradient and renders Skeletons during search', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  assert.ok(root, 'App must mount successfully');

  // Must contain AtmosphericGradient
  const gradient = root.findAllByType(AtmosphericGradient);
  assert.ok(gradient.length >= 1, 'App must feature top AtmosphericGradient');
});

test('AmbientGlowBackground: Renders Skia Canvas with Fill #000000, Blur decal, dithered LinearGradient vignette, crossfade, square artwork & neutral Lyrics card', async () => {
  const flattenStyle = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s || {});
  const artworkUrl1 = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg';
  const artworkUrl2 = 'https://i.ytimg.com/vi/xyz789/hqdefault.jpg';

  // 1. Verify Skia Canvas structure: Fill #000000, Group(0.55) -> Image(cover) -> Blur(70, decal), Rect(dither) -> LinearGradient
  let glowTree;
  await actAsync(async () => {
    glowTree = renderer.create(React.createElement(AmbientGlowBackground, { artworkUri: artworkUrl1 }));
  });
  const container = glowTree.root.findByProps({ testID: 'ambient-glow-background' });
  assert.strictEqual(container.props.pointerEvents, 'none');
  const containerStyle = flattenStyle(container.props.style);
  assert.strictEqual(containerStyle.backgroundColor, '#000000');
  assert.strictEqual(containerStyle.overflow, 'hidden');
  assert.strictEqual(containerStyle.zIndex, 0);

  const canvas = glowTree.root.findByType('SkiaCanvas');
  assert.strictEqual(canvas.props.pointerEvents, 'none');

  const skiaNodes = glowTree.root.findAllByType('SkiaElement');
  const fillNode = skiaNodes.find((n) => n.props.tag === 'Fill');
  assert.strictEqual(fillNode?.props.color, '#000000');

  const groupNodes = skiaNodes.filter((n) => n.props.tag === 'Group');
  assert.strictEqual(groupNodes.length, 1);
  assert.strictEqual(groupNodes[0].props.opacity.value, 0.76);

  const imgNodes = skiaNodes.filter((n) => n.props.tag === 'Image');
  assert.strictEqual(imgNodes.length, 1);
  assert.strictEqual(imgNodes[0].props.fit, 'cover');
  assert.strictEqual(imgNodes[0].props.image.uri, artworkUrl1);

  const blurNode = skiaNodes.find((n) => n.props.tag === 'Blur');
  assert.strictEqual(blurNode?.props.blur, 85);
  assert.strictEqual(blurNode?.props.mode, 'decal');

  const rectNodes = skiaNodes.filter((n) => n.props.tag === 'Rect');
  assert.strictEqual(rectNodes.length, 2);
  assert.strictEqual(rectNodes[0].props.dither, true);
  assert.strictEqual(rectNodes[1].props.blendMode, 'overlay');
  assert.strictEqual(rectNodes[1].props.dither, true);

  const noiseNode = skiaNodes.find((n) => n.props.tag === 'FractalNoise');
  assert.ok(noiseNode, 'Should render Skia FractalNoise anti-banding grain shader');

  const gradNode = skiaNodes.find((n) => n.props.tag === 'LinearGradient');
  assert.strictEqual(gradNode?.props.colors.length, 7);
  assert.strictEqual(gradNode?.props.colors[gradNode.props.colors.length - 1], '#000000');
  assert.strictEqual(gradNode?.props.positions.length, 7);

  // 2. Switching artworkUri updates Skia image cleanly and null clears smoothly
  await actAsync(async () => {
    glowTree.update(React.createElement(AmbientGlowBackground, { artworkUri: artworkUrl2 }));
  });
  const updatedImg = glowTree.root.findAllByType('SkiaElement').find((n) => n.props.tag === 'Image');
  assert.strictEqual(updatedImg?.props.image.uri, artworkUrl2);

  await actAsync(async () => {
    glowTree.update(React.createElement(AmbientGlowBackground, { artworkUri: null }));
  });
  const clearedImgs = glowTree.root.findAllByType('SkiaElement').filter((n) => n.props.tag === 'Image');
  assert.strictEqual(clearedImgs.length, 0);

  // 3. Verify NowPlayingModal passes artworkUri, uses square 86% artwork & discrete Lyrics card
  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: {
          id: 'glow_track_1',
          url: 'https://example.com/audio.mp3',
          title: 'Arrival of the Birds',
          artist: 'The Cinematic Orchestra',
          artwork: artworkUrl1,
        },
        isPlaying: true,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });
  const modalGlow = modalTree.root.findByType(AmbientGlowBackground);
  assert.strictEqual(modalGlow.props.artworkUri, artworkUrl1);

  const rnModal = modalTree.root.findByType('Modal');
  assert.strictEqual(rnModal.props.statusBarTranslucent, true);
  const modalStatusBars = modalTree.root.findAllByType('StatusBar');
  assert.strictEqual(
    modalStatusBars.length,
    0,
    'NowPlayingModal must not mount StatusBar so MainActivity insets stay stable while dragging down'
  );

  const coverImage = modalTree.root.findByProps({ accessibilityLabel: 'Capa do álbum de Arrival of the Birds' });
  const coverStyle = flattenStyle(coverImage.props.style);
  assert.deepStrictEqual(coverStyle.transform, [{ scale: 1.35 }], 'Should crop YouTube hqdefault 4:3 letterbox bars');
  const wrapperStyle = flattenStyle(coverImage.parent.props.style);
  assert.strictEqual(typeof wrapperStyle.width, 'number');
  assert.strictEqual(wrapperStyle.width, wrapperStyle.height, 'Artwork wrapper must have explicit equal pixel width and height so Android Yoga never collapses it');
  assert.strictEqual(wrapperStyle.aspectRatio, 1);
  assert.strictEqual(wrapperStyle.flexShrink, 0);
  assert.strictEqual(wrapperStyle.borderRadius, 16);
  assert.strictEqual(wrapperStyle.overflow, 'hidden');
  assert.strictEqual(wrapperStyle.elevation, 12);

  const lyricsCard = modalTree.root.findAllByType('View').find((v) => {
    const s = flattenStyle(v.props.style);
    return (
      s.borderRadius === 24 &&
      s.backgroundColor === 'rgba(255, 255, 255, 0.06)' &&
      s.borderColor === 'rgba(255, 255, 255, 0.08)'
    );
  });
  assert.ok(lyricsCard, 'Lyrics card should use discrete dark background and border');
  const lyricsCardStyle = flattenStyle(lyricsCard.props.style);
  assert.strictEqual(
    lyricsCardStyle.elevation,
    undefined,
    'Translucent Lyrics card must not use Android elevation shadow that bleeds through alpha fill'
  );
  assert.strictEqual(lyricsCardStyle.shadowOpacity, undefined);

  const lyricsSubtitle = lyricsCard.findAllByType('Text').find((t) =>
    String(t.props.children || '').includes('Arraste para cima para ver a letra')
  );
  assert.ok(lyricsSubtitle, 'Lyrics subtitle hint must be present');
  const titleBlockStyle = flattenStyle(lyricsSubtitle.parent.parent.props.style);
  assert.strictEqual(titleBlockStyle.flexShrink, 1, 'Lyrics title block must shrink so subtitle never overlaps TEXTO button');
  assert.strictEqual(titleBlockStyle.minWidth, 0);

  const artistCard = modalTree.root.findAllByType('View').find((v) => {
    const s = flattenStyle(v.props.style);
    return (
      s.borderRadius === 24 &&
      s.backgroundColor === 'rgba(0, 0, 0, 0.52)' &&
      s.borderColor === 'rgba(255, 255, 255, 0.09)'
    );
  });
  assert.ok(artistCard, 'Artist card should use smoked black glass surface over the ambient glow');
});

test('LibrarySection & App Glow: Transparent layers expose crimson AtmosphericGradient through translucent StatusBar, frosted + Nova button, LinearGradient Favorites hero, and borderless playlist rows', async () => {
  const { StyleSheet } = require('react-native');
  const { LibrarySection } = require('../components/LibrarySection');
  const { getAllText } = require('./helpers/testUtils');

  // 1. Default crimson AtmosphericGradient stops (no opaque dark overlay)
  let gradTree;
  await actAsync(async () => {
    gradTree = renderer.create(React.createElement(AtmosphericGradient, {}));
  });
  const svgStops = gradTree.root.findAllByType('SvgElement').filter((el) => el.props.tag === 'Stop');
  const primaryStop = svgStops.find(
    (s) => s.props.stopColor === '#6E000D' && s.props.stopOpacity === '0.48'
  );
  assert.ok(primaryStop, 'AtmosphericGradient must expose #6E000D crimson radial peak at 0.48 opacity');
  const opaqueBlackOverlayStop = svgStops.find(
    (s) => s.props.stopColor === '#030303' && Number(s.props.stopOpacity) > 0
  );
  assert.strictEqual(opaqueBlackOverlayStop, undefined, 'No opaque dark overlay stop may hide top glow');

  // 2. App shell StatusBar & Playlists tab transparency
  let appTree;
  await actAsync(async () => {
    appTree = renderer.create(React.createElement(App));
  });
  const appStatusBar = appTree.root.findByType('StatusBar');
  assert.strictEqual(appStatusBar.props.translucent, true);
  assert.strictEqual(appStatusBar.props.backgroundColor, 'transparent');
  const appGrad = appTree.root.findByType(AtmosphericGradient);
  assert.strictEqual(appGrad.props.height, 320);

  const playlistsTabBtn = appTree.root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Playlists')
  )[0];
  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });

  const libInstance = appTree.root.findByType(LibrarySection);
  const tabContentStyle = StyleSheet.flatten(libInstance.parent.props.style);
  assert.strictEqual(tabContentStyle.backgroundColor, 'transparent', 'tabContent must be transparent so AtmosphericGradient shows behind LibrarySection');

  // 3. LibrarySection hero, frosted button, SUAS PLAYLISTS header, and open rows
  let libTree;
  await actAsync(async () => {
    libTree = renderer.create(
      React.createElement(LibrarySection, {
        playlists: [
          { id: '__favorites__', name: 'Músicas Curtidas', trackCount: 3, isSystem: true },
          {
            id: 'pl_1',
            name: 'Synthwave Night',
            trackCount: 7,
            isSystem: false,
            thumbnailUrl: 'https://i.ytimg.com/vi/MV_3Dpw-BRY/hqdefault.jpg',
          },
        ],
        isLoading: false,
        isQuickCreateVisible: false,
        quickCreateName: '',
        onChangeQuickCreateName: () => {},
        onToggleQuickCreate: () => {},
        onSubmitQuickCreate: () => {},
        onSelectPlaylist: () => {},
      })
    );
  });

  const libRoot = libTree.root;
  const libContainerStyle = StyleSheet.flatten(libRoot.findAllByType('View')[0].props.style);
  assert.strictEqual(libContainerStyle.backgroundColor, 'transparent');

  const newBtn = libRoot.findByProps({ accessibilityLabel: 'Criar nova playlist' });
  const newBtnStyle = StyleSheet.flatten(newBtn.props.style);
  assert.strictEqual(newBtnStyle.backgroundColor, 'rgba(255, 255, 255, 0.09)');
  assert.strictEqual(newBtnStyle.borderColor, 'rgba(255, 255, 255, 0.16)');

  const favBtn = libRoot.findByProps({ accessibilityLabel: 'Abrir playlist Músicas Curtidas' });
  const linearGradients = favBtn.findAllByType('LinearGradient');
  assert.strictEqual(linearGradients.length, 2, 'Favorites hero card & ruby icon badge must use LinearGradient');
  assert.deepStrictEqual(linearGradients[0].props.colors, ['#2E0B12', '#17090D', '#101012']);
  assert.deepStrictEqual(linearGradients[1].props.colors, ['#D91B2C', '#7A0B1B']);

  assert.ok(getAllText(libRoot).includes('SUAS PLAYLISTS'));

  const userRowBtn = libRoot.findByProps({ accessibilityLabel: 'Abrir playlist Synthwave Night' });
  const rowStyle = StyleSheet.flatten(userRowBtn.props.style);
  assert.strictEqual(rowStyle.backgroundColor, 'transparent');
  assert.strictEqual(rowStyle.borderWidth, undefined);

  const thumbImg = userRowBtn.findByType('Image');
  assert.strictEqual(thumbImg.props.resizeMode, 'cover');
  assert.deepStrictEqual(StyleSheet.flatten(thumbImg.props.style).transform, [{ scale: 1.35 }]);
});

test('App Tabs Glow Continuity: Search and Downloads FlatLists keep transparent contentContainerStyle without clipping AtmosphericGradient', async () => {
  const { FlatList, StyleSheet } = require('react-native');
  const { getAllText } = require('./helpers/testUtils');

  let appTree;
  await actAsync(async () => {
    appTree = renderer.create(React.createElement(App));
  });

  // Search tab (default): FlatList contentContainerStyle must not use opaque #030303
  const searchFlatList = appTree.root.findByType(FlatList);
  const searchListStyle = StyleSheet.flatten(searchFlatList.props.contentContainerStyle) || {};
  assert.notStrictEqual(searchListStyle.backgroundColor, '#030303');
  const searchTabContentStyle = StyleSheet.flatten(searchFlatList.parent.props.style) || {};
  assert.strictEqual(searchTabContentStyle.backgroundColor, 'transparent');

  // Downloads tab ("Baixadas"): FlatList and tabContent must stay transparent
  const downloadsTabBtn = appTree.root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Baixadas')
  )[0];
  await actAsync(async () => {
    downloadsTabBtn.props.onPress();
  });

  const downloadsFlatList = appTree.root.findByType(FlatList);
  const downloadsListStyle = StyleSheet.flatten(downloadsFlatList.props.contentContainerStyle) || {};
  assert.notStrictEqual(downloadsListStyle.backgroundColor, '#030303');
  const downloadsTabContentStyle = StyleSheet.flatten(downloadsFlatList.parent.props.style) || {};
  assert.strictEqual(downloadsTabContentStyle.backgroundColor, 'transparent');
});

test('Smooth Tab Crossfade & Search-Only Skeletons: local tabs/modals fade without skeletons while network search keeps full-screen TrackRowSkeleton', async () => {
  const { StyleSheet } = require('react-native');
  const { LibrarySection } = require('../components/LibrarySection');
  const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
  const { AddToPlaylistModal } = require('../components/AddToPlaylistModal');
  const { getAllText } = require('./helpers/testUtils');
  const api = require('../services/api');

  // 1. TrackRowSkeleton fadeBottom applies gradual opacity fade on last 2 rows (for search)
  let rowTree;
  await actAsync(async () => {
    rowTree = renderer.create(
      React.createElement(TrackRowSkeleton, { count: 10, fadeBottom: true })
    );
  });
  const rowViews = rowTree.root
    .findAllByType('View')
    .filter((v) => StyleSheet.flatten(v.props.style)?.flexDirection === 'row');
  assert.strictEqual(rowViews.length, 10);
  assert.strictEqual(StyleSheet.flatten(rowViews[8].props.style).opacity, 0.64);
  assert.strictEqual(StyleSheet.flatten(rowViews[9].props.style).opacity, 0.32);

  // 2. LibrarySection never renders skeletons when navigating/loading locally
  let libLoadingTree;
  await actAsync(async () => {
    libLoadingTree = renderer.create(
      React.createElement(LibrarySection, {
        playlists: [],
        isLoading: true,
        isQuickCreateVisible: false,
        quickCreateName: '',
        onChangeQuickCreateName: () => {},
        onToggleQuickCreate: () => {},
        onSubmitQuickCreate: () => {},
        onSelectPlaylist: () => {},
      })
    );
  });
  assert.strictEqual(libLoadingTree.root.findAllByType(CardSkeleton).length, 0);
  assert.strictEqual(libLoadingTree.root.findAllByType(TrackRowSkeleton).length, 0);
  assert.strictEqual(libLoadingTree.root.findAllByType(Skeleton).length, 0);

  // 3. PlaylistDetailModal & AddToPlaylistModal load via smooth fade with zero skeletons
  let plDetailTree;
  await actAsync(async () => {
    plDetailTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: '__favorites__',
        onClose: () => {},
        onPlayTrack: () => {},
        onPlayAll: () => {},
      })
    );
  });
  assert.strictEqual(plDetailTree.root.findAllByType(TrackRowSkeleton).length, 0);
  assert.strictEqual(plDetailTree.root.findAllByType(Skeleton).length, 0);

  let addModalTree;
  await actAsync(async () => {
    addModalTree = renderer.create(
      React.createElement(AddToPlaylistModal, {
        visible: true,
        onClose: () => {},
        track: { id: 't_add', title: 'Song', artist: 'Artist', duration: 120, thumbnailUrl: '' },
      })
    );
  });
  assert.strictEqual(addModalTree.root.findAllByType(TrackRowSkeleton).length, 0);

  // 4. App tab switching uses tab-transition-container fade without rendering skeletons
  const origSearchTracks = api.searchTracks;
  let resolveSearch;
  api.searchTracks = () =>
    new Promise((resolve) => {
      resolveSearch = resolve;
    });

  let appTree;
  await actAsync(async () => {
    appTree = renderer.create(React.createElement(App));
  });
  const transitionView = appTree.root.findByProps({ testID: 'tab-transition-container' });
  assert.strictEqual(StyleSheet.flatten(transitionView.props.style).backgroundColor, 'transparent');

  const playlistsTabBtn = appTree.root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Playlists')
  )[0];
  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });
  assert.strictEqual(appTree.root.findByType(LibrarySection).props.isLoading, false);
  assert.strictEqual(appTree.root.findAllByType(TrackRowSkeleton).length, 0);

  // 5. Network search still renders full-screen TrackRowSkeleton (>= 10 rows with fadeBottom)
  const searchTabBtn = appTree.root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Buscar')
  )[0];
  await actAsync(async () => {
    searchTabBtn.props.onPress();
  });

  const input = findInputByPlaceholder(appTree.root, 'Buscar faixas, artistas ou álbuns...');
  const searchBtn = findSearchActionButton(appTree.root);
  await actAsync(async () => {
    input.props.onChangeText('Lo-Fi');
  });
  await actAsync(async () => {
    searchBtn.props.onPress();
  });

  const searchSkeleton = appTree.root.findByType(TrackRowSkeleton);
  assert.ok(searchSkeleton.props.count >= 10);
  assert.strictEqual(searchSkeleton.props.fadeBottom, true);

  await actAsync(async () => {
    resolveSearch([]);
  });
  api.searchTracks = origSearchTracks;

  // 6. Entering & exiting a playlist uses smooth shell + playlist-detail-transition crossfade
  const shellView = appTree.root.findByProps({ testID: 'shell-transition-container' });
  assert.strictEqual(StyleSheet.flatten(shellView.props.style).backgroundColor, 'transparent');

  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });
  const libSection = appTree.root.findByType(LibrarySection);
  assert.ok(libSection.props.playlists.length > 0, 'Playlists tab should have system Favorites playlist');
  const firstPlaylistId = libSection.props.playlists[0].id;

  const { Animated } = require('react-native');
  const timingEvents = [];
  const origTiming = Animated.timing;
  Animated.timing = (val, config) => {
    timingEvents.push({
      from: val?._value,
      toValue: config?.toValue,
      duration: config?.duration,
    });
    return origTiming(val, config);
  };
  try {
    await actAsync(async () => {
      libSection.props.onSelectPlaylist(firstPlaylistId);
    });
  } finally {
    Animated.timing = origTiming;
  }

  assert.ok(
    timingEvents.some(
      (e) => e.from === 1 && e.toValue === 0 && e.duration === theme.transitions.screenOutMs
    ),
    'Shell must fade out (1 -> 0) before opening playlist detail'
  );
  assert.ok(
    timingEvents.some(
      (e) => e.from === 0 && e.toValue === 1 && e.duration === theme.transitions.screenInMs
    ),
    'PlaylistDetailModal must still fade in (0 -> 1) even when hydrated from cache'
  );

  const detailTransition = appTree.root.findByProps({ testID: 'playlist-detail-transition' });
  const detailStyle = StyleSheet.flatten(detailTransition.props.style);
  assert.strictEqual(detailStyle.opacity._value, 1);

  const backBtn = detailTransition.findByProps({ accessibilityLabel: 'Voltar' });
  await actAsync(async () => {
    backBtn.props.onPress();
  });

  const restoredShell = appTree.root.findByProps({ testID: 'shell-transition-container' });
  const restoredTab = appTree.root.findByProps({ testID: 'tab-transition-container' });
  assert.strictEqual(StyleSheet.flatten(restoredShell.props.style).opacity._value, 1);
  assert.strictEqual(StyleSheet.flatten(restoredTab.props.style).opacity._value, 1);

  // 7. PlaylistDetailModal with initialPlaylist starts fade-in immediately without stalling on SQLite
  let instantDetailTree;
  await actAsync(async () => {
    instantDetailTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: 'pl_preview',
        initialPlaylist: {
          id: 'pl_preview',
          name: 'Immediate Preview Mix',
          description: 'No SQLite stall',
          trackCount: 3,
          thumbnailUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
          isSystem: false,
        },
        onClose: () => {},
        onPlayTrack: () => {},
        onPlayAll: () => {},
      })
    );
  });
  const instantTransition = instantDetailTree.root.findByProps({
    testID: 'playlist-detail-transition',
  });
  assert.strictEqual(StyleSheet.flatten(instantTransition.props.style).opacity._value, 1);
});

test('All 3-dot Bottom Sheets & cached Modals animate entry smoothly via onShow and after-commit scheduling', async () => {
  const { Animated } = require('react-native');
  const { TrackCard } = require('../components/TrackCard');
  const { AddToPlaylistModal } = require('../components/AddToPlaylistModal');
  const { PlaylistOptionsSheet } = require('../components/PlaylistOptionsSheet');
  const { ArtistProfileModal } = require('../components/ArtistProfileModal');
  const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
  const { createPlaylist, getPlaylists, getPlaylistById, initDatabase } = require('../services/database');
  const { findButtonByIcon } = require('./helpers/testUtils');

  await initDatabase();
  const pl = await createPlaylist('Cached Animation Pl');
  await getPlaylists(); // pre-warm playlists cache
  await getPlaylistById(pl.id); // pre-warm detail cache

  const captureTimings = async (fn) => {
    const events = [];
    const origTiming = Animated.timing;
    Animated.timing = (val, config) => {
      events.push({
        from: val?._value,
        toValue: config?.toValue,
        duration: config?.duration,
        useNativeDriver: config?.useNativeDriver,
      });
      return origTiming(val, config);
    };
    try {
      await fn();
    } finally {
      Animated.timing = origTiming;
    }
    return events;
  };

  // 1. TrackContextSheet (3-dots menu on TrackCard) animates translateY (300 -> 0) and backdrop (0 -> 1)
  let cardTree;
  await actAsync(async () => {
    cardTree = renderer.create(
      React.createElement(TrackCard, {
        id: 'anim_t1',
        title: 'Animated Track',
        artist: 'Artist A',
        onPress: () => {},
        onPlayNext: () => {},
        onAddToPlaylist: () => {},
      })
    );
  });
  const trackMenuEvents = await captureTimings(async () => {
    const moreBtn = cardTree.root.findByProps({
      accessibilityLabel: 'Mais opções para Animated Track',
    });
    await actAsync(async () => {
      moreBtn.props.onPress({ stopPropagation: () => {} });
    });
  });
  assert.ok(
    trackMenuEvents.some((e) => e.from === 300 && e.toValue === 0 && e.useNativeDriver === true),
    'TrackContextSheet must slide up from translateY=300 -> 0 on Modal onShow'
  );
  assert.ok(
    trackMenuEvents.some((e) => e.from === 0 && e.toValue === 1 && e.useNativeDriver === true),
    'TrackContextSheet must fade backdrop opacity 0 -> 1 on Modal onShow'
  );

  // 2. AddToPlaylistModal still animates slide-up (320 -> 0) + backdrop even with cached playlists
  const addModalEvents = await captureTimings(async () => {
    await actAsync(async () => {
      renderer.create(
        React.createElement(AddToPlaylistModal, {
          visible: true,
          onClose: () => {},
          track: { id: 'anim_t1', title: 'Animated Track', artist: 'Artist A', duration: 180, thumbnailUrl: '' },
        })
      );
    });
  });
  assert.ok(
    addModalEvents.some((e) => e.from === 320 && e.toValue === 0 && e.useNativeDriver === true),
    'AddToPlaylistModal must slide up even when playlists are hydrated from cache'
  );
  assert.ok(
    addModalEvents.some((e) => e.from === 0 && e.toValue === 1 && e.useNativeDriver === true),
    'AddToPlaylistModal must fade backdrop opacity 0 -> 1'
  );

  // 3. PlaylistOptionsSheet animates slide-up (320 -> 0) + backdrop (0 -> 1)
  const cachedDetail = await getPlaylistById(pl.id);
  const plOptionsEvents = await captureTimings(async () => {
    await actAsync(async () => {
      renderer.create(
        React.createElement(PlaylistOptionsSheet, {
          visible: true,
          playlist: cachedDetail,
          isReordering: false,
          isDownloadingAll: false,
          onClose: () => {},
          onPickCustomCover: () => {},
          onResetCustomCover: () => {},
          onEditDetails: () => {},
          onToggleReorder: () => {},
          onDownloadAll: () => {},
          onDeletePlaylist: () => {},
        })
      );
    });
  });
  assert.ok(
    plOptionsEvents.some((e) => e.from === 320 && e.toValue === 0 && e.useNativeDriver === true),
    'PlaylistOptionsSheet must slide up from translateY=320 -> 0'
  );
  assert.ok(
    plOptionsEvents.some((e) => e.from === 0 && e.toValue === 1 && e.useNativeDriver === true),
    'PlaylistOptionsSheet must fade backdrop opacity 0 -> 1'
  );

  // 4. ArtistProfileModal animates entrance via onShow even when hydrated from initialProfile cache
  const artistEvents = await captureTimings(async () => {
    await actAsync(async () => {
      renderer.create(
        React.createElement(ArtistProfileModal, {
          visible: true,
          onClose: () => {},
          artistName: 'Daft Punk',
          initialProfile: { name: 'Daft Punk', topTracks: [], albums: [], singles: [] },
          onPlayTrack: () => {},
          onStartArtistRadio: () => {},
        })
      );
    });
  });
  assert.ok(
    artistEvents.some((e) => e.from === 0 && e.toValue === 1 && e.useNativeDriver === true),
    'ArtistProfileModal must animate opacity 0 -> 1 even when initialProfile cache hits'
  );
  assert.ok(
    artistEvents.some((e) => e.from === 18 && e.toValue === 0 && e.useNativeDriver === true),
    'ArtistProfileModal must animate translateY 18 -> 0 even when cached'
  );

  // 5. PlaylistDetailModal animates both opacity (0 -> 1) and translateY (14 -> 0) from cache
  const detailEvents = await captureTimings(async () => {
    await actAsync(async () => {
      renderer.create(
        React.createElement(PlaylistDetailModal, {
          visible: true,
          playlistId: pl.id,
          onClose: () => {},
          onPlayTrack: () => {},
          onPlayAll: () => {},
        })
      );
    });
  });
  assert.ok(
    detailEvents.some((e) => e.from === 0 && e.toValue === 1 && e.duration === theme.transitions.screenInMs),
    'PlaylistDetailModal must fade in from 0 -> 1 when cached'
  );
  assert.ok(
    detailEvents.some((e) => e.from === 14 && e.toValue === 0 && e.useNativeDriver === true),
    'PlaylistDetailModal must subtly slide 14 -> 0 when cached'
  );

  // 6. NowPlayingModal 3-dots sheet slides up and fades backdrop after mounting
  let npTree;
  await actAsync(async () => {
    npTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: { id: 'np_anim_1', title: 'Veridis Quo', artist: 'Daft Punk', duration: 345, url: 'https://x.com/a.m4a' },
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });
  const npMenuEvents = await captureTimings(async () => {
    const moreBtn = findButtonByIcon(npTree.root, 'MoreVertical');
    assert.ok(moreBtn, 'NowPlayingModal 3-dots button must exist');
    await actAsync(async () => {
      moreBtn.props.onPress();
    });
  });
  assert.ok(
    npMenuEvents.some((e) => e.from === 360 && e.toValue === 0 && e.useNativeDriver === true),
    'NowPlayingModal 3-dots context sheet must slide from 360 -> 0 after mounting'
  );
  assert.ok(
    npMenuEvents.some((e) => e.from === 0 && e.toValue === 1 && e.useNativeDriver === true),
    'NowPlayingModal 3-dots context sheet must fade backdrop 0 -> 1'
  );
});

