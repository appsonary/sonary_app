// tests/flow4_playlists_favorites.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const { AddToPlaylistModal } = require('../components/AddToPlaylistModal');
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const api = require('../services/api');
const {
  actAsync,
  findButtonByText,
  findButtonByIcon,
  findSearchActionButton,
  findInputByPlaceholder,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const {
  initDatabase,
  getPlaylists,
  createPlaylist,
  getPlaylistById,
  addTrackToPlaylist,
  isFavorite,
} = require('../services/database');
const { mockPlayer } = require('./mocks/trackPlayerMock');

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test('Flow 4: Quick create playlist in Playlists tab', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Navigate to Playlists tab
  const playlistsTabBtn = findButtonByText(root, 'Playlists');
  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });

  // Click "Nova" button to reveal inline creation box
  const newBtn = findButtonByText(root, 'Nova');
  assert.ok(newBtn, 'Nova playlist button should exist');
  await actAsync(async () => {
    newBtn.props.onPress();
  });

  // Type playlist name in quick create input
  const nameInput = findInputByPlaceholder(root, 'Nome da nova playlist');
  assert.ok(nameInput, 'Quick create input should be rendered');
  await actAsync(async () => {
    nameInput.props.onChangeText('Rock dos Anos 80');
  });

  // Click "Criar"
  const createBtn = findButtonByText(root, 'Criar');
  assert.ok(createBtn);
  await actAsync(async () => {
    createBtn.props.onPress();
  });

  // Verify the playlist was saved in database and appears in list
  const playlists = await getPlaylists();
  const created = playlists.find((p) => p.name === 'Rock dos Anos 80');
  assert.ok(created, 'Playlist must be created in SQLite');

  const contentText = getAllText(root);
  assert.ok(contentText.includes('Rock dos Anos 80'), 'New playlist should appear in UI');
});

test('Flow 4: AddToPlaylistModal adds track to existing playlist and creates new one', async () => {
  // Setup an existing playlist
  const existingPl = await createPlaylist('Minha Lista Favorita');

  const sampleTrack = {
    id: 'track_add_1',
    title: 'Comfortably Numb',
    artist: 'Pink Floyd',
    duration: 382,
    thumbnailUrl: 'https://example.com/pinkfloyd.jpg',
  };

  let modalTree;
  let trackAdded = false;

  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(AddToPlaylistModal, {
        visible: true,
        track: sampleTrack,
        onClose: () => { },
        onTrackAdded: (plId, plName) => {
          trackAdded = true;
          assert.strictEqual(plId, existingPl.id);
        },
      })
    );
  });

  const modalRoot = modalTree.root;
  assert.ok(getAllText(modalRoot).includes('Adicionar à playlist'));
  assert.ok(getAllText(modalRoot).includes('Minha Lista Favorita'));

  // Click on the existing playlist to add track
  const plCard = modalRoot.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Minha Lista Favorita')
  )[0];
  assert.ok(plCard);

  await actAsync(async () => {
    plCard.props.onPress();
  });

  assert.strictEqual(trackAdded, true, 'onTrackAdded callback should be called');

  // Verify database record
  const detail = await getPlaylistById(existingPl.id);
  assert.strictEqual(detail.trackCount, 1);
  assert.strictEqual(detail.tracks[0].title, 'Comfortably Numb');
});

test('Flow 4: AddToPlaylistModal shifts sheet above Android software keyboard when creating a new playlist', async () => {
  const { Keyboard, StyleSheet } = require('react-native');
  const sampleTrack = {
    id: 'track_kb_1',
    title: 'The Emptiness Machine',
    artist: 'Linkin Park',
    duration: 190,
    thumbnailUrl: 'https://example.com/lp.jpg',
  };

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(AddToPlaylistModal, {
        visible: true,
        track: sampleTrack,
        onClose: () => {},
      })
    );
  });

  const modalRoot = modalTree.root;
  const createBtn = modalRoot.findByProps({ accessibilityLabel: 'Criar nova playlist' });
  await actAsync(async () => {
    createBtn.props.onPress();
  });

  const nameInput = modalRoot.findByProps({ accessibilityLabel: 'Nome da nova playlist' });
  assert.ok(nameInput, 'New playlist TextInput must be visible');

  const kav = modalRoot.findByType('KeyboardAvoidingView');
  assert.strictEqual(StyleSheet.flatten(kav.props.style).paddingBottom, undefined);

  // Emit Android keyboardDidShow (e.g. 320px keyboard height under adjustNothing)
  await actAsync(async () => {
    Keyboard.__emit('keyboardDidShow', { endCoordinates: { height: 320 } });
  });

  const kavStyleWithKeyboard = StyleSheet.flatten(kav.props.style);
  assert.strictEqual(
    kavStyleWithKeyboard.paddingBottom,
    320,
    'AddToPlaylistModal overlay must apply keyboardHeight paddingBottom on Android so the input stays above the keyboard'
  );

  // Emit keyboardDidHide -> restores paddingBottom
  await actAsync(async () => {
    Keyboard.__emit('keyboardDidHide', {});
  });
  assert.strictEqual(StyleSheet.flatten(kav.props.style).paddingBottom, undefined);
});

