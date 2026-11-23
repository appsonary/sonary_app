// tests/lyrics_radio_related_artist.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const NowPlayingModal = require('../components/NowPlayingModal').default;
const { LyricsViewer } = require('../components/LyricsViewer');
const { ArtistProfileModal } = require('../components/ArtistProfileModal');
const api = require('../services/api');
const player = require('../services/player');
const db = require('../services/database');
const { actAsync, getAllText, resetAllMocks } = require('./helpers/testUtils');
const { mockPlayer } = require('./mocks/trackPlayerMock');

const originalFetch = global.fetch;

test.beforeEach(async () => {
  resetAllMocks();
  api.clearLyricsCache();
  await db.initDatabase();
});

test.afterEach(() => {
  global.fetch = originalFetch;
});

test('LRA-001: getTrackLyrics caches synced lyrics in L1 memory and L2 SQLite and preserves plain lyrics without fake timestamps', async () => {
  let fetchCount = 0;
  global.fetch = async (url) => {
    fetchCount += 1;
    if (String(url).includes('lrclib.net')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          syncedLyrics: '[00:05.50] First real verse\n[00:12.25] Second real verse',
          plainLyrics: 'First real verse\nSecond real verse',
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  // 1. First call fetches from network and stores in L1 + L2
  const res1 = await api.getTrackLyrics('track_sync_1', 'Test Song', 'Test Artist', 180);
  assert.strictEqual(res1.type, 'synced');
  assert.strictEqual(res1.provider, 'lrclib');
  assert.strictEqual(res1.lines.length, 2);
  assert.strictEqual(res1.lines[0].time, 5.5);
  assert.strictEqual(res1.lines[1].time, 12.25);
  assert.strictEqual(fetchCount, 1);

  // 2. Second call hits L1 Memory Cache (0 network calls)
  const res2 = await api.getTrackLyrics('track_sync_1', 'Test Song', 'Test Artist', 180);
  assert.strictEqual(res2.type, 'synced');
  assert.strictEqual(fetchCount, 1, 'L1 cache should prevent redundant network fetch');

  // 3. Clear L1 Memory Cache -> Third call hits L2 SQLite Cache (0 network calls)
  api.clearLyricsCache();
  const res3 = await api.getTrackLyrics('track_sync_1', 'Test Song', 'Test Artist', 180);
  assert.strictEqual(res3.type, 'synced');
  assert.strictEqual(res3.lines[0].text, 'First real verse');
  assert.strictEqual(fetchCount, 1, 'L2 SQLite cache should hydrate without network fetch');

  // 4. Plain lyrics only -> Must NOT slice fake timestamps
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      plainLyrics: 'Un-synced line one\nUn-synced line two',
    }),
  });

  const plainRes = await api.getTrackLyrics('track_plain_1', 'Plain Song', 'Artist', 200);
  assert.strictEqual(plainRes.type, 'plain');
  assert.strictEqual(plainRes.lines.length, 2);
  assert.strictEqual(plainRes.lines[0].time, 0);
  assert.strictEqual(plainRes.lines[1].time, 0, 'Plain lyrics must not have synthetic timestamps');

  // 5. 404 Not Found -> Graceful none state
  global.fetch = async () => ({ ok: false, status: 404 });
  const noneRes = await api.getTrackLyrics('track_none_1', 'Unknown', 'Nobody', 120);
  assert.strictEqual(noneRes.type, 'none');
  assert.strictEqual(noneRes.lines.length, 0);
});

