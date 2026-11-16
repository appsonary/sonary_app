// tests/flow3_player.test.js
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
const {
  initDatabase,
  savePlaybackSession,
  saveDownloadedTrack,
  createPlaylist,
  addTrackToPlaylist,
} = require('../services/database');
const FileSystem = require('expo-file-system');

const originalSearchTracks = api.searchTracks;
const originalGetAudioStream = api.getAudioStream;
const originalGetTrackRadio = api.getTrackRadio;
const originalGetRelatedTracks = api.getRelatedTracks;

const sampleTracks = [
  {
    id: 'track_a',
    title: 'Clocks',
    artist: 'Coldplay',
    duration: 307,
    formattedDuration: '5:07',
    thumbnailUrl: 'https://example.com/clocks.jpg',
  },
  {
    id: 'track_b',
    title: 'The Scientist',
    artist: 'Coldplay',
    duration: 309,
    formattedDuration: '5:09',
    thumbnailUrl: 'https://example.com/scientist.jpg',
  },
];

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
  api.searchTracks = async () => sampleTracks;
  api.getAudioStream = async (id) => ({
    videoId: id,
    title: id === 'track_a' ? 'Clocks' : 'The Scientist',
    artist: 'Coldplay',
    duration: 300,
    thumbnailUrl: 'https://example.com/art.jpg',
    streamUrl: `https://stream.example.com/${id}.mp4`,
    mimeType: 'audio/mp4',
    format: 'M4A',
    bitrate: 128000,
  });
  api.getTrackRadio = async () => ({
    tracks: [],
    continuationToken: undefined,
  });
  api.getRelatedTracks = async () => [];
});

test.afterEach(() => {
  api.searchTracks = originalSearchTracks;
  api.getAudioStream = originalGetAudioStream;
  api.getTrackRadio = originalGetTrackRadio;
  api.getRelatedTracks = originalGetRelatedTracks;
});

test('Flow 3: Clicking a track in search list starts playback and renders Mini Player', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('Coldplay');
  });

  const searchBtn = findSearchActionButton(root);
  await actAsync(async () => {
    searchBtn.props.onPress();
  });

  // Find track card for 'Clocks' and press it
  const clockCards = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Clocks')
  );
  assert.ok(clockCards.length > 0, 'Track card for Clocks must exist');

  await actAsync(async () => {
    clockCards[0].props.onPress();
  });

  // Verify TrackPlayer received the track and started playing
  assert.strictEqual(mockPlayer.state, State.Playing);
  const activeTrack = mockPlayer.getActiveTrack();
  assert.ok(activeTrack);
  assert.strictEqual(activeTrack.id, 'track_a');

  // Verify Mini Player is now visible with active track info
  const text = getAllText(root);
  assert.ok(text.includes('Clocks'), 'Mini player should show track title');
  assert.ok(text.includes('Coldplay'), 'Mini player should show artist');

  // Verify Mini Player controls: Pause, SkipBack, SkipForward exist
  const pauseIcons = root.findAll(
    (n) => n.type === 'LucideIcon' && n.props.name === 'Pause'
  );
  assert.ok(pauseIcons.length > 0, 'Pause icon should be displayed when playing');
});

test('Flow 3: Mini Player play/pause toggle, skipNext, and skipPrevious', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('Coldplay');
  });
  await actAsync(async () => {
    findSearchActionButton(root).props.onPress();
  });

  // Click first track
  const clockCards = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Clocks')
  );
  await actAsync(async () => {
    clockCards[0].props.onPress();
  });

  assert.strictEqual(mockPlayer.state, State.Playing);

  // 1. Toggle pause via Mini Player
  const pauseBtn = findButtonByIcon(root, 'Pause');
  assert.ok(pauseBtn, 'Pause button should exist in mini player');
  await actAsync(async () => {
    pauseBtn.props.onPress({ stopPropagation: () => {} });
  });

  assert.strictEqual(mockPlayer.state, State.Paused);

  // Toggle play again
  const playBtn = findButtonByIcon(root, 'Play');
  assert.ok(playBtn, 'Play button should exist when paused');
  await actAsync(async () => {
    playBtn.props.onPress({ stopPropagation: () => {} });
  });

  assert.strictEqual(mockPlayer.state, State.Playing);

  // 2. Skip to Next track via Mini Player
  const skipForwardBtn = findButtonByIcon(root, 'SkipForward');
  assert.ok(skipForwardBtn, 'SkipForward button should exist');
  await actAsync(async () => {
    skipForwardBtn.props.onPress({ stopPropagation: () => {} });
  });

  // Active track should now be track_b ('The Scientist')
  assert.strictEqual(mockPlayer.getActiveTrack().id, 'track_b');

  // 3. Skip to Previous track via Mini Player
  const skipBackBtn = findButtonByIcon(root, 'SkipBack');
  assert.ok(skipBackBtn, 'SkipBack button should exist');
  await actAsync(async () => {
    skipBackBtn.props.onPress({ stopPropagation: () => {} });
  });

  assert.strictEqual(mockPlayer.getActiveTrack().id, 'track_a');
});

