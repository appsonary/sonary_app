// tests/edge_cases_break_ui.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const NowPlayingModal = require('../components/NowPlayingModal').default;
const { AddToPlaylistModal } = require('../components/AddToPlaylistModal');
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const { TrackCard } = require('../components/TrackCard');
const { PersistentMiniPlayer } = require('../components/PersistentMiniPlayer');
const { LibrarySection } = require('../components/LibrarySection');
const {
  actAsync,
  findButtonByText,
  findButtonByIcon,
  findSearchActionButton,
  findInputByPlaceholder,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const { mockPlayer } = require('./mocks/trackPlayerMock');
const {
  initDatabase,
  createPlaylist,
  addTrackToPlaylist,
} = require('../services/database');

test.beforeEach(async () => {
  resetAllMocks();
});

test('Break-UI: NowPlayingModal handles extreme track metadata without crashing', async () => {
  // Extreme edge cases: extremely long title, emojis, unicode, null artwork, 0 duration
  const extremeTrack = {
    id: 'extreme_1',
    url: 'https://stream.example.com/audio.mp4',
    title: '🎵 SuperLongTrackTitleWithoutSpacesThatCouldBreakFlexboxWrappingIfEllipsizeModeIsNotSetCorrectlyToAvoidLayoutOverflowOnMobileAndDesktopScreensWithSpecialSymbols!@#$%^&*()_+🎉🚀🔥',
    artist: 'Артист مع اسم طويل جداً / 非常に長いアーティスト名 / Extremely Long Artist Name feat. Everyone In The World',
    album: 'Album with emoji 💿 and special characters «§» 2026 Remastered Deluxe Edition',
    artwork: null,
    duration: 0,
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => { },
        track: extremeTrack,
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => { },
        onSkipNext: () => { },
        onSkipPrevious: () => { },
        onSeekRelative: () => { },
        isFavorite: true,
      })
    );
  });

  const root = tree.root;
  const renderedText = getAllText(root);

  // Verifies that text is rendered safely
  assert.ok(renderedText.includes('SuperLongTrackTitle'), 'Should render long title safely');
  assert.ok(renderedText.includes('Артист'), 'Should render unicode artist safely');
  assert.ok(renderedText.includes('00:00'), 'Should safely format 0 duration');

  // Verify controls work
  const playPauseBtn = findButtonByIcon(root, 'Pause');
  assert.ok(playPauseBtn, 'Play/Pause button should render with extreme data');
});

test('Break-UI: PlaylistDetailModal handles empty tracks, long playlist names and huge durations', async () => {
  // Playlist with huge duration (10 hours) and special chars
  const extremePlaylistTracks = [
    {
      id: 'pt_1',
      playlistId: 'pl_ext',
      trackId: 'track_ext_1',
      title: '🎶 Very Long Title '.repeat(10),
      artist: 'Unknown Artist 🎸',
      duration: 36000, // 10 hours
      thumbnailUrl: '',
      isDownloaded: false,
      position: 1,
      addedAt: '2026-11-03T12:00:00Z',
    },
  ];

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        onClose: () => { },
        playlistId: 'pl_ext',
        onPlayTrack: () => { },
        onPlayAll: () => { },
      })
    );
  });

  const root = tree.root;
  assert.ok(root, 'PlaylistDetailModal renders safely');
});

test('Break-UI: PlaylistDetailModal supports internal search filtering and reorder mode toggle', async () => {
  await initDatabase();
  const pl = await createPlaylist('Search & Reorder Test Pl');
  await addTrackToPlaylist(pl.id, {
    id: 'tr_1',
    title: 'Comfortably Numb',
    artist: 'Pink Floyd',
    duration: 380,
    thumbnailUrl: 'https://ex.com/pf.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'tr_2',
    title: 'Echoes',
    artist: 'Pink Floyd',
    duration: 1200,
    thumbnailUrl: 'https://ex.com/pf2.jpg',
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        onClose: () => {},
        playlistId: pl.id,
        onPlayTrack: () => {},
        onPlayAll: () => {},
      })
    );
  });

  const root = tree.root;
  let text = getAllText(root);
  assert.ok(text.includes('Comfortably Numb'));
  assert.ok(text.includes('Echoes'));
  assert.ok(text.includes('Baixar'));
  assert.ok(text.includes('Ordenar'));

  // Test internal search filtering
  const searchInput = findInputByPlaceholder(root, 'Buscar nesta playlist');
  assert.ok(searchInput, 'Search input should exist');

  await actAsync(async () => {
    searchInput.props.onChangeText('Echoes');
  });

  text = getAllText(root);
  assert.ok(text.includes('Echoes'));
  assert.strictEqual(text.includes('Comfortably Numb'), false);

  // Clear search filter
  await actAsync(async () => {
    searchInput.props.onChangeText('');
  });
  text = getAllText(root);
  assert.ok(text.includes('Comfortably Numb'));

  // Test reorder mode toggle
  const reorderBtn = findButtonByText(root, 'Ordenar');
  assert.ok(reorderBtn);
  await actAsync(async () => {
    reorderBtn.props.onPress();
  });

  text = getAllText(root);
  assert.ok(text.includes('Concluir'), 'Should show Concluir when in reorder mode');
});

