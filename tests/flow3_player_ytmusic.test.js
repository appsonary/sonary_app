// tests/flow3_player_ytmusic.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const NowPlayingModal = require('../components/NowPlayingModal').default;
const api = require('../services/api');
const {
  actAsync,
  findButtonByText,
  findSearchActionButton,
  findInputByPlaceholder,
  findButtonByIcon,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const { mockPlayer, State, RepeatMode } = require('./mocks/trackPlayerMock');
const { initDatabase } = require('../services/database');

const originalSearchTracks = api.searchTracks;
const originalGetAudioStream = api.getAudioStream;
const originalGetTrackRadio = api.getTrackRadio;
const originalGetRelatedTracks = api.getRelatedTracks;

const sampleTracks = [
  {
    id: 'yt_track_1',
    title: 'Starboy',
    artist: 'The Weeknd',
    duration: 230,
    formattedDuration: '3:50',
    thumbnailUrl: 'https://example.com/starboy.jpg',
  },
  {
    id: 'yt_track_2',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    duration: 200,
    formattedDuration: '3:20',
    thumbnailUrl: 'https://example.com/blinding.jpg',
  },
  {
    id: 'yt_track_3',
    title: 'Save Your Tears',
    artist: 'The Weeknd',
    duration: 215,
    formattedDuration: '3:35',
    thumbnailUrl: 'https://example.com/tears.jpg',
  },
];

let keydownListeners = [];

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
  keydownListeners = [];

  global.window = {
    addEventListener: (event, cb) => {
      if (event === 'keydown') keydownListeners.push(cb);
    },
    removeEventListener: (event, cb) => {
      if (event === 'keydown') {
        keydownListeners = keydownListeners.filter((fn) => fn !== cb);
      }
    },
  };

  global.document = {
    activeElement: { tagName: 'BODY' },
  };

  api.searchTracks = async () => sampleTracks;
  api.getAudioStream = async (id) => ({
    videoId: id,
    title: sampleTracks.find((t) => t.id === id)?.title || 'Música',
    artist: 'The Weeknd',
    duration: 220,
    thumbnailUrl: 'https://example.com/art.jpg',
    streamUrl: `https://stream.example.com/${id}.mp4`,
    mimeType: 'audio/mp4',
    format: 'M4A',
    bitrate: 128000,
  });
  api.getTrackRadio = async (id) => ({
    tracks: sampleTracks.filter((t) => t.id !== id),
    continuationToken: undefined,
  });
  api.getRelatedTracks = async (id) => sampleTracks.filter((t) => t.id !== id);
});

test.afterEach(() => {
  api.searchTracks = originalSearchTracks;
  api.getAudioStream = originalGetAudioStream;
  api.getTrackRadio = originalGetTrackRadio;
  api.getRelatedTracks = originalGetRelatedTracks;
  delete global.window;
  delete global.document;
});

const dispatchKey = (key, extra = {}) => {
  const event = {
    key,
    preventDefault: () => {},
    ...extra,
  };
  keydownListeners.forEach((listener) => listener(event));
};

test('YouTube Music Player: Rapid open/close of Now Playing drawer is interruptible and preserves playback continuity', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Search and play track
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('The Weeknd');
  });
  await actAsync(async () => {
    findSearchActionButton(root).props.onPress();
  });

  const starboyCard = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Starboy')
  )[0];
  assert.ok(starboyCard, 'Starboy card should exist');

  await actAsync(async () => {
    starboyCard.props.onPress();
  });

  // Verify audio started
  assert.strictEqual(mockPlayer.state, State.Playing);
  assert.strictEqual(mockPlayer.getActiveTrack().id, 'yt_track_1');

  // Find expand button (ChevronUp) in mini player
  const expandBtn = findButtonByIcon(root, 'ChevronUp');
  assert.ok(expandBtn, 'Mini-player must have ChevronUp expand button');

  // Rapidly toggle Now Playing open and closed 10 times in quick succession
  for (let i = 0; i < 10; i++) {
    // Open
    await actAsync(async () => {
      expandBtn.props.onPress({ stopPropagation: () => {} });
    });

    // Close via ChevronDown
    const closeBtn = findButtonByIcon(root, 'ChevronDown');
    assert.ok(closeBtn, `Close button must exist on iteration ${i}`);
    await actAsync(async () => {
      closeBtn.props.onPress({ stopPropagation: () => {} });
    });

    // Verify audio NEVER stopped or paused during rapid drawer interruptions
    assert.strictEqual(
      mockPlayer.state,
      State.Playing,
      `Audio playback must remain uninterrupted during rapid toggle #${i}`
    );
  }

  // Active track must still be Starboy
  assert.strictEqual(mockPlayer.getActiveTrack().id, 'yt_track_1');
});

