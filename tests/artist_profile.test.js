// tests/artist_profile.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const { ArtistProfileModal } = require('../components/ArtistProfileModal');
const { AlbumDetailView } = require('../components/AlbumDetailView');
const { AmbientGlowBackground } = require('../components/AmbientGlowBackground');
const api = require('../services/api');
const storage = require('../services/storage');
const { initDatabase } = require('../services/database');
const { dispatchBackPress, resetBackHandlersForTest } = require('../services/backNavigation');
const {
  actAsync,
  findButtonByText,
  findInputByPlaceholder,
  findSearchActionButton,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const { mockPlayer, State } = require('./mocks/trackPlayerMock');

test.beforeEach(async () => {
  resetAllMocks();
  resetBackHandlersForTest();
  api.clearArtistAndAlbumCaches();
  await initDatabase();
});


test('Artist UI & App Integration: renders inline preserving MiniPlayer + TabBar, omits top-right ⋮ button, keeps profile open on Play/Shuffle/Radio, supports Ver tudo, TrackContextSheet, AlbumDetailView, Related Artist navigation and Android Back stack', async () => {
  const originalSearchTracks = api.searchTracks;
  const originalSearchArtists = api.searchArtists;
  const originalGetArtistProfile = api.getArtistProfile;
  const originalGetAlbumDetail = api.getAlbumDetail;
  const originalGetAudioStream = api.getAudioStream;
  const originalGetArtistRadio = api.getArtistRadio;

  const topTracks = Array.from({ length: 7 }, (_, i) => ({
    id: `cbjr_${i + 1}`,
    title: `Sucesso ${i + 1}`,
    artist: 'Charlie Brown Jr.',
    album: `Álbum ${i + 1}`,
    duration: 200 + i * 5,
    formattedDuration: `3:${String(20 + i * 5).padStart(2, '0')}`,
    thumbnailUrl: `https://example.com/t${i + 1}.jpg`,
  }));

  api.searchTracks = async () => topTracks.slice(0, 2);
  api.searchArtists = async () => [
    {
      id: 'UC_cbjr',
      name: 'Charlie Brown Jr.',
      subtitle: 'Artista • 10,2 mi ouvintes mensais',
      thumbnailUrl: 'https://example.com/cbjr.jpg',
    },
  ];
  api.getArtistProfile = async (name, channelId) => {
    if (channelId === 'UC_falcao') {
      return {
        name: 'Marcelo Falcão',
        channelId: 'UC_falcao',
        avatarUrl: 'https://example.com/falcao.jpg',
        bannerUrl: 'https://example.com/falcao-banner.jpg',
        subtitle: 'Artista • 1,48 mi ouvintes mensais',
        topTracks: [
          {
            id: 'falcao_1',
            title: 'Viver',
            artist: 'Marcelo Falcão',
            album: 'Viver (Mais Leve Que o Ar)',
            duration: 215,
            formattedDuration: '3:35',
            thumbnailUrl: 'https://example.com/viver.jpg',
          },
        ],
        albums: [],
        singles: [],
      };
    }
    return {
      name: name || 'Charlie Brown Jr.',
      channelId: channelId || 'UC_cbjr',
      avatarUrl: 'https://example.com/cbjr.jpg',
      bannerUrl: 'https://example.com/cbjr-banner.jpg',
      subtitle: 'Artista • 10,2 mi ouvintes mensais',
      bio: 'Banda brasileira de rock formada em Santos em 1992.',
      topTracks,
      albums: [
        {
          browseId: 'album_camisa10',
          title: 'Camisa 10',
          year: '2009',
          thumbnailUrl: 'https://example.com/camisa10.jpg',
          type: 'album',
        },
      ],
      singles: [
        {
          browseId: 'album_zoio',
          title: 'Zóio de Lula',
          year: '2019',
          thumbnailUrl: 'https://example.com/zoio.jpg',
          type: 'single',
        },
      ],
      relatedArtists: [
        {
          id: 'UC_falcao',
          name: 'Marcelo Falcão',
          subtitle: '1,48 mi ouvintes mensais',
          thumbnailUrl: 'https://example.com/falcao.jpg',
        },
      ],
    };
  };
  api.getAlbumDetail = async () => ({
    browseId: 'album_camisa10',
    title: 'Camisa 10',
    artist: 'Charlie Brown Jr.',
    year: '2009',
    type: 'album',
    thumbnailUrl: 'https://example.com/camisa10.jpg',
    trackCount: 2,
    totalDuration: 420,
    tracks: [
      {
        id: 'c10_1',
        title: 'Dona do Meu Pensamento',
        artist: 'Charlie Brown Jr.',
        album: 'Camisa 10',
        duration: 235,
        formattedDuration: '3:55',
        thumbnailUrl: 'https://example.com/camisa10.jpg',
      },
      {
        id: 'c10_2',
        title: 'Só os Loucos Sabem',
        artist: 'Charlie Brown Jr.',
        album: 'Camisa 10',
        duration: 206,
        formattedDuration: '3:26',
        thumbnailUrl: 'https://example.com/camisa10.jpg',
      },
    ],
  });
  api.getAudioStream = async (videoId) => ({
    videoId,
    title: `Track ${videoId}`,
    artist: 'Charlie Brown Jr.',
    duration: 210,
    thumbnailUrl: 'https://example.com/art.jpg',
    streamUrl: `https://stream.example.com/${videoId}.m4a`,
    mimeType: 'audio/mp4',
    format: 'm4a',
    bitrate: 128000,
  });
  let radioCalls = 0;
  api.getArtistRadio = async (name) => {
    radioCalls += 1;
    return {
      seedId: 'UC_cbjr',
      title: `Rádio de ${name}`,
      tracks: [topTracks[0]],
    };
  };

  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    // 1. Search and open Artist Profile inline
    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('Charlie Brown Jr');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });

    const artistBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Abrir perfil do artista Charlie Brown Jr.'
    );
    await actAsync(async () => {
      artistBtn.props.onPress();
    });

    // 2. Verify inline presentation: profile visible + TabBar visible + NO top-right ⋮ button
    const profileView = root.findByProps({ testID: 'artist-profile-modal' });
    assert.ok(profileView);
    assert.ok(findButtonByText(root, 'Buscar'), 'TabBar must stay visible in inline Artist Profile');
    assert.strictEqual(
      profileView.findAll(
        (n) =>
          n.type === 'TouchableOpacity' &&
          typeof n.props.accessibilityLabel === 'string' &&
          n.props.accessibilityLabel.toLowerCase().includes('opções do artista')
      ).length,
      0,
      'Must NOT render top-right ⋮ artist options button'
    );

    const initialText = getAllText(profileView);
    assert.ok(initialText.includes('Charlie Brown Jr.'));
    assert.ok(initialText.includes('Artista • 10,2 mi ouvintes mensais'));
    assert.ok(initialText.includes('Populares'));
    assert.ok(initialText.includes('Sucesso 1'));
    assert.ok(initialText.includes('Sucesso 5'));
    assert.strictEqual(initialText.includes('Sucesso 6'), false, 'Should initially cap Populares at 5 rows');
    assert.ok(initialText.includes('Álbuns'));
    assert.ok(initialText.includes('Camisa 10'));
    assert.ok(initialText.includes('2009'));
    assert.ok(initialText.includes('Singles e EPs'));
    assert.ok(initialText.includes('Artistas semelhantes'));
    assert.ok(initialText.includes('Marcelo Falcão'));

    // 3. Click "Tocar" -> plays track WITHOUT closing profile, and MiniPlayer becomes visible!
    const countArtistProfiles = () =>
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-profile-modal').length;
    const playAllBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Tocar populares de Charlie Brown Jr.'
    );
    await actAsync(async () => {
      playAllBtn.props.onPress();
    });
    assert.strictEqual(mockPlayer.state, State.Playing);
    assert.strictEqual(
      countArtistProfiles(),
      1,
      'Pressing Tocar must NOT close the Artist Profile'
    );

    // 4. Click "Aleatório" and "Rádio" -> stay on profile
    const shuffleBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Tocar Charlie Brown Jr. em modo aleatório'
    );
    await actAsync(async () => {
      shuffleBtn.props.onPress();
    });
    assert.strictEqual(countArtistProfiles(), 1);

    const radioBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Iniciar rádio de Charlie Brown Jr.'
    );
    await actAsync(async () => {
      radioBtn.props.onPress();
    });
    assert.strictEqual(radioCalls, 1);
    assert.strictEqual(countArtistProfiles(), 1);

    // 5. Click "Ver tudo" -> expands to all 7 tracks
    const seeAllBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Ver todas as faixas populares'
    );
    await actAsync(async () => {
      seeAllBtn.props.onPress();
    });
    assert.ok(getAllText(root.findByProps({ testID: 'artist-profile-modal' })).includes('Sucesso 7'));

    // 6. Click ••• on a popular track -> opens TrackContextSheet
    const activeProfileView = root.find(
      (n) => n.type === 'View' && n.props.testID === 'artist-profile-modal'
    );
    const moreTrackBtn = activeProfileView.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Mais opções para Sucesso 1'
    );
    await actAsync(async () => {
      moreTrackBtn.props.onPress({ stopPropagation: () => {} });
    });
    const textWithSheet = getAllText(root);
    assert.ok(textWithSheet.includes('Tocar a seguir') && textWithSheet.includes('Adicionar à playlist'));

    // Close TrackContextSheet via native Modal onRequestClose (real Android Back on Modal)
    const contextModals = root.findAllByType('Modal');
    assert.ok(contextModals.length > 0, 'TrackContextSheet must render inside a Modal');
    await actAsync(async () => {
      contextModals[contextModals.length - 1].props.onRequestClose();
    });
    assert.strictEqual(
      getAllText(root).includes('Adicionar ao fim da fila'),
      false,
      'Modal onRequestClose must dismiss TrackContextSheet'
    );
    assert.strictEqual(
      countArtistProfiles(),
      1,
      'Dismissing TrackContextSheet must keep ArtistProfileModal open'
    );

    // 7. Tap Album card -> opens AlbumDetailView with real album tracks
    const albumCard = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir Camisa 10'
    );
    await actAsync(async () => {
      albumCard.props.onPress();
    });
    const albumView = root.findByProps({ testID: 'album-detail-view' });
    assert.ok(albumView);
    assert.ok(getAllText(albumView).includes('Dona do Meu Pensamento'));

    // 8. Android Back closes AlbumDetailView -> returns to Charlie Brown Jr. profile
    await actAsync(async () => {
      assert.strictEqual(dispatchBackPress(), true);
    });
    assert.strictEqual(root.findAllByProps({ testID: 'album-detail-view' }).length, 0);
    assert.ok(getAllText(root.findByProps({ testID: 'artist-profile-modal' })).includes('Charlie Brown Jr.'));

    // 9. Tap Related Artist -> navigates to Marcelo Falcão, Android Back returns to Charlie Brown Jr.
    const relatedBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Abrir perfil do artista Marcelo Falcão'
    );
    await actAsync(async () => {
      relatedBtn.props.onPress();
    });
    assert.ok(getAllText(root.findByProps({ testID: 'artist-profile-modal' })).includes('Marcelo Falcão'));

    await actAsync(async () => {
      assert.strictEqual(dispatchBackPress(), true);
    });
    assert.ok(getAllText(root.findByProps({ testID: 'artist-profile-modal' })).includes('Charlie Brown Jr.'));

    // 10. Final Android Back returns to Search with search results preserved
    await actAsync(async () => {
      assert.strictEqual(dispatchBackPress(), true);
    });
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-profile-modal').length,
      0
    );
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-results-section').length,
      1
    );
  } finally {
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
    api.searchTracks = originalSearchTracks;
    api.searchArtists = originalSearchArtists;
    api.getArtistProfile = originalGetArtistProfile;
    api.getAlbumDetail = originalGetAlbumDetail;
    api.getAudioStream = originalGetAudioStream;
    api.getArtistRadio = originalGetArtistRadio;
  }
});