test('LRA-002: LyricsViewer eliminates static mock, supports Synced/Plain toggle and Retry button on empty state', async () => {
  let retried = false;
  let seekedTo = null;

  // 1. Render with 'none' payload -> Must show graceful empty state and NEVER show old fake lines
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(LyricsViewer, {
        track: { id: 't1', title: 'Instrumental', artist: 'Daft Punk', duration: 200 },
        lyricsPayload: {
          trackId: 't1',
          type: 'none',
          lines: [],
          provider: 'none',
          cachedAt: Date.now(),
        },
        isLoading: false,
        currentPosition: 10,
        isExpanded: false,
        onToggleExpand: () => {},
        onSeekTo: (sec) => {
          seekedTo = sec;
        },
        onRetry: () => {
          retried = true;
        },
      })
    );
  });

  const emptyText = getAllText(tree.root);
  assert.ok(
    !emptyText.includes('Sentindo o ritmo ecoar no ar'),
    'Old static 10-line mock must be completely eliminated'
  );
  assert.ok(
    !emptyText.includes('Instrumental') && !emptyText.includes('Daft Punk'),
    'Lyrics component must not repeat track title or artist'
  );
  assert.ok(
    emptyText.includes('Letras não disponíveis para esta faixa'),
    'Empty state message must be displayed'
  );

  const retryBtn = tree.root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props.accessibilityLabel === 'Tentar carregar letras novamente'
  );
  assert.ok(retryBtn, 'Retry button must exist in empty state');
  await actAsync(async () => {
    retryBtn.props.onPress();
  });
  assert.strictEqual(retried, true, 'Clicking retry button must trigger onRetry');
  assert.strictEqual(seekedTo, null, 'Clicking retry button must never seek playback');

  // 2. Render in fullscreen mode with synced lyrics -> Toggle between Synced and Plain mode without seeking
  let toggledPlay = false;
  await actAsync(async () => {
    tree.update(
      React.createElement(LyricsViewer, {
        track: { id: 't2', title: 'Get Lucky', artist: 'Daft Punk', duration: 240 },
        lyricsPayload: {
          trackId: 't2',
          type: 'synced',
          lines: [
            { time: 10, text: 'Like the legend of the phoenix' },
            { time: 18.5, text: 'All ends with beginnings' },
          ],
          plainText: 'Like the legend of the phoenix\nAll ends with beginnings',
          provider: 'lrclib',
          cachedAt: Date.now(),
        },
        isLoading: false,
        currentPosition: 12,
        isExpanded: true,
        variant: 'fullscreen',
        isPlaying: true,
        onTogglePlay: () => {
          toggledPlay = true;
        },
        onToggleExpand: () => {},
        onSeekTo: (sec) => {
          seekedTo = sec;
        },
      })
    );
  });

  const syncedText = getAllText(tree.root);
  assert.ok(syncedText.includes('Like the legend of the phoenix'));
  assert.ok(
    !syncedText.includes('Get Lucky') && !syncedText.includes('Daft Punk'),
    'Fullscreen lyrics must not repeat track title or artist'
  );

  const toggleModeBtn = tree.root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props.accessibilityLabel === 'Alternar para texto puro'
  );
  assert.ok(toggleModeBtn, 'Toggle button for Plain/Synced mode must exist in fullscreen');
  await actAsync(async () => {
    toggleModeBtn.props.onPress({ stopPropagation: () => {} });
  });

  const syncBackBtn = tree.root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props.accessibilityLabel === 'Alternar para letra sincronizada'
  );
  assert.ok(syncBackBtn, 'Should switch to plain mode and allow switching back to synced');

  const playPauseBtn = tree.root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props.accessibilityLabel === 'Reproduzir ou pausar'
  );
  assert.ok(playPauseBtn, 'Fullscreen lyrics footer must provide Play/Pause button');
  await actAsync(async () => {
    playPauseBtn.props.onPress();
  });
  assert.strictEqual(toggledPlay, true, 'Fullscreen Play/Pause button must invoke onTogglePlay');
  assert.strictEqual(seekedTo, null, 'Interacting with lyrics must never trigger seek');
});


test('LRA-005 & LRA-006: NowPlayingModal renders real relatedTracks, triggers radio actions, and opens ArtistProfileModal', async () => {
  let trackRadioStarted = false;
  let artistRadioStartedWith = null;
  let playedRelated = null;
  let queuedRelated = null;

  const currentTrack = {
    id: 'main_1',
    title: 'Midnight City',
    artist: 'M83',
    duration: 243,
    artwork: 'https://example.com/m83.jpg',
  };

  const relatedTracks = [
    {
      id: 'rel_1',
      title: 'Wait',
      artist: 'M83',
      duration: 343,
      formattedDuration: '5:43',
      thumbnailUrl: 'https://example.com/wait.jpg',
    },
    {
      id: 'rel_2',
      title: 'Outro',
      artist: 'M83',
      duration: 247,
      formattedDuration: '4:07',
      thumbnailUrl: 'https://example.com/outro.jpg',
    },
  ];

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: currentTrack,
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
        relatedTracks,
        onStartTrackRadio: () => {
          trackRadioStarted = true;
        },
        onStartArtistRadio: (artistName) => {
          artistRadioStartedWith = artistName;
        },
        onPlayRelatedTrack: (t) => {
          playedRelated = t;
        },
        onAddRelatedToQueue: (t) => {
          queuedRelated = t;
        },
      })
    );
  });

  const root = modalTree.root;
  const allText = getAllText(root);

  // 1. Verify dynamic related tracks are rendered
  assert.ok(allText.includes('Wait'), 'Related track "Wait" must be rendered');
  assert.ok(allText.includes('5:43'), 'Related track formatted duration must be rendered');
  assert.ok(allText.includes('Outro'), 'Related track "Outro" must be rendered');

  // 2. Trigger Track Radio button
  const trackRadioBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar mix relacionado'
  );
  await actAsync(async () => {
    trackRadioBtn.props.onPress();
  });
  assert.strictEqual(trackRadioStarted, true, 'Track Radio button must call onStartTrackRadio');

  // 3. Trigger Artist Radio card
  const artistRadioBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Iniciar rádio do artista'
  );
  await actAsync(async () => {
    artistRadioBtn.props.onPress();
  });
  assert.strictEqual(artistRadioStartedWith, 'M83', 'Artist Radio card must call onStartArtistRadio');

  // 4. Play a related track and add to queue
  const playWaitBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar relacionada Wait'
  );
  await actAsync(async () => {
    playWaitBtn.props.onPress();
  });
  assert.strictEqual(playedRelated?.id, 'rel_1');

  const addWaitQueueBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Adicionar Wait à fila'
  );
  await actAsync(async () => {
    addWaitQueueBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(queuedRelated?.id, 'rel_1');

  // 5. Open ArtistProfileModal by pressing "Abrir perfil do artista"
  const openArtistBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir perfil do artista'
  );
  await actAsync(async () => {
    openArtistBtn.props.onPress();
  });

  const modalTextAfterOpen = getAllText(root);
  assert.ok(
    root.findAllByProps({ testID: 'artist-profile-modal' }).length > 0 &&
      modalTextAfterOpen.includes('Populares') &&
      modalTextAfterOpen.includes('Tocar') &&
      modalTextAfterOpen.includes('Aleatório') &&
      modalTextAfterOpen.includes('Rádio'),
    'ArtistProfileModal must open displaying Populares and action pills (Tocar, Aleatório, Rádio)'
  );
  assert.strictEqual(
    modalTextAfterOpen.includes(['You', 'Tube Music'].join('')),
    false,
    'ArtistProfileModal and NowPlayingModal must not expose third-party streaming branding'
  );
});