test('Flow 4: AddToPlaylistModal alerts when track is duplicate and allows confirming or cancelling', async () => {
  const pl = await createPlaylist('Duplicate Test Pl');
  const track = {
    id: 'dup_track',
    title: 'Duplicate Song',
    artist: 'Artist D',
    duration: 200,
    thumbnailUrl: 'https://example.com/d.jpg',
  };

  // Add once first
  await addTrackToPlaylist(pl.id, track);

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(AddToPlaylistModal, {
        visible: true,
        track,
        onClose: () => { },
      })
    );
  });

  const modalRoot = modalTree.root;
  // Click on playlist card
  const plCard = modalRoot.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Duplicate Test Pl')
  )[0];
  assert.ok(plCard);

  await actAsync(async () => {
    plCard.props.onPress();
  });

  // Warning text should appear
  let text = getAllText(modalRoot);
  assert.ok(text.includes('Música já adicionada'), 'Should show duplicate warning');
  assert.ok(text.includes('Deseja adicionar novamente ou cancelar?'));

  // Click Cancelar
  const cancelBtn = modalRoot.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Cancelar')
  )[0];
  await actAsync(async () => {
    cancelBtn.props.onPress();
  });

  text = getAllText(modalRoot);
  assert.strictEqual(text.includes('Deseja adicionar novamente ou cancelar?'), false);

  // Click again and confirm
  await actAsync(async () => {
    plCard.props.onPress();
  });

  const confirmBtn = modalRoot.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Adicionar novamente')
  )[0];
  assert.ok(confirmBtn);

  await actAsync(async () => {
    confirmBtn.props.onPress();
  });

  const detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.trackCount, 1);
});

test('Flow 4: PlaylistDetailModal displays tracks, allows playback, editing, and deletion', async () => {
  // Create playlist with 2 tracks
  const pl = await createPlaylist('Jazz Session', 'Sessão suave');
  await addTrackToPlaylist(pl.id, {
    id: 'jazz_1',
    title: 'Take Five',
    artist: 'Dave Brubeck',
    duration: 324,
    thumbnailUrl: 'https://example.com/brubeck.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'jazz_2',
    title: 'Autumn Leaves',
    artist: 'Bill Evans',
    duration: 360,
    thumbnailUrl: 'https://example.com/evans.jpg',
  });

  let playAllCalled = false;
  let playTrackCalled = false;
  let updatedCalled = false;
  let deletedCalled = false;

  let detailTree;
  await actAsync(async () => {
    detailTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        currentActiveTrackId: 'jazz_1',
        isPlaying: true,
        onClose: () => { },
        onPlayAll: (tracks) => {
          playAllCalled = true;
          assert.strictEqual(tracks.length, 2);
        },
        onPlayTrack: (track, index, allTracks) => {
          playTrackCalled = true;
          assert.strictEqual(track.title, 'Autumn Leaves');
        },
        onPlaylistUpdated: () => {
          updatedCalled = true;
        },
        onPlaylistDeleted: () => {
          deletedCalled = true;
        },
      })
    );
  });

  const detailRoot = detailTree.root;
  const detailText = getAllText(detailRoot);

  assert.ok(detailText.includes('Jazz Session'));
  assert.ok(detailText.includes('Sessão suave'));
  assert.ok(detailText.includes('Take Five'));
  assert.ok(detailText.includes('Autumn Leaves'));

  // Test "Tocar" button
  const playAllBtn = findButtonByText(detailRoot, 'Tocar');
  assert.ok(playAllBtn, 'Tocar button should exist');
  await actAsync(async () => {
    playAllBtn.props.onPress();
  });
  assert.strictEqual(playAllCalled, true);

  // Test clicking individual track to play
  const autumnCard = detailRoot.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Autumn Leaves')
  )[0];
  assert.ok(autumnCard);
  await actAsync(async () => {
    autumnCard.props.onPress();
  });
  assert.strictEqual(playTrackCalled, true);
});