test('Flow 3: NowPlayingModal renders expanded full screen and controls playback and seek', async () => {
  let playToggled = false;
  let nextSkipped = false;
  let prevSkipped = false;
  let relativeSeek = 0;
  let favoriteToggled = false;
  let modalClosed = false;

  const sampleTrack = {
    id: 'modal_track_1',
    title: 'Fix You',
    artist: 'Coldplay',
    duration: 295,
    artwork: 'https://example.com/fixyou.jpg',
  };

  mockPlayer.position = 75;
  mockPlayer.duration = 295;

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {
          modalClosed = true;
        },
        track: sampleTrack,
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {
          playToggled = true;
        },
        onSkipNext: () => {
          nextSkipped = true;
        },
        onSkipPrevious: () => {
          prevSkipped = true;
        },
        onSeekRelative: (sec) => {
          relativeSeek = sec;
        },
        isFavorite: false,
        onToggleFavorite: () => {
          favoriteToggled = true;
        },
      })
    );
  });

  const modalRoot = modalTree.root;
  const modalText = getAllText(modalRoot);

  // Verify header and track metadata
  assert.ok(modalText.includes('TOCANDO AGORA'));
  assert.ok(modalText.includes('Fix You'));
  assert.ok(modalText.includes('Coldplay'));

  // Verify 3-dots more options button opens contextual bottom sheet
  const moreBtn = findButtonByIcon(modalRoot, 'MoreVertical');
  assert.ok(moreBtn, '3-dots more options button should exist in NowPlayingModal header');
  await actAsync(async () => {
    moreBtn.props.onPress();
  });
  const sheetText = getAllText(modalRoot);
  assert.ok(
    sheetText.includes('Ver fila de reprodução') || sheetText.includes('Adicionar à playlist'),
    'Contextual bottom sheet should open with playlist/queue options'
  );

  // Verify Skip Previous button
  const skipPrevBtn = findButtonByIcon(modalRoot, 'SkipBack');
  assert.ok(skipPrevBtn);
  await actAsync(async () => {
    skipPrevBtn.props.onPress();
  });
  assert.strictEqual(prevSkipped, true);

  // Verify Main Play/Pause button
  const pauseMainBtn = findButtonByIcon(modalRoot, 'Pause');
  assert.ok(pauseMainBtn);
  await actAsync(async () => {
    pauseMainBtn.props.onPress();
  });
  assert.strictEqual(playToggled, true);

  // Verify Skip Next button
  const skipNextBtn = findButtonByIcon(modalRoot, 'SkipForward');
  assert.ok(skipNextBtn);
  await actAsync(async () => {
    skipNextBtn.props.onPress();
  });
  assert.strictEqual(nextSkipped, true);

  // Verify Favorite toggle button
  const heartBtn = findButtonByIcon(modalRoot, 'Heart');
  assert.ok(heartBtn);
  await actAsync(async () => {
    heartBtn.props.onPress();
  });
  assert.strictEqual(favoriteToggled, true);

  // Verify Minimize button (ChevronDown) closes the modal
  const closeBtn = findButtonByIcon(modalRoot, 'ChevronDown');
  assert.ok(closeBtn);
  await actAsync(async () => {
    closeBtn.props.onPress();
  });
  assert.strictEqual(modalClosed, true);
});

