// media-provider/tests/artist_and_album_provider.test.js
const test = require('node:test');
const assert = require('node:assert');
const api = require('../../services/api');
const { initDatabase } = require('../../services/database');
const { resetAllMocks } = require('../../tests/helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
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

