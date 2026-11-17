// tests/android_back_navigation.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const NowPlayingModal = require('../components/NowPlayingModal').default;
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const { AddToPlaylistModal } = require('../components/AddToPlaylistModal');
const { SearchBarSection } = require('../components/SearchBarSection');
const { LibrarySection } = require('../components/LibrarySection');
const {
  BACK_PRIORITY,
  useBackHandler,
} = require('../services/backNavigation');
const {
  initDatabase,
  createPlaylist,
  addTrackToPlaylist,
  saveDownloadedTrack,
} = require('../services/database');
const api = require('../services/api');
const {
  Animated,
  BackHandler,
  Dimensions,
  Keyboard,
  Linking,
} = require('./mocks/reactNativeMock');
const {
  actAsync,
  findButtonByText,
  findInputByPlaceholder,
  findSearchActionButton,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test('BackNavigation: Priority tiers and LIFO ordering run highest priority first', async () => {
  const order = [];
  function Harness() {
    useBackHandler(true, () => {
      order.push('tab');
      return true;
    }, BACK_PRIORITY.TAB_HISTORY);
    useBackHandler(true, () => {
      order.push('overlay-1');
      return false; // allow fallthrough
    }, BACK_PRIORITY.INLINE_OVERLAY);
    useBackHandler(true, () => {
      order.push('subscreen');
      return true;
    }, BACK_PRIORITY.SUBSCREEN);
    useBackHandler(true, () => {
      order.push('overlay-2');
      return false; // latest in same priority runs first
    }, BACK_PRIORITY.INLINE_OVERLAY);
    return null;
  }

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(Harness));
  });

  const handled = BackHandler.__emitHardwareBackPress();
  assert.strictEqual(handled, true);
  assert.deepStrictEqual(order, ['overlay-2', 'overlay-1', 'subscreen']);

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: Multi-tab + PlaylistDetailModal history walks back in order and requires double-back to exit at root', async () => {
  const pl = await createPlaylist('Minha Vibe');
  await addTrackToPlaylist(pl.id, {
    id: 'trk-1',
    title: 'Midnight Track',
    artist: 'Sonary Artist',
    duration: 210,
    thumbnailUrl: 'https://example.com/art.jpg',
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  // 1. search -> playlists -> downloads
  await actAsync(async () => {
    findButtonByText(root, 'Playlists').props.onPress();
  });
  assert.ok(getAllText(root).includes('Sua Biblioteca'));

  // Open quick create inline box on playlists tab, press Back -> should close box only
  const novaBtn = findButtonByText(root, 'Nova');
  await actAsync(async () => {
    novaBtn.props.onPress();
  });
  assert.ok(findInputByPlaceholder(root, 'Nome da nova playlist...'));

  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.strictEqual(findInputByPlaceholder(root, 'Nome da nova playlist...'), null);
  assert.ok(getAllText(root).includes('Sua Biblioteca'), 'Must stay on Playlists tab after closing quick-create');

  // Navigate to downloads tab
  await actAsync(async () => {
    findButtonByText(root, 'Baixadas').props.onPress();
  });
  assert.ok(getAllText(root).includes('Nenhuma música baixada'));

  // Back from downloads -> playlists
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('Sua Biblioteca'));

  // Open playlist detail from playlists tab
  const plBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir playlist Minha Vibe'
  );
  await actAsync(async () => {
    plBtn.props.onPress();
  });
  assert.ok(getAllText(root).includes('Midnight Track'), 'PlaylistDetailModal should be visible');

  // Back inside PlaylistDetailModal -> returns to playlists tab (NOT home screen)
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('Sua Biblioteca'), 'Back from playlist must return to Playlists tab');

  // Back from playlists -> returns to search root
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('O que você quer ouvir?'), 'Back from Playlists must return to Search root');

  // First Back at root search -> consumes press and shows exit toast
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('Pressione voltar novamente para sair'));

  // Second Back within 2s at root search -> returns false (allows Android to background app)
  let secondResult;
  await actAsync(async () => {
    secondResult = BackHandler.__emitHardwareBackPress();
  });
  assert.strictEqual(secondResult, false);

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: PlaylistDetailModal exits reorder mode and clears internal search before closing', async () => {
  const pl = await createPlaylist('Focus');
  await addTrackToPlaylist(pl.id, {
    id: 't1',
    title: 'Alpha Song',
    artist: 'Artist A',
    duration: 180,
    thumbnailUrl: '',
  });
  await addTrackToPlaylist(pl.id, {
    id: 't2',
    title: 'Beta Song',
    artist: 'Artist B',
    duration: 200,
    thumbnailUrl: '',
  });

  let closed = false;
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        onClose: () => {
          closed = true;
        },
        onPlayTrack: () => {},
        onPlayAll: () => {},
      })
    );
  });
  const root = tree.root;

  // Enable reorder mode and type internal search query
  const reorderBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Modo reordenar faixas'
  );
  await actAsync(async () => {
    reorderBtn.props.onPress();
  });
  const searchInput = findInputByPlaceholder(root, 'Buscar nesta playlist...');
  await actAsync(async () => {
    searchInput.props.onChangeText('Alpha');
  });
  assert.ok(getAllText(root).includes('Concluir'));
  assert.strictEqual(findInputByPlaceholder(root, 'Buscar nesta playlist...').props.value, 'Alpha');

  // 1st Back -> exits reorder mode
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('Ordenar'));
  assert.strictEqual(closed, false);

  // 2nd Back -> clears internal playlist search
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.strictEqual(findInputByPlaceholder(root, 'Buscar nesta playlist...').props.value, '');
  assert.strictEqual(closed, false);

  // 3rd Back -> closes PlaylistDetailModal
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.strictEqual(closed, true);

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: SearchBarSection closes recent suggestions on Back/keyboardDidHide and clears results to Discovery', async () => {
  let cleared = false;
  function SearchHarness() {
    const [q, setQ] = React.useState('lofi');
    const [hasResults, setHasResults] = React.useState(true);
    return React.createElement(SearchBarSection, {
      query: q,
      onChangeQuery: setQ,
      onSearch: () => setHasResults(true),
      isSearching: false,
      recentQueries: ['lofi beats', 'jazz'],
      hasResults,
      onClearSearch: () => {
        cleared = true;
        setHasResults(false);
        setQ('');
      },
    });
  }

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(SearchHarness));
  });
  const root = tree.root;

  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onFocus();
  });
  assert.ok(root.findByProps({ testID: 'search-history-list' }));

  // 1st Back closes suggestions dropdown without clearing results yet
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.strictEqual(root.findAllByProps({ testID: 'search-history-list' }).length, 0);
  assert.strictEqual(cleared, false);

  // Refocus and test keyboardDidHide sync
  await actAsync(async () => {
    input.props.onFocus();
  });
  assert.ok(root.findByProps({ testID: 'search-history-list' }));
  await actAsync(async () => {
    Keyboard.__emit('keyboardDidHide');
  });
  assert.strictEqual(root.findAllByProps({ testID: 'search-history-list' }).length, 0);

  // Next Back clears search results back to Discovery Hub
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.strictEqual(cleared, true);

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: NowPlayingModal onRequestClose closes context menu, queue edit, queue sheet, lyrics expand before minimizing player', async () => {
  const originalLyrics = api.getTrackLyrics;
  const originalRelated = api.getRelatedTracks;
  const originalArtist = api.getArtistProfile;
  api.getTrackLyrics = async () => ({
    trackId: 't1',
    type: 'plain',
    lines: [{ time: 0, text: 'Line 1' }],
    plainText: 'Line 1',
    provider: 'lrclib',
    cachedAt: Date.now(),
  });
  api.getRelatedTracks = async () => [];
  api.getArtistProfile = async () => null;

  let closeCount = 0;
  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {
            closeCount += 1;
          },
          track: {
            id: 't1',
            url: 'https://example.com/a.m4a',
            title: 'Song One',
            artist: 'Artist One',
            duration: 200,
          },
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          queue: [
            { id: 'q1', url: 'u1', title: 'Queue Track 1', artist: 'Artist Q', duration: 150 },
          ],
          onMoveQueueTrack: () => {},
        })
      );
    });
    const root = tree.root;
    const modal = root.findAllByType('Modal')[0];

    // 1. Open 3-dots context menu -> onRequestClose closes menu, NOT player
    const moreBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções'
    );
    await actAsync(async () => {
      moreBtn.props.onPress();
    });
    assert.ok(getAllText(root).includes('Ver fila de reprodução'));

    await actAsync(async () => {
      modal.props.onRequestClose();
    });
    assert.strictEqual(closeCount, 0, 'Player must NOT close while context menu was open');
    assert.strictEqual(getAllText(root).includes('Ver fila de reprodução'), false);

    // 2. Open Queue sheet & enter Edit queue -> Back exits edit -> Back closes queue sheet -> Back closes player
    const filaBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fila'
    );
    await actAsync(async () => {
      filaBtn.props.onPress();
    });
    assert.ok(getAllText(root).includes('Queue Track 1'));

    const editQueueBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Editar fila'
    );
    await actAsync(async () => {
      editQueueBtn.props.onPress();
    });
    assert.ok(getAllText(root).includes('Concluído'));

    // Back exits queue edit mode
    await actAsync(async () => {
      modal.props.onRequestClose();
    });
    assert.strictEqual(closeCount, 0);
    assert.ok(getAllText(root).includes('Queue Track 1'), 'Queue sheet stays open when exiting edit mode');

    // Back closes queue sheet
    await actAsync(async () => {
      modal.props.onRequestClose();
    });
    assert.strictEqual(closeCount, 0, 'Player must NOT close while queue sheet was open');
    assert.strictEqual(getAllText(root).includes('Queue Track 1'), false);

    // 3. Expand lyrics -> Back collapses lyrics -> Back minimizes player
    const expandLyricsBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Expandir letras'
    );
    await actAsync(async () => {
      expandLyricsBtn.props.onPress();
    });
    assert.ok(
      root.findAll(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Recolher letras'
      ).length > 0
    );

    await actAsync(async () => {
      modal.props.onRequestClose();
    });
    assert.strictEqual(closeCount, 0, 'Player must collapse expanded lyrics before closing');

    await actAsync(async () => {
      modal.props.onRequestClose();
    });
    assert.strictEqual(closeCount, 1, 'Final Back minimizes NowPlayingModal');
  } finally {
    api.getTrackLyrics = originalLyrics;
    api.getRelatedTracks = originalRelated;
    api.getArtistProfile = originalArtist;
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
  }
});