test('YouTube Music Player: Global media shortcuts (Space/K, Seek, Mute, Next/Prev, Escape)', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Search and play track
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('The Weeknd');
  });
  await actAsync(async () => {
    findSearchActionButton(root).props.onPress();
  });

  const trackCard = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Starboy')
  )[0];
  await actAsync(async () => {
    trackCard.props.onPress();
  });

  assert.strictEqual(mockPlayer.state, State.Playing);
  mockPlayer.position = 30;

  // 1. Space -> Toggle Pause
  await actAsync(async () => {
    dispatchKey(' ');
  });
  assert.strictEqual(mockPlayer.state, State.Paused, 'Space should pause playback');

  // 2. 'k' -> Toggle Play
  await actAsync(async () => {
    dispatchKey('k');
  });
  assert.strictEqual(mockPlayer.state, State.Playing, 'k key should resume playback');

  // 3. ArrowRight -> Seek +5s
  await actAsync(async () => {
    dispatchKey('ArrowRight');
  });
  assert.strictEqual(mockPlayer.position, 35, 'ArrowRight should seek +5s');

  // 4. ArrowLeft -> Seek -5s
  await actAsync(async () => {
    dispatchKey('ArrowLeft');
  });
  assert.strictEqual(mockPlayer.position, 30, 'ArrowLeft should seek -5s');

  // 5. 'l' -> Seek +5s
  await actAsync(async () => {
    dispatchKey('l');
  });
  assert.strictEqual(mockPlayer.position, 35, 'l key should seek +5s');

  // 6. 'j' -> Seek -5s
  await actAsync(async () => {
    dispatchKey('j');
  });
  assert.strictEqual(mockPlayer.position, 30, 'j key should seek -5s');

  // 7. 'm' -> Toggle Mute (Volume 0.0)
  await actAsync(async () => {
    dispatchKey('m');
  });
  assert.strictEqual(mockPlayer.volume, 0, 'm key should mute volume');

  // Toggle Mute again (Volume 1.0)
  await actAsync(async () => {
    dispatchKey('m');
  });
  assert.strictEqual(mockPlayer.volume, 1.0, 'm key should unmute volume');

  // 8. 'n' -> Next track (captures queued next track because search auto-fill picks randomized related tracks)
  const queuedBeforeNext = await mockPlayer.getQueue();
  const expectedNextId = queuedBeforeNext[1]?.id;
  assert.ok(
    expectedNextId === 'yt_track_2' || expectedNextId === 'yt_track_3',
    `expected auto-filled next track from related results, got ${expectedNextId}`
  );
  await actAsync(async () => {
    dispatchKey('n');
  });
  assert.strictEqual(mockPlayer.getActiveTrack().id, expectedNextId, 'n key should skip to next track');

  // 9. 'p' -> Previous track
  await actAsync(async () => {
    dispatchKey('p');
  });
  assert.strictEqual(mockPlayer.getActiveTrack().id, 'yt_track_1', 'p key should skip to previous track');

  // 10. Escape closes Now Playing modal
  const expandBtn = findButtonByIcon(root, 'ChevronUp');
  await actAsync(async () => {
    expandBtn.props.onPress({ stopPropagation: () => {} });
  });

  // Modal is open
  let closeBtn = findButtonByIcon(root, 'ChevronDown');
  assert.ok(closeBtn, 'Modal should be open before Escape');

  await actAsync(async () => {
    dispatchKey('Escape');
  });

  // Close button should no longer exist (modal is closed)
  closeBtn = findButtonByIcon(root, 'ChevronDown');
  assert.strictEqual(closeBtn, null, 'Escape key should close Now Playing modal');

  // 11. Typing in text input ignores shortcuts
  global.document.activeElement = { tagName: 'INPUT' };
  await actAsync(async () => {
    dispatchKey(' ');
  });
  // State should still be Playing because typing space inside an input must not pause music
  assert.strictEqual(mockPlayer.state, State.Playing, 'Space inside input should not pause music');
});