test('Artist UI Stress (break-ui): handles error + retry, missing artwork, empty albums/singles, and very long names cleanly', async () => {
  const originalGetArtistProfile = api.getArtistProfile;
  let attempts = 0;

  try {
    api.getArtistProfile = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Network down');
      }
      return {
        name: 'Um Nome de Artista Extremamente Longo Para Testar Truncamento No Hero Sem Quebrar Layout',
        avatarUrl: '',
        bannerUrl: '',
        subtitle: 'Artista',
        topTracks: [],
        albums: [],
        singles: [],
      };
    };

    let tree;
    await actAsync(async () => {
      tree = renderer.create(
        React.createElement(ArtistProfileModal, {
          visible: true,
          presentation: 'inline',
          onClose: () => {},
          artistName: 'Artista Teste Erro',
          onPlayTrack: () => {},
          onStartArtistRadio: () => {},
        })
      );
    });

    const root = tree.root;
    assert.ok(getAllText(root).includes('Tentar novamente'), 'Must render retry CTA on load failure');

    const retryBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Tentar novamente carregar artista'
    );
    await actAsync(async () => {
      retryBtn.props.onPress();
    });

    assert.strictEqual(attempts, 2);
    const recoveredText = getAllText(root);
    assert.ok(recoveredText.includes('Nenhuma faixa popular encontrada'));
    assert.strictEqual(root.findAllByProps({ testID: 'artist-albums-section' }).length, 0);
    assert.strictEqual(root.findAllByProps({ testID: 'artist-singles-section' }).length, 0);
    assert.strictEqual(root.findAllByProps({ testID: 'artist-related-section' }).length, 0);

    await actAsync(async () => {
      tree.unmount();
    });
  } finally {
    api.getArtistProfile = originalGetArtistProfile;
  }
});