test('Flow 3: NowPlayingModal dragging down from top dismisses player to mini player', async () => {
  let modalClosed = false;

  const sampleTrack = {
    id: 'drag_track_1',
    title: 'Numb',
    artist: 'Linkin Park',
    duration: 187,
  };

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {
          modalClosed = true;
        },
        track: sampleTrack,
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });

  const modalRoot = modalTree.root;
  // Locate the animated modal content wrapper which holds the panHandlers
  const contentWrapper = modalRoot.findByProps({ testID: 'now-playing-modal-content' });
  assert.ok(contentWrapper, 'Modal content wrapper with panHandlers must exist');

  // Check shouldSetResponder logic:
  // At top (scrollY <= 5), dragging downward (> 8px) should capture
  const shouldSet = contentWrapper.props.onMoveShouldSetResponder(
    {},
    { dy: 90, dx: 0 }
  );
  assert.strictEqual(shouldSet, true, 'PanResponder should capture downward drag when at top');

  // Upward drag should NOT capture
  const shouldNotSetUp = contentWrapper.props.onMoveShouldSetResponder(
    {},
    { dy: -30, dx: 0 }
  );
  assert.strictEqual(shouldNotSetUp, false, 'PanResponder should not capture upward drag');

  // Triggering drag down and release beyond threshold calls onClose
  await actAsync(async () => {
    contentWrapper.props.onResponderMove({}, { dy: 120, dx: 0 });
    contentWrapper.props.onResponderRelease({}, { dy: 120, dx: 0, vy: 0.6 });
  });

  assert.strictEqual(modalClosed, true, 'Crossing drag threshold should call onClose to dismiss modal');

  // Verify header toolbar allows dragging from any point of the top bar
  const headerToolbar = modalRoot.findByProps({ accessibilityRole: 'toolbar' });
  assert.ok(headerToolbar, 'Top header bar toolbar should exist');
  assert.strictEqual(
    headerToolbar.props.onStartShouldSetResponder(),
    true,
    'Header toolbar should accept touch start on any part of the component'
  );
  let headerDragClosed = false;
  let headerTree;
  await actAsync(async () => {
    headerTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {
          headerDragClosed = true;
        },
        track: sampleTrack,
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });
  const headerToolbar2 = headerTree.root.findByProps({ accessibilityRole: 'toolbar' });
  await actAsync(async () => {
    headerToolbar2.props.onResponderMove({}, { dy: 100, dx: 0 });
    headerToolbar2.props.onResponderRelease({}, { dy: 100, dx: 0, vy: 0.5 });
  });
  assert.strictEqual(headerDragClosed, true, 'Dragging down directly on the top header bar should dismiss modal');
});

test('Flow 3: NowPlayingModal native PanGestureHandler dismisses from anywhere when scrollY is at top and disables when scrolled down', async () => {
  const { State: GestureState } = require('react-native-gesture-handler');
  let modalClosed = false;

  const sampleTrack = {
    id: 'drag_anywhere_1',
    title: 'Thinkin Bout You',
    artist: 'Joseph Solomon',
    duration: 238,
  };

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {
          modalClosed = true;
        },
        track: sampleTrack,
        isPlaying: false,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });

  const modalRoot = modalTree.root;
  const panHandler = modalRoot.findByProps({ testID: 'player-dismiss-pan' });
  const scrollView = modalRoot.findAllByType('ScrollView')[0];
  const contentWrapper = modalRoot.findByProps({ testID: 'now-playing-modal-content' });

  assert.strictEqual(panHandler.props.enabled, true, 'PanGestureHandler must be enabled when scroll is at top');
  assert.ok(scrollView.props.waitFor, 'ScrollView must waitFor PanGestureHandler so downward drag is not stolen');

  // Scroll down -> disables PanGestureHandler and modalPanResponder
  await actAsync(async () => {
    scrollView.props.onScroll({ nativeEvent: { contentOffset: { y: 150 } } });
  });
  assert.strictEqual(panHandler.props.enabled, false, 'PanGestureHandler must disable when scrolled down');
  assert.strictEqual(
    contentWrapper.props.onMoveShouldSetResponder({}, { dy: 90, dx: 0 }),
    false,
    'PanResponder must not capture when scrolled down'
  );

  // Scroll back to top -> re-enables full-screen downward drag dismiss
  await actAsync(async () => {
    scrollView.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
  });
  assert.strictEqual(panHandler.props.enabled, true, 'PanGestureHandler must re-enable when back at top');

  // Trigger native downward drag gesture anywhere in the modal
  await actAsync(async () => {
    panHandler.props.onHandlerStateChange({
      nativeEvent: {
        state: GestureState.ACTIVE,
        oldState: GestureState.BEGAN,
        translationY: 15,
        velocityY: 100,
      },
    });
    panHandler.props.onGestureEvent({
      nativeEvent: { translationY: 110 },
    });
    panHandler.props.onHandlerStateChange({
      nativeEvent: {
        state: GestureState.END,
        oldState: GestureState.ACTIVE,
        translationY: 110,
        velocityY: 600,
      },
    });
  });

  assert.strictEqual(modalClosed, true, 'Downward PanGestureHandler drag at top should dismiss NowPlayingModal');
});

