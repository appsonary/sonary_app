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

  // Find mini player card (ChevronUp button removed; card itself expands player)
  assert.strictEqual(findButtonByIcon(root, 'ChevronUp'), null, 'Mini-player must not render ChevronUp button');
  const expandBtn = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
  );
  assert.ok(expandBtn, 'Mini-player card must be clickable to expand');

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
  const expandBtn = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
  );
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

  // 1. Icon-only "Fila" button on the right -> opens Spotify-style queue sheet
  const queueTabBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'
  );
  assert.ok(queueTabBtn, 'Fila icon button must exist');
  assert.strictEqual(getAllText(queueTabBtn), '', 'Fila button must be icon-only without text');
  assert.ok(
    queueTabBtn.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'ListMusic').length === 1,
    'Fila button must render ListMusic icon'
  );

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

  // 2. "Letras" tab button is removed; lyrics are read-only (no accidental seek) and open fullscreen on Expand
  const lyricsTabBtns = modalRoot.findAll(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Letras'
  );
  assert.strictEqual(lyricsTabBtns.length, 0, 'Letras button must be removed from the quick-action bar');

  const positionBefore = mockPlayer.position;
  const expandLyricsBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Expandir letras'
  );
  await actAsync(async () => {
    expandLyricsBtn.props.onPress();
  });
  assert.ok(
    modalRoot.findAllByProps({ testID: 'fullscreen-lyrics-overlay' }).length > 0,
    'Expanding lyrics must mount dedicated fullscreen-lyrics-overlay'
  );
  assert.strictEqual(
    mockPlayer.position,
    positionBefore,
    'Opening fullscreen lyrics must not change playback position'
  );
  const collapseLyricsBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Recolher letras'
  );
  await actAsync(async () => {
    collapseLyricsBtn.props.onPress();
  });
  assert.strictEqual(
    modalRoot.findAllByProps({ testID: 'fullscreen-lyrics-overlay' }).length,
    0,
    'Closing fullscreen lyrics must unmount fullscreen-lyrics-overlay'
  );

  // 3. Icon-only "Relacionados" button (Info icon) positioned before "Fila" (right side)
  const relatedTabBtn = modalRoot.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Relacionados'
  );
  assert.ok(relatedTabBtn, 'Relacionados icon button must exist');
  assert.strictEqual(getAllText(relatedTabBtn), '', 'Relacionados button must be icon-only without text');
  assert.ok(
    relatedTabBtn.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'Info').length === 1,
    'Relacionados button must render Info icon'
  );
  let tabsRowNode = relatedTabBtn.parent;
  while (tabsRowNode && tabsRowNode.type !== 'View') {
    tabsRowNode = tabsRowNode.parent;
  }
  const rowButtons = tabsRowNode.findAllByType('TouchableOpacity');
  assert.strictEqual(rowButtons.length, 2, 'Quick-action row must contain only Relacionados and Fila icons');
  assert.strictEqual(
    rowButtons[0].props.accessibilityLabel,
    'Relacionados',
    'Relacionados icon button must be on the left side of the row'
  );
  assert.strictEqual(
    rowButtons[1].props.accessibilityLabel,
    'Fila',
    'Fila icon button must be positioned on the right side of the row'
  );

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

  // 2. Verify custom LRCLIB lyrics are rendered in the Lyrics card (no separate Letras tab button)
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
  assert.ok(!initialText.includes('FILA'), 'Queue button should be icon-only (no FILA text)');
  assert.ok(!initialText.includes('LETRAS'), 'Letras tab button should be removed');
  assert.ok(!initialText.includes('RELACIONADOS'), 'Relacionados button should be icon-only (no RELACIONADOS text)');
  assert.ok(
    root.find((n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'),
    'Queue icon button must exist'
  );

  // 2. Verify Lyrics Expand opens dedicated fullscreen overlay with Recolher letras button
  const expandBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Expandir letras'
  );
  assert.ok(expandBtn, 'Expand lyrics button should exist');
  assert.ok(getAllText(expandBtn).includes('EXPANDIR'));

  await actAsync(async () => {
    expandBtn.props.onPress();
  });

  assert.ok(
    root.findAllByProps({ testID: 'fullscreen-lyrics-overlay' }).length > 0,
    'Fullscreen lyrics overlay should mount when expanded'
  );
  const collapseBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Recolher letras'
  );
  assert.ok(collapseBtn, 'Collapse lyrics button (ChevronDown) should exist in fullscreen view');

  await actAsync(async () => {
    collapseBtn.props.onPress();
  });
  assert.strictEqual(
    root.findAllByProps({ testID: 'fullscreen-lyrics-overlay' }).length,
    0,
    'Fullscreen lyrics overlay should unmount after pressing Recolher letras'
  );
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
  const expandBtn = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
  );
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

    const miniExpandBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
    );
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