test('AlbumDetailView: supports Play, Shuffle, download-all progress counter X/Y, track menu, and error retry', async () => {
  const originalGetAlbumDetail = api.getAlbumDetail;
  const originalSubscribe = storage.subscribeDownloadQueue;
  const originalEnqueuePlaylist = storage.enqueuePlaylistDownload;

  let attempts = 0;
  let queueListener = null;
  let enqueuedTracks = null;
  const playAllCalls = [];
  const toasts = [];

  try {
    storage.subscribeDownloadQueue = (cb) => {
      queueListener = cb;
      cb([]);
      return () => {
        queueListener = null;
      };
    };
    storage.enqueuePlaylistDownload = (tracks) => {
      enqueuedTracks = tracks;
      return { enqueuedCount: tracks.length, skippedCount: 0 };
    };
    api.getAlbumDetail = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Album load error');
      }
      return {
        browseId: 'album_test_alb',
        title: 'Acústico MTV',
        artist: 'Charlie Brown Jr.',
        year: '2003',
        type: 'album',
        thumbnailUrl: 'https://example.com/acustico.jpg',
        trackCount: 2,
        totalDuration: 420,
        tracks: [
          {
            id: 'ac_1',
            title: 'Papo Reto',
            artist: 'Charlie Brown Jr.',
            album: 'Acústico MTV',
            duration: 210,
            formattedDuration: '3:30',
            thumbnailUrl: 'https://example.com/acustico.jpg',
          },
          {
            id: 'ac_2',
            title: 'Proibida Pra Mim',
            artist: 'Charlie Brown Jr.',
            album: 'Acústico MTV',
            duration: 210,
            formattedDuration: '3:30',
            thumbnailUrl: 'https://example.com/acustico.jpg',
          },
        ],
      };
    };

    let tree;
    await actAsync(async () => {
      tree = renderer.create(
        React.createElement(AlbumDetailView, {
          release: {
            browseId: 'album_test_alb',
            title: 'Acústico MTV',
            year: '2003',
            thumbnailUrl: 'https://example.com/acustico.jpg',
            type: 'album',
          },
          artistName: 'Charlie Brown Jr.',
          onBack: () => {},
          onPlayTrack: () => {},
          onPlayAll: (tracks, idx, opts) => playAllCalls.push({ count: tracks.length, idx, opts }),
          onAddToQueue: () => {},
          onShowToast: (msg) => toasts.push(msg),
        })
      );
    });
    const root = tree.root;

    // 1. Error + Retry
    const retryBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tentar novamente carregar álbum'
    );
    await actAsync(async () => {
      retryBtn.props.onPress();
    });
    assert.strictEqual(attempts, 2);
    assert.ok(getAllText(root).includes('Papo Reto'));

    // Dynamic ambient glow must follow the album cover (same pattern as PlaylistDetailModal)
    const ambientGlow = root.findByType(AmbientGlowBackground);
    assert.strictEqual(ambientGlow.props.artworkUri, 'https://example.com/acustico.jpg');

    // 2. Play & Shuffle buttons
    const playBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar álbum Acústico MTV'
    );
    const shuffleBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar álbum Acústico MTV em modo aleatório'
    );
    await actAsync(async () => {
      playBtn.props.onPress();
      shuffleBtn.props.onPress();
    });
    assert.deepStrictEqual(playAllCalls, [
      { count: 2, idx: 0, opts: { shuffle: false } },
      { count: 2, idx: 0, opts: { shuffle: true } },
    ]);

    // 3. Download all + live progress counter 1/2
    const downloadAllBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Baixar todas as músicas do álbum'
    );
    await actAsync(async () => {
      downloadAllBtn.props.onPress();
    });
    assert.strictEqual(enqueuedTracks.length, 2);
    assert.ok(toasts.some((m) => m.includes('2 músicas adicionadas')));

    await actAsync(async () => {
      queueListener([
        { track: { id: 'ac_1', title: 'Papo Reto', artist: 'Charlie Brown Jr.', duration: 210, formattedDuration: '3:30', thumbnailUrl: '' }, status: 'completed', progress: 1 },
        { track: { id: 'ac_2', title: 'Proibida Pra Mim', artist: 'Charlie Brown Jr.', duration: 210, formattedDuration: '3:30', thumbnailUrl: '' }, status: 'downloading', progress: 0.45 },
      ]);
    });
    assert.ok(getAllText(root).includes('1/2'), 'Top bar download button must display 1/2 progress counter');

    // 4. Open track context menu
    const moreBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Mais opções para Papo Reto'
    );
    await actAsync(async () => {
      moreBtn.props.onPress({ stopPropagation: () => {} });
    });
    assert.ok(getAllText(root).includes('Adicionar ao fim da fila'));

    await actAsync(async () => {
      tree.unmount();
    });
  } finally {
    api.getAlbumDetail = originalGetAlbumDetail;
    storage.subscribeDownloadQueue = originalSubscribe;
    storage.enqueuePlaylistDownload = originalEnqueuePlaylist;
  }
});