test('Flow 3: NowPlayingModal 3-dots menu bottom sheet triggers Play Next, Queue, Playlist, and Download', async () => {
  let playNextCalled = false;
  let addToQueueCalled = false;
  let addToPlaylistCalled = false;
  let downloadCalled = false;

  const sampleTrack = {
    id: 'sheet_track_1',
    title: 'In The End',
    artist: 'Linkin Park',
    duration: 216,
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: sampleTrack,
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
        onPlayNext: () => {
          playNextCalled = true;
        },
        onAddToQueue: () => {
          addToQueueCalled = true;
        },
        onAddToPlaylist: () => {
          addToPlaylistCalled = true;
        },
        onDownload: () => {
          downloadCalled = true;
        },
      })
    );
  });

  const root = tree.root;

  // 1. Open 3-dots bottom sheet
  const moreBtn = findButtonByIcon(root, 'MoreVertical');
  assert.ok(moreBtn, '3-dots more button must exist');
  await actAsync(async () => {
    moreBtn.props.onPress();
  });

  // 2. Verify sheet drag handle exists
  const dragArea = root.find(
    (n) => n.props.accessibilityLabel === 'Arraste para baixo para recolher o menu'
  );
  assert.ok(dragArea, 'Drag area handle should exist in bottom sheet');

  // 3. Test Play Next action
  const playNextBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar a seguir'
  );
  assert.ok(playNextBtn);
  await actAsync(async () => {
    playNextBtn.props.onPress();
  });
  assert.strictEqual(playNextCalled, true, 'onPlayNext should be triggered');

  // 4. Re-open sheet and test Add to Playlist action
  await actAsync(async () => {
    moreBtn.props.onPress();
  });
  const playlistBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Adicionar à playlist'
  );
  assert.ok(playlistBtn);
  await actAsync(async () => {
    playlistBtn.props.onPress();
  });
  assert.strictEqual(addToPlaylistCalled, true, 'onAddToPlaylist should be triggered');

  // 5. Re-open sheet and test Download action
  await actAsync(async () => {
    moreBtn.props.onPress();
  });
  const downloadBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Salvar offline'
  );
  assert.ok(downloadBtn);
  await actAsync(async () => {
    downloadBtn.props.onPress();
  });
  assert.strictEqual(downloadCalled, true, 'onDownload should be triggered');
});