test('Flow 4: Toggling favorites on active track updates database and state', async () => {
  api.searchTracks = async () => [
    {
      id: 'fav_song',
      title: 'Get Lucky',
      artist: 'Daft Punk',
      duration: 248,
      formattedDuration: '4:08',
      thumbnailUrl: 'https://example.com/daft.jpg',
    },
  ];
  api.getAudioStream = async () => ({
    videoId: 'fav_song',
    title: 'Get Lucky',
    artist: 'Daft Punk',
    duration: 248,
    streamUrl: 'https://stream.example.com/daft.mp4',
    mimeType: 'audio/mp4',
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('Daft');
  });
  const searchBtn = findSearchActionButton(root);
  await actAsync(async () => {
    searchBtn.props.onPress();
  });

  // Play track from search list
  const trackCards = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Get Lucky')
  );
  assert.ok(trackCards.length > 0, 'Track card must exist');
  await actAsync(async () => {
    trackCards[0].props.onPress();
  });

  // Initial favorite status is false
  assert.strictEqual(await isFavorite('fav_song'), false);

  // Open NowPlayingModal by pressing Mini Player (which is the second element with Get Lucky)
  const elementsWithTitle = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Get Lucky')
  );
  assert.ok(elementsWithTitle.length >= 2, 'Both search card and mini player should exist');
  const miniPlayer = elementsWithTitle[1];
  await actAsync(async () => {
    miniPlayer.props.onPress();
  });

  // Toggle favorite in NowPlayingModal
  const heartBtn = findButtonByIcon(root, 'Heart');
  assert.ok(heartBtn, 'Heart favorite button should exist in NowPlayingModal');
  await actAsync(async () => {
    heartBtn.props.onPress();
  });

  // Should now be favorited in database
  assert.strictEqual(await isFavorite('fav_song'), true);

  // Toggle favorite again to remove
  await actAsync(async () => {
    heartBtn.props.onPress();
  });
  assert.strictEqual(await isFavorite('fav_song'), false);
});