test('YT Music Morph: Continuous interpolations across p = 0, 0.35, 0.50, 0.65, 0.85, 1.0', async () => {
  const collapseDistance = 684;
  const navBarHeight = 66;
  const sampleTrack = {
    id: 'morph_track_1',
    title: 'Sorrows',
    artist: 'Bryson Tiller',
    duration: 194,
    artwork: 'https://example.com/sorrows_blue.jpg',
  };

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: sampleTrack,
        isPlaying: true,
        isBuffering: false,
        collapseDistance,
        navBarHeight,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });

  const mRoot = modalTree.root;
  const dismissPan = mRoot.findByProps({ testID: 'player-dismiss-pan' });
  const contentWrapper = mRoot.findByProps({ testID: 'now-playing-modal-content' });
  const clipWrapper = contentWrapper.parent;
  const headerToolbar = mRoot.findByProps({ accessibilityRole: 'toolbar' });
  const morphArtwork = mRoot.findByProps({ testID: 'player-morph-artwork' });
  const morphMiniBar = mRoot.findByProps({ testID: 'player-morph-mini-bar' });

  const flatten = (st) => Object.assign({}, ...[].concat(st).filter(Boolean));
  const getTx = (st, key) => {
    const arr = flatten(st).transform || [];
    const entry = arr.find((t) => t && t[key] !== undefined);
    return entry ? entry[key]._value : undefined;
  };
  const getVal = (v) => (v && typeof v === 'object' && '_value' in v ? v._value : v);

  const setProgress = async (p) => {
    await actAsync(async () => {
      dismissPan.props.onGestureEvent({
        nativeEvent: { translationY: p * collapseDistance },
      });
    });
  };

  // p = 0: expanded controls visible, compact mini bar hidden, artwork at origin
  await setProgress(0);
  const miniBarStyle = flatten(morphMiniBar.props.style);
  assert.strictEqual(miniBarStyle.left, 0, 'Collapsed morph mini bar must reach left edge');
  assert.strictEqual(miniBarStyle.right, 0, 'Collapsed morph mini bar must reach right edge');
  assert.strictEqual(miniBarStyle.borderRadius, 8, 'Collapsed morph mini bar must preserve rounded corners');
  assert.strictEqual(getVal(flatten(headerToolbar.props.style).opacity), 1);
  assert.strictEqual(getVal(flatten(morphMiniBar.props.style).opacity), 0);
  assert.strictEqual(getVal(flatten(morphArtwork.props.style).opacity), 0);
  assert.strictEqual(getTx(morphArtwork.props.style, 'scale'), 1);
  assert.strictEqual(getTx(morphArtwork.props.style, 'translateX'), 0);
  assert.strictEqual(getTx(morphArtwork.props.style, 'translateY'), 0);
  assert.strictEqual(getTx(clipWrapper.props.style, 'translateY'), 0);
  assert.strictEqual(getTx(contentWrapper.props.style, 'translateY'), 0);

  // Verify morphArtwork and inScrollArtwork never both drop below opacity 1 across the final approach (modalTranslateY in [0..8])
  const inScrollArtworkNode = mRoot.find(
    (n) =>
      n.type === 'View' &&
      typeof n.props?.onLayout === 'function' &&
      n.props?.style?.opacity !== undefined
  );
  assert.ok(inScrollArtworkNode, 'inScrollArtwork wrapper must exist');
  for (const ty of [6, 3, 1, 0.5, 0]) {
    await actAsync(async () => {
      dismissPan.props.onGestureEvent({ nativeEvent: { translationY: ty } });
    });
    const morphOp = getVal(flatten(morphArtwork.props.style).opacity);
    const scrollOp = getVal(flatten(inScrollArtworkNode.props.style).opacity);
    assert.ok(
      morphOp === 1 || scrollOp === 1,
      `At translationY=${ty}px at least one artwork layer must be at full 1.0 opacity to prevent darkening flicker (got morph=${morphOp}, inScroll=${scrollOp})`
    );
  }

  // p = 0.35: expanded controls faded out completely, compact mini bar still hidden, artwork morphing
  await setProgress(0.35);
  assert.strictEqual(getVal(flatten(headerToolbar.props.style).opacity), 0);
  assert.strictEqual(getVal(flatten(morphMiniBar.props.style).opacity), 0);
  assert.strictEqual(getVal(flatten(morphArtwork.props.style).opacity), 1);
  const scaleAt35 = getTx(morphArtwork.props.style, 'scale');
  assert.ok(scaleAt35 < 1 && scaleAt35 > 40 / 300, `scale at p=0.35 should interpolate (${scaleAt35})`);
  assert.ok(getTx(morphArtwork.props.style, 'translateX') < 0);
  assert.ok(getTx(morphArtwork.props.style, 'translateY') < 0);

  // p = 0.50: container bottom-clipped cleanly above rising NavigationTabBar
  await setProgress(0.5);
  assert.ok(Math.abs(getTx(clipWrapper.props.style, 'translateY') - -33) < 0.01);
  assert.ok(Math.abs(getTx(contentWrapper.props.style, 'translateY') - (342 + 33)) < 0.01);
  assert.strictEqual(getVal(flatten(morphMiniBar.props.style).opacity), 0);

  // p = 0.65 -> 0.85: compact mini bar fades in across [0.65, 1.0]
  await setProgress(0.65);
  assert.ok(Math.abs(getVal(flatten(morphMiniBar.props.style).opacity)) < 0.01);
  await setProgress(0.85);
  const miniOpacity85 = getVal(flatten(morphMiniBar.props.style).opacity);
  assert.ok(miniOpacity85 > 0.5 && miniOpacity85 < 0.65, `miniBar opacity at 0.85 expected ~0.57, got ${miniOpacity85}`);

  // p = 1.0: docked compact mini bar at opacity 1, artwork at mini-thumbnail scale
  await setProgress(1.0);
  assert.strictEqual(getVal(flatten(headerToolbar.props.style).opacity), 0);
  assert.strictEqual(getVal(flatten(morphMiniBar.props.style).opacity), 1);
  const targetScale = 40 / Math.min(Math.round(375 * 0.76), 300);
  assert.ok(Math.abs(getTx(morphArtwork.props.style, 'scale') - targetScale) < 0.001);
  assert.ok(
    Math.abs(getTx(morphArtwork.props.style, 'translateX') - (28 - 375 / 2)) < 0.01,
    'Morphed artwork must align horizontally with paddingLeft=8 (targetCenterX=28)'
  );
  assert.strictEqual(getTx(clipWrapper.props.style, 'translateY'), -navBarHeight);
  assert.strictEqual(getTx(contentWrapper.props.style, 'translateY'), collapseDistance + navBarHeight);

  // Paused state: expanded artwork scale matches scaleAnim (0.95) while collapsed stays at targetScale
  await actAsync(async () => {
    modalTree.update(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: sampleTrack,
        isPlaying: false,
        isBuffering: false,
        collapseDistance,
        navBarHeight,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });
  await setProgress(0);
  assert.strictEqual(getTx(morphArtwork.props.style, 'scale'), 0.95);
  await setProgress(1.0);
  assert.ok(Math.abs(getTx(morphArtwork.props.style, 'scale') - targetScale) < 0.001);
});

