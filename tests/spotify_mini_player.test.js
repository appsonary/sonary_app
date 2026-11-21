// tests/spotify_mini_player.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const {
  PersistentMiniPlayer,
  getDominantTrackColor,
  SPOTIFY_DARK_PALETTES,
} = require('../components/PersistentMiniPlayer');
const { actAsync, findButtonByIcon, getAllText, resetAllMocks } = require('./helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
});

test('Spotify Mini Player: getDominantTrackColor extracts dynamic dark background colors', () => {
  // Test distinct track seeds produce valid deep dark tones
  const colorNavy = getDominantTrackColor('https://example.com/blue_cover.jpg', 'track_1', 'Still Yours');
  const colorForest = getDominantTrackColor('https://example.com/forest.jpg', 'track_2', 'Chill Green');
  const colorBurgundy = getDominantTrackColor('https://example.com/red_love.jpg', 'track_3', 'Red Love');
  const colorPlum = getDominantTrackColor('https://example.com/violet.jpg', 'track_4', 'Starboy');

  assert.strictEqual(colorNavy, '#132438', 'Blue/Navy track should get Spotify deep midnight navy');
  assert.strictEqual(colorForest, '#0e2d24', 'Green track should get Spotify deep forest emerald');
  assert.strictEqual(colorBurgundy, '#351419', 'Red track should get Spotify deep wine burgundy');
  assert.strictEqual(colorPlum, '#2a1435', 'Purple track should get Spotify deep velvet violet');

  // Verify all palette colors are valid hex colors
  for (const hex of SPOTIFY_DARK_PALETTES) {
    assert.match(hex, /^#[0-9a-fA-F]{6}$/, `${hex} must be a valid 6-digit hex color`);
  }
});

test('Spotify Mini Player: Renders floating card with dynamic background, bottom progress bar and Spotify controls', async () => {
  let playToggled = false;
  let favoriteToggled = false;
  let expanded = false;

  const sampleTrack = {
    id: 'bryson_1',
    title: 'Still Yours (feat. Big Sean)',
    artist: 'Bryson Tiller, Big Sean',
    duration: 215,
    artwork: 'https://example.com/stillyours_blue.jpg',
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PersistentMiniPlayer, {
        activeTrack: sampleTrack,
        isPlaying: true,
        isLoadingAudio: false,
        isBuffering: false,
        isFavorite: true,
        progressPct: 40,
        onExpand: () => {
          expanded = true;
        },
        onTogglePlay: () => {
          playToggled = true;
        },
        onSkipNext: () => {},
        onSkipPrevious: () => {},
        onToggleFavorite: () => {
          favoriteToggled = true;
        },
      })
    );
  });

  const root = tree.root;
  assert.ok(root, 'Mini player should render');

  // Verify text content: Title and Artist
  const text = getAllText(root);
  assert.ok(text.includes('Still Yours'), 'Title must be rendered');
  assert.ok(text.includes('Bryson Tiller'), 'Artist must be rendered');

  // Verify dynamic background color on root card
  const touchables = root.findAllByType('TouchableOpacity');
  const card = touchables[0];
  const flattenedStyle = Object.assign({}, ...[].concat(card.props.style).filter(Boolean));
  assert.strictEqual(flattenedStyle.backgroundColor, '#132438', 'Background color should dynamically match album palette');
  assert.strictEqual(flattenedStyle.borderRadius, 8, 'Mini player must preserve rounded corners');
  assert.strictEqual(flattenedStyle.marginHorizontal, 0, 'Mini player must reach both horizontal edges of the screen');

  // Verify device connect button and chevron expand button are omitted
  const deviceBtn = findButtonByIcon(root, 'Laptop2');
  assert.strictEqual(deviceBtn, null, 'Device connect button must not be present when pairing feature is inactive');
  assert.strictEqual(findButtonByIcon(root, 'ChevronUp'), null, 'Mini player must not render ChevronUp button');

  // Verify Favorite Heart button exists, is red (#FF0000) when active, and toggles
  const favBtn = findButtonByIcon(root, 'Heart');
  assert.ok(favBtn, 'Favorite button must exist');
  const heartIcon = favBtn.find((n) => n.type === 'LucideIcon' && n.props.name === 'Heart');
  assert.strictEqual(heartIcon.props.color, '#FF0000', 'Favorite heart color must be red (#FF0000)');
  assert.strictEqual(heartIcon.props.fill, '#FF0000', 'Favorite heart fill must be red (#FF0000)');
  await actAsync(async () => {
    favBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(favoriteToggled, true, 'Pressing favorite should trigger callback');

  // Verify Play/Pause button
  const pauseBtn = findButtonByIcon(root, 'Pause');
  assert.ok(pauseBtn, 'Pause icon button must be rendered when playing');
  await actAsync(async () => {
    pauseBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(playToggled, true, 'Pressing play/pause should trigger callback');
});

test('Spotify Mini Player: Upward drag gestures drive onDragMove/onDragRelease without hijacking taps or horizontal swipes', async () => {
  const moves = [];
  let released = null;
  let cancelled = false;
  let expanded = false;

  const sampleTrack = {
    id: 'drag_mini_1',
    title: 'Sorrows',
    artist: 'Bryson Tiller',
    duration: 194,
    artwork: 'https://example.com/sorrows_blue.jpg',
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PersistentMiniPlayer, {
        activeTrack: sampleTrack,
        isPlaying: true,
        isLoadingAudio: false,
        isBuffering: false,
        progressPct: 25,
        onExpand: () => {
          expanded = true;
        },
        onDragMove: (dy) => moves.push(dy),
        onDragRelease: (dy, vy) => {
          released = { dy, vy };
        },
        onDragCancel: () => {
          cancelled = true;
        },
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });

  const root = tree.root;
  const panWrapper = root.find(
    (n) => n.type === 'View' && typeof n.props.onMoveShouldSetResponderCapture === 'function'
  );
  assert.ok(panWrapper, 'Mini player should attach upward drag PanResponder when drag props are supplied');

  // Normal tap / downward / horizontal movement should NOT capture
  assert.strictEqual(panWrapper.props.onStartShouldSetResponder(), false);
  assert.strictEqual(panWrapper.props.onMoveShouldSetResponderCapture({}, { dy: 12, dx: 0 }), false);
  assert.strictEqual(panWrapper.props.onMoveShouldSetResponderCapture({}, { dy: -4, dx: 30 }), false);

  // Upward drag captures and forwards move/release/terminate
  assert.strictEqual(panWrapper.props.onMoveShouldSetResponderCapture({}, { dy: -20, dx: 0 }), true);
  await actAsync(async () => {
    panWrapper.props.onResponderMove({}, { dy: -90, dx: 0 });
    panWrapper.props.onResponderRelease({}, { dy: -90, dx: 0, vy: -0.6 });
  });
  assert.deepStrictEqual(moves, [-90]);
  assert.deepStrictEqual(released, { dy: -90, vy: -0.6 });
  assert.strictEqual(expanded, false);

  await actAsync(async () => {
    panWrapper.props.onResponderTerminate();
  });
  assert.strictEqual(cancelled, true);
});

test('Spotify Mini Player: Extracts real artwork pixel color for PersistentMiniPlayer and NowPlayingModal compactMiniBar with safe cancellation and WCAG contrast', async () => {
  const { Skia } = require('@shopify/react-native-skia');
  const {
    extractLyricsPaletteFromPixels,
    clearArtworkPaletteCacheForTest,
  } = require('../components/AmbientGlowBackground');
  const NowPlayingModal = require('../components/NowPlayingModal').default;

  const hexToRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const luminance = (hex) => {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrastRatio = (fgHex, bgHex) => {
    const l1 = Math.max(luminance(fgHex), luminance(bgHex));
    const l2 = Math.min(luminance(fgHex), luminance(bgHex));
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const makeSolidPixels = (r, g, b, count = 256) => {
    const arr = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      arr[i * 4] = r;
      arr[i * 4 + 1] = g;
      arr[i * 4 + 2] = b;
      arr[i * 4 + 3] = 255;
    }
    return arr;
  };

  // 1. Verify coral-red cover ("Notion" style) produces warm reddish miniColor with high contrast
  const coralPixels = makeSolidPixels(230, 89, 66);
  const coralPalette = extractLyricsPaletteFromPixels(coralPixels);
  const [cr, cg, cb] = hexToRgb(coralPalette.miniColor);
  assert.ok(cr > cg && cr > cb, `Coral cover should yield reddish miniColor, got ${coralPalette.miniColor}`);
  assert.ok(contrastRatio('#FFFFFF', coralPalette.miniColor) >= 7.5, 'White title contrast must be >= 7.5:1');
  assert.ok(contrastRatio('#B3B3B3', coralPalette.miniColor) >= 4.5, 'Gray artist contrast must be >= 4.5:1');

  // 2. Verify bright yellow cover still enforces WCAG contrast on miniColor
  const yellowPalette = extractLyricsPaletteFromPixels(makeSolidPixels(255, 245, 40));
  assert.ok(contrastRatio('#FFFFFF', yellowPalette.miniColor) >= 7.5, 'Yellow miniColor must keep white title >= 7.5:1');
  assert.ok(contrastRatio('#B3B3B3', yellowPalette.miniColor) >= 4.5, 'Yellow miniColor must keep gray artist >= 4.5:1');

  // 3. Wire mock Skia decoding pipeline to test PersistentMiniPlayer + NowPlayingModal + rapid track switch
  const coralUri = 'https://i.ytimg.com/vi/notion_coral/hqdefault.jpg';
  const greenUri = 'https://i.ytimg.com/vi/emerald_track/hqdefault.jpg';
  const brokenUri = 'https://i.ytimg.com/vi/offline_broken/hqdefault.jpg';
  const greenPixels = makeSolidPixels(30, 175, 90);
  const greenPalette = extractLyricsPaletteFromPixels(greenPixels);

  let disposedCount = 0;
  let capturedCropRect = null;
  let resolveSlowCoral = null;
  const uriToPixels = new Map([
    [coralUri, coralPixels],
    [greenUri, greenPixels],
  ]);

  clearArtworkPaletteCacheForTest();
  Skia.Data = {
    fromURI: (uri) => {
      if (uri === brokenUri) return Promise.reject(new Error('Network offline'));
      if (uri === coralUri && resolveSlowCoral === null) {
        return new Promise((resolve) => {
          resolveSlowCoral = () => resolve({ uri, dispose: () => { disposedCount++; } });
        });
      }
      return Promise.resolve({ uri, dispose: () => { disposedCount++; } });
    },
  };
  Skia.Image = {
    MakeImageFromEncoded: (data) => ({
      uri: data.uri,
      width: () => 480,
      height: () => 360,
      dispose: () => { disposedCount++; },
    }),
  };
  Skia.Paint = () => ({ dispose: () => { disposedCount++; } });
  Skia.XYWHRect = (x, y, width, height) => ({ x, y, width, height });
  Skia.Surface = {
    Make: () => {
      let drawnUri = null;
      return {
        getCanvas: () => ({
          drawImageRect: (img, srcRect) => {
            drawnUri = img.uri;
            capturedCropRect = srcRect;
          },
        }),
        makeImageSnapshot: () => ({
          readPixels: () => uriToPixels.get(drawnUri) || null,
          dispose: () => { disposedCount++; },
        }),
        dispose: () => { disposedCount++; },
      };
    },
  };

  try {
    const notionTrack = {
      id: 'notion_1',
      title: 'Notion',
      artist: 'The Rare Occasions - Topic',
      duration: 195,
      artwork: coralUri,
    };
    const greenTrack = {
      id: 'green_1',
      title: 'Emerald Song',
      artist: 'Artist',
      duration: 210,
      artwork: greenUri,
    };

    // Start on Notion (slow fetch), then rapidly switch to Green before Notion resolves
    let miniTree;
    await actAsync(async () => {
      miniTree = renderer.create(
        React.createElement(PersistentMiniPlayer, {
          activeTrack: notionTrack,
          isPlaying: true,
          isLoadingAudio: false,
          isBuffering: false,
          progressPct: 20,
          onExpand: () => {},
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
        })
      );
    });

    // Switch immediately to greenTrack before coralUri resolves
    await actAsync(async () => {
      miniTree.update(
        React.createElement(PersistentMiniPlayer, {
          activeTrack: greenTrack,
          isPlaying: true,
          isLoadingAudio: false,
          isBuffering: false,
          progressPct: 20,
          onExpand: () => {},
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
        })
      );
    });

    const getMiniBg = (t) => {
      const card = t.root.findAllByType('TouchableOpacity')[0];
      return Object.assign({}, ...[].concat(card.props.style).filter(Boolean)).backgroundColor;
    };

    assert.strictEqual(
      getMiniBg(miniTree),
      greenPalette.miniColor,
      'PersistentMiniPlayer must apply real pixel-extracted green miniColor'
    );
    assert.ok(
      capturedCropRect && capturedCropRect.y > 0 && capturedCropRect.height < 360,
      'hqdefault.jpg thumbnails must crop top/bottom YouTube letterbox bars before sampling'
    );

    // Now resolve the stale slow coralUri fetch — must NOT overwrite greenTrack's color!
    await actAsync(async () => {
      resolveSlowCoral();
    });
    assert.strictEqual(
      getMiniBg(miniTree),
      greenPalette.miniColor,
      'Stale in-flight artwork load must NOT clobber current track mini player color'
    );

    // Switching back to Notion should hit cache synchronously and show coralPalette.miniColor
    await actAsync(async () => {
      miniTree.update(
        React.createElement(PersistentMiniPlayer, {
          activeTrack: notionTrack,
          isPlaying: true,
          isLoadingAudio: false,
          isBuffering: false,
          progressPct: 20,
          onExpand: () => {},
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
        })
      );
    });
    assert.strictEqual(
      getMiniBg(miniTree),
      coralPalette.miniColor,
      'Cached coral artwork must render coral miniColor immediately on PersistentMiniPlayer'
    );

    // NowPlayingModal compactMiniBar (persistentMode) must also use coralPalette.miniColor
    let modalTree;
    await actAsync(async () => {
      modalTree = renderer.create(
        React.createElement(NowPlayingModal, {
          visible: false,
          persistentMode: true,
          isModalActive: false,
          onClose: () => {},
          track: notionTrack,
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
        })
      );
    });
    const coralSurfaceViews = modalTree.root.findAll((n) => {
      if (!n.props?.style) return false;
      const flat = Object.assign({}, ...[].concat(n.props.style).filter(Boolean));
      return flat.backgroundColor === coralPalette.miniColor;
    });
    assert.ok(
      coralSurfaceViews.length >= 2,
      'NowPlayingModal persistentMode compactMiniBar and morph surface must use real coral miniColor'
    );
    await actAsync(async () => {
      modalTree.unmount();
    });

    // Broken/offline artwork URI must fall back gracefully without crashing
    const brokenTrack = {
      id: 'broken_1',
      title: 'Still Yours',
      artist: 'Artist',
      duration: 180,
      artwork: brokenUri,
    };
    await actAsync(async () => {
      miniTree.update(
        React.createElement(PersistentMiniPlayer, {
          activeTrack: brokenTrack,
          isPlaying: false,
          isLoadingAudio: false,
          isBuffering: false,
          progressPct: 0,
          onExpand: () => {},
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
        })
      );
    });
    assert.strictEqual(
      getMiniBg(miniTree),
      getDominantTrackColor(brokenUri, brokenTrack.id, brokenTrack.title),
      'Offline/failed artwork decode must gracefully fall back to deterministic color'
    );
    assert.ok(disposedCount >= 4, 'Native Skia Data/Image/Surface/Paint objects must be disposed');
  } finally {
    delete Skia.Data;
    delete Skia.Image;
    delete Skia.Paint;
    delete Skia.XYWHRect;
    delete Skia.Surface;
    clearArtworkPaletteCacheForTest();
  }
});