test('Flow 4: Opening playlist detail preserves Mini Player and bottom NavigationTabBar', async () => {
  api.getAudioStream = async () => ({
    videoId: 'chill_1',
    title: 'Sunset Lover',
    artist: 'Petit Biscuit',
    duration: 215,
    streamUrl: 'https://stream.example.com/chill.mp4',
    mimeType: 'audio/mp4',
  });

  const pl = await createPlaylist('Vibe Chill');
  await addTrackToPlaylist(pl.id, {
    id: 'chill_1',
    title: 'Sunset Lover',
    artist: 'Petit Biscuit',
    duration: 215,
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;

  // Navigate to Playlists tab
  const playlistsTabBtn = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Playlists')
  );
  assert.ok(playlistsTabBtn.length > 0, 'Playlists tab button must exist');
  await actAsync(async () => {
    playlistsTabBtn[0].props.onPress();
  });

  // Open playlist
  const plCards = root.findAll(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Vibe Chill')
  );
  assert.ok(plCards.length > 0, 'Vibe Chill playlist item must exist');
  await actAsync(async () => {
    plCards[0].props.onPress();
  });

  // Verify playlist screen is open
  let text = getAllText(root);
  assert.ok(text.includes('Vibe Chill'));
  assert.ok(text.includes('Tocar'));

  // Verify bottom navigation menu is present while inside playlist
  const navTabs = root.findAll(
    (n) => n.type === 'TouchableOpacity' && (getAllText(n).includes('Início') || getAllText(n).includes('Pesquisar') || getAllText(n).includes('Playlists'))
  );
  assert.ok(navTabs.length > 0, 'Bottom navigation menu should remain visible inside playlist view');

  // Play track from inside the playlist
  const playAllBtn = findButtonByText(root, 'Tocar');
  assert.ok(playAllBtn, 'Tocar button must exist');
  await actAsync(async () => {
    playAllBtn.props.onPress();
  });

  // Verify mini player appears at the bottom while playlist is still open
  const miniPlayerText = getAllText(root);
  assert.ok(miniPlayerText.includes('Sunset Lover'), 'Mini player must display playing track while in playlist');

  // Verify back button closes playlist and returns to library
  const backBtn = findButtonByIcon(root, 'ArrowLeft');
  assert.ok(backBtn, 'Back button must exist in playlist header');
  await actAsync(async () => {
    backBtn.props.onPress();
  });

  // Still on playlists tab, with mini player still active
  text = getAllText(root);
  assert.ok(text.includes('Sunset Lover'), 'Mini player persists after returning from playlist view');
});

test('Flow 4: PlaylistDetailModal renders 3-dots track context menu matching Baixadas UX', async () => {
  const pl = await createPlaylist('Indie Road');
  await addTrackToPlaylist(pl.id, {
    id: 'indie_1',
    title: 'Evergreen',
    artist: 'Richy Mitch',
    duration: 185,
    thumbnailUrl: 'https://example.com/ev.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'indie_2',
    title: 'Lake Missoula',
    artist: 'Richy Mitch',
    duration: 210,
    thumbnailUrl: 'https://example.com/lm.jpg',
  });

  const calls = [];
  let updatedCount = 0;

  let detailTree;
  await actAsync(async () => {
    detailTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        downloadedTrackIds: new Set(['indie_2']),
        onClose: () => { },
        onPlayAll: () => { },
        onPlayTrack: (track) => calls.push(['play', track.trackId]),
        onPlayNext: (track) => calls.push(['playNext', track.id]),
        onAddToQueue: (track) => calls.push(['queue', track.id]),
        onAddToPlaylist: (track) => calls.push(['playlist', track.id]),
        onDownloadTrack: (track) => calls.push(['download', track.id]),
        onPlaylistUpdated: () => {
          updatedCount++;
        },
      })
    );
  });

  const root = detailTree.root;

  // Track rows must not render standalone track index numbers on the left
  const standaloneNumbers = root.findAll(
    (n) =>
      n.type === 'Text' &&
      n.children?.length === 1 &&
      (n.children[0] === '1' || n.children[0] === '2')
  );
  assert.strictEqual(standaloneNumbers.length, 0);

  // Bare immediate delete button must no longer exist directly on row
  const legacyRemoveBtns = root.findAll(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props.accessibilityLabel === 'Remover Evergreen da playlist'
  );
  assert.strictEqual(legacyRemoveBtns.length, 0);

  const openMenuFor = async (title) => {
    const moreBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === `Mais opções para ${title}`
    );
    assert.ok(moreBtn, `3-dots menu button should exist for ${title}`);
    await actAsync(async () => {
      moreBtn.props.onPress({ stopPropagation: () => { } });
    });
  };

  // Menu is lazy-mounted only after tap
  assert.strictEqual(
    root.findAll((n) => n.props?.accessibilityLabel === 'Tocar a seguir').length,
    0
  );

  // Downloaded & Stream icon-only badges reflect downloadedTrackIds
  const downloadedBadge = root.find(
    (n) => n.type === 'View' && n.props.accessibilityLabel === 'Baixada'
  );
  assert.ok(
    downloadedBadge.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'Folder').length === 1,
    'Downloaded track must display Folder icon without text'
  );
  const streamBadge = root.find(
    (n) => n.type === 'View' && n.props.accessibilityLabel === 'Stream'
  );
  assert.ok(
    streamBadge.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'Globe').length === 1,
    'Online track must display Globe icon without text'
  );

  // Tocar a seguir
  await openMenuFor('Evergreen');
  const menuText = getAllText(root);
  assert.ok(menuText.includes('Tocar a seguir'));
  assert.ok(menuText.includes('Iniciar rádio'));
  assert.ok(menuText.includes('Adicionar ao fim da fila'));
  assert.ok(menuText.includes('Salvar offline'));
  assert.ok(menuText.includes('Adicionar à playlist'));
  assert.ok(menuText.includes('Remover da playlist'));

  await actAsync(async () => {
    root
      .find(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar a seguir'
      )
      .props.onPress();
  });

  // Adicionar ao fim da fila
  await openMenuFor('Evergreen');
  await actAsync(async () => {
    root
      .find(
        (n) =>
          n.type === 'TouchableOpacity' &&
          n.props.accessibilityLabel === 'Adicionar ao fim da fila'
      )
      .props.onPress();
  });

  // Adicionar à playlist
  await openMenuFor('Evergreen');
  await actAsync(async () => {
    root
      .findAll(
        (n) =>
          n.type === 'TouchableOpacity' &&
          n.props.accessibilityLabel === 'Adicionar à playlist'
      )[0]
      .props.onPress();
  });

  // Salvar offline
  await openMenuFor('Evergreen');
  await actAsync(async () => {
    root
      .find(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Salvar offline'
      )
      .props.onPress();
  });

  assert.deepStrictEqual(calls, [
    ['playNext', 'indie_1'],
    ['queue', 'indie_1'],
    ['playlist', 'indie_1'],
    ['download', 'indie_1'],
  ]);

  // Downloaded track shows "Música já baixada" and skips onDownload
  await openMenuFor('Lake Missoula');
  assert.ok(getAllText(root).includes('Música já baixada'));
  await actAsync(async () => {
    root
      .find(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Salvar offline'
      )
      .props.onPress();
  });
  assert.strictEqual(calls.length, 4);

  // Remover da playlist deletes from SQLite and updates list
  await openMenuFor('Evergreen');
  await actAsync(async () => {
    root
      .find(
        (n) =>
          n.type === 'TouchableOpacity' &&
          n.props.accessibilityLabel === 'Remover da playlist'
      )
      .props.onPress();
  });

  assert.ok(updatedCount >= 1);
  const updatedDetail = await getPlaylistById(pl.id);
  assert.strictEqual(updatedDetail.trackCount, 1);
  assert.strictEqual(updatedDetail.tracks[0].trackId, 'indie_2');
});