test('Flow 3: Restored non-downloaded session stays paused without queueing dummy URL or triggering PlaybackError, and plays real stream on Play', async () => {
  await savePlaybackSession({
    track: {
      id: 'florissant_1',
      title: 'Florissant',
      artist: 'Richy Mitch & The Coal Miners',
      duration: 185,
      thumbnailUrl: 'https://example.com/florissant.jpg',
    },
    positionSec: 42,
    playlistContext: { type: 'search' },
    savedAt: Date.now(),
  });

  let streamResolveCount = 0;
  api.getAudioStream = async (id) => {
    streamResolveCount += 1;
    return {
      videoId: id,
      title: 'Florissant',
      artist: 'Richy Mitch & The Coal Miners',
      duration: 185,
      thumbnailUrl: 'https://example.com/florissant.jpg',
      streamUrl: `https://cdn.realstream.test/${id}.m4a`,
      mimeType: 'audio/mp4',
      format: 'M4A',
      bitrate: 128000,
    };
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const textOnStartup = getAllText(root);

  // Mini player shows restored track in paused state with zero errors
  assert.ok(textOnStartup.includes('Florissant'), 'Mini player should render restored track title');
  assert.ok(
    !textOnStartup.includes('Stream bloqueado pelo servidor'),
    'Startup must not show stream error banner for non-downloaded restored track'
  );
  assert.strictEqual(streamResolveCount, 0, 'Startup must not eagerly resolve stream URL');
  assert.strictEqual(mockPlayer.queue.length, 0, 'TrackPlayer must not receive dummy stream.example.com URL');

  // Press Play on Mini Player -> resolves real stream and starts playback at saved position
  const playBtn = findButtonByIcon(root, 'Play');
  assert.ok(playBtn, 'Play button should exist on restored mini player');

  await actAsync(async () => {
    playBtn.props.onPress({ stopPropagation: () => {} });
  });

  assert.strictEqual(streamResolveCount, 1, 'Pressing Play must resolve real audio stream');
  assert.strictEqual(mockPlayer.state, State.Playing, 'Playback should start after resolving stream');
  assert.strictEqual(mockPlayer.getActiveTrack().id, 'florissant_1');
  assert.strictEqual(
    mockPlayer.getActiveTrack().url,
    'https://cdn.realstream.test/florissant_1.m4a'
  );
  assert.strictEqual(mockPlayer.position, 42, 'Should seek to restored session position');
  assert.ok(
    !getAllText(root).includes('Stream bloqueado pelo servidor'),
    'No error banner after pressing Play'
  );
});

test('Flow 3: Restored non-downloaded session preserves mini player on stream fetch failure for retry', async () => {
  await savePlaybackSession({
    track: {
      id: 'offline_retry_1',
      title: 'Offline Song',
      artist: 'Test Artist',
      duration: 200,
      thumbnailUrl: 'https://example.com/art.jpg',
    },
    positionSec: 15,
    savedAt: Date.now(),
  });

  api.getAudioStream = async () => {
    throw new Error('Sem conexão com a internet');
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const playBtn = findButtonByIcon(root, 'Play');
  assert.ok(playBtn);

  await actAsync(async () => {
    playBtn.props.onPress({ stopPropagation: () => {} });
  });

  const text = getAllText(root);
  assert.ok(text.includes('Sem conexão com a internet'), 'Should display stream error message');
  assert.ok(text.includes('Offline Song'), 'Mini player should remain visible for retry');
});

test('Flow 3: Restored downloaded session loads directly into TrackPlayer paused from localUri', async () => {
  const localUri = `${FileSystem.documentDirectory}tracks/dl_track_1.m4a`;
  FileSystem.files.set(localUri, { isDirectory: false, size: 1024 * 1024 * 3 });
  await saveDownloadedTrack({
    id: 'dl_track_1',
    title: 'Local Track',
    artist: 'Offline Artist',
    duration: 210,
    thumbnailUrl: 'https://example.com/local.jpg',
    localUri,
    downloadedAt: Date.now(),
  });
  await savePlaybackSession({
    track: {
      id: 'dl_track_1',
      title: 'Local Track',
      artist: 'Offline Artist',
      duration: 210,
      thumbnailUrl: 'https://example.com/local.jpg',
    },
    positionSec: 30,
    savedAt: Date.now(),
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  assert.strictEqual(mockPlayer.queue.length, 1);
  assert.strictEqual(mockPlayer.getActiveTrack().url, localUri);
  assert.strictEqual(mockPlayer.state, State.Paused);
  assert.strictEqual(mockPlayer.position, 30);
});

test('Flow 3: NowPlayingModal native horizontal PanGestureHandler skips next/previous like Spotify without dismissing or hijacking scrubber', async () => {
  const { State: GestureState } = require('react-native-gesture-handler');
  let skipNextCount = 0;
  let skipPrevCount = 0;
  let modalClosed = false;

  const sampleTrack = {
    id: 'swipe_track_1',
    title: 'Smells Like Teen Spirit',
    artist: 'Nirvana',
    artwork: 'https://example.com/curr.jpg',
    duration: 278,
  };
  const prevTrack = {
    id: 'swipe_track_0',
    title: 'Come As You Are',
    artist: 'Nirvana',
    artwork: 'https://example.com/prev.jpg',
    duration: 219,
  };
  const nextTrack = {
    id: 'swipe_track_2',
    title: 'Lithium',
    artist: 'Nirvana',
    artwork: 'https://example.com/next.jpg',
    duration: 257,
  };

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {
          modalClosed = true;
        },
        track: sampleTrack,
        previousTrack: prevTrack,
        queue: [nextTrack],
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {
          skipNextCount += 1;
        },
        onSkipPrevious: () => {
          skipPrevCount += 1;
        },
      })
    );
  });

  const modalRoot = modalTree.root;
  const horizontalPan = modalRoot.findByProps({ testID: 'player-horizontal-pan' });
  const scrubberPan = modalRoot.findByProps({ testID: 'player-scrubber-pan' });

  assert.strictEqual(horizontalPan.props.enabled, true, 'Horizontal swipe PanGestureHandler must be enabled');
  assert.ok(horizontalPan.props.waitFor, 'Horizontal swipe must waitFor scrubber PanGestureHandler');

  // Adjacent track artworks are rendered for Spotify-style horizontal carousel transition
  const images = modalRoot.findAllByType('Image');
  assert.ok(images.some((img) => img.props.source?.uri === prevTrack.artwork), 'Previous cover preview should render');
  assert.ok(images.some((img) => img.props.source?.uri === nextTrack.artwork), 'Next cover preview should render');

  // Swipe left beyond threshold triggers onSkipNext and keeps carousel shifted until track prop updates
  await actAsync(async () => {
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.BEGAN, oldState: GestureState.UNDETERMINED, translationX: 0, velocityX: 0 },
    });
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.ACTIVE, oldState: GestureState.BEGAN, translationX: -95, velocityX: -600 },
    });
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.END, oldState: GestureState.ACTIVE, translationX: -95, velocityX: -600 },
    });
  });
  assert.strictEqual(skipNextCount, 1, 'Swiping left should call onSkipNext');
  assert.strictEqual(skipPrevCount, 0);
  assert.strictEqual(modalClosed, false);

  const mainArtworkBeforePropUpdate = modalRoot.findByProps({
    accessibilityLabel: `Capa do álbum de ${sampleTrack.title}`,
  });
  assert.strictEqual(mainArtworkBeforePropUpdate.props.fadeDuration, 0, 'Cover image must disable Android fade-in');

  // Animated container holding main artwork must NOT snap back to 0 before `track` updates (prevents flicker)
  const animatedArtworkContainers = modalRoot.findAll(
    (n) =>
      n.props &&
      Array.isArray(n.props.style) &&
      n.props.style.some((s) => s && Array.isArray(s.transform) && s.transform.some((t) => t && t.translateX))
  );
  const swipeAnimatedNode = animatedArtworkContainers[animatedArtworkContainers.length - 1];
  const translateXEntry = swipeAnimatedNode.props.style
    .flatMap((s) => (s && Array.isArray(s.transform) ? s.transform : []))
    .find((t) => t && t.translateX);
  assert.ok(
    translateXEntry.translateX._value < 0,
    'swipeTranslateX must hold at exitX until the new track prop commits'
  );

  // Updating `track` prop to nextTrack resets swipeTranslateX synchronously
  await actAsync(async () => {
    modalTree.update(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {
          modalClosed = true;
        },
        track: nextTrack,
        previousTrack: sampleTrack,
        queue: [],
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {
          skipNextCount += 1;
        },
        onSkipPrevious: () => {
          skipPrevCount += 1;
        },
      })
    );
  });
  assert.strictEqual(
    translateXEntry.translateX._value,
    0,
    'swipeTranslateX must reset to 0 synchronously once the new track arrives'
  );

  // Swiping left when queue is empty springs back without firing onSkipNext
  await actAsync(async () => {
    modalRoot.findByProps({ testID: 'player-horizontal-pan' }).props.onHandlerStateChange({
      nativeEvent: { state: GestureState.END, oldState: GestureState.ACTIVE, translationX: -95, velocityX: -600 },
    });
  });
  assert.strictEqual(skipNextCount, 1, 'Swiping left at end of queue must not call onSkipNext');

  // Swipe right beyond threshold triggers onSkipPrevious
  await actAsync(async () => {
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.BEGAN, oldState: GestureState.UNDETERMINED, translationX: 0, velocityX: 0 },
    });
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.ACTIVE, oldState: GestureState.BEGAN, translationX: 95, velocityX: 600 },
    });
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.END, oldState: GestureState.ACTIVE, translationX: 95, velocityX: 600 },
    });
  });
  assert.strictEqual(skipPrevCount, 1, 'Swiping right should call onSkipPrevious');
  assert.strictEqual(modalClosed, false);

  // Small horizontal drag below threshold snaps back without skipping
  await actAsync(async () => {
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.ACTIVE, oldState: GestureState.BEGAN, translationX: -35, velocityX: -100 },
    });
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.END, oldState: GestureState.ACTIVE, translationX: -35, velocityX: -100 },
    });
  });
  assert.strictEqual(skipNextCount, 1, 'Short horizontal drag must not skip next');
  assert.strictEqual(skipPrevCount, 1, 'Short horizontal drag must not skip previous');

  // While scrubbing the progress bar, horizontalPan disables cleanly
  await actAsync(async () => {
    scrubberPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.BEGAN, oldState: GestureState.UNDETERMINED, absoluteX: 120, x: 96 },
    });
  });
  assert.strictEqual(
    modalRoot.findByProps({ testID: 'player-horizontal-pan' }).props.enabled,
    false,
    'Active scrubber drag must disable horizontal track swipe'
  );
  await actAsync(async () => {
    scrubberPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.CANCELLED, oldState: GestureState.BEGAN, absoluteX: 120, x: 96 },
    });
  });
});