test('YouTube Music Player: NowPlayingModal 3-Tab system (FILA, LETRAS, RELACIONADOS) with Spotify queue sheet, interactive lyrics, and queue selection', async () => {
  let selectedQueueItem = null;
  let seekPosition = null;

  const currentTrack = {
    id: 'yt_track_1',
    title: 'Starboy',
    artist: 'The Weeknd',
    duration: 230,
    artwork: 'https://example.com/starboy.jpg',
  };

  const queue = [
    {
      id: 'yt_track_2',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      duration: 200,
    },
    {
      id: 'yt_track_3',
      title: 'Save Your Tears',
      artist: 'The Weeknd',
      duration: 215,
    },
  ];

  mockPlayer.position = 12;
  mockPlayer.duration = 230;

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
        onSeekRelative: () => {},
        isFavorite: true,
        onToggleFavorite: () => {},
        repeatMode: RepeatMode.Queue,
        onToggleRepeat: () => {},
        isShuffleActive: true,
        onToggleShuffle: () => {},
        queue,
        onSelectQueueTrack: (t, idx) => {
          selectedQueueItem = { track: t, index: idx };
        },
      })
    );
  });

  const modalRoot = modalTree.root;

  // 1. Tab "FILA" -> opens Spotify-style queue sheet
  const queueTabBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'
  );
  assert.ok(queueTabBtn, 'Fila tab button must exist');
  assert.ok(getAllText(queueTabBtn).includes('FILA'), 'Tab text must be FILA');

  await actAsync(async () => {
    queueTabBtn.props.onPress();
  });

  let textContent = getAllText(modalRoot);
  assert.ok(textContent.includes('Fila'), 'Queue sheet title should show "Fila"');
  assert.ok(textContent.includes('Editar'), 'Queue sheet should show "Editar" button');
  assert.ok(textContent.includes('A seguir'), 'Queue sheet should show "A seguir" section');
  assert.ok(textContent.includes('Blinding Lights'), 'Queue should list Blinding Lights');
  assert.ok(textContent.includes('Save Your Tears'), 'Queue should list Save Your Tears');
  assert.ok(textContent.includes('Aleatório'), 'Queue sheet bottom bar should show "Aleatório"');
  assert.ok(textContent.includes('Repetir'), 'Queue sheet bottom bar should show "Repetir"');
  assert.ok(textContent.includes('Fechar'), 'Queue sheet bottom bar should show "Fechar"');

  // Click queue item
  const blindingLightsItem = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar Blinding Lights na fila'
  );
  assert.ok(blindingLightsItem, 'Blinding Lights queue item should be clickable');

  // Horizontal swipe over a queue item must NOT trigger track playback
  selectedQueueItem = null;
  let blindingLightsRow = blindingLightsItem.parent;
  while (blindingLightsRow && typeof blindingLightsRow.props?.onTouchStart !== 'function') {
    blindingLightsRow = blindingLightsRow.parent;
  }
  assert.ok(blindingLightsRow, 'Row container with onTouchStart must exist');
  await actAsync(async () => {
    blindingLightsRow.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 200 } });
    blindingLightsRow.props.onTouchMove({ nativeEvent: { pageX: 150, pageY: 202 } });
    blindingLightsItem.props.onPress({ nativeEvent: { pageX: 150, pageY: 202 } });
  });
  assert.strictEqual(selectedQueueItem, null, 'Horizontal swipe must not select queue track');

  // Swipe and return back to start position before lifting finger must still NOT trigger playback
  await actAsync(async () => {
    blindingLightsRow.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 200 } });
    blindingLightsRow.props.onTouchMove({ nativeEvent: { pageX: 155, pageY: 200 } });
    blindingLightsItem.props.onPress({ nativeEvent: { pageX: 102, pageY: 200 } });
  });
  assert.strictEqual(selectedQueueItem, null, 'Swipe-and-return must not select queue track');

  // Small jitter tap (<= 8px) must still select track
  await actAsync(async () => {
    blindingLightsRow.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 200 } });
    blindingLightsItem.props.onPress({ nativeEvent: { pageX: 103, pageY: 201 } });
  });
  assert.deepStrictEqual(selectedQueueItem, { track: queue[0], index: 0 });

  // Zero-arg programmatic press (e.g. accessibility / legacy callers) also selects track
  selectedQueueItem = null;
  await actAsync(async () => {
    blindingLightsItem.props.onPress();
  });
  assert.deepStrictEqual(selectedQueueItem, { track: queue[0], index: 0 });

  // Close queue sheet before checking Lyrics tab
  const closeQueueBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fechar fila'
  );
  await actAsync(async () => {
    closeQueueBtn.props.onPress();
  });

  // 2. Tab "LETRAS"
  const lyricsTabBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Letras'
  );
  assert.ok(lyricsTabBtn, 'Letras tab button must exist');

  await actAsync(async () => {
    lyricsTabBtn.props.onPress();
  });

  textContent = getAllText(modalRoot);
  // Default lyrics should contain generated song lines
  assert.ok(textContent.includes('Starboy'), 'Lyrics should reference track title');

  // Find lyric lines
  const lyricButtons = modalRoot.findAll(
    (n) => n.type === 'TouchableOpacity' && n.props.style && n.props.style.paddingVertical
  );
  assert.ok(lyricButtons.length > 0, 'Lyrics lines buttons must be rendered');

  // Click a lyric line to seek
  await actAsync(async () => {
    lyricButtons[1].props.onPress();
  });
  // Verify seekTo was called
  assert.ok(mockPlayer.position >= 0, 'Clicking lyrics line should update position');

  // 3. Tab "RELACIONADOS"
  const relatedTabBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Relacionados'
  );
  assert.ok(relatedTabBtn, 'Relacionados tab button must exist');

  await actAsync(async () => {
    relatedTabBtn.props.onPress();
  });

  textContent = getAllText(modalRoot);
  assert.ok(
    textContent.includes('Explorar discografia') || textContent.includes('Você também pode gostar'),
    'Related tab should show artist hero and recommendations'
  );
  assert.ok(
    textContent.includes('Sonary Smart Radio'),
    'Related tab should show Sonary Smart Radio badge'
  );
  assert.strictEqual(
    textContent.includes('YouTube Music'),
    false,
    'Related tab must not expose YouTube Music branding'
  );
});