test('App Integration: NowPlayingModal minimizes and opens inline ArtistProfileModal using hydrated initialProfile without losing MiniPlayer or TabBar', async () => {
  const originalSearchTracks = api.searchTracks;
  const originalSearchArtists = api.searchArtists;
  const originalGetArtistProfile = api.getArtistProfile;
  const originalGetAudioStream = api.getAudioStream;
  const originalGetRelatedTracks = api.getRelatedTracks;
  const originalGetTrackLyrics = api.getTrackLyrics;

  let profileFetchCount = 0;

  try {
    api.searchTracks = async () => [
      {
        id: 'np_song_1',
        title: 'Céu Azul',
        artist: 'Charlie Brown Jr',
        duration: 199,
        formattedDuration: '3:19',
        thumbnailUrl: 'https://example.com/ceu.jpg',
      },
    ];
    api.searchArtists = async () => [];
    api.getRelatedTracks = async () => [];
    api.getTrackLyrics = async () => null;
    api.getAudioStream = async (videoId) => ({
      videoId,
      title: 'Céu Azul',
      artist: 'Charlie Brown Jr',
      duration: 199,
      thumbnailUrl: 'https://example.com/ceu.jpg',
      streamUrl: 'https://stream.example.com/ceu.m4a',
      mimeType: 'audio/mp4',
      format: 'm4a',
      bitrate: 128000,
    });
    api.getArtistProfile = async () => {
      profileFetchCount += 1;
      return {
        name: 'Charlie Brown Jr.',
        channelId: 'UC_cbjr_np',
        avatarUrl: 'https://example.com/cbjr.jpg',
        bannerUrl: 'https://example.com/cbjr-wide.jpg',
        subtitle: 'Artista • 10,2 mi ouvintes mensais',
        monthlyListenersText: '10,2 mi ouvintes mensais',
        topTracks: [
          {
            id: 'np_song_1',
            title: 'Céu Azul',
            artist: 'Charlie Brown Jr.',
            album: 'Música Popular Caiçara',
            duration: 199,
            formattedDuration: '3:19',
            thumbnailUrl: 'https://example.com/ceu.jpg',
          },
        ],
        albums: [],
        singles: [],
      };
    };

    let tree;
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    // 1. Search and play track so MiniPlayer appears
    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('Céu Azul');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });
    const trackBtn = root.findAll(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Tocar Céu Azul de Charlie Brown Jr'
    )[0];
    assert.ok(trackBtn, 'Search result track button must exist');
    await actAsync(async () => {
      trackBtn.props.onPress();
    });

    // 2. Expand NowPlayingModal from MiniPlayer
    const miniExpand = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        typeof n.props.accessibilityLabel === 'string' &&
        n.props.accessibilityLabel.includes('Toque para expandir player')
    );
    await actAsync(async () => {
      miniExpand.props.onPress();
    });
    const fetchesBeforeOpen = profileFetchCount;

    // 3. Tap "Abrir perfil do artista" inside NowPlayingModal
    const openArtistBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir perfil do artista'
    );
    await actAsync(async () => {
      openArtistBtn.props.onPress();
    });

    // 4. Inline ArtistProfileModal must be open with TabBar visible and hydrated without extra fetch
    assert.ok(root.findByProps({ testID: 'artist-profile-modal' }));
    assert.ok(findButtonByText(root, 'Buscar'), 'TabBar must stay visible after opening artist from NowPlayingModal');
    assert.strictEqual(
      profileFetchCount,
      fetchesBeforeOpen,
      'Normalized initialProfile match ("Charlie Brown Jr" vs "Charlie Brown Jr.") must avoid redundant refetch'
    );

    // 5. Android Back returns cleanly to Search
    await actAsync(async () => {
      assert.strictEqual(dispatchBackPress(), true);
    });
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-profile-modal').length,
      0
    );

    await actAsync(async () => {
      tree.unmount();
    });
  } finally {
    api.searchTracks = originalSearchTracks;
    api.searchArtists = originalSearchArtists;
    api.getArtistProfile = originalGetArtistProfile;
    api.getAudioStream = originalGetAudioStream;
    api.getRelatedTracks = originalGetRelatedTracks;
    api.getTrackLyrics = originalGetTrackLyrics;
  }
});