test('Flow 3: Selecting a new song preserves user-queued upcoming tracks without re-randomizing, and only auto-populates when upcoming queue is empty', async () => {
  const origGetTrackRadio = api.getTrackRadio;
  const origGetRelatedTracks = api.getRelatedTracks;
  let radioCalls = 0;

  try {
    api.searchTracks = async () => [
      {
        id: 'song_1',
        title: 'First Song',
        artist: 'Artist 1',
        duration: 200,
        formattedDuration: '3:20',
        thumbnailUrl: 'https://example.com/1.jpg',
      },
      {
        id: 'song_2',
        title: 'Second Chosen Song',
        artist: 'Artist 2',
        duration: 210,
        formattedDuration: '3:30',
        thumbnailUrl: 'https://example.com/2.jpg',
      },
    ];
    api.getTrackRadio = async () => {
      radioCalls += 1;
      return {
        seedId: 'seed',
        title: 'Radio Mix',
        tracks: [
          {
            id: 'radio_1',
            title: 'Random Radio Track',
            artist: 'Radio Artist',
            duration: 180,
            formattedDuration: '3:00',
            thumbnailUrl: 'https://example.com/r1.jpg',
          },
        ],
      };
    };
    api.getRelatedTracks = async () => [];

    let tree;
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    // 1. Play standalone initial track with empty queue (Radio seeds upcoming because queue had nothing)
    await actAsync(async () => {
      findInputByPlaceholder(root, 'Buscar faixas').props.onChangeText('test');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });

    // Click 'Second Chosen Song' (last item in results so no next search item -> radio fills empty sequence)
    const secondCard = root.findAll(
      (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Second Chosen Song')
    )[0];
    await actAsync(async () => {
      secondCard.props.onPress();
    });
    assert.strictEqual(radioCalls, 1, 'Radio should populate only when there are no upcoming tracks');
    assert.strictEqual(mockPlayer.getActiveTrack().id, 'song_2');

    // 2. Replace upcoming queue cleanly with two manually queued tracks (simulating user adding U1, U2)
    await mockPlayer.removeUpcomingTracks();
    await mockPlayer.add([
      { id: 'queued_u1', url: 'https://stream.example.com/u1.mp4', title: 'Manual Queue 1', artist: 'User' },
      { id: 'queued_u2', url: 'https://stream.example.com/u2.mp4', title: 'Manual Queue 2', artist: 'User' },
    ]);

    // 3. Now user chooses a DIFFERENT song ('First Song') from search results!
    const firstCard = root.findAll(
      (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('First Song')
    )[0];
    await actAsync(async () => {
      firstCard.props.onPress();
    });

    // Active track switches to 'song_1', radio must NOT re-trigger, and Manual Queue 1 & 2 stay intact!
    assert.strictEqual(mockPlayer.getActiveTrack().id, 'song_1');
    assert.strictEqual(radioCalls, 1, 'Radio must NOT run when upcoming tracks already exist in queue');
    const qAfterSwitch = await mockPlayer.getQueue();
    const activeIdx = await mockPlayer.getActiveTrackIndex();
    assert.deepStrictEqual(
      qAfterSwitch.slice(activeIdx + 1).map((t) => t.id),
      ['queued_u1', 'queued_u2'],
      'User-queued upcoming tracks must remain preserved in order after choosing a new song'
    );
  } finally {
    api.getTrackRadio = origGetTrackRadio;
    api.getRelatedTracks = origGetRelatedTracks;
  }
});

test('Flow 3: Selecting a track inside an open playlist resets previous queue and builds full upcoming playlist order', async () => {
  const pl = await createPlaylist('Minha Playlist Rock');
  const plTracks = [
    { id: 'pl_1', title: 'Track One', artist: 'Band', duration: 180, thumbnailUrl: '' },
    { id: 'pl_2', title: 'Track Two', artist: 'Band', duration: 190, thumbnailUrl: '' },
    { id: 'pl_3', title: 'Track Three', artist: 'Band', duration: 200, thumbnailUrl: '' },
    { id: 'pl_4', title: 'Track Four', artist: 'Band', duration: 210, thumbnailUrl: '' },
    { id: 'pl_5', title: 'Track Five', artist: 'Band', duration: 220, thumbnailUrl: '' },
  ];
  for (const t of plTracks) {
    await addTrackToPlaylist(pl.id, t);
  }

  // Simulate an existing active queue from another context before opening the playlist
  await mockPlayer.add([
    { id: 'old_active', url: 'https://stream.example.com/old_0.mp4', title: 'Old Active', artist: 'Old' },
    { id: 'old_queued', url: 'https://stream.example.com/old_1.mp4', title: 'Old Queued', artist: 'Old' },
  ]);
  await mockPlayer.play();

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  // Navigate to Playlists tab and open 'Minha Playlist Rock'
  const playlistsTabBtn = findButtonByText(root, 'Playlists');
  assert.ok(playlistsTabBtn, 'Playlists tab button must exist');
  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });

  const plCard = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Minha Playlist Rock')
  )[0];
  assert.ok(plCard, 'Created playlist card must exist');
  await actAsync(async () => {
    plCard.props.onPress();
  });

  // Select the 2nd track ('Track Two') inside the open playlist
  const trackTwoRow = root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props.accessibilityLabel === 'Tocar Track Two de Band'
  );
  assert.ok(trackTwoRow, 'Playlist track row for Track Two must exist');
  await actAsync(async () => {
    trackTwoRow.props.onPress();
  });

  const queue = await mockPlayer.getQueue();
  const activeIdx = await mockPlayer.getActiveTrackIndex();
  assert.strictEqual(activeIdx, 0, 'Playlist selection must reset active queue index to 0');
  assert.deepStrictEqual(
    queue.map((t) => t.id),
    ['pl_2', 'pl_3', 'pl_4', 'pl_5'],
    'Queue must be rebuilt with the selected playlist track followed by all remaining playlist tracks in order'
  );
});