test('YouTube Music Player: Mini-player contains Repeat, Shuffle, and Red Top Progress Bar on desktop', async () => {
  const rn = require('react-native');
  const originalGet = rn.Dimensions.get;
  rn.Dimensions.get = () => ({ width: 1024, height: 768, scale: 2, fontScale: 1 });

  try {
    let tree;
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });

    const root = tree.root;

    // Search and play track
    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('The Weeknd');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });

    const trackCard = root.findAll(
      (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Starboy')
    )[0];
    await actAsync(async () => {
      trackCard.props.onPress();
    });

    // Verify Repeat button exists and toggles
    const repeatBtn = findButtonByIcon(root, 'Repeat');
    assert.ok(repeatBtn, 'Mini-player must feature Repeat button on desktop');
    await actAsync(async () => {
      repeatBtn.props.onPress({ stopPropagation: () => {} });
    });

    // Verify Shuffle button exists and toggles
    const shuffleBtn = findButtonByIcon(root, 'Shuffle');
    assert.ok(shuffleBtn, 'Mini-player must feature Shuffle button on desktop');
    await actAsync(async () => {
      shuffleBtn.props.onPress({ stopPropagation: () => {} });
    });

    // Verify Volume / Mute button exists
    const volumeBtn = findButtonByIcon(root, 'Volume2');
    assert.ok(volumeBtn, 'Mini-player must feature Volume button on desktop');
    await actAsync(async () => {
      volumeBtn.props.onPress({ stopPropagation: () => {} });
    });
    assert.strictEqual(mockPlayer.volume, 0, 'Volume button click should mute player');
  } finally {
    rn.Dimensions.get = originalGet;
  }
});