test('Flow 4: PlaylistDetailModal renders atmospheric glow, 1:1 cropped cover, and centered single-row action bar', async () => {
  const { StyleSheet } = require('react-native');
  const { AmbientGlowBackground } = require('../components/AmbientGlowBackground');
  const { AtmosphericGradient } = require('../components/AtmosphericGradient');

  const pl = await createPlaylist('Night Drive');
  await addTrackToPlaylist(pl.id, {
    id: 'nd_1',
    title: 'Nightcall',
    artist: 'Kavinsky',
    duration: 258,
    thumbnailUrl: 'https://i.ytimg.com/vi/MV_3Dpw-BRY/hqdefault.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'nd_2',
    title: 'Midnight City',
    artist: 'M83',
    duration: 243,
    thumbnailUrl: 'https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg',
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        onClose: () => { },
        onPlayTrack: () => { },
        onPlayAll: () => { },
      })
    );
  });

  const root = tree.root;

  // 1. AmbientGlowBackground spans from screen top (StatusBar + translucent borderless topBar + cover)
  const statusBar = root.findByType('StatusBar');
  assert.strictEqual(statusBar.props.translucent, true);
  assert.strictEqual(statusBar.props.backgroundColor, 'transparent');

  const backBtn = root.findByProps({ accessibilityLabel: 'Voltar' });
  let topBar = backBtn.parent;
  while (topBar && topBar.type !== 'View') {
    topBar = topBar.parent;
  }
  const topBarStyle = StyleSheet.flatten(topBar.props.style);
  assert.strictEqual(topBarStyle.backgroundColor, 'transparent');
  assert.strictEqual(topBarStyle.borderBottomWidth, undefined);

  const glow = root.findByType(AmbientGlowBackground);
  assert.strictEqual(
    glow.props.artworkUri,
    'https://i.ytimg.com/vi/MV_3Dpw-BRY/hqdefault.jpg'
  );
  let glowBackdrop = glow.parent;
  while (glowBackdrop && glowBackdrop.type !== 'View') {
    glowBackdrop = glowBackdrop.parent;
  }
  const glowBackdropStyle = StyleSheet.flatten(glowBackdrop.props.style);
  assert.strictEqual(glowBackdropStyle.position, 'absolute');
  assert.strictEqual(glowBackdropStyle.top, 0);
  assert.strictEqual(glowBackdropStyle.zIndex, 0);

  // 2. 1:1 cover with borderRadius 12, resizeMode="cover" & hqdefault crop
  const coverImage = root.findAllByType('Image').find(
    (img) =>
      img.props.source &&
      img.props.source.uri === 'https://i.ytimg.com/vi/MV_3Dpw-BRY/hqdefault.jpg' &&
      img.props.resizeMode === 'cover'
  );
  assert.ok(coverImage, 'Playlist cover Image must use resizeMode="cover"');
  const coverImgStyle = StyleSheet.flatten(coverImage.props.style);
  assert.deepStrictEqual(coverImgStyle.transform, [{ scale: 1.35 }]);
  let coverWrapper = coverImage.parent;
  while (coverWrapper && coverWrapper.type !== 'View') {
    coverWrapper = coverWrapper.parent;
  }
  const coverWrapperStyle = StyleSheet.flatten(coverWrapper.props.style);
  assert.strictEqual(coverWrapperStyle.width, coverWrapperStyle.height);
  assert.strictEqual(coverWrapperStyle.aspectRatio, 1);
  assert.strictEqual(coverWrapperStyle.borderRadius, 12);

  // 3. Single-row centered action bar with Baixar (44x44), Tocar (compact pill), Ordenar (44x44)
  const playBtn = root.findByProps({
    accessibilityLabel: 'Tocar todas as músicas da playlist',
  });
  const actionsBarStyle = StyleSheet.flatten(playBtn.parent.props.style);
  assert.strictEqual(actionsBarStyle.flexDirection, 'row');
  assert.strictEqual(actionsBarStyle.alignItems, 'flex-start');
  assert.strictEqual(actionsBarStyle.justifyContent, 'center');
  assert.strictEqual(actionsBarStyle.gap, 20);

  const playStyle = StyleSheet.flatten(playBtn.props.style);
  assert.strictEqual(playStyle.height, 46);
  assert.strictEqual(playStyle.minWidth, 144);
  assert.strictEqual(playStyle.borderRadius, 23);
  assert.strictEqual(playStyle.backgroundColor, '#FFFFFF');
  assert.ok(getAllText(playBtn).includes('Tocar'));

  const downloadBtn = root.findByProps({
    accessibilityLabel: 'Baixar todas as músicas da playlist',
  });
  assert.ok(getAllText(downloadBtn).includes('Baixar'));
  const downloadCircle = downloadBtn.findAllByType('View')[0];
  const downloadCircleStyle = StyleSheet.flatten(downloadCircle.props.style);
  assert.strictEqual(downloadCircleStyle.width, 44);
  assert.strictEqual(downloadCircleStyle.height, 44);
  assert.strictEqual(downloadCircleStyle.borderRadius, 22);

  const reorderBtn = root.findByProps({
    accessibilityLabel: 'Modo reordenar faixas',
  });
  assert.ok(getAllText(reorderBtn).includes('Ordenar'));
  await actAsync(async () => {
    reorderBtn.props.onPress();
  });
  const activeReorderBtn = root.findByProps({
    accessibilityLabel: 'Modo reordenar faixas',
  });
  assert.ok(getAllText(activeReorderBtn).includes('Concluir'));
  const activeCircle = activeReorderBtn.findAllByType('View')[0];
  const activeCircleStyle = StyleSheet.flatten(activeCircle.props.style);
  assert.strictEqual(activeCircleStyle.backgroundColor, '#FFFFFF');

  // 4. System Favorites playlist renders full-bleed ruby LinearGradient cover and AtmosphericGradient
  let favDetailTree;
  await actAsync(async () => {
    favDetailTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: '__favorites__',
        onClose: () => { },
        onPlayTrack: () => { },
        onPlayAll: () => { },
      })
    );
  });
  const favDetailGradients = favDetailTree.root.findAllByType('LinearGradient');
  assert.strictEqual(favDetailGradients.length, 1);
  assert.deepStrictEqual(favDetailGradients[0].props.colors, ['#D91B2C', '#7A0B1B']);
  const favDetailCoverStyle = StyleSheet.flatten(favDetailGradients[0].props.style);
  assert.strictEqual(favDetailCoverStyle.width, '100%');
  assert.strictEqual(favDetailCoverStyle.height, '100%');
  assert.ok(
    favDetailTree.root.findAllByType(AtmosphericGradient).length >= 1,
    'Favorites playlist without artworkUri should render AtmosphericGradient'
  );

  // 5. Empty user playlist without thumbnail falls back to AtmosphericGradient
  const emptyPl = await createPlaylist('Empty Glow');
  let emptyTree;
  await actAsync(async () => {
    emptyTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: emptyPl.id,
        onClose: () => { },
        onPlayTrack: () => { },
        onPlayAll: () => { },
      })
    );
  });
  assert.ok(
    emptyTree.root.findAllByType(AtmosphericGradient).length >= 1,
    'Empty playlist without thumbnail should render AtmosphericGradient fallback'
  );
});