test('BackNavigation: AddToPlaylistModal backs out of duplicate warning and inline creation before dismissing sheet', async () => {
  const pl = await createPlaylist('Existing');
  await addTrackToPlaylist(pl.id, {
    id: 'dup-1',
    title: 'Dup Track',
    artist: 'Artist',
    duration: 180,
    thumbnailUrl: '',
  });

  let closed = false;
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(AddToPlaylistModal, {
        visible: true,
        track: {
          id: 'dup-1',
          title: 'Dup Track',
          artist: 'Artist',
          duration: 180,
          thumbnailUrl: '',
        },
        onClose: () => {
          closed = true;
        },
      })
    );
  });
  const root = tree.root;
  const modal = root.findByType('Modal');

  // Trigger duplicate warning
  const plRow = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Adicionar à playlist Existing'
  );
  await actAsync(async () => {
    await plRow.props.onPress();
  });
  assert.ok(getAllText(root).includes('Música já adicionada'));

  // 1st Back clears duplicate warning
  await actAsync(async () => {
    modal.props.onRequestClose();
  });
  assert.strictEqual(getAllText(root).includes('Música já adicionada'), false);
  assert.strictEqual(closed, false);

  // Open inline creation form
  const newBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Criar nova playlist'
  );
  await actAsync(async () => {
    newBtn.props.onPress();
  });
  assert.ok(findInputByPlaceholder(root, 'Dê um nome para a sua playlist'));

  // 2nd Back closes inline creation form
  await actAsync(async () => {
    modal.props.onRequestClose();
  });
  assert.strictEqual(findInputByPlaceholder(root, 'Dê um nome para a sua playlist'), null);
  assert.strictEqual(closed, false);

  // 3rd Back dismisses sheet
  await actAsync(async () => {
    modal.props.onRequestClose();
  });
  assert.strictEqual(closed, true);

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: Opening Support via notification deep link returns to Search on Back instead of exiting', async () => {
  Linking.__setInitialUrl('com.sonarypro.app://support?nid=test-1');

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  assert.ok(getAllText(root).includes('Apoie o Sonary'), 'Deep link must open Support tab');

  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('O que você quer ouvir?'), 'Back from Support must return to Search root');

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: LibrarySection clears internal playlist filter on Back', async () => {
  const pl = await createPlaylist('Rock Classics');
  assert.ok(pl.id);

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(LibrarySection, {
        playlists: [pl],
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
  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar playlists...');
  await actAsync(async () => {
    input.props.onChangeText('Jazz');
  });
  assert.strictEqual(findInputByPlaceholder(root, 'Buscar playlists...').props.value, 'Jazz');

  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.strictEqual(findInputByPlaceholder(root, 'Buscar playlists...').props.value, '');

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: Downloads tab clears internal filter before returning to previous tab', async () => {
  const FileSystem = require('expo-file-system');
  const uri = `${FileSystem.documentDirectory}tracks/dl_back.m4a`;
  FileSystem.files.set(uri, { isDirectory: false, size: 1024 });
  await saveDownloadedTrack({
    id: 'dl_back',
    title: 'Back Track',
    artist: 'Offline Artist',
    duration: 180,
    thumbnailUrl: '',
    localUri: uri,
    downloadedAt: Date.now(),
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  await actAsync(async () => {
    findButtonByText(root, 'Baixadas').props.onPress();
  });

  const dlInput = findInputByPlaceholder(root, 'Buscar nas baixadas...');
  assert.ok(dlInput);
  await actAsync(async () => {
    dlInput.props.onChangeText('NoMatch');
  });
  assert.ok(getAllText(root).includes('Nenhuma faixa encontrada'));

  // 1st Back clears downloads filter, stays on Downloads
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.strictEqual(findInputByPlaceholder(root, 'Buscar nas baixadas...').props.value, '');
  assert.ok(getAllText(root).includes('Back Track'));

  // 2nd Back returns to Search root
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('O que você quer ouvir?'));

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: Deleting Playlist B after Playlist A -> B returns once to Playlist A and compacts history', async () => {
  const originalDimGet = Dimensions.get;
  Dimensions.get = () => ({ width: 1200, height: 900, scale: 2, fontScale: 1 });

  const plA = await createPlaylist('Playlist Alpha');
  const plB = await createPlaylist('Playlist Beta');
  await addTrackToPlaylist(plA.id, {
    id: 'a1',
    title: 'Alpha Song',
    artist: 'A',
    duration: 120,
    thumbnailUrl: '',
  });
  await addTrackToPlaylist(plB.id, {
    id: 'b1',
    title: 'Beta Song',
    artist: 'B',
    duration: 140,
    thumbnailUrl: '',
  });

  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    // Open Playlist A from Search sidebar, then jump directly to Playlist B
    const openA = root.findAll(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir playlist Playlist Alpha'
    )[0];
    await actAsync(async () => {
      openA.props.onPress();
    });
    assert.ok(getAllText(root).includes('Alpha Song'));

    const openB = root.findAll(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir playlist Playlist Beta'
    )[0];
    await actAsync(async () => {
      openB.props.onPress();
    });
    assert.ok(getAllText(root).includes('Beta Song'));

    // Delete Playlist B via Options -> Excluir playlist (Alert auto-confirms in mock)
    const optionsBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções da playlist'
    );
    await actAsync(async () => {
      optionsBtn.props.onPress();
    });
    const deleteBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Excluir playlist'
    );
    await actAsync(async () => {
      await deleteBtn.props.onPress();
    });

    // Must return to Playlist A (NOT skip past it back to Search!)
    assert.ok(getAllText(root).includes('Alpha Song'), 'Deleting Playlist B must land on Playlist A');

    // Next Back leaves Playlist A -> returns to Search root
    await actAsync(async () => {
      assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
    });
    assert.ok(getAllText(root).includes('O que você quer ouvir?'));
  } finally {
    Dimensions.get = originalDimGet;
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
  }
});