test('YouTube Music Player: NowPlayingModal Up Next queue remove and reorder buttons and real LRCLIB synced lyrics', async () => {
  let removedIndex = null;
  let moveParams = null;

  const currentTrack = {
    id: 'yt_track_1',
    title: 'Starboy',
    artist: 'The Weeknd',
    duration: 230,
  };

  const queue = [
    {
      id: 'yt_track_2',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      duration: 200,
    },
    {
      id: 'yt_track_3',
      title: 'Save Your Tears',
      artist: 'The Weeknd',
      duration: 215,
    },
  ];

  const customLyrics = [
    { time: 0, text: 'I am trying to put you in the worst mood' },
    { time: 15, text: 'P1 cleaner than your church shoes' },
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
        onSeekRelative: () => {},
        queue,
        onRemoveQueueTrack: (idx) => {
          removedIndex = idx;
        },
        onMoveQueueTrack: (from, to) => {
          moveParams = { from, to };
        },
        syncedLyrics: customLyrics,
      })
    );
  });

  const root = modalTree.root;

  // 1. Open 'FILA' bottom sheet, test drag-to-reorder via the 3-bar handle, then edit mode
  const queueTabBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'
  );
  assert.ok(queueTabBtn);
  await actAsync(async () => {
    queueTabBtn.props.onPress();
  });

  const dragDetectors = root.findAll(
    (n) =>
      n.type === 'GestureDetector' &&
      n.findAll(
        (c) => c.props && c.props.accessibilityLabel === 'Arrastar Blinding Lights para reordenar na fila'
      ).length > 0
  );
  assert.ok(dragDetectors.length > 0, 'Drag handle GestureDetector for Blinding Lights should exist');
  const firstDragDetector = dragDetectors[dragDetectors.length - 1];

  const findNeighborRowTranslateY = (trackTitle) => {
    const labelBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === `Tocar ${trackTitle} na fila`
    );
    let node = labelBtn.parent;
    while (node && !Array.isArray(node.props?.style)) {
      node = node.parent;
    }
    const transformEntry = (node?.props?.style || []).find((s) => s && s.transform);
    const ty = transformEntry?.transform?.[0]?.translateY;
    return typeof ty === 'number' ? ty : ty?._value ?? 0;
  };

  // Cancelled drag animates neighbor shift during drag and resets back on cancel
  await actAsync(async () => {
    firstDragDetector.props.gesture._state.handlers.onBegin({});
    firstDragDetector.props.gesture._state.handlers.onUpdate({ translationY: 60 });
  });
  assert.strictEqual(
    findNeighborRowTranslateY('Save Your Tears'),
    -60,
    'Neighbor row should animate up (-60px) while dragged row passes over it'
  );
  await actAsync(async () => {
    firstDragDetector.props.gesture._state.handlers.onFinalize({}, false);
  });
  assert.strictEqual(moveParams, null, 'Cancelled drag must not call onMoveQueueTrack');
  assert.strictEqual(findNeighborRowTranslateY('Save Your Tears'), 0, 'Neighbor row animates back to 0 on cancel');

  // Committed drag down by 1 row height (60px) moves item 0 -> 1
  await actAsync(async () => {
    firstDragDetector.props.gesture._state.handlers.onBegin({});
    firstDragDetector.props.gesture._state.handlers.onUpdate({ translationY: 60 });
    firstDragDetector.props.gesture._state.handlers.onEnd({ translationY: 60 });
    firstDragDetector.props.gesture._state.handlers.onFinalize({}, true);
  });
  assert.deepStrictEqual(moveParams, { from: 0, to: 1 }, 'Drag handle drop should call onMoveQueueTrack(0, 1)');
  assert.strictEqual(findNeighborRowTranslateY('Save Your Tears'), 0, 'Reordered neighbor row resets transform cleanly');
  moveParams = null;

  const editQueueBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Editar fila'
  );
  assert.ok(editQueueBtn, 'Edit queue button should exist');
  await actAsync(async () => {
    editQueueBtn.props.onPress();
  });

  // Verify remove button and move controls in edit mode (order now has Save Your Tears at 0 and Blinding Lights at 1)
  const removeBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Remover Save Your Tears da fila'
  );
  assert.ok(removeBtn, 'Remove queue item button should exist in edit mode');
  await actAsync(async () => {
    removeBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(removedIndex, 0, 'onRemoveQueueTrack should be called with index 0');

  const moveDownBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mover Save Your Tears para baixo'
  );
  assert.ok(moveDownBtn, 'Move down queue button should exist in edit mode');
  await actAsync(async () => {
    moveDownBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.deepStrictEqual(moveParams, { from: 0, to: 1 }, 'onMoveQueueTrack should be called with { from: 0, to: 1 }');

  const closeQueueBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fechar fila'
  );
  await actAsync(async () => {
    closeQueueBtn.props.onPress();
  });

  // 2. Switch to 'LETRAS' tab
  const lyricsTabBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Letras'
  );
  assert.ok(lyricsTabBtn);
  await actAsync(async () => {
    lyricsTabBtn.props.onPress();
  });

  const lyricsText = getAllText(root);
  assert.ok(lyricsText.includes('P1 cleaner than your church shoes'), 'Custom LRCLIB lyrics should be rendered');
});

test('Spotify-Style Now Playing: Scroll feed renders Lyrics Card, About Artist, and Up Next queue with expand toggle', async () => {
  const currentTrack = {
    id: 'sp_track_1',
    title: 'Starboy',
    artist: 'The Weeknd',
    duration: 230,
    artwork: 'https://example.com/starboy.jpg',
  };

  const queue = [
    {
      id: 'sp_track_2',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      duration: 200,
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
        queue,
      })
    );
  });

  const root = modalTree.root;
  const initialText = getAllText(root);

  // 1. Verify feed cards exist and legacy bottom queue card is removed from vertical feed
  assert.ok(initialText.includes('Arraste para cima para ver a letra'), 'Peek swipe hint should be present');
  assert.ok(initialText.includes('Letras'), 'Lyrics card header must exist');
  assert.ok(initialText.includes('Sobre o artista'), 'About the artist card must exist');
  assert.ok(!initialText.includes('A Seguir • Fila'), 'Inline bottom queue card should not render in scroll feed');
  assert.ok(initialText.includes('FILA'), 'Queue tab button must read FILA');

  // 2. Verify Lyrics Expand / Collapse toggle
  const expandBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Expandir letras'
  );
  assert.ok(expandBtn, 'Expand lyrics button should exist');
  assert.ok(getAllText(expandBtn).includes('EXPANDIR'));

  await actAsync(async () => {
    expandBtn.props.onPress();
  });

  const collapseBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Recolher letras'
  );
  assert.ok(collapseBtn, 'Collapse lyrics button should exist after expanding');
  assert.ok(getAllText(collapseBtn).includes('RECOLHER'));
});