test('Flow 4: PlaylistCover renders 2x2 collage only for >= 4 tracks, single cover for < 4 tracks, and custom cover overrides collage', async () => {
  const { PlaylistCover } = require('../components/PlaylistCover');

  // 1. 0 tracks -> placeholder icon
  const emptyCoverTree = renderer.create(
    React.createElement(PlaylistCover, {
      thumbnailUrl: null,
      hasCustomCover: false,
      coverThumbnails: [],
      size: 120,
    })
  );
  assert.strictEqual(emptyCoverTree.root.findAllByType('Image').length, 0);
  assert.strictEqual(emptyCoverTree.root.findAllByType('LucideIcon').length, 1);

  // 2. 3 tracks -> ONLY 1st track cover (not 2x2 collage)
  const threeCoverTree = renderer.create(
    React.createElement(PlaylistCover, {
      thumbnailUrl: 'https://example.com/t1.jpg',
      hasCustomCover: false,
      coverThumbnails: [
        'https://example.com/t1.jpg',
        'https://example.com/t2.jpg',
        'https://example.com/t3.jpg',
      ],
      size: 120,
    })
  );
  const threeImages = threeCoverTree.root.findAllByType('Image');
  assert.strictEqual(threeImages.length, 1);
  assert.strictEqual(threeImages[0].props.source.uri, 'https://example.com/t1.jpg');

  // 3. 4 tracks -> 2x2 collage with all 4 first covers
  const fourCoverTree = renderer.create(
    React.createElement(PlaylistCover, {
      thumbnailUrl: 'https://example.com/t1.jpg',
      hasCustomCover: false,
      coverThumbnails: [
        'https://example.com/t1.jpg',
        'https://example.com/t2.jpg',
        'https://example.com/t3.jpg',
        'https://example.com/t4.jpg',
      ],
      size: 120,
    })
  );
  const collageImages = fourCoverTree.root.findAllByType('Image');
  assert.strictEqual(collageImages.length, 4);
  assert.deepStrictEqual(
    collageImages.map((img) => img.props.source.uri),
    [
      'https://example.com/t1.jpg',
      'https://example.com/t2.jpg',
      'https://example.com/t3.jpg',
      'https://example.com/t4.jpg',
    ]
  );

  // 4. Custom cover -> overrides collage even with 4+ tracks
  const customCoverTree = renderer.create(
    React.createElement(PlaylistCover, {
      thumbnailUrl: 'file:///data/user/0/com.sonarypro/files/playlist_covers/custom.jpg',
      hasCustomCover: true,
      coverThumbnails: [],
      size: 120,
    })
  );
  const customImages = customCoverTree.root.findAllByType('Image');
  assert.strictEqual(customImages.length, 1);
  assert.strictEqual(
    customImages[0].props.source.uri,
    'file:///data/user/0/com.sonarypro/files/playlist_covers/custom.jpg'
  );
});