test('YT Music Morph: Single-player handoff, NavigationTabBar proportional slide, mini drag-up expand, track switch, and desktop layout intact', async () => {
  const rn = require('react-native');
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  // Start playback
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

  const navFade = root.findByProps({ testID: 'spotify-nav-fade' });
  let navAnimWrapper = navFade.parent;
  while (navAnimWrapper && !(navAnimWrapper.props?.style && navAnimWrapper.props.style.opacity !== undefined)) {
    navAnimWrapper = navAnimWrapper.parent;
  }
  const miniTouchable = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
  );
  let miniAnimWrapper = miniTouchable.parent;
  while (miniAnimWrapper && typeof miniAnimWrapper.props?.pointerEvents !== 'string') {
    miniAnimWrapper = miniAnimWrapper.parent;
  }

  const getVal = (v) => (v && typeof v === 'object' && '_value' in v ? v._value : v);
  const getStyleNum = (node, prop) => {
    const s = Object.assign({}, ...[].concat(node.props.style).filter(Boolean));
    return getVal(s[prop]);
  };
  const getTxY = (node) => {
    const s = Object.assign({}, ...[].concat(node.props.style).filter(Boolean));
    const entry = (s.transform || []).find((t) => t && t.translateY !== undefined);
    return entry ? getVal(entry.translateY) : undefined;
  };

  const countModalContent = () =>
    root.findAll((n) => n.type === 'View' && n.props.testID === 'now-playing-modal-content').length;

  // Stale pre-track bottomDock layout (height < 100, e.g. only 66px navBar before mini player mounted)
  // must NOT overwrite collapseDistance and strand the morphed mini player higher up above the tab bar.
  const bottomDock = root.find(
    (n) => n.type === 'View' && n.props.pointerEvents === 'box-none' && typeof n.props.onLayout === 'function'
  );
  assert.ok(bottomDock, 'bottomDock with onLayout must exist');
  await actAsync(async () => {
    bottomDock.props.onLayout({ nativeEvent: { layout: { x: 0, y: 746, width: 375, height: 66 } } });
  });

  // Resting collapsed state: 1 player visible (PersistentMiniPlayer), NowPlayingModal unmounted, NavigationTabBar visible
  assert.strictEqual(getStyleNum(miniAnimWrapper, 'opacity'), 1);
  assert.strictEqual(miniAnimWrapper.props.pointerEvents, 'auto');
  assert.strictEqual(getTxY(navAnimWrapper), 0);
  assert.strictEqual(getStyleNum(navAnimWrapper, 'opacity'), 1);
  assert.strictEqual(countModalContent(), 0);

  // Tap mini player to expand -> PersistentMiniPlayer hides (no 2 players!), NavigationTabBar slides off-screen
  await actAsync(async () => {
    miniTouchable.props.onPress();
  });
  assert.strictEqual(countModalContent(), 1);
  assert.strictEqual(getStyleNum(miniAnimWrapper, 'opacity'), 0);
  assert.strictEqual(miniAnimWrapper.props.pointerEvents, 'none');
  assert.strictEqual(getTxY(navAnimWrapper), 66);
  assert.strictEqual(getStyleNum(navAnimWrapper, 'opacity'), 0);

  // Mid-drag collapse (p = 0.5): NavigationTabBar rises proportionally while PersistentMiniPlayer remains hidden
  const dismissPan = root.findByProps({ testID: 'player-dismiss-pan' });
  const collapseDistance = 812 - (62 + 66);
  await actAsync(async () => {
    dismissPan.props.onGestureEvent({
      nativeEvent: { translationY: collapseDistance * 0.5 },
    });
  });
  assert.ok(Math.abs(getTxY(navAnimWrapper) - 33) < 0.01);
  assert.strictEqual(getStyleNum(miniAnimWrapper, 'opacity'), 0);

  // Release past threshold -> NowPlayingModal closes & unmounts, PersistentMiniPlayer & NavigationTabBar restore
  const { State: GestureState } = require('react-native-gesture-handler');
  await actAsync(async () => {
    dismissPan.props.onHandlerStateChange({
      nativeEvent: {
        state: GestureState.END,
        oldState: GestureState.ACTIVE,
        translationY: 140,
        velocityY: 600,
      },
    });
  });
  assert.strictEqual(countModalContent(), 0);
  assert.strictEqual(getStyleNum(miniAnimWrapper, 'opacity'), 1);
  assert.strictEqual(miniAnimWrapper.props.pointerEvents, 'auto');
  assert.strictEqual(getTxY(navAnimWrapper), 0);
  assert.strictEqual(getStyleNum(navAnimWrapper, 'opacity'), 1);

  // Drag mini player upward past threshold -> renders full morph sheet (never a floating 56px pill) and expands cleanly
  const miniPanWrapper = root.find(
    (n) => n.type === 'View' && typeof n.props?.onMoveShouldSetResponderCapture === 'function'
  );
  await actAsync(async () => {
    miniPanWrapper.props.onResponderMove({}, { dy: -120, dx: 0 });
  });
  assert.strictEqual(
    getStyleNum(miniAnimWrapper, 'opacity'),
    0,
    'Upward mini drag must hide 56px mini pill while full morph sheet rises'
  );
  assert.strictEqual(
    countModalContent(),
    1,
    'Upward mini drag must render full morph sheet inline during drag'
  );
  const risingContent = root.findByProps({ testID: 'now-playing-modal-content' });
  assert.ok(
    getTxY(risingContent) < collapseDistance + 66,
    'Full morph sheet should rise with upward finger drag'
  );
  await actAsync(async () => {
    miniPanWrapper.props.onResponderRelease({}, { dy: -120, dx: 0, vy: -0.6 });
  });
  assert.strictEqual(countModalContent(), 1);
  assert.strictEqual(getStyleNum(miniAnimWrapper, 'opacity'), 0);
  const expandedContentAfterDrag = root.findByProps({ testID: 'now-playing-modal-content' });
  assert.strictEqual(
    getTxY(expandedContentAfterDrag),
    0,
    'Drag-up release must lock NowPlayingModal at translateY = 0 without collapsing or re-expanding'
  );

  // Track change while collapsed updates dominant color without unmounting mini player
  const closeBtn = findButtonByIcon(root, 'ChevronDown');
  await actAsync(async () => {
    closeBtn.props.onPress({ stopPropagation: () => {} });
  });
  const skipNextBtn = findButtonByIcon(root, 'SkipForward');
  await actAsync(async () => {
    await skipNextBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(getStyleNum(miniAnimWrapper, 'opacity'), 1);
  assert.strictEqual(mockPlayer.getActiveTrack().id !== 'yt_track_1', true);

  // Desktop mode (width >= 768) leaves NavigationTabBar unmounted and sidebar intact
  const originalGet = rn.Dimensions.get;
  rn.Dimensions.get = () => ({ width: 1024, height: 900, scale: 2, fontScale: 1 });
  let desktopTree;
  try {
    await actAsync(async () => {
      desktopTree = renderer.create(React.createElement(App));
    });
    assert.strictEqual(
      desktopTree.root.findAllByProps({ testID: 'spotify-nav-fade' }).length,
      0,
      'Desktop layout must omit NavigationTabBar'
    );
  } finally {
    rn.Dimensions.get = originalGet;
    if (desktopTree) {
      await actAsync(async () => {
        desktopTree.unmount();
      });
    }
    await actAsync(async () => {
      tree.unmount();
    });
  }
});

test('YT Music Morph: Snap-back below threshold and 10x rapid-tap async interruptibility', async () => {
  const { Animated } = require('react-native');
  const { State: GestureState } = require('react-native-gesture-handler');

  // 1. Snap-back when dy <= 80 and vy <= 0.4
  let closed = false;
  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {
          closed = true;
        },
        track: {
          id: 'snap_1',
          title: 'Snap Song',
          artist: 'Artist',
          duration: 180,
          artwork: 'https://example.com/snap.jpg',
        },
        isPlaying: true,
        isBuffering: false,
        collapseDistance: 684,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });

  const dismissPan = modalTree.root.findByProps({ testID: 'player-dismiss-pan' });
  const headerToolbar = modalTree.root.findByProps({ accessibilityRole: 'toolbar' });
  const miniBar = modalTree.root.findByProps({ testID: 'player-morph-mini-bar' });
  const getOpacity = (node) => {
    const s = Object.assign({}, ...[].concat(node.props.style).filter(Boolean));
    return s.opacity && typeof s.opacity === 'object' ? s.opacity._value : s.opacity;
  };

  await actAsync(async () => {
    dismissPan.props.onGestureEvent({ nativeEvent: { translationY: 50 } });
    dismissPan.props.onHandlerStateChange({
      nativeEvent: {
        state: GestureState.END,
        oldState: GestureState.ACTIVE,
        translationY: 50,
        velocityY: 100,
      },
    });
  });
  assert.strictEqual(closed, false, 'Below-threshold drag must snap back instead of closing');
  assert.strictEqual(getOpacity(headerToolbar), 1);
  assert.strictEqual(getOpacity(miniBar), 0);

  // 2. 10x rapid-tap async interruptibility with intercepted in-flight Animated.timing
  let appTree;
  await actAsync(async () => {
    appTree = renderer.create(React.createElement(App));
  });
  const root = appTree.root;

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

  const originalTiming = Animated.timing;
  const pendingAnims = [];
  Animated.timing = (val, config) => {
    let active = true;
    let storedCb = null;
    return {
      start: (cb) => {
        storedCb = cb;
        pendingAnims.push({
          val,
          config,
          finish: () => {
            if (!active) return;
            active = false;
            if (config && config.toValue !== undefined && val?.setValue) {
              val.setValue(config.toValue);
            }
            storedCb?.({ finished: true });
          },
        });
      },
      stop: () => {
        if (!active) return;
        active = false;
        const cb = storedCb;
        storedCb = null;
        cb?.({ finished: false });
      },
    };
  };

  try {
    const expandBtn = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
  );
    for (let i = 0; i < 10; i++) {
      await actAsync(async () => {
        expandBtn.props.onPress({ stopPropagation: () => {} });
      });
      const closeBtn = findButtonByIcon(root, 'ChevronDown');
      assert.ok(closeBtn, `ChevronDown must be reachable on rapid async iteration ${i}`);
      await actAsync(async () => {
        closeBtn.props.onPress({ stopPropagation: () => {} });
      });
      assert.strictEqual(mockPlayer.state, State.Playing);
    }

    // Complete final in-flight close animation -> modal must unmount cleanly without deadlocking
    await actAsync(async () => {
      pendingAnims.forEach((p) => p.finish());
    });
    assert.strictEqual(
      root.findAllByProps({ testID: 'now-playing-modal-content' }).length,
      0,
      'Final in-flight close must unmount NowPlayingModal cleanly'
    );

    // Re-expand and let enter animation finish -> must reach p = 0 cleanly
    await actAsync(async () => {
      expandBtn.props.onPress({ stopPropagation: () => {} });
    });
    await actAsync(async () => {
      pendingAnims.forEach((p) => p.finish());
    });
    const finalToolbar = root.findByProps({ accessibilityRole: 'toolbar' });
    assert.strictEqual(getOpacity(finalToolbar), 1);
    assert.strictEqual(mockPlayer.state, State.Playing);
  } finally {
    Animated.timing = originalTiming;
    await actAsync(async () => {
      appTree.unmount();
    });
  }
});