test('BackNavigation: Double-back exit expires after 2000ms and resets on forward navigation', async () => {
  const originalNow = Date.now;
  let fakeNow = 10_000;
  Date.now = () => fakeNow;

  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    // 1st Back at root -> toast shown
    await actAsync(async () => {
      assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
    });
    assert.ok(getAllText(root).includes('Pressione voltar novamente para sair'));

    // Advance clock past 2000ms -> 2nd Back must NOT exit, re-arms prompt
    fakeNow += 2100;
    await actAsync(async () => {
      assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
    });
    assert.ok(getAllText(root).includes('Pressione voltar novamente para sair'));

    // Navigate forward to Playlists and back within < 2000ms -> exit timer was reset
    fakeNow += 500;
    await actAsync(async () => {
      findButtonByText(root, 'Playlists').props.onPress();
    });
    await actAsync(async () => {
      assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
    });
    // Now back at Search root; next Back must prompt again instead of exiting immediately
    await actAsync(async () => {
      assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
    });
    assert.ok(getAllText(root).includes('Pressione voltar novamente para sair'));

    // Within 2000ms -> exits (returns false)
    fakeNow += 500;
    let exitResult;
    await actAsync(async () => {
      exitResult = BackHandler.__emitHardwareBackPress();
    });
    assert.strictEqual(exitResult, false);
  } finally {
    Date.now = originalNow;
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
  }
});