test('Flow 4: PlaylistDetailModal opens Bottom Sheet menu, supports gallery cover selection, dedicated Edit Modal, and revert to 2x2 auto cover', async () => {
  const pl = await createPlaylist('Roadtrip 2026', 'Inicial');
  for (let i = 1; i <= 4; i++) {
    await addTrackToPlaylist(pl.id, {
      id: `rt_${i}`,
      title: `Track ${i}`,
      artist: `Artist ${i}`,
      duration: 200,
      thumbnailUrl: `https://example.com/rt_${i}.jpg`,
    });
  }

  let updatedEvents = 0;
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        onClose: () => { },
        onPlayTrack: () => { },
        onPlayAll: () => { },
        onPlaylistUpdated: () => {
          updatedEvents += 1;
        },
      })
    );
  });

  const root = tree.root;

  // Starts with 4 track covers in 2x2 collage
  assert.strictEqual(
    root.findAllByType('Image').filter((img) =>
      img.props.source?.uri?.includes('https://example.com/rt_')
    ).length >= 4,
    true,
    'PlaylistDetailModal hero should display 4 track covers for 4-track playlist'
  );

  // Open PlaylistOptionsSheet via 3-dots button
  const moreBtn = root.findByProps({ accessibilityLabel: 'Mais opções da playlist' });
  await actAsync(async () => {
    moreBtn.props.onPress();
  });

  let sheetText = getAllText(root);
  assert.ok(sheetText.includes('Alterar capa (galeria)'));
  assert.ok(sheetText.includes('Nome e detalhes'));
  assert.ok(sheetText.includes('Ordenar faixas'));
  assert.ok(sheetText.includes('Baixar playlist'));
  assert.ok(sheetText.includes('Excluir playlist'));
  // Ensure unrequested Share / Add-to-this-playlist items are omitted
  assert.strictEqual(sheetText.includes('Share'), false);
  assert.strictEqual(sheetText.includes('Compartilhar'), false);
  assert.strictEqual(sheetText.includes('Usar capa automática'), false);

  // Open EditPlaylistModal via "Nome e detalhes"
  const editDetailsBtn = root.findByProps({
    accessibilityLabel: 'Editar nome e detalhes da playlist',
  });
  await actAsync(async () => {
    editDetailsBtn.props.onPress();
  });
  await actAsync(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  const nameInput = root.findByProps({ accessibilityLabel: 'Nome da playlist' });
  const descInput = root.findByProps({ accessibilityLabel: 'Descrição da playlist' });
  await actAsync(async () => {
    nameInput.props.onChangeText('Roadtrip VIP');
    descInput.props.onChangeText('Som para estrada');
  });

  // Pick cover from gallery inside EditPlaylistModal -> opens Sonary CoverCropModal
  global.__imagePickerMock = {
    requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted', granted: true }),
    launchImageLibraryAsync: async () => ({
      canceled: false,
      assets: [{ uri: 'file:///cache/trip_cover.jpg', width: 1200, height: 800 }],
    }),
  };

  let manipulateCalls = [];
  global.__imageManipulatorMock = {
    manipulateAsync: async (uri, actions, opts) => {
      manipulateCalls.push({ uri, actions, opts });
      return { uri: 'file:///cache/cropped_trip_cover.jpg', width: 600, height: 600 };
    },
  };

  try {
    const pickInModalBtn = root.findByProps({ accessibilityLabel: 'Alterar capa' });
    await actAsync(async () => {
      await pickInModalBtn.props.onPress();
    });

    // CoverCropModal opens edge-to-edge with Sonary-native Portuguese controls (never Android UCrop)
    const cropModalNode = root.findAllByType('Modal').find((m) => m.props.statusBarTranslucent && m.props.hardwareAccelerated);
    assert.ok(cropModalNode, 'CoverCropModal must set statusBarTranslucent=true and hardwareAccelerated=true to prevent top StatusBar leak');
    const cropTexts = getAllText(root);
    assert.ok(cropTexts.includes('Ajustar capa'));
    assert.ok(cropTexts.includes('Usar capa'));
    assert.strictEqual(cropTexts.includes('CROP'), false);

    // Zoom in and rotate 90° before confirming crop
    await actAsync(async () => {
      root.findByProps({ accessibilityLabel: 'Aumentar zoom da capa' }).props.onPress();
      root.findByProps({ accessibilityLabel: 'Girar capa 90 graus' }).props.onPress();
    });

    const confirmCropBtn = root.findByProps({
      accessibilityLabel: 'Confirmar recorte da capa',
    });
    await actAsync(async () => {
      await confirmCropBtn.props.onPress();
    });

    assert.ok(manipulateCalls.length >= 1, 'cropPlaylistCoverImage must invoke ImageManipulator');
    assert.ok(
      manipulateCalls[0].actions.some((a) => a.rotate === 90),
      'Rotation action should be passed to manipulator'
    );
    assert.ok(
      manipulateCalls[0].actions.some((a) => a.crop && a.crop.width === a.crop.height),
      '1:1 square crop rect should be passed to manipulator'
    );

    const saveModalBtn = root.findByProps({
      accessibilityLabel: 'Salvar alterações da playlist',
    });
    await actAsync(async () => {
      await saveModalBtn.props.onPress();
    });

    const savedDetail = await getPlaylistById(pl.id);
    assert.strictEqual(savedDetail.name, 'Roadtrip VIP');
    assert.strictEqual(savedDetail.description, 'Som para estrada');
    assert.strictEqual(savedDetail.hasCustomCover, true);
    assert.ok(savedDetail.thumbnailUrl.includes('playlist_covers/'));
    assert.ok(updatedEvents >= 1);

    // Reopen Bottom Sheet: now "Usar capa automática" must be visible
    await actAsync(async () => {
      root.findByProps({ accessibilityLabel: 'Mais opções da playlist' }).props.onPress();
    });
    const resetCoverBtn = root.findByProps({
      accessibilityLabel: 'Usar capa automática',
    });
    assert.ok(resetCoverBtn);

    await actAsync(async () => {
      resetCoverBtn.props.onPress();
    });
    await actAsync(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const revertedDetail = await getPlaylistById(pl.id);
    assert.strictEqual(revertedDetail.hasCustomCover, false);
    assert.strictEqual(revertedDetail.coverThumbnails.length, 4);
  } finally {
    delete global.__imagePickerMock;
    delete global.__imageManipulatorMock;
  }
});