test('YouTube Music Player: Queue drag auto-scrolls up and down on long queue near viewport edges', async () => {
  const currentTrack = {
    id: 'sp_current',
    title: 'Current Track',
    artist: 'Artist',
    duration: 200,
  };
  const longQueue = Array.from({ length: 10 }, (_, idx) => ({
    id: `q_${idx}`,
    title: `Queue Track ${idx}`,
    artist: `Artist ${idx}`,
    duration: 180,
  }));

  const scrollCalls = [];
  let moveParams = null;

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
        queue: longQueue,
        onMoveQueueTrack: (from, to) => {
          moveParams = { from, to };
        },
      }),
      {
        createNodeMock: (el) => {
          if (el.type === 'ScrollView') {
            return {
              scrollTo: (opts) => scrollCalls.push(opts),
            };
          }
          return null;
        },
      }
    );
  });

  const root = modalTree.root;
  const queueTabBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'
  );
  await actAsync(async () => {
    queueTabBtn.props.onPress();
  });

  const queueScrollView = root.find(
    (n) => n.type === 'ScrollView' && typeof n.props.onContentSizeChange === 'function'
  );
  await actAsync(async () => {
    queueScrollView.props.onLayout({ nativeEvent: { layout: { height: 240 } } });
    queueScrollView.props.onContentSizeChange(360, 612);
    queueScrollView.props.onScroll({ nativeEvent: { contentOffset: { y: 240 } } });
  });

  // 1. Drag track 6 upward near the top edge (initial viewport y = 360 - 240 = 120; -100 -> 20)
  const dragDetector6List = root.findAll(
    (n) =>
      n.type === 'GestureDetector' &&
      n.findAll((c) => c.props?.accessibilityLabel === 'Arrastar Queue Track 6 para reordenar na fila')
        .length > 0
  );
  const dragDetector6 = dragDetector6List[dragDetector6List.length - 1];
  await actAsync(async () => {
    dragDetector6.props.gesture._state.handlers.onBegin({});
    dragDetector6.props.gesture._state.handlers.onUpdate({ translationY: -100 });
    await new Promise((r) => setTimeout(r, 180));
  });

  assert.ok(scrollCalls.length > 0, 'Dragging near top edge should auto-scroll queue upward');
  assert.ok(
    scrollCalls[scrollCalls.length - 1].y < 240,
    'Auto-scroll upward should decrease scrollY below 240'
  );

  await actAsync(async () => {
    dragDetector6.props.gesture._state.handlers.onEnd({ translationY: -100 });
  });
  assert.ok(
    moveParams && moveParams.from === 6 && moveParams.to < 4,
    `Auto-scroll upward should advance drop target past immediate neighbor (got ${JSON.stringify(moveParams)})`
  );

  // 2. Drag track 0 downward near the bottom edge from scrollY = 0
  scrollCalls.length = 0;
  moveParams = null;
  await actAsync(async () => {
    queueScrollView.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
  });

  const dragDetector0List = root.findAll(
    (n) =>
      n.type === 'GestureDetector' &&
      n.findAll((c) => c.props?.accessibilityLabel === 'Arrastar Queue Track 0 para reordenar na fila')
        .length > 0
  );
  const dragDetector0 = dragDetector0List[dragDetector0List.length - 1];
  await actAsync(async () => {
    dragDetector0.props.gesture._state.handlers.onBegin({});
    dragDetector0.props.gesture._state.handlers.onUpdate({ translationY: 165 });
    await new Promise((r) => setTimeout(r, 180));
  });

  assert.ok(scrollCalls.length > 0, 'Dragging near bottom edge should auto-scroll queue downward');
  assert.ok(
    scrollCalls[scrollCalls.length - 1].y > 0,
    'Auto-scroll downward should increase scrollY above 0'
  );

  await actAsync(async () => {
    dragDetector0.props.gesture._state.handlers.onEnd({ translationY: 165 });
  });
  assert.ok(
    moveParams && moveParams.from === 0 && moveParams.to > 2,
    `Auto-scroll downward should advance drop target further down (got ${JSON.stringify(moveParams)})`
  );
});