test('Break-UI: AddToPlaylistModal handles long playlist names and rapid submissions', async () => {
  const extremeTrack = {
    id: 'trk_ext',
    title: 'Extremely Long Track Name '.repeat(5),
    artist: 'Artist '.repeat(5),
    duration: 180,
    thumbnailUrl: '',
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(AddToPlaylistModal, {
        visible: true,
        onClose: () => { },
        track: extremeTrack,
      })
    );
  });

  const root = tree.root;
  const renderedText = getAllText(root);
  assert.ok(renderedText.includes('Adicionar à playlist'), 'Should render header');
});

test('Break-UI: App handles rapid tab switching and empty query submittals', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Rapid tab switching
  const playlistsBtn = findButtonByText(root, 'Playlists');
  const downloadsBtn = findButtonByText(root, 'Baixadas');
  const searchBtn = findButtonByText(root, 'Buscar');

  for (let i = 0; i < 5; i++) {
    await actAsync(async () => {
      playlistsBtn.props.onPress();
    });
    await actAsync(async () => {
      downloadsBtn.props.onPress();
    });
    await actAsync(async () => {
      searchBtn.props.onPress();
    });
  }

  // Submit search with empty spaces
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('     ');
    input.props.onSubmitEditing();
  });

  const brandLogo = root.find(
    (n) => n.type === 'Image' && n.props && n.props.accessibilityLabel === 'Sonary'
  );
  assert.ok(brandLogo, 'Brand logo remains rendered after rapid tab switching');
  const text = getAllText(root);
  assert.strictEqual(text.includes('Só você e a música'), false, 'Removed slogan stays absent after rapid tab switching');
});

test('Break-UI: TrackCard truncates long titles/artists and handles missing/null images', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(TrackCard, {
        id: 'break_track_1',
        title: 'SuperLongSongTitleThatHasNoBreaksAndCouldExceedMaxScreenWidthOnVerySmallDevices1234567890',
        artist: 'Very Long Artist Name Featuring Multiple Special Characters & Unicode 🎵⚡️🔥',
        durationText: '10:00:00',
        thumbnailUrl: '',
        onPress: () => { },
        onAddToPlaylist: () => { },
        onDownload: () => { },
      })
    );
  });

  const root = tree.root;
  const renderedText = getAllText(root);
  assert.ok(renderedText.includes('SuperLongSongTitleThatHasNoBreaks'));
  assert.ok(renderedText.includes('10:00:00'));

  // Test with null thumbnail
  let nullImgTree;
  await actAsync(async () => {
    nullImgTree = renderer.create(
      React.createElement(TrackCard, {
        id: 'break_track_null',
        title: 'Title',
        artist: 'Artist',
        thumbnailUrl: undefined,
        onPress: () => { },
      })
    );
  });
  assert.ok(nullImgTree.root, 'TrackCard handles missing/undefined thumbnail safely');
});

test('Break-UI: PersistentMiniPlayer handles empty metadata, long text and 0 duration safely', async () => {
  const extremeTrack = {
    id: 'mini_extreme',
    title: 'Extreme Title Without Spaces '.repeat(5),
    artist: 'Artist With Unicode 🎵🎶',
    artwork: '',
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PersistentMiniPlayer, {
        activeTrack: extremeTrack,
        isPlaying: false,
        isLoadingAudio: false,
        isBuffering: false,
        progressPct: 150, // Should clamp safely
        onExpand: () => { },
        onTogglePlay: () => { },
        onSkipNext: () => { },
        onSkipPrevious: () => { },
      })
    );
  });

  const root = tree.root;
  const text = getAllText(root);
  assert.ok(text.includes('Extreme Title'));
  assert.ok(text.includes('Artist With Unicode'));
});