test('Flow 4: computeCropRect calculates accurate 1:1 square bounds across zoom, pan, and rotation', () => {
  const { computeCropRect } = require('../components/CoverCropModal');

  // Landscape 1200x800 in 300px viewport at 1.0x centered -> 800x800 at originX=200, originY=0
  assert.deepStrictEqual(
    computeCropRect({
      imageWidth: 1200,
      imageHeight: 800,
      viewportSize: 300,
      rotation: 0,
      panX: 0,
      panY: 0,
      zoom: 1,
    }),
    { originX: 200, originY: 0, width: 800, height: 800 }
  );

  // Panned full left (-75px) to expose right side of 1200x800 image -> originX=400
  assert.deepStrictEqual(
    computeCropRect({
      imageWidth: 1200,
      imageHeight: 800,
      viewportSize: 300,
      rotation: 0,
      panX: -75,
      panY: 0,
      zoom: 1,
    }),
    { originX: 400, originY: 0, width: 800, height: 800 }
  );

  // Rotated 90° (effective 800x1200) centered -> 800x800 at originX=0, originY=200
  assert.deepStrictEqual(
    computeCropRect({
      imageWidth: 1200,
      imageHeight: 800,
      viewportSize: 300,
      rotation: 90,
      panX: 0,
      panY: 0,
      zoom: 1,
    }),
    { originX: 0, originY: 200, width: 800, height: 800 }
  );

  // 2x zoom centered on 1200x800 -> 400x400 at originX=400, originY=200
  assert.deepStrictEqual(
    computeCropRect({
      imageWidth: 1200,
      imageHeight: 800,
      viewportSize: 300,
      rotation: 0,
      panX: 0,
      panY: 0,
      zoom: 2,
    }),
    { originX: 400, originY: 200, width: 400, height: 400 }
  );
});