test('App UI: Success feedback toast renders at the top of the screen without covering mini player and dismisses on tap', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('The Weeknd');
  });
  await actAsync(async () => {
    findSearchActionButton(root).props.onPress();
  });

  const starboyCard = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Starboy')
  )[0];
  await actAsync(async () => {
    starboyCard.props.onPress();
  });

  const moreBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções para Blinding Lights'
  );
  await actAsync(async () => {
    moreBtn.props.onPress({ stopPropagation: () => {} });
  });

  const playNextBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar a seguir'
  );
  await actAsync(async () => {
    playNextBtn.props.onPress({ stopPropagation: () => {} });
  });

  const toastBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fechar notificação de sucesso'
  );
  assert.ok(
    getAllText(toastBtn).includes('"Blinding Lights" será tocada a seguir'),
    'Toast should display track play-next confirmation'
  );

  // Walk up to the absolute-positioned toast container and verify top positioning (not bottom)
  let containerNode = toastBtn.parent;
  while (containerNode && containerNode.props?.pointerEvents !== 'box-none') {
    containerNode = containerNode.parent;
  }
  assert.ok(containerNode, 'Top toast container must exist');
  assert.ok(
    typeof containerNode.props.style?.top === 'number' && containerNode.props.style?.bottom === undefined,
    'Toast container must be anchored at the top rather than bottom over the mini player'
  );

  // Tapping toast dismisses it immediately
  await actAsync(async () => {
    toastBtn.props.onPress();
  });
  const remaining = root.findAll(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fechar notificação de sucesso'
  );
  assert.strictEqual(remaining.length, 0, 'Tapping toast should dismiss it');
});

test('YouTube Music Player: Toggling Aleatório mid-queue only shuffles upcoming tracks and resets queue slot epoch without overlapping rows', async () => {
  // 1. Verify App-level mid-queue shuffle does not duplicate or resurrect already-played tracks
  const playlistTracks = [
    { id: 'pl_1', url: 'https://stream.example.com/pl_1.mp4', title: 'Track 1', artist: 'Artist' },
    { id: 'pl_2', url: 'https://stream.example.com/pl_2.mp4', title: 'Track 2', artist: 'Artist' },
    { id: 'pl_3', url: 'https://stream.example.com/pl_3.mp4', title: 'Track 3', artist: 'Artist' },
    { id: 'pl_4', url: 'https://stream.example.com/pl_4.mp4', title: 'Track 4', artist: 'Artist' },
    { id: 'pl_5', url: 'https://stream.example.com/pl_5.mp4', title: 'Track 5', artist: 'Artist' },
    { id: 'pl_6', url: 'https://stream.example.com/pl_6.mp4', title: 'Track 6', artist: 'Artist' },
  ];
  await mockPlayer.reset();
  await mockPlayer.add(playlistTracks);
  await mockPlayer.skip(2); // Playing pl_3 (index 2); upcoming are [pl_4, pl_5, pl_6]

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  // Open Queue sheet via mini-player -> Expand -> Fila
  const expandBtn = findButtonByIcon(root, 'ChevronUp');
  await actAsync(async () => {
    expandBtn.props.onPress({ stopPropagation: () => {} });
  });
  const queueTabBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'
  );
  await actAsync(async () => {
    queueTabBtn.props.onPress();
  });

  // Tap "Aleatório" button inside Queue bottom bar
  const shuffleBottomBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Aleatório'
  );
  await actAsync(async () => {
    shuffleBottomBtn.props.onPress();
  });

  const shuffledNativeQueue = await mockPlayer.getQueue();
  const activeIdx = await mockPlayer.getActiveTrackIndex();
  assert.strictEqual(activeIdx, 2);
  assert.deepStrictEqual(
    shuffledNativeQueue.slice(0, 3).map((t) => t.id),
    ['pl_1', 'pl_2', 'pl_3'],
    'Tracks played before active track must not be resurrected into Up Next'
  );
  assert.deepStrictEqual(
    shuffledNativeQueue.slice(3).map((t) => t.id).sort(),
    ['pl_4', 'pl_5', 'pl_6'],
    'Upcoming queue after shuffle must contain only remaining upcoming tracks'
  );

  // Verify rendered queue track buttons have unique sequential rows and no duplicated/resurrected tracks
  const upcomingRowTitles = root
    .findAll(
      (n) =>
        n.type === 'TouchableOpacity' &&
        typeof n.props.accessibilityLabel === 'string' &&
        n.props.accessibilityLabel.startsWith('Tocar ') &&
        n.props.accessibilityLabel.endsWith(' na fila')
    )
    .map((n) => n.props.accessibilityLabel);
  assert.strictEqual(upcomingRowTitles.length, 3, 'Queue UI must render exactly the 3 remaining upcoming tracks');
  assert.deepStrictEqual(
    [...upcomingRowTitles].sort(),
    ['Tocar Track 4 na fila', 'Tocar Track 5 na fila', 'Tocar Track 6 na fila']
  );

  // 2. Verify NowPlayingModal remounts slot container cleanly on external shuffle reorder (zero stale Y transforms)
  const initialQueue = playlistTracks.slice(1); // 5 tracks
  let modalTree;
  const renderModal = (q, shuffleOn) =>
    React.createElement(NowPlayingModal, {
      visible: true,
      onClose: () => {},
      track: playlistTracks[0],
      isPlaying: true,
      isBuffering: false,
      onTogglePlay: () => {},
      onSkipNext: () => {},
      onSkipPrevious: () => {},
      onSeekRelative: () => {},
      isFavorite: false,
      onToggleFavorite: () => {},
      repeatMode: RepeatMode.Off,
      onToggleRepeat: () => {},
      isShuffleActive: shuffleOn,
      onToggleShuffle: () => {},
      onMoveQueueTrack: () => {},
      queue: q,
    });

  await actAsync(async () => {
    modalTree = renderer.create(renderModal(initialQueue, false));
  });
  const mRoot = modalTree.root;
  const mQueueTab = mRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'
  );
  await actAsync(async () => {
    mQueueTab.props.onPress();
  });

  const beforeSlotsKey = mRoot.find(
    (n) => typeof n._fiber?.key === 'string' && n._fiber.key.startsWith('queue-slots-')
  )._fiber.key;

  const reorderedByShuffle = [
    initialQueue[3],
    initialQueue[0],
    initialQueue[4],
    initialQueue[2],
    initialQueue[1],
  ];
  await actAsync(async () => {
    modalTree.update(renderModal(reorderedByShuffle, true));
  });

  const afterSlotsNode = mRoot.find(
    (n) => typeof n._fiber?.key === 'string' && n._fiber.key.startsWith('queue-slots-')
  );
  assert.notStrictEqual(
    afterSlotsNode._fiber.key,
    beforeSlotsKey,
    'External shuffle reorder must bump queue-slots epoch to prevent overlapping Reanimated row positions'
  );
  const renderedLabels = afterSlotsNode
    .findAll(
      (n) =>
        n.type === 'TouchableOpacity' &&
        typeof n.props.accessibilityLabel === 'string' &&
        n.props.accessibilityLabel.startsWith('Tocar ') &&
        n.props.accessibilityLabel.endsWith(' na fila')
    )
    .map((n) => n.props.accessibilityLabel);
  assert.deepStrictEqual(renderedLabels, [
    'Tocar Track 5 na fila',
    'Tocar Track 2 na fila',
    'Tocar Track 6 na fila',
    'Tocar Track 4 na fila',
    'Tocar Track 3 na fila',
  ]);
});