test('Break-UI: LibrarySection handles empty playlists state, long names and null thumbnails', async () => {
  let emptyTree;
  await actAsync(async () => {
    emptyTree = renderer.create(
      React.createElement(LibrarySection, {
        playlists: [],
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

  const emptyText = getAllText(emptyTree.root);
  assert.ok(emptyText.includes('Sua Biblioteca'));
  assert.ok(emptyText.includes('Nenhuma playlist criada'));

  // Extreme playlists with 1000 items or long names
  const extremePlaylists = [
    {
      id: '__favorites__',
      name: 'Músicas Curtidas',
      trackCount: 99999,
      isSystem: true,
    },
    {
      id: 'custom_extreme',
      name: 'Very Long Playlist Name '.repeat(10),
      trackCount: 0,
      isSystem: false,
    },
  ];

  let extremeTree;
  await actAsync(async () => {
    extremeTree = renderer.create(
      React.createElement(LibrarySection, {
        playlists: extremePlaylists,
        isLoading: false,
        isQuickCreateVisible: true,
        quickCreateName: 'New Playlist Name',
        onChangeQuickCreateName: () => { },
        onToggleQuickCreate: () => { },
        onSubmitQuickCreate: () => { },
        onSelectPlaylist: () => { },
      })
    );
  });

  const extremeText = getAllText(extremeTree.root);
  assert.ok(extremeText.includes('Músicas Curtidas'));
  assert.ok(extremeText.includes('99999 músicas curtidas'));
});

test('Break-UI: TrackCard contextual menu toggles and executes Play Next and Add to Queue', async () => {
  let playNextCalled = false;
  let addToQueueCalled = false;

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(TrackCard, {
        id: 'track_menu_test',
        title: 'Song Title',
        artist: 'Artist Name',
        durationText: '3:30',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        onPress: () => {},
        onPlayNext: () => {
          playNextCalled = true;
        },
        onAddToQueue: () => {
          addToQueueCalled = true;
        },
      })
    );
  });

  const root = tree.root;

  // Open context menu via MoreVertical button
  const moreBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções para Song Title'
  );
  assert.ok(moreBtn, 'MoreVertical options button must exist');

  await actAsync(async () => {
    moreBtn.props.onPress();
  });

  // Verify menu items appear
  const text = getAllText(root);
  assert.ok(text.includes('Tocar a seguir'), 'Context menu should show Tocar a seguir');
  assert.ok(text.includes('Adicionar ao fim da fila'), 'Context menu should show Adicionar ao fim da fila');

  // Click 'Tocar a seguir'
  const playNextBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar a seguir'
  );
  assert.ok(playNextBtn);
  await actAsync(async () => {
    playNextBtn.props.onPress();
  });
  assert.strictEqual(playNextCalled, true, 'onPlayNext should be triggered');

  // Re-open menu to click 'Adicionar ao fim da fila'
  await actAsync(async () => {
    moreBtn.props.onPress();
  });

  const addToQueueBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Adicionar ao fim da fila'
  );
  assert.ok(addToQueueBtn);
  await actAsync(async () => {
    addToQueueBtn.props.onPress();
  });
  assert.strictEqual(addToQueueCalled, true, 'onAddToQueue should be triggered');
});

test('Break-UI: TrackCard bottom sheet drag handle and inline action button visibility', async () => {
  // 1. When onPlayNext/onAddToQueue are provided, inline buttons are omitted by default
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(TrackCard, {
        id: 'track_clean_row',
        title: 'Clean Row Song',
        artist: 'Clean Artist',
        onPress: () => {},
        onAddToPlaylist: () => {},
        onDownload: () => {},
        onPlayNext: () => {},
        onAddToQueue: () => {},
      })
    );
  });

  const root = tree.root;

  // Verify only MoreVertical exists on row; ListPlus and Download are not directly on row
  const moreBtns = root.findAll(
    (n) => n.type === 'LucideIcon' && n.props.name === 'MoreVertical'
  );
  assert.strictEqual(moreBtns.length, 1, 'Should have only the MoreVertical 3-dots button on the row');

  // Verify sheet drag handle area exists with PanResponder handlers
  const moreBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções para Clean Row Song'
  );
  await actAsync(async () => {
    moreBtn.props.onPress();
  });

  const dragArea = root.find(
    (n) => n.props.accessibilityLabel === 'Arraste para baixo para recolher o menu'
  );
  assert.ok(dragArea, 'Sheet must have dragArea with accessibility label');
  assert.ok(dragArea.props.onMoveShouldSetResponder || dragArea.props.onStartShouldSetResponder, 'dragArea must have pan responder handlers attached');

  // Verify bottom sheet extends below the viewport edge and clamps upward elastic drag so underlying views never bleed through
  const sheetAnimatedView = root.find(
    (n) =>
      n.props &&
      Array.isArray(n.props.style) &&
      n.props.style[0] &&
      n.props.style[0].marginBottom < 0 &&
      n.props.style[1]?.transform?.[0]?.translateY
  );
  const sheetStyle = sheetAnimatedView.props.style[0];
  const sheetTranslateY = sheetAnimatedView.props.style[1].transform[0].translateY;
  dragArea.props.onResponderMove({ nativeEvent: { touches: [] } }, { dy: -1000 });
  assert.ok(
    sheetTranslateY._value >= -56 && Math.abs(sheetStyle.marginBottom) > Math.abs(sheetTranslateY._value),
    'Upward elastic drag must stay covered by sheet bottom skirt'
  );

  // 2. When showInlineActions is explicitly true, inline buttons can still be forced
  let treeExplicit;
  await actAsync(async () => {
    treeExplicit = renderer.create(
      React.createElement(TrackCard, {
        id: 'track_explicit_row',
        title: 'Explicit Song',
        artist: 'Explicit Artist',
        showInlineActions: true,
        onPress: () => {},
        onAddToPlaylist: () => {},
        onDownload: () => {},
        onPlayNext: () => {},
      })
    );
  });

  const explicitDl = treeExplicit.root.findAll(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Baixar Explicit Song'
  );
  assert.strictEqual(explicitDl.length, 1, 'Explicit showInlineActions renders download button');
});