test('YT Music Morph: BEGAN->FAILED tap during enter/close does not freeze, and stale close callback does not clobber across epochs', async () => {
  const { Animated } = require('react-native');
  const { State: GestureState } = require('react-native-gesture-handler');

  let appTree;
  await actAsync(async () => {
    appTree = renderer.create(React.createElement(App));
  });
  const root = appTree.root;

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

  const originalTiming = Animated.timing;
  const recordedTimings = [];
  Animated.timing = (val, config) => {
    let active = true;
    let storedCb = null;
    const entry = {
      val,
      config,
      stopped: false,
      deferredStopCb: null,
      finish: () => {
        if (!active) return;
        active = false;
        if (config && config.toValue !== undefined && val?.setValue) {
          val.setValue(config.toValue);
        }
        const cb = storedCb;
        storedCb = null;
        cb?.({ finished: true });
      },
      flushDeferredStop: () => {
        const cb = entry.deferredStopCb;
        entry.deferredStopCb = null;
        cb?.({ finished: false });
      },
    };
    return {
      start: (cb) => {
        storedCb = cb;
        recordedTimings.push(entry);
      },
      stop: () => {
        if (!active) return;
        active = false;
        entry.stopped = true;
        entry.deferredStopCb = storedCb;
        storedCb = null;
      },
    };
  };

  const getOpacity = (node) => {
    const s = Object.assign({}, ...[].concat(node.props.style).filter(Boolean));
    return s.opacity && typeof s.opacity === 'object' ? s.opacity._value : s.opacity;
  };
  const countModalContent = () =>
    root.findAll((n) => n.type === 'View' && n.props.testID === 'now-playing-modal-content').length;

  try {
    const expandBtn = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
  );

    // (a) BEGAN -> FAILED during animateToExpanded() must settle headerToolbar opacity to 1
    await actAsync(async () => {
      expandBtn.props.onPress({ stopPropagation: () => {} });
    });
    const enterAnim1 = recordedTimings.filter((e) => e.config?.toValue === 0).slice(-1)[0];
    assert.ok(enterAnim1, 'Enter animation must be created');

    const dismissPan = root.findByProps({ testID: 'player-dismiss-pan' });
    const headerToolbar = root.findByProps({ accessibilityRole: 'toolbar' });
    assert.strictEqual(
      headerToolbar.props.onStartShouldSetResponder?.(),
      true,
      'headerPanResponder must still accept touch start on the top bar'
    );

    const prevRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
    try {
      let persistentModalTree;
      await actAsync(async () => {
        persistentModalTree = renderer.create(
          React.createElement(NowPlayingModal, {
            visible: true,
            persistentMode: true,
            onClose: () => {},
            track: sampleTracks[0],
            isPlaying: true,
            isBuffering: false,
            onTogglePlay: () => {},
            onSkipNext: () => {},
            onSkipPrevious: () => {},
          })
        );
      });
      const persistentContentWrapper = persistentModalTree.root.findByProps({
        testID: 'now-playing-modal-content',
      });
      assert.strictEqual(
        persistentContentWrapper.props.onMoveShouldSetResponder?.({}, { dy: 9, dx: 0 }),
        false,
        'In persistentMode with native PanGestureHandler attached, modalPanResponder must not steal slow downward drags at dy=9px before activeOffsetY=10px'
      );
      await actAsync(async () => {
        persistentModalTree.unmount();
      });
    } finally {
      global.requestAnimationFrame = prevRaf;
    }

    await actAsync(async () => {
      dismissPan.props.onHandlerStateChange({
        nativeEvent: { state: GestureState.BEGAN, oldState: GestureState.UNDETERMINED },
      });
      dismissPan.props.onHandlerStateChange({
        nativeEvent: { state: GestureState.FAILED, oldState: GestureState.BEGAN },
      });
      // Non-drag tap on headerPanResponder must also not interrupt enter animation
      headerToolbar.props.onResponderGrant?.({}, {});
      headerToolbar.props.onResponderMove?.({}, { dy: 2, dx: 0 });
      headerToolbar.props.onResponderRelease?.({}, { dy: 2, dx: 0, vy: 0 });
    });
    assert.strictEqual(enterAnim1.stopped, false, 'BEGAN->FAILED and non-drag header tap must not stop animateToExpanded');

    await actAsync(async () => {
      enterAnim1.finish();
    });
    assert.strictEqual(getOpacity(headerToolbar), 1, 'headerToolbar opacity must settle to 1');

    // (b) BEGAN -> FAILED during closeWithSlide() must not leave modal frozen mid-morph
    const closeBtn = findButtonByIcon(root, 'ChevronDown');
    await actAsync(async () => {
      closeBtn.props.onPress({ stopPropagation: () => {} });
    });
    const closeAnim1 = recordedTimings.filter((e) => e.config?.toValue > 0).slice(-1)[0];
    assert.ok(closeAnim1, 'Close animation 1 must be created');
    closeAnim1.val.setValue(250);

    await actAsync(async () => {
      dismissPan.props.onHandlerStateChange({
        nativeEvent: { state: GestureState.BEGAN, oldState: GestureState.UNDETERMINED },
      });
      dismissPan.props.onHandlerStateChange({
        nativeEvent: { state: GestureState.FAILED, oldState: GestureState.BEGAN },
      });
    });
    assert.strictEqual(closeAnim1.stopped, false, 'BEGAN->FAILED tap must not stop closeWithSlide');

    await actAsync(async () => {
      closeAnim1.finish();
    });
    assert.strictEqual(countModalContent(), 0, 'Modal must finish closing cleanly without mid-morph freeze');

    // (c) Stale deferred closeWithSlide stop callback across morphEpoch bump must not clobber closeAnim2
    await actAsync(async () => {
      expandBtn.props.onPress({ stopPropagation: () => {} });
    });
    await actAsync(async () => {
      recordedTimings.filter((e) => e.config?.toValue === 0).slice(-1)[0].finish();
    });

    await actAsync(async () => {
      findButtonByIcon(root, 'ChevronDown').props.onPress({ stopPropagation: () => {} });
    });
    const staleCloseAnim = recordedTimings.filter((e) => e.config?.toValue > 0).slice(-1)[0];

    // Re-open (bumps morphEpoch, stops staleCloseAnim with deferred stop callback)
    await actAsync(async () => {
      expandBtn.props.onPress({ stopPropagation: () => {} });
    });
    assert.strictEqual(staleCloseAnim.stopped, true, 'Re-open must stop in-flight close animation');
    await actAsync(async () => {
      recordedTimings.filter((e) => e.config?.toValue === 0).slice(-1)[0].finish();
    });

    // Start closeAnim2
    const closeCountBefore2 = recordedTimings.filter((e) => e.config?.toValue > 0).length;
    await actAsync(async () => {
      findButtonByIcon(root, 'ChevronDown').props.onPress({ stopPropagation: () => {} });
    });
    const closeCountAfter2 = recordedTimings.filter((e) => e.config?.toValue > 0).length;
    assert.strictEqual(closeCountAfter2, closeCountBefore2 + 1, 'Second close animation must start');
    const closeAnim2 = recordedTimings.filter((e) => e.config?.toValue > 0).slice(-1)[0];

    // Fire stale deferred stop callback from staleCloseAnim while closeAnim2 is active
    await actAsync(async () => {
      staleCloseAnim.flushDeferredStop();
    });

    // Attempt a 3rd closeWithSlide() while closeAnim2 is still active — must be ignored!
    await actAsync(async () => {
      findButtonByIcon(root, 'ChevronDown').props.onPress({ stopPropagation: () => {} });
    });
    const closeCountAfter3 = recordedTimings.filter((e) => e.config?.toValue > 0).length;
    assert.strictEqual(
      closeCountAfter3,
      closeCountAfter2,
      'Stale deferred close callback must not clobber isClosingRef or allow a 3rd close animation'
    );
    assert.strictEqual(closeAnim2.stopped, false, 'closeAnim2 must remain active');

    await actAsync(async () => {
      closeAnim2.finish();
    });
    assert.strictEqual(countModalContent(), 0, 'closeAnim2 must finish and close modal cleanly');
  } finally {
    Animated.timing = originalTiming;
    await actAsync(async () => {
      appTree.unmount();
    });
  }
});