test('BackNavigation: Pressing Back during openPlaylistDetail fade-out cancels open without corrupting history', async () => {
  const pl = await createPlaylist('Async Race PL');
  await addTrackToPlaylist(pl.id, {
    id: 'r1',
    title: 'Race Track',
    artist: 'Artist',
    duration: 180,
    thumbnailUrl: '',
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  await actAsync(async () => {
    findButtonByText(root, 'Playlists').props.onPress();
  });

  // Intercept Animated.timing once to hold shellOpacity transition mid-flight
  const originalTiming = Animated.timing;
  let heldFinishCb = null;
  let intercepted = false;
  Animated.timing = (val, config) => {
    if (!intercepted && config && config.toValue === 0) {
      intercepted = true;
      return {
        start: (cb) => {
          heldFinishCb = cb;
        },
        stop: () => {
          heldFinishCb = null;
        },
      };
    }
    return originalTiming(val, config);
  };

  try {
    const plBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir playlist Async Race PL'
    );
    await actAsync(async () => {
      plBtn.props.onPress();
    });
    // Still mid-fade: PlaylistDetailModal has NOT opened yet
    assert.strictEqual(getAllText(root).includes('Race Track'), false);

    // Press Back during the 30ms fade-out -> cancels pending open, stays on Playlists
    await actAsync(async () => {
      assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
    });
    assert.ok(getAllText(root).includes('Sua Biblioteca'));
    assert.strictEqual(heldFinishCb, null, 'Pending fade callback must be stopped/cleared');

    // Next Back must return to Search (proving history was NOT corrupted)
    await actAsync(async () => {
      assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
    });
    assert.ok(getAllText(root).includes('O que você quer ouvir?'));
  } finally {
    Animated.timing = originalTiming;
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
  }
});

test('BackNavigation: Modal lock shields underlying BackHandlers and recovers if NowPlaying activeTrack is cleared', async () => {
  const FileSystem = require('expo-file-system');
  const uri = `${FileSystem.documentDirectory}tracks/active_del.m4a`;
  FileSystem.files.set(uri, { isDirectory: false, size: 1024 });
  await saveDownloadedTrack({
    id: 'active_del',
    title: 'Active Offline',
    artist: 'Offline Artist',
    duration: 200,
    thumbnailUrl: '',
    localUri: uri,
    downloadedAt: Date.now(),
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  await actAsync(async () => {
    findButtonByText(root, 'Baixadas').props.onPress();
  });
  const dlInput = findInputByPlaceholder(root, 'Buscar nas baixadas...');
  await actAsync(async () => {
    dlInput.props.onChangeText('Active');
  });

  // Play track -> expand NowPlayingModal
  const trackRow = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar Active Offline de Offline Artist'
  );
  await actAsync(async () => {
    await trackRow.props.onPress();
  });
  const miniPlayer = root.find(
    (n) => n.type === 'TouchableOpacity' && String(n.props.accessibilityLabel || '').includes('Toque para expandir player')
  );
  await actAsync(async () => {
    miniPlayer.props.onPress();
  });
  assert.ok(root.findAllByProps({ testID: 'now-playing-modal-content' }).length > 0);

  // While NowPlayingModal is open, BackHandler.__emitHardwareBackPress must NOT clear downloads filter or change tab
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), false);
  });
  assert.strictEqual(findInputByPlaceholder(root, 'Buscar nas baixadas...').props.value, 'Active');

  // Close NowPlayingModal via its Modal.onRequestClose
  const npModal = root.findAllByType('Modal').find((m) => m.props.onRequestClose);
  await actAsync(async () => {
    npModal.props.onRequestClose();
  });
  assert.strictEqual(root.findAllByProps({ testID: 'now-playing-modal-content' }).length, 0);

  // Re-open NowPlayingModal, then delete the active offline track via TrackCard menu (clears activeTrack via resetPlayer)
  await actAsync(async () => {
    miniPlayer.props.onPress();
  });
  assert.ok(root.findAllByProps({ testID: 'now-playing-modal-content' }).length > 0);

  const trackMoreBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções para Active Offline'
  );
  await actAsync(async () => {
    trackMoreBtn.props.onPress();
  });
  const deleteOfflineBtn = root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Remover dos baixados'
  );
  await actAsync(async () => {
    await deleteOfflineBtn.props.onPress();
  });
  assert.strictEqual(root.findAllByProps({ testID: 'now-playing-modal-content' }).length, 0);

  // BackHandler must NOT be stuck locked: 1st Back clears downloads filter, 2nd Back returns to Search
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  await actAsync(async () => {
    assert.strictEqual(BackHandler.__emitHardwareBackPress(), true);
  });
  assert.ok(getAllText(root).includes('O que você quer ouvir?'));

  await actAsync(async () => {
    tree.unmount();
  });
});

