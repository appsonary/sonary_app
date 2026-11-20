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

test('Artist API: parses real /browse header, topTracks with album & VLOLAK durations, real Albums/Singles/RelatedArtists, ignores Videos/Podcasts, and never fabricates fake albums', async () => {
  const originalFetch = global.fetch;
  const fetchCalls = [];

  try {
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      fetchCalls.push({ url: String(url), browseId: body.browseId, params: body.params });

      if (body.browseId === 'UC_cbjr_real') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            header: {
              musicImmersiveHeaderRenderer: {
                title: { runs: [{ text: 'Charlie Brown Jr.' }] },
                description: { runs: [{ text: 'Banda icônica de Santos misturando rock, skate e rap.' }] },
                monthlyListenerCount: { runs: [{ text: '10,2 mi ouvintes mensais' }] },
                subscriptionButton: {
                  subscribeButtonRenderer: {
                    longSubscriberCountText: { runs: [{ text: '2,7 mi de inscritos' }] },
                  },
                },
                thumbnail: {
                  musicThumbnailRenderer: {
                    thumbnail: {
                      thumbnails: [
                        { width: 540, height: 225, url: 'https://lh3.googleusercontent.com/w540' },
                        { width: 1440, height: 600, url: 'https://lh3.googleusercontent.com/w1440' },
                        { width: 2880, height: 1200, url: 'https://lh3.googleusercontent.com/w2880' },
                      ],
                    },
                  },
                },
              },
            },
            contents: {
              singleColumnBrowseResultsRenderer: {
                tabs: [
                  {
                    tabRenderer: {
                      content: {
                        sectionListRenderer: {
                          contents: [
                            {
                              musicShelfRenderer: {
                                title: { runs: [{ text: 'Top músicas' }] },
                                bottomEndpoint: {
                                  browseEndpoint: {
                                    browseId: 'VLOLAK_cbjr_top',
                                    params: 'ggMCCAI%3D',
                                  },
                                },
                                contents: [
                                  {
                                    musicResponsiveListItemRenderer: {
                                      playlistItemData: { videoId: 'vid_ceu' },
                                      flexColumns: [
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Céu Azul' }] } } },
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Charlie Brown Jr.' }] } } },
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Tocou 411 mi vezes' }] } } },
                                        {
                                          musicResponsiveListItemFlexColumnRenderer: {
                                            text: {
                                              runs: [
                                                {
                                                  text: 'Música Popular Caiçara',
                                                  navigationEndpoint: {
                                                    browseEndpoint: {
                                                      browseId: 'MPREb_mpc',
                                                      browseEndpointContextSupportedConfigs: {
                                                        browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' },
                                                      },
                                                    },
                                                  },
                                                },
                                              ],
                                            },
                                          },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              musicCarouselShelfRenderer: {
                                header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Álbuns' }] } } },
                                contents: [
                                  {
                                    musicTwoRowItemRenderer: {
                                      title: { runs: [{ text: 'Camisa 10' }] },
                                      subtitle: { runs: [{ text: '2009' }] },
                                      navigationEndpoint: {
                                        browseEndpoint: {
                                          browseId: 'MPREb_camisa10',
                                          browseEndpointContextSupportedConfigs: {
                                            browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' },
                                          },
                                        },
                                      },
                                      thumbnailRenderer: {
                                        musicThumbnailRenderer: {
                                          thumbnail: { thumbnails: [{ width: 544, height: 544, url: 'https://example.com/camisa10.jpg' }] },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              musicCarouselShelfRenderer: {
                                header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Singles e EPs' }] } } },
                                contents: [
                                  {
                                    musicTwoRowItemRenderer: {
                                      title: { runs: [{ text: 'Zóio de Lula' }] },
                                      subtitle: { runs: [{ text: 'Single' }, { text: ' • ' }, { text: '2019' }] },
                                      navigationEndpoint: {
                                        browseEndpoint: {
                                          browseId: 'MPREb_zoio',
                                          browseEndpointContextSupportedConfigs: {
                                            browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' },
                                          },
                                        },
                                      },
                                      thumbnailRenderer: {
                                        musicThumbnailRenderer: {
                                          thumbnail: { thumbnails: [{ width: 544, height: 544, url: 'https://example.com/zoio.jpg' }] },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              musicCarouselShelfRenderer: {
                                header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Vídeos' }] } } },
                                contents: [
                                  {
                                    musicTwoRowItemRenderer: {
                                      title: { runs: [{ text: 'Clipe Ignorado' }] },
                                      navigationEndpoint: { browseEndpoint: { browseId: 'VIDEO_IGNORED' } },
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              musicCarouselShelfRenderer: {
                                header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Os fãs também podem gostar de...' }] } } },
                                contents: [
                                  {
                                    musicTwoRowItemRenderer: {
                                      title: { runs: [{ text: 'Marcelo Falcão' }] },
                                      subtitle: { runs: [{ text: '1,48 mi ouvintes mensais' }] },
                                      navigationEndpoint: {
                                        browseEndpoint: {
                                          browseId: 'UC_falcao',
                                          browseEndpointContextSupportedConfigs: {
                                            browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' },
                                          },
                                        },
                                      },
                                      thumbnailRenderer: {
                                        musicThumbnailRenderer: {
                                          thumbnail: { thumbnails: [{ width: 544, height: 544, url: 'https://example.com/falcao.jpg' }] },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          }),
        };
      }

      if (body.browseId === 'VLOLAK_cbjr_top') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contents: {
              singleColumnBrowseResultsRenderer: {
                tabs: [
                  {
                    tabRenderer: {
                      content: {
                        sectionListRenderer: {
                          contents: [
                            {
                              musicPlaylistShelfRenderer: {
                                contents: [
                                  {
                                    musicResponsiveListItemRenderer: {
                                      playlistItemData: { videoId: 'vid_loucos' },
                                      flexColumns: [
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Só os Loucos Sabem' }] } } },
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Charlie Brown Jr.' }] } } },
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Tocou 500 mi vezes' }] } } },
                                        {
                                          musicResponsiveListItemFlexColumnRenderer: {
                                            text: {
                                              runs: [
                                                {
                                                  text: 'Camisa 10',
                                                  navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_camisa10' } },
                                                },
                                              ],
                                            },
                                          },
                                        },
                                      ],
                                      fixedColumns: [
                                        { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:26' }] } } },
                                      ],
                                    },
                                  },
                                  {
                                    musicResponsiveListItemRenderer: {
                                      playlistItemData: { videoId: 'vid_ceu' },
                                      flexColumns: [
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Céu Azul' }] } } },
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Charlie Brown Jr.' }] } } },
                                        {
                                          musicResponsiveListItemFlexColumnRenderer: {
                                            text: {
                                              runs: [
                                                {
                                                  text: 'Música Popular Caiçara',
                                                  navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_mpc' } },
                                                },
                                              ],
                                            },
                                          },
                                        },
                                      ],
                                      fixedColumns: [
                                        { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:19' }] } } },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          }),
        };
      }

      throw new Error(`Unexpected browseId: ${body.browseId}`);
    };

    const profile = await api.getArtistProfile('Charlie Brown Jr.', 'UC_cbjr_real');
    assert.strictEqual(profile.name, 'Charlie Brown Jr.');
    assert.strictEqual(profile.bannerUrl, 'https://lh3.googleusercontent.com/w1440', 'Should cap banner width <= 1920');
    assert.strictEqual(profile.subtitle, 'Artista • 10,2 mi ouvintes mensais');
    assert.strictEqual(profile.songsBrowseId, 'VLOLAK_cbjr_top');
    assert.strictEqual(profile.topTracks.length, 2, 'Should enrich topTracks from VLOLAK songs playlist');
    assert.strictEqual(profile.topTracks[0].title, 'Só os Loucos Sabem');
    assert.strictEqual(profile.topTracks[0].album, 'Camisa 10');
    assert.strictEqual(profile.topTracks[0].formattedDuration, '3:26');
    assert.strictEqual(profile.albums.length, 1);
    assert.strictEqual(profile.albums[0].browseId, 'MPREb_camisa10');
    assert.strictEqual(profile.albums[0].year, '2009');
    assert.strictEqual(profile.singles.length, 1);
    assert.strictEqual(profile.singles[0].browseId, 'MPREb_zoio');
    assert.strictEqual(profile.singles[0].type, 'single');
    assert.strictEqual(profile.relatedArtists?.length, 1);
    assert.strictEqual(profile.relatedArtists[0].id, 'UC_falcao');
    assert.strictEqual(fetchCalls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Artist API: resolves channelId via searchArtists when omitted and never fabricates albums when /browse has no album shelves', async () => {
  const originalFetch = global.fetch;
  const originalSearchArtists = api.searchArtists;
  let resolvedSearchQuery = null;

  try {
    api.searchArtists = async (q) => {
      resolvedSearchQuery = q;
      return [{ id: 'UC_resolved_123', name: 'Indie Artist', subtitle: 'Artista • 50 mil ouvintes', thumbnailUrl: 'https://example.com/indie.jpg' }];
    };
    global.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.strictEqual(body.browseId, 'UC_resolved_123');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          header: {
            musicImmersiveHeaderRenderer: {
              title: { runs: [{ text: 'Indie Artist' }] },
            },
          },
          contents: {
            singleColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicShelfRenderer: {
                              contents: [
                                {
                                  musicResponsiveListItemRenderer: {
                                    playlistItemData: { videoId: 'indie_t1' },
                                    flexColumns: [
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Track One' }] } } },
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Indie Artist' }] } } },
                                    ],
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      };
    };

    const profile = await api.getArtistProfile('Indie Artist');
    assert.strictEqual(resolvedSearchQuery, 'Indie Artist');
    assert.strictEqual(profile.channelId, 'UC_resolved_123');
    assert.strictEqual(profile.albums.length, 0, 'Must never fabricate fake albums from topTracks');
    assert.strictEqual(profile.singles.length, 0, 'Must never fabricate fake singles from topTracks');
    assert.strictEqual(profile.topTracks[0].formattedDuration, '', 'Must not invent fake 3:30 duration');
  } finally {
    global.fetch = originalFetch;
    api.searchArtists = originalSearchArtists;
  }
});

test('Album API: getAlbumDetail parses real twoColumnBrowseResultsRenderer header and secondaryContents tracks', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.strictEqual(body.browseId, 'MPREb_camisa10');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          contents: {
            twoColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicResponsiveHeaderRenderer: {
                              title: { runs: [{ text: 'Camisa 10' }] },
                              subtitle: { runs: [{ text: 'Álbum' }, { text: ' • ' }, { text: '2009' }] },
                              straplineTextOne: { runs: [{ text: 'Charlie Brown Jr.' }] },
                              thumbnail: {
                                musicThumbnailRenderer: {
                                  thumbnail: { thumbnails: [{ width: 544, height: 544, url: 'https://example.com/camisa10-hd.jpg' }] },
                                },
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
              secondaryContents: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        contents: [
                          {
                            musicResponsiveListItemRenderer: {
                              playlistItemData: { videoId: 'alb_t1' },
                              flexColumns: [
                                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Dona do Meu Pensamento' }] } } },
                              ],
                              fixedColumns: [
                                { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:55' }] } } },
                              ],
                            },
                          },
                          {
                            musicResponsiveListItemRenderer: {
                              playlistItemData: { videoId: 'alb_t2' },
                              flexColumns: [
                                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Só os Loucos Sabem' }] } } },
                              ],
                              fixedColumns: [
                                { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:26' }] } } },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      };
    };

    const album = await api.getAlbumDetail('MPREb_camisa10');
    assert.strictEqual(album.title, 'Camisa 10');
    assert.strictEqual(album.artist, 'Charlie Brown Jr.');
    assert.strictEqual(album.year, '2009');
    assert.strictEqual(album.thumbnailUrl, 'https://example.com/camisa10-hd.jpg');
    assert.strictEqual(album.trackCount, 2);
    assert.strictEqual(album.totalDuration, 235 + 206);
    assert.strictEqual(album.tracks[0].title, 'Dona do Meu Pensamento');
    assert.strictEqual(album.tracks[0].thumbnailUrl, 'https://example.com/camisa10-hd.jpg');
    assert.strictEqual(album.tracks[0].album, 'Camisa 10');
  } finally {
    global.fetch = originalFetch;
  }
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
          browseId: 'MPREb_camisa10',
          title: 'Camisa 10',
          year: '2009',
          thumbnailUrl: 'https://example.com/camisa10.jpg',
          type: 'album',
        },
      ],
      singles: [
        {
          browseId: 'MPREb_zoio',
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
    browseId: 'MPREb_camisa10',
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

test('Artist API: rejects on total network failure without poisoning cache so subsequent retry succeeds', async () => {
  const originalFetch = global.fetch;
  const originalSearchTracks = api.searchTracks;
  let online = false;

  try {
    api.searchTracks = async () => {
      if (!online) throw new Error('Offline');
      return [];
    };
    global.fetch = async () => {
      if (!online) throw new Error('Network unreachable');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          header: {
            musicImmersiveHeaderRenderer: {
              title: { runs: [{ text: 'Recovered Artist' }] },
            },
          },
          contents: {
            singleColumnBrowseResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicShelfRenderer: {
                              contents: [
                                {
                                  musicResponsiveListItemRenderer: {
                                    playlistItemData: { videoId: 'rec_1' },
                                    flexColumns: [
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Recovered Song' }] } } },
                                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Recovered Artist' }] } } },
                                    ],
                                    fixedColumns: [
                                      { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:10' }] } } },
                                    ],
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      };
    };

    await assert.rejects(
      () => api.getArtistProfile('Recovered Artist', 'UC_rec_1'),
      /carregar os dados do artista/i,
      'getArtistProfile must reject on total network failure so UI can render Retry'
    );

    // Network comes back WITHOUT clearing cache -> must NOT serve a cached empty profile
    online = true;
    const recovered = await api.getArtistProfile('Recovered Artist', 'UC_rec_1');
    assert.strictEqual(recovered.name, 'Recovered Artist');
    assert.strictEqual(recovered.topTracks.length, 1);
    assert.strictEqual(recovered.topTracks[0].id, 'rec_1');
  } finally {
    global.fetch = originalFetch;
    api.searchTracks = originalSearchTracks;
  }
});

test('Album API: preserves short intro/interlude tracks (< 45s) and falls back to searchTracks when /browse fails', async () => {
  const originalFetch = global.fetch;
  const originalSearchTracks = api.searchTracks;

  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        contents: {
          twoColumnBrowseResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        {
                          musicResponsiveHeaderRenderer: {
                            title: { runs: [{ text: 'Meteora' }] },
                            subtitle: { runs: [{ text: 'Álbum • 2003' }] },
                            straplineTextOne: { runs: [{ text: 'Linkin Park' }] },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
            secondaryContents: {
              sectionListRenderer: {
                contents: [
                  {
                    musicShelfRenderer: {
                      contents: [
                        {
                          musicResponsiveListItemRenderer: {
                            playlistItemData: { videoId: 'lp_intro' },
                            flexColumns: [
                              { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Foreword' }] } } },
                            ],
                            fixedColumns: [
                              { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '0:13' }] } } },
                            ],
                          },
                        },
                        {
                          musicResponsiveListItemRenderer: {
                            playlistItemData: { videoId: 'lp_dontstay' },
                            flexColumns: [
                              { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Don't Stay" }] } } },
                            ],
                            fixedColumns: [
                              { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:08' }] } } },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    });

    const album = await api.getAlbumDetail('MPREb_meteora');
    assert.strictEqual(album.trackCount, 2, 'Album tracklist must keep 13s intro track');
    assert.strictEqual(album.tracks[0].title, 'Foreword');
    assert.strictEqual(album.tracks[0].duration, 13);

    // Fallback path when /browse fails
    global.fetch = async () => {
      throw new Error('Browse offline');
    };
    api.searchTracks = async (q) => {
      assert.ok(q.includes('Linkin Park') && q.includes('Hybrid Theory'));
      return [
        {
          id: 'ht_1',
          title: 'Papercut',
          artist: 'Linkin Park',
          duration: 185,
          formattedDuration: '3:05',
          thumbnailUrl: 'https://example.com/ht.jpg',
        },
      ];
    };

    const fallbackAlbum = await api.getAlbumDetail('MPREb_ht_fail', {
      title: 'Hybrid Theory',
      artist: 'Linkin Park',
      type: 'album',
    });
    assert.strictEqual(fallbackAlbum.tracks.length, 1);
    assert.strictEqual(fallbackAlbum.tracks[0].id, 'ht_1');
  } finally {
    global.fetch = originalFetch;
    api.searchTracks = originalSearchTracks;
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
        browseId: 'MPREb_test_alb',
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
            browseId: 'MPREb_test_alb',
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
        n.props.accessibilityLabel.includes('Expandir player')
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
          songsBrowseId: 'VLOLAK_tiny',
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
        songsBrowseId: 'VLOLAK_a',
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