test('Flow 3: Swiping right in NowPlayingModal goes to previous track even after 3s, while SkipBack button rewinds', async () => {
  const { State: GestureState } = require('react-native-gesture-handler');
  await mockPlayer.add([
    { id: 't1', url: 'https://stream.example.com/t1.mp4', title: 'Track 1', artist: 'A1', duration: 200 },
    { id: 't2', url: 'https://stream.example.com/t2.mp4', title: 'Track 2', artist: 'A2', duration: 220 },
  ]);
  await mockPlayer.skip(1);
  await mockPlayer.play();
  mockPlayer.position = 45;

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  // Open NowPlayingModal by tapping the mini player
  const miniPlayerBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel && n.props.accessibilityLabel.includes('Expandir player')
  );
  assert.ok(miniPlayerBtn, 'Mini player expand button must exist');
  await actAsync(async () => {
    miniPlayerBtn.props.onPress();
  });

  // 1. Tapping the SkipBack button after 3s rewinds current track (t2) to 0
  const skipBackBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Faixa anterior'
  );
  await actAsync(async () => {
    skipBackBtn.props.onPress({});
  });
  assert.strictEqual(mockPlayer.getActiveTrack().id, 't2', 'SkipBack button > 3s must stay on current track');
  assert.strictEqual(mockPlayer.position, 0, 'SkipBack button > 3s must rewind current track to 0');

  // 2. Swiping right in NowPlayingModal after 3s goes straight to previous track (t1)
  mockPlayer.position = 45;
  const horizontalPan = root.findByProps({ testID: 'player-horizontal-pan' });
  await actAsync(async () => {
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.BEGAN, oldState: GestureState.UNDETERMINED, translationX: 0, velocityX: 0 },
    });
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.ACTIVE, oldState: GestureState.BEGAN, translationX: 95, velocityX: 600 },
    });
    horizontalPan.props.onHandlerStateChange({
      nativeEvent: { state: GestureState.END, oldState: GestureState.ACTIVE, translationX: 95, velocityX: 600 },
    });
  });

  assert.strictEqual(mockPlayer.getActiveTrack().id, 't1', 'Swiping right > 3s must go to previous track t1');
});