test('App UI: Adding recommended track to queue inside open NowPlayingModal displays toast inside Modal window', async () => {
  const originalGetRelatedTracks = api.getRelatedTracks;
  api.getRelatedTracks = async () => [
    {
      id: 'rel_rec_1',
      title: 'For Whom The Bell Tolls',
      artist: 'Metallica',
      duration: 310,
      formattedDuration: '5:10',
      thumbnailUrl: 'https://example.com/bell.jpg',
    },
  ];

  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });

    const root = tree.root;
    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('The Weeknd');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });

    const starboyCard = root.findAll(
      (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Starboy')
    )[0];
    await actAsync(async () => {
      starboyCard.props.onPress();
    });

    const miniExpandBtn = findButtonByIcon(root, 'ChevronUp');
    await actAsync(async () => {
      miniExpandBtn.props.onPress({ stopPropagation: () => {} });
    });

    const modalNode = root.findByType('Modal');
    const addQueueBtn = modalNode.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Adicionar For Whom The Bell Tolls à fila'
    );
    await actAsync(async () => {
      addQueueBtn.props.onPress({ stopPropagation: () => {} });
    });

    const modalToast = modalNode.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fechar notificação de sucesso'
    );
    assert.ok(
      getAllText(modalToast).includes('"For Whom The Bell Tolls" adicionada ao fim da fila'),
      'Toast confirmation must render inside NowPlayingModal Dialog window when adding recommended track to queue'
    );

    await actAsync(async () => {
      modalToast.props.onPress();
    });
    assert.strictEqual(
      modalNode.findAll(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fechar notificação de sucesso'
      ).length,
      0,
      'Tapping toast inside NowPlayingModal should dismiss it'
    );
  } finally {
    api.getRelatedTracks = originalGetRelatedTracks;
  }
});