test('BackNavigation: NowPlayingModal handles context menu -> queue sheet transition and ArtistProfileModal', async () => {
  const originalLyrics = api.getTrackLyrics;
  const originalRelated = api.getRelatedTracks;
  const originalArtist = api.getArtistProfile;
  api.getTrackLyrics = async () => null;
  api.getRelatedTracks = async () => [];
  api.getArtistProfile = async () => ({
    name: 'Artist One',
    channelId: 'ch1',
    topTracks: [],
    albums: [],
    singles: [],
  });

  let closeCount = 0;
  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {
            closeCount += 1;
          },
          track: {
            id: 't2',
            url: 'https://example.com/b.m4a',
            title: 'Song Two',
            artist: 'Artist One',
            duration: 200,
          },
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          queue: [{ id: 'q1', url: 'u1', title: 'Next Q', artist: 'A', duration: 100 }],
        })
      );
    });
    const root = tree.root;

    // Open ArtistProfileModal -> its own Modal.onRequestClose closes only ArtistProfileModal
    const artistBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver perfil de Artist One'
    );
    await actAsync(async () => {
      artistBtn.props.onPress();
    });
    assert.ok(root.findAllByProps({ testID: 'artist-profile-modal' }).length > 0);
    const modalsWithArtist = root.findAllByType('Modal');
    const artistModal = modalsWithArtist[modalsWithArtist.length - 1];
    await actAsync(async () => {
      artistModal.props.onRequestClose();
    });
    assert.strictEqual(root.findAllByProps({ testID: 'artist-profile-modal' }).length, 0);
    assert.strictEqual(closeCount, 0);

    // Open context menu -> click "Ver fila de reprodução" -> closes menu and opens Queue sheet
    const moreBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções'
    );
    await actAsync(async () => {
      moreBtn.props.onPress();
    });
    const viewQueueBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver fila de reprodução'
    );
    await actAsync(async () => {
      viewQueueBtn.props.onPress();
    });
    assert.strictEqual(getAllText(root).includes('Ver fila de reprodução'), false);
    assert.ok(getAllText(root).includes('Next Q'));

    // Back closes Queue sheet, not player
    const mainModal = root.findAllByType('Modal')[0];
    await actAsync(async () => {
      mainModal.props.onRequestClose();
    });
    assert.strictEqual(getAllText(root).includes('Next Q'), false);
    assert.strictEqual(closeCount, 0);
  } finally {
    api.getTrackLyrics = originalLyrics;
    api.getRelatedTracks = originalRelated;
    api.getArtistProfile = originalArtist;
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
  }
});

test('BackNavigation: SearchBarSection blurs TextInput ref on keyboardDidHide', async () => {
  let blurred = false;
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SearchBarSection, {
        query: '',
        onChangeQuery: () => {},
        onSearch: () => {},
        isSearching: false,
        recentQueries: ['jazz'],
      }),
      {
        createNodeMock: (element) => {
          if (element.type === 'TextInput') {
            return {
              blur: () => {
                blurred = true;
              },
            };
          }
          return null;
        },
      }
    );
  });
  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onFocus();
  });
  assert.ok(root.findByProps({ testID: 'search-history-list' }));

  await actAsync(async () => {
    Keyboard.__emit('keyboardDidHide');
  });
  assert.strictEqual(blurred, true, 'keyboardDidHide must blur native TextInput');
  assert.strictEqual(root.findAllByProps({ testID: 'search-history-list' }).length, 0);

  await actAsync(async () => {
    tree.unmount();
  });
});