test('Flow 3: Selecting a search track with empty upcoming queue fills at least 5 random related tracks even with Repeat on', async () => {
  const origSearchTracks = api.searchTracks;
  const origGetTrackRadio = api.getTrackRadio;
  const origGetRelatedTracks = api.getRelatedTracks;

  try {
    api.searchTracks = async () => [
      { id: 's_1', title: 'Chosen Search Track', artist: 'Main Artist', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
      { id: 's_2', title: 'Other Search 2', artist: 'Other', duration: 210, formattedDuration: '3:30', thumbnailUrl: '' },
      { id: 's_3', title: 'Other Search 3', artist: 'Other', duration: 220, formattedDuration: '3:40', thumbnailUrl: '' },
    ];
    // Radio returns 3 related tracks (< 5), so getRelatedTracks must supplement to reach at least 5
    api.getTrackRadio = async () => ({
      seedId: 's_1',
      title: 'Mix',
      tracks: [
        { id: 'rel_1', title: 'Rel 1', artist: 'R1', duration: 180, formattedDuration: '3:00', thumbnailUrl: '' },
        { id: 'rel_2', title: 'Rel 2', artist: 'R2', duration: 185, formattedDuration: '3:05', thumbnailUrl: '' },
        { id: 'rel_3', title: 'Rel 3', artist: 'R3', duration: 190, formattedDuration: '3:10', thumbnailUrl: '' },
      ],
    });
    api.getRelatedTracks = async () => [
      { id: 'rel_4', title: 'Rel 4', artist: 'R4', duration: 195, formattedDuration: '3:15', thumbnailUrl: '' },
      { id: 'rel_5', title: 'Rel 5', artist: 'R5', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
      { id: 'rel_6', title: 'Rel 6', artist: 'R6', duration: 205, formattedDuration: '3:25', thumbnailUrl: '' },
    ];

    // Activate RepeatQueue before selecting the track
    await mockPlayer.setRepeatMode(RepeatMode.Queue);

    let tree;
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    await actAsync(async () => {
      findInputByPlaceholder(root, 'Buscar faixas').props.onChangeText('rock');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });

    const firstSearchCard = root.findAll(
      (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Chosen Search Track')
    )[0];
    await actAsync(async () => {
      firstSearchCard.props.onPress();
    });

    // Wait briefly for async recommendation stream preloads to enqueue
    await actAsync(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    const queue = await mockPlayer.getQueue();
    const activeIdx = await mockPlayer.getActiveTrackIndex();
    const upcomingIds = queue.slice(activeIdx + 1).map((t) => t.id);

    assert.ok(
      upcomingIds.length >= 5,
      `Expected at least 5 recommended upcoming tracks when queue is empty, got ${upcomingIds.length}`
    );
    assert.strictEqual(
      upcomingIds.some((id) => id === 's_2' || id === 's_3'),
      false,
      'Must queue related tracks instead of subsequent search results when upcoming queue is empty'
    );
    assert.strictEqual(
      upcomingIds.every((id) => id.startsWith('rel_')),
      true,
      'All auto-filled upcoming tracks must come from related recommendations'
    );
  } finally {
    api.searchTracks = origSearchTracks;
    api.getTrackRadio = origGetTrackRadio;
    api.getRelatedTracks = origGetRelatedTracks;
  }
});