test('ArtistProfileModal: lazy Ver tudo fetches getArtistTopTracks, ignores stale responses on artist switch, and hides ghost Ver tudo when artist has < 5 tracks', async () => {
  const originalGetArtistProfile = api.getArtistProfile;
  const originalGetArtistTopTracks = api.getArtistTopTracks;

  let resolveSlowTopTracks;
  let topTracksCalls = 0;

  try {
    api.getArtistProfile = async (name) => {
      if (name === 'Tiny Artist') {
        return {
          name: 'Tiny Artist',
          channelId: 'UC_tiny',
          avatarUrl: '',
          songsBrowseId: 'songs_tiny',
          topTracks: [
            { id: 't1', title: 'Only Song', artist: 'Tiny Artist', duration: 180, formattedDuration: '3:00', thumbnailUrl: '' },
          ],
          albums: [],
          singles: [],
        };
      }
      if (name === 'Artist B') {
        return {
          name: 'Artist B',
          channelId: 'UC_b',
          avatarUrl: '',
          topTracks: [
            { id: 'b1', title: 'Song From B', artist: 'Artist B', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
          ],
          albums: [],
          singles: [],
        };
      }
      return {
        name: 'Artist A',
        channelId: 'UC_a',
        avatarUrl: '',
        songsBrowseId: 'songs_a',
        topTracks: Array.from({ length: 5 }, (_, i) => ({
          id: `a_${i + 1}`,
          title: `Track A ${i + 1}`,
          artist: 'Artist A',
          duration: 190,
          formattedDuration: '3:10',
          thumbnailUrl: '',
        })),
        albums: [],
        singles: [],
      };
    };

    api.getArtistTopTracks = async () => {
      topTracksCalls += 1;
      return new Promise((resolve) => {
        resolveSlowTopTracks = resolve;
      });
    };

    // 1. Tiny Artist (< 5 tracks) must NOT show ghost "Ver tudo" even if songsBrowseId is set
    let tree;
    await actAsync(async () => {
      tree = renderer.create(
        React.createElement(ArtistProfileModal, {
          visible: true,
          presentation: 'inline',
          onClose: () => {},
          artistName: 'Tiny Artist',
          onPlayTrack: () => {},
          onStartArtistRadio: () => {},
        })
      );
    });
    assert.strictEqual(
      tree.root.findAll(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver todas as faixas populares'
      ).length,
      0,
      'Must NOT render ghost Ver tudo when artist has fewer than 5 tracks'
    );

    // 2. Switch to Artist A (5 tracks + songsBrowseId) -> click Ver tudo -> switch to Artist B before response settles
    await actAsync(async () => {
      tree.update(
        React.createElement(ArtistProfileModal, {
          visible: true,
          presentation: 'inline',
          onClose: () => {},
          artistName: 'Artist A',
          channelId: 'UC_a',
          onPlayTrack: () => {},
          onStartArtistRadio: () => {},
        })
      );
    });
    const seeAllBtn = tree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver todas as faixas populares'
    );
    await actAsync(async () => {
      seeAllBtn.props.onPress();
    });
    assert.strictEqual(topTracksCalls, 1);

    // Switch to Artist B while Artist A's getArtistTopTracks is still pending
    await actAsync(async () => {
      tree.update(
        React.createElement(ArtistProfileModal, {
          visible: true,
          presentation: 'inline',
          onClose: () => {},
          artistName: 'Artist B',
          channelId: 'UC_b',
          onPlayTrack: () => {},
          onStartArtistRadio: () => {},
        })
      );
    });

    // Now resolve Artist A's late response -> MUST be ignored and NOT overwrite Artist B
    await actAsync(async () => {
      resolveSlowTopTracks([
        { id: 'stale_a', title: 'Stale Track From A', artist: 'Artist A', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
      ]);
    });
    const textB = getAllText(tree.root);
    assert.ok(textB.includes('Song From B'));
    assert.strictEqual(
      textB.includes('Stale Track From A'),
      false,
      'Stale getArtistTopTracks response from Artist A must NOT leak into Artist B'
    );

    await actAsync(async () => {
      tree.unmount();
    });
  } finally {
    api.getArtistProfile = originalGetArtistProfile;
    api.getArtistTopTracks = originalGetArtistTopTracks;
  }
});

test('NowPlayingModal Artist Resolution Regression: resolves inverted "Dancing With You (Baby) - James Smith" (official & 3rd-party uploads) and blocks stale Bruno Mars profile on fast track switch', async () => {
  const NowPlayingModal = require('../components/NowPlayingModal').default;
  const originalGetArtistProfile = api.getArtistProfile;
  const originalGetRelatedTracks = api.getRelatedTracks;
  const originalGetTrackLyrics = api.getTrackLyrics;

  let pendingJamesResolve = null;

  try {
    api.getRelatedTracks = async () => [];
    api.getTrackLyrics = async () => ({ trackId: 'x', type: 'none', lines: [], provider: 'none', cachedAt: Date.now() });
    api.getArtistProfile = async (name) => {
      if (name === 'Bruno Mars') {
        return {
          name: 'Bruno Mars',
          channelId: 'UCZn4r7heNOPY-C43YIywnVA',
          avatarUrl: 'https://example.com/bruno.jpg',
          subtitle: 'Artista • 592 mi ouvintes mensais',
          topTracks: [],
          albums: [],
          singles: [],
        };
      }
      if (name === 'Dancing With You (Baby)') {
        return {
          name: 'Dancing With You (Baby)',
          channelId: undefined,
          avatarUrl: '',
          subtitle: 'Artista',
          topTracks: [],
          albums: [],
          singles: [],
        };
      }
      if (name === 'James Smith') {
        if (pendingJamesResolve === 'DEFER') {
          return new Promise((resolve) => {
            pendingJamesResolve = resolve;
          });
        }
        return {
          name: 'James Smith',
          channelId: 'UCWvOYwCl5b-v10Bdj4BwW7w',
          avatarUrl: 'https://example.com/james.jpg',
          subtitle: 'Artista • 848 mil ouvintes mensais',
          topTracks: [],
          albums: [],
          singles: [],
        };
      }
      if (name === 'Live') {
        return {
          name: 'Live',
          channelId: 'UC_BAND_LIVE',
          avatarUrl: '',
          subtitle: 'Artista • 3 mi ouvintes mensais',
          topTracks: [],
          albums: [],
          singles: [],
        };
      }
      if (name === 'Future') {
        return {
          name: 'Future',
          channelId: 'UC_RAPPER_FUTURE',
          avatarUrl: '',
          subtitle: 'Artista • 50 mi ouvintes mensais',
          topTracks: [],
          albums: [],
          singles: [],
        };
      }
      if (name === 'Failing Channel') {
        throw new Error('Network error');
      }
      return {
        name,
        channelId: undefined,
        avatarUrl: '',
        subtitle: 'Artista',
        topTracks: [],
        albums: [],
        singles: [],
      };
    };

    const openedCalls = [];
    let tree;

    // 1. Official channel inverted title: "Dancing With You (Baby) - James Smith" on "James Smith"
    await actAsync(async () => {
      tree = renderer.create(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {},
          track: {
            id: '5ydkJWXEIU0',
            url: 'https://stream.example.com/1.m4a',
            title: 'Dancing With You (Baby) - James Smith',
            artist: 'James Smith',
            duration: 209,
          },
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          onOpenArtistProfile: (params) => openedCalls.push(params),
        })
      );
    });

    const subtitleBtn1 = tree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver perfil de James Smith'
    );
    await actAsync(async () => {
      subtitleBtn1.props.onPress();
    });
    assert.strictEqual(openedCalls.length, 1);
    assert.strictEqual(openedCalls[0].artistName, 'James Smith');
    assert.strictEqual(openedCalls[0].channelId, 'UCWvOYwCl5b-v10Bdj4BwW7w');
    assert.strictEqual(openedCalls[0].initialProfile?.name, 'James Smith');

    // 2. Third-party upload with inverted title -> falls back from unverified song title to verified right-side artist "James Smith"
    openedCalls.length = 0;
    await actAsync(async () => {
      tree.update(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {},
          track: {
            id: '3rd_party_inv',
            url: 'https://stream.example.com/2.m4a',
            title: 'Dancing With You (Baby) - James Smith',
            artist: 'Indie Vibes',
            duration: 209,
          },
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          onOpenArtistProfile: (params) => openedCalls.push(params),
        })
      );
    });

    const subtitleBtn2 = tree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver perfil de Indie Vibes'
    );
    await actAsync(async () => {
      subtitleBtn2.props.onPress();
    });
    assert.strictEqual(openedCalls.length, 1);
    assert.strictEqual(openedCalls[0].artistName, 'James Smith');
    assert.strictEqual(openedCalls[0].channelId, 'UCWvOYwCl5b-v10Bdj4BwW7w');

    // 3. Fast track switch from Bruno Mars -> James Smith while James Smith fetch is still in flight
    await actAsync(async () => {
      tree.update(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {},
          track: {
            id: 'bruno_1',
            url: 'https://stream.example.com/b.m4a',
            title: 'Die With A Smile',
            artist: 'Bruno Mars',
            duration: 252,
          },
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          onOpenArtistProfile: (params) => openedCalls.push(params),
        })
      );
    });

    openedCalls.length = 0;
    pendingJamesResolve = 'DEFER';

    await actAsync(async () => {
      tree.update(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {},
          track: {
            id: 'james_fast_switch',
            url: 'https://stream.example.com/j.m4a',
            title: 'Dancing With You (Baby) - James Smith',
            artist: 'James Smith',
            duration: 209,
          },
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          onOpenArtistProfile: (params) => openedCalls.push(params),
        })
      );
    });

    const subtitleBtnFast = tree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver perfil de James Smith'
    );
    await actAsync(async () => {
      subtitleBtnFast.props.onPress();
    });

    assert.strictEqual(openedCalls.length, 1);
    assert.strictEqual(openedCalls[0].artistName, 'James Smith');
    assert.strictEqual(
      openedCalls[0].channelId,
      undefined,
      'Must NEVER leak stale Bruno Mars channelId while new artist profile is loading'
    );
    assert.strictEqual(
      openedCalls[0].initialProfile,
      null,
      'Must NEVER leak stale Bruno Mars initialProfile while new artist profile is loading'
    );

    if (typeof pendingJamesResolve === 'function') {
      await actAsync(async () => {
        pendingJamesResolve({
          name: 'James Smith',
          channelId: 'UCWvOYwCl5b-v10Bdj4BwW7w',
          avatarUrl: '',
          subtitle: 'Artista',
          topTracks: [],
          albums: [],
          singles: [],
        });
      });
    }

    // 4. Unverified indie artist on own channel with "Live" or famous-artist song title ("Future") must NEVER hijack
    for (const songSuffix of ['Live', 'Future']) {
      openedCalls.length = 0;
      await actAsync(async () => {
        tree.update(
          React.createElement(NowPlayingModal, {
            visible: true,
            onClose: () => {},
            track: {
              id: `indie_${songSuffix}`,
              url: 'https://stream.example.com/i.m4a',
              title: `Indie Band XYZ - ${songSuffix}`,
              artist: 'Indie Band XYZ',
              duration: 210,
            },
            isPlaying: true,
            isBuffering: false,
            onTogglePlay: () => {},
            onSkipNext: () => {},
            onSkipPrevious: () => {},
            onOpenArtistProfile: (params) => openedCalls.push(params),
          })
        );
      });
      const indieBtn = tree.root.find(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver perfil de Indie Band XYZ'
      );
      await actAsync(async () => {
        indieBtn.props.onPress();
      });
      assert.strictEqual(openedCalls.length, 1);
      assert.strictEqual(openedCalls[0].artistName, 'Indie Band XYZ');
      assert.strictEqual(
        openedCalls[0].channelId,
        undefined,
        `Must NEVER hijack "Indie Band XYZ - ${songSuffix}" into "${songSuffix}"`
      );
    }

    // 5. Updating relatedTracks prop while getArtistProfile is in flight must NOT permanently drop resolved profile
    openedCalls.length = 0;
    pendingJamesResolve = 'DEFER';
    await actAsync(async () => {
      tree.update(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {},
          track: {
            id: 'james_related_race',
            url: 'https://stream.example.com/jr.m4a',
            title: 'Dancing With You (Baby) - James Smith',
            artist: 'James Smith',
            duration: 209,
          },
          relatedTracks: [],
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          onOpenArtistProfile: (params) => openedCalls.push(params),
        })
      );
    });
    await actAsync(async () => {
      tree.update(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {},
          track: {
            id: 'james_related_race',
            url: 'https://stream.example.com/jr.m4a',
            title: 'Dancing With You (Baby) - James Smith',
            artist: 'James Smith',
            duration: 209,
          },
          relatedTracks: [
            { id: 'rel_1', title: 'Other Song', artist: 'James Smith', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
          ],
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          onOpenArtistProfile: (params) => openedCalls.push(params),
        })
      );
    });
    if (typeof pendingJamesResolve === 'function') {
      await actAsync(async () => {
        pendingJamesResolve({
          name: 'James Smith',
          channelId: 'UCWvOYwCl5b-v10Bdj4BwW7w',
          avatarUrl: 'https://example.com/james.jpg',
          subtitle: 'Artista • 848 mil ouvintes mensais',
          topTracks: [],
          albums: [],
          singles: [],
        });
      });
    }
    const subtitleBtnRace = tree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver perfil de James Smith'
    );
    await actAsync(async () => {
      subtitleBtnRace.props.onPress();
    });
    assert.strictEqual(openedCalls.length, 1);
    assert.strictEqual(openedCalls[0].channelId, 'UCWvOYwCl5b-v10Bdj4BwW7w');
    assert.strictEqual(openedCalls[0].initialProfile?.name, 'James Smith');

    // 6. Partial fallback error on 3rd-party upload must not pair track.artist with song-title profile
    openedCalls.length = 0;
    await actAsync(async () => {
      tree.update(
        React.createElement(NowPlayingModal, {
          visible: true,
          onClose: () => {},
          track: {
            id: 'partial_err_3rd',
            url: 'https://stream.example.com/pe.m4a',
            title: 'Dancing With You (Baby) - Unverified Local Singer',
            artist: 'Failing Channel',
            duration: 209,
          },
          isPlaying: true,
          isBuffering: false,
          onTogglePlay: () => {},
          onSkipNext: () => {},
          onSkipPrevious: () => {},
          onOpenArtistProfile: (params) => openedCalls.push(params),
        })
      );
    });
    const partialBtn = tree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ver perfil de Failing Channel'
    );
    await actAsync(async () => {
      partialBtn.props.onPress();
    });
    assert.strictEqual(openedCalls.length, 1);
    assert.strictEqual(openedCalls[0].artistName, 'Failing Channel');
    assert.strictEqual(openedCalls[0].initialProfile, null);

    await actAsync(async () => {
      tree.unmount();
    });
  } finally {
    api.getArtistProfile = originalGetArtistProfile;
    api.getRelatedTracks = originalGetRelatedTracks;
    api.getTrackLyrics = originalGetTrackLyrics;
  }
});