test('LRA-008: extractLyricsPaletteFromPixels extracts real artwork hue, ignores white background to pick accent color, and enforces WCAG AAA contrast for white text', () => {
  const {
    extractLyricsPaletteFromPixels,
    DEFAULT_LYRICS_PALETTE,
  } = require('../components/AmbientGlowBackground');

  const hexToRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const contrastAgainstWhite = (hex) => {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 1.05 / (lum + 0.05);
  };
  const makeSolid = (r, g, b, count = 64) => {
    const arr = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      arr[i * 4] = r;
      arr[i * 4 + 1] = g;
      arr[i * 4 + 2] = b;
      arr[i * 4 + 3] = 255;
    }
    return arr;
  };

  // 1. Vibrant blue artwork -> blue dominant backdrop (B > R and B > G)
  const bluePalette = extractLyricsPaletteFromPixels(makeSolid(30, 110, 220));
  const [br, bg, bb] = hexToRgb(bluePalette.topColor);
  assert.ok(bb > br && bb > bg, `Expected blue-dominant topColor, got ${bluePalette.topColor}`);
  assert.ok(contrastAgainstWhite(bluePalette.topColor) >= 7.0, 'Blue palette must keep >= 7:1 contrast');

  // 2. Mostly white cover (80% white) with 20% teal accent -> picks teal instead of washing out or randomizing
  const whiteWithTeal = makeSolid(250, 250, 248, 100);
  for (let i = 0; i < 20; i++) {
    whiteWithTeal[i * 4] = 20;
    whiteWithTeal[i * 4 + 1] = 175;
    whiteWithTeal[i * 4 + 2] = 165;
  }
  const tealPalette = extractLyricsPaletteFromPixels(whiteWithTeal);
  const [tr, tg, tb] = hexToRgb(tealPalette.topColor);
  assert.ok(tg > tr && tb > tr, `Expected teal-dominant topColor from white cover, got ${tealPalette.topColor}`);
  assert.ok(contrastAgainstWhite(tealPalette.topColor) >= 7.0, 'White+teal palette must keep >= 7:1 contrast');

  // 3. Pure white monochrome cover -> falls back to neutral dark slate (no random burgundy/hue)
  const whitePalette = extractLyricsPaletteFromPixels(makeSolid(255, 255, 255));
  assert.deepStrictEqual(whitePalette, DEFAULT_LYRICS_PALETTE);
  assert.ok(contrastAgainstWhite(whitePalette.topColor) >= 7.0);

  // 4. Bright neon yellow cover -> clamped dark enough for >= 7:1 contrast with white lyrics
  const yellowPalette = extractLyricsPaletteFromPixels(makeSolid(255, 245, 40));
  assert.ok(
    contrastAgainstWhite(yellowPalette.topColor) >= 7.0,
    `Bright yellow cover must be darkened for white text readability (got ${yellowPalette.topColor}, contrast=${contrastAgainstWhite(yellowPalette.topColor).toFixed(2)})`
  );
});




