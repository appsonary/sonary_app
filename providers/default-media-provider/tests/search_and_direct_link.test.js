// providers/default-media-provider/tests/search_and_direct_link.test.js
const test = require('node:test');
const assert = require('node:assert');
const api = require('../../../services/api');
const provider = require('../index');
const { resetAllMocks } = require('../../../tests/helpers/testUtils');
const { initDatabase } = require('../../../services/database');

const originalSearchTracks = api.searchTracks;
const originalSearchTracksPage = api.searchTracksPage;

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test.afterEach(() => {
  api.searchTracks = originalSearchTracks;
  api.searchTracksPage = originalSearchTracksPage;
});

test('Flow 2: Infinite Radio getRelatedTracks returns related tracks', async () => {
  const origFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('youtubei/v1/next')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contents: {
              singleColumnMusicWatchNextResultsRenderer: {
                tabbedRenderer: {
                  watchNextTabbedResultsRenderer: {
                    tabs: [
                      {
                        tabRenderer: {
                          content: {
                            musicQueueRenderer: {
                              content: {
                                playlistPanelRenderer: {
                                  contents: [
                                    {
                                      playlistPanelVideoRenderer: {
                                        videoId: 'rel_1',
                                        title: { runs: [{ text: 'Adventure of a Lifetime' }] },
                                        shortBylineText: { runs: [{ text: 'Coldplay' }] },
                                        lengthText: { runs: [{ text: '4:23' }] },
                                        thumbnail: { thumbnails: [{ url: 'https://example.com/rel1.jpg' }] },
                                      },
                                    },
                                    {
                                      playlistPanelVideoRenderer: {
                                        videoId: 'rel_2',
                                        title: { runs: [{ text: 'Paradise' }] },
                                        shortBylineText: { runs: [{ text: 'Coldplay' }] },
                                        lengthText: { runs: [{ text: '4:38' }] },
                                        thumbnail: { thumbnails: [{ url: 'https://example.com/rel2.jpg' }] },
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
        };
      }
      return origFetch(url);
    };

    const related = await api.getRelatedTracks('coldplay_1');
    assert.strictEqual(related.length, 2, 'Should return 2 related tracks');
    assert.strictEqual(related[0].id, 'rel_1');
    assert.strictEqual(related[0].title, 'Adventure of a Lifetime');
    assert.strictEqual(related[1].id, 'rel_2');
    assert.strictEqual(related[1].title, 'Paradise');
  } finally {
    global.fetch = origFetch;
  }
});

test('Flow 2: searchTracksPage paginates InnerTube results to at least 30 unique tracks and Load More appends without duplicates', async () => {
  const origFetch = global.fetch;
  const makePageItems = (start, count, token) => {
    const items = Array.from({ length: count }, (_, idx) => {
      const n = start + idx;
      return {
        videoRenderer: {
          videoId: `vid_${n}`,
          title: { runs: [{ text: `Track ${n}` }] },
          shortBylineText: { runs: [{ text: `Artist ${n}` }] },
          lengthText: { runs: [{ text: '3:15' }] },
          thumbnail: { thumbnails: [{ url: `https://example.com/${n}.jpg` }] },
        },
      };
    });
    if (token) {
      items.push({
        continuationItemRenderer: {
          continuationEndpoint: { continuationCommand: { token } },
        },
      });
    }
    return items;
  };

  try {
    global.fetch = async (url, init) => {
      if (typeof url === 'string' && url.includes('youtube.com/youtubei/v1/search')) {
        const body = JSON.parse(init?.body || '{}');
        const token = body.continuation || null;
        if (!token) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              contents: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: makePageItems(1, 19, null),
                        continuations: [{ nextContinuationData: { continuation: 'tok_p2' } }],
                      },
                    },
                  ],
                  continuations: [{ reloadContinuationData: { continuation: 'reload_ignored' } }],
                },
              },
            }),
          };
        }
        if (token === 'tok_p2') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              continuationContents: {
                itemSectionContinuation: {
                  // Includes overlapping vid_19 to verify dedup
                  contents: makePageItems(19, 19, null),
                  continuations: [{ nextContinuationData: { continuation: 'tok_p3' } }],
                },
              },
            }),
          };
        }
        if (token === 'tok_p3') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              onResponseReceivedCommands: [
                {
                  appendContinuationItemsAction: {
                    continuationItems: makePageItems(38, 19, 'tok_p4'),
                  },
                },
              ],
            }),
          };
        }
        if (token === 'tok_p4') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              onResponseReceivedCommands: [
                {
                  appendContinuationItemsAction: {
                    continuationItems: makePageItems(57, 19, null),
                  },
                },
              ],
            }),
          };
        }
      }
      return origFetch(url, init);
    };

    const firstBatch = await api.searchTracksPage('lofi', { targetCount: 30 });
    assert.ok(firstBatch.tracks.length >= 30, `Expected >= 30 initial tracks, got ${firstBatch.tracks.length}`);
    assert.strictEqual(new Set(firstBatch.tracks.map((t) => t.id)).size, firstBatch.tracks.length);
    assert.strictEqual(firstBatch.continuationToken, 'tok_p3');

    const seenIds = new Set(firstBatch.tracks.map((t) => t.id));
    const secondBatch = await api.searchTracksPage('lofi', {
      targetCount: 30,
      continuationToken: firstBatch.continuationToken,
      excludeIds: seenIds,
    });
    assert.ok(secondBatch.tracks.length >= 30, `Expected >= 30 load-more tracks, got ${secondBatch.tracks.length}`);
    assert.ok(
      secondBatch.tracks.every((t) => !seenIds.has(t.id)),
      'Load more batch must exclude tracks already returned in earlier batches'
    );
    assert.strictEqual(secondBatch.continuationToken, null);
  } finally {
    global.fetch = origFetch;
  }
});


test('Flow 2: searchArtists parses YouTube Music WEB_REMIX payload, defaults to 12, filters UC browseIds, deduplicates and upgrades thumbnail', async () => {
  const originalFetch = global.fetch;
  try {
    const makeArtistEntry = (idx, id, name) => ({
      musicResponsiveListItemRenderer: {
        navigationEndpoint: { browseEndpoint: { browseId: id } },
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: name }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: `Artista • ${idx}M ouvintes` }] } } },
        ],
        thumbnail: {
          musicThumbnailRenderer: {
            thumbnail: {
              thumbnails: [
                { url: `https://lh3.googleusercontent.com/artist_${idx}=w120-h120-p-l90-rj` },
              ],
            },
          },
        },
      },
    });

    const rawItems = [
      makeArtistEntry(0, 'VL_not_an_artist', 'Playlist Ignorada'),
      makeArtistEntry(0, 'MPREb_album_1', 'Álbum Ignorado'),
      makeArtistEntry(1, 'UC_1', 'Charlie Brown Jr.'),
      makeArtistEntry(1, 'UC_1', 'Charlie Brown Jr.'), // duplicata por id
      makeArtistEntry(1, 'UC_1_DUP', 'charlie brown jr.'), // duplicata por nome normalizado
      makeArtistEntry(2, 'UC_2', 'Chorão'),
      makeArtistEntry(3, 'UC_3', 'Raimundos'),
      makeArtistEntry(4, 'UC_4', 'CPM 22'),
      makeArtistEntry(5, 'UC_5', 'O Rappa'),
      makeArtistEntry(6, 'UC_6', 'Detonautas'),
      makeArtistEntry(7, 'UC_7', 'NX Zero'),
      makeArtistEntry(8, 'UC_8', 'Pitty'),
      makeArtistEntry(9, 'UC_9', 'Skank'),
      makeArtistEntry(10, 'UC_10', 'Jota Quest'),
      makeArtistEntry(11, 'UC_11', 'Capital Inicial'),
      makeArtistEntry(12, 'UC_12', 'Legião Urbana'),
      makeArtistEntry(13, 'UC_13', 'Artista Extra 13'),
    ];

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [{ musicShelfRenderer: { contents: rawItems } }],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    });

    const artists = await api.searchArtists('Charlie Brown Jr');
    assert.strictEqual(artists.length, 12, 'Must default to at most 12 artists');
    assert.ok(
      artists.every((a) => a.id.startsWith('UC')),
      'Must only accept browseIds starting with UC'
    );
    assert.strictEqual(artists[0].id, 'UC_1');
    assert.strictEqual(artists[0].name, 'Charlie Brown Jr.');
    assert.strictEqual(
      artists[0].thumbnailUrl,
      'https://lh3.googleusercontent.com/artist_1=w240-h240-p-l90-rj'
    );
    assert.strictEqual(artists[11].name, 'Legião Urbana');

    const capped = await api.searchArtists('Charlie Brown Jr', 3);
    assert.strictEqual(capped.length, 3, 'Must respect custom limit');

    // Fallback silencioso em erro HTTP
    global.fetch = async () => ({ ok: false, status: 500 });
    const emptyOnError = await api.searchArtists('Charlie Brown Jr');
    assert.deepStrictEqual(emptyOnError, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Flow 2: getArtistProfile prioritizes real Top Tracks from /browse musicShelfRenderer over searchTracks fallback', async () => {
  const originalFetch = global.fetch;
  const originalSearchTracks = api.searchTracks;
  let searchFallbackCalls = 0;

  try {
    api.searchTracks = async () => {
      searchFallbackCalls += 1;
      return [
        {
          id: 'fallback_1',
          title: 'Fallback Track',
          artist: 'Charlie Brown Jr.',
          duration: 200,
          formattedDuration: '3:20',
          thumbnailUrl: 'https://example.com/fb.jpg',
        },
      ];
    };

    global.fetch = async (url) => {
      assert.ok(String(url).includes('/youtubei/v1/browse'));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          header: {
            musicImmersiveHeaderRenderer: {
              thumbnail: {
                musicThumbnailRenderer: {
                  thumbnail: {
                    thumbnails: [{ url: 'https://example.com/cbjr-avatar.jpg' }],
                  },
                },
              },
              description: { runs: [{ text: 'Banda de rock brasileiro.' }] },
              subscriptionButton: {
                subscribeButtonRenderer: {
                  subscriberCountText: { runs: [{ text: '4,5 mi inscritos' }] },
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
                              contents: [
                                {
                                  musicResponsiveListItemRenderer: {
                                    playlistItemData: { videoId: 'ceu_azul_id' },
                                    flexColumns: [
                                      {
                                        musicResponsiveListItemFlexColumnRenderer: {
                                          text: { runs: [{ text: 'Céu Azul' }] },
                                        },
                                      },
                                      {
                                        musicResponsiveListItemFlexColumnRenderer: {
                                          text: { runs: [{ text: 'Charlie Brown Jr.' }] },
                                        },
                                      },
                                    ],
                                    fixedColumns: [
                                      {
                                        musicResponsiveListItemFixedColumnRenderer: {
                                          text: { runs: [{ text: '3:19' }] },
                                        },
                                      },
                                    ],
                                    thumbnail: {
                                      musicThumbnailRenderer: {
                                        thumbnail: {
                                          thumbnails: [{ url: 'https://example.com/ceu-azul.jpg' }],
                                        },
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
    };

    const profile = await api.getArtistProfile('Charlie Brown Jr. Browse', 'UC_cbjr_browse_test');
    assert.strictEqual(profile.avatarUrl, 'https://example.com/cbjr-avatar.jpg');
    assert.strictEqual(profile.topTracks.length, 1);
    assert.strictEqual(profile.topTracks[0].id, 'ceu_azul_id');
    assert.strictEqual(profile.topTracks[0].title, 'Céu Azul');
    assert.strictEqual(profile.topTracks[0].formattedDuration, '3:19');
    assert.strictEqual(
      searchFallbackCalls,
      0,
      'Must prioritize /browse musicShelfRenderer tracks without calling searchTracks fallback'
    );
  } finally {
    global.fetch = originalFetch;
    api.searchTracks = originalSearchTracks;
  }
});


function buildInnerTubeTracksFetchMock(trackSpecs, continuationToken = null) {
  const contents = trackSpecs.map((spec, idx) => ({
    videoRenderer: {
      videoId: spec.id || `it_vid_${idx + 1}`,
      title: { runs: [{ text: spec.title }] },
      shortBylineText: { runs: [{ text: spec.artist }] },
      lengthText: { runs: [{ text: spec.duration || '3:45' }] },
      thumbnail: { thumbnails: [{ url: `https://example.com/it_${idx + 1}.jpg` }] },
    },
  }));

  return async (url) => {
    if (typeof url === 'string' && url.includes('youtube.com/youtubei/v1/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          contents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents,
                    ...(continuationToken
                      ? { continuations: [{ nextContinuationData: { continuation: continuationToken } }] }
                      : {}),
                  },
                },
              ],
            },
          },
        }),
      };
    }
    throw new Error(`Unexpected fetch URL in artist inference test: ${url}`);
  };
}

test('Flow 2: Artist inference Case A recovers dominant artist when primary artist search is empty (including fan upload "Avenged Sevenfold - Live In The LBC" on "TSTS")', async () => {
  const originalFetch = global.fetch;
  const originalSearchArtists = api.searchArtists;
  const artistCalls = [];

  try {
    const tracks = [
      { title: 'Avenged Sevenfold - Hail to the King', artist: 'Avenged Sevenfold' },
      { title: 'Nightmare', artist: 'Avenged Sevenfold - Topic' },
      { title: 'Avenged Sevenfold - Live In The LBC', artist: 'TSTS' },
      { title: 'Afterlife', artist: 'Avenged SevenfoldVEVO' },
      { title: 'Stanford University Campus Tour', artist: 'Campus Vlog' },
    ];

    // Unit verification of inferDominantArtistFromTracks counting fan upload + Topic + VEVO
    const inferred = api.inferDominantArtistFromTracks(
      tracks.map((t, i) => ({
        id: `a7x_${i}`,
        title: t.title,
        artist: t.artist,
        duration: 240,
        formattedDuration: '4:00',
        thumbnailUrl: 'https://example.com/a7x.jpg',
      }))
    );
    assert.ok(inferred, 'Should infer Avenged Sevenfold');
    assert.strictEqual(inferred.name, 'Avenged Sevenfold');
    assert.strictEqual(inferred.count, 4, 'Fan upload "Avenged Sevenfold - Live In The LBC" on TSTS must be counted');
    assert.strictEqual(inferred.total, 5);

    global.fetch = buildInnerTubeTracksFetchMock(tracks);
    api.searchArtists = async (q, limit) => {
      artistCalls.push({ q, limit });
      if (q === 'avenged stanford') return [];
      if (q === 'Avenged Sevenfold') {
        return [
          {
            id: 'UC_a7x',
            name: 'Avenged Sevenfold',
            subtitle: 'Artista • 12 mi ouvintes mensais',
            thumbnailUrl: 'https://example.com/a7x-avatar.jpg',
          },
        ];
      }
      return [];
    };

    const page = await api.searchTracksPage('avenged stanford', { targetCount: 5 });
    assert.strictEqual(page.tracks.length, 5);
    assert.deepStrictEqual(
      artistCalls.map((c) => c.q),
      ['avenged stanford', 'Avenged Sevenfold'],
      'Should run primary artist search and then fallback with inferred dominant artist'
    );
    assert.strictEqual(page.artists.length, 1);
    assert.strictEqual(page.artists[0].id, 'UC_a7x');
    assert.strictEqual(page.artists[0].name, 'Avenged Sevenfold');

    // Resilience: fallback failure degrades silently to [] without failing track search
    api.searchArtists = async (q) => {
      if (q === 'avenged stanford') return [];
      throw new Error('YTM temporary outage');
    };
    const resilientPage = await api.searchTracksPage('avenged stanford', { targetCount: 5 });
    assert.strictEqual(resilientPage.tracks.length, 5);
    assert.deepStrictEqual(resilientPage.artists, []);
  } finally {
    global.fetch = originalFetch;
    api.searchArtists = originalSearchArtists;
  }
});

test('Flow 2: Artist inference Case B promotes dominant artist on strong divergence ("three days grape" -> "Three Days Grace"), deduplicates by id/name, caps at 12, ignores tribute matches, and preserves primary on fallback failure', async () => {
  const originalFetch = global.fetch;
  const originalSearchArtists = api.searchArtists;
  const artistCalls = [];

  try {
    const tracks = [
      { title: 'I Hate Everything About You', artist: 'Three Days Grace - Topic' },
      { title: 'Animal I Have Become', artist: 'Three Days GraceVEVO' },
      { title: 'Three Days Grace - Never Too Late', artist: 'RockFanChannel' },
      { title: 'Pain', artist: 'Three Days Grace' },
      { title: 'Riot', artist: 'Three Days Grace' },
      { title: 'Grapevine', artist: 'Big Moochie Grape' },
      { title: 'Omaha', artist: 'Moby Grape' },
      { title: 'Random Rock Mix', artist: 'Rock Mixes' },
    ];

    global.fetch = buildInnerTubeTracksFetchMock(tracks);
    api.searchArtists = async (q) => {
      artistCalls.push(q);
      if (q === 'three days grape') {
        return [
          { id: 'UC_big_grape', name: 'Big Moochie Grape', thumbnailUrl: 'https://example.com/g1.jpg' },
          { id: 'UC_moby_grape', name: 'Moby Grape', thumbnailUrl: 'https://example.com/g2.jpg' },
          { id: 'UC_tribute', name: 'The Three Days Grace Tribute', thumbnailUrl: 'https://example.com/tr.jpg' },
          ...Array.from({ length: 10 }, (_, i) => ({
            id: `UC_prim_extra_${i + 1}`,
            name: `Primary Extra ${i + 1}`,
            thumbnailUrl: '',
          })),
        ];
      }
      if (q === 'Three Days Grace') {
        return [
          { id: 'UC_tdg', name: 'Three Days Grace', thumbnailUrl: 'https://example.com/tdg.jpg' },
          { id: 'UC_saint', name: 'Saint Asonia', thumbnailUrl: 'https://example.com/sa.jpg' },
          { id: 'UC_big_grape_dup', name: 'big moochie grape', thumbnailUrl: 'https://example.com/g1b.jpg' },
          { id: 'UC_moby_grape', name: 'Moby Grape Official', thumbnailUrl: 'https://example.com/g2b.jpg' },
        ];
      }
      return [];
    };

    const page = await api.searchTracksPage('three days grape', { targetCount: 8 });
    assert.deepStrictEqual(
      artistCalls,
      ['three days grape', 'Three Days Grace'],
      'Tribute band in primary results must not suppress Case B fallback'
    );
    assert.strictEqual(page.artists.length, 12, 'Merged Case B results must cap at 12');
    assert.deepStrictEqual(
      page.artists.slice(0, 5).map((a) => a.name),
      ['Three Days Grace', 'Saint Asonia', 'big moochie grape', 'Moby Grape Official', 'The Three Days Grace Tribute'],
      'Inferred artist must be promoted to top and duplicates by both id and name removed'
    );
    assert.strictEqual(
      page.artists.filter((a) => a.id === 'UC_moby_grape').length,
      1,
      'Duplicate by identical id must be removed'
    );

    // Resilience in Case B: fallback error preserves primaryArtists
    api.searchArtists = async (q) => {
      if (q === 'three days grape') {
        return [{ id: 'UC_big_grape', name: 'Big Moochie Grape', thumbnailUrl: '' }];
      }
      throw new Error('Fallback timeout');
    };
    const errorFallbackPage = await api.searchTracksPage('three days grape', { targetCount: 8 });
    assert.deepStrictEqual(
      errorFallbackPage.artists.map((a) => a.id),
      ['UC_big_grape'],
      'Case B fallback failure must preserve primaryArtists'
    );
  } finally {
    global.fetch = originalFetch;
    api.searchArtists = originalSearchArtists;
  }
});

test('Flow 2: Artist inference respects 12-track sample cap, does not misattribute normal "Other - Artist" titles, and works on fetchFallbackBatch', async () => {
  const originalFetch = global.fetch;
  const originalSearchArtists = api.searchArtists;

  try {
    // 1. Sample cap: first 12 tracks are heterogeneous (max 1/12), tracks 13..20 are all the same artist -> must return null
    const cappedTracks = [
      ...Array.from({ length: 12 }, (_, idx) => ({
        id: `cap_h_${idx}`,
        title: `Unique Song ${idx}`,
        artist: `Unique Artist ${idx}`,
        duration: 200,
        formattedDuration: '3:20',
        thumbnailUrl: '',
      })),
      ...Array.from({ length: 8 }, (_, idx) => ({
        id: `cap_late_${idx}`,
        title: `Late Hit ${idx}`,
        artist: 'Late Dominant Artist',
        duration: 200,
        formattedDuration: '3:20',
        thumbnailUrl: '',
      })),
    ];
    assert.strictEqual(
      api.inferDominantArtistFromTracks(cappedTracks),
      null,
      'Must only inspect the first 12 tracks'
    );

    // 2. Normal "OtherArtist - TargetArtist" song title must NOT be reassigned to TargetArtist
    const nonLiveDashTracks = [
      { id: 'n1', title: 'Song 1', artist: 'Target Band', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
      { id: 'n2', title: 'Song 2', artist: 'Target Band', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
      { id: 'n3', title: 'Other Artist - Target Band', artist: 'Other Artist', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
      { id: 'n4', title: 'Unrelated 1', artist: 'Singer A', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
      { id: 'n5', title: 'Unrelated 2', artist: 'Singer B', duration: 200, formattedDuration: '3:20', thumbnailUrl: '' },
    ];
    assert.strictEqual(
      api.inferDominantArtistFromTracks(nonLiveDashTracks),
      null,
      'Normal "OtherArtist - TargetBand" title must not be reassigned to reach count >= 3'
    );

    // 3. fetchFallbackBatch path: InnerTube search fails -> Invidious fallback succeeds -> Case A still infers artist
    const artistCalls = [];
    global.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('youtube.com/youtubei/v1/search')) {
        return { ok: false, status: 503, statusText: 'Service Unavailable' };
      }
      if (typeof url === 'string' && url.includes('/api/v1/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { videoId: 'fb_1', title: 'Avenged Sevenfold - Nightmare', author: 'Avenged Sevenfold', lengthSeconds: 374 },
            { videoId: 'fb_2', title: 'Avenged Sevenfold - Afterlife', author: 'Avenged Sevenfold', lengthSeconds: 353 },
            { videoId: 'fb_3', title: 'Avenged Sevenfold - Live In The LBC', author: 'TSTS', lengthSeconds: 500 },
            { videoId: 'fb_4', title: 'Random Clip', author: 'Other', lengthSeconds: 180 },
          ],
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    api.searchArtists = async (q) => {
      artistCalls.push(q);
      if (q === 'avenged stanford') return [];
      if (q === 'Avenged Sevenfold') {
        return [{ id: 'UC_a7x', name: 'Avenged Sevenfold', thumbnailUrl: 'https://example.com/a7x.jpg' }];
      }
      return [];
    };

    const page = await api.searchTracksPage('avenged stanford', { targetCount: 4 });
    assert.strictEqual(page.tracks.length, 4);
    assert.deepStrictEqual(artistCalls, ['avenged stanford', 'Avenged Sevenfold']);
    assert.strictEqual(page.artists.length, 1);
    assert.strictEqual(page.artists[0].name, 'Avenged Sevenfold');
  } finally {
    global.fetch = originalFetch;
    api.searchArtists = originalSearchArtists;
  }
});

test('Flow 2: Artist inference anti-hallucination does not call fallback on heterogeneous tracks or generic artists', async () => {
  const originalFetch = global.fetch;
  const originalSearchArtists = api.searchArtists;
  const artistCalls = [];

  try {
    const heterogeneousTracks = Array.from({ length: 12 }, (_, idx) => ({
      title: `Random Clip ${idx + 1}`,
      artist: `Unique Creator ${idx + 1}`,
    }));

    global.fetch = buildInnerTubeTracksFetchMock(heterogeneousTracks);
    api.searchArtists = async (q) => {
      artistCalls.push(q);
      return [];
    };

    const page = await api.searchTracksPage('xyzqwertyuiop12345', { targetCount: 12 });
    assert.deepStrictEqual(
      artistCalls,
      ['xyzqwertyuiop12345'],
      'Must NOT invoke fallback searchArtists when no artist reaches consensus'
    );
    assert.deepStrictEqual(page.artists, []);

    // Generic artist labels must also be ignored
    const genericTracks = [
      { id: 'g1', title: 'Track 1', artist: 'Artista Desconhecido', duration: 180, formattedDuration: '3:00', thumbnailUrl: '' },
      { id: 'g2', title: 'Track 2', artist: 'Artista Desconhecido', duration: 180, formattedDuration: '3:00', thumbnailUrl: '' },
      { id: 'g3', title: 'Track 3', artist: 'Artista Desconhecido', duration: 180, formattedDuration: '3:00', thumbnailUrl: '' },
      { id: 'g4', title: 'Track 4', artist: 'Various Artists', duration: 180, formattedDuration: '3:00', thumbnailUrl: '' },
      { id: 'g5', title: 'Track 5', artist: 'Vários Artistas', duration: 180, formattedDuration: '3:00', thumbnailUrl: '' },
    ];
    assert.strictEqual(api.inferDominantArtistFromTracks(genericTracks), null);
  } finally {
    global.fetch = originalFetch;
    api.searchArtists = originalSearchArtists;
  }
});

test('Flow 2: Artist inference happy path makes zero extra calls when primary artist already matches or query matches inferred name', async () => {
  const originalFetch = global.fetch;
  const originalSearchArtists = api.searchArtists;
  const artistCalls = [];

  try {
    const cbjrTracks = [
      { title: 'Só os Loucos Sabem', artist: 'Charlie Brown Jr.' },
      { title: 'Céu Azul', artist: 'Charlie Brown Jr. - Topic' },
      { title: 'Dias de Luta, Dias de Glória', artist: 'Charlie Brown Jr.' },
      { title: 'Zóio de Lula', artist: 'Charlie Brown Jr.' },
      { title: 'Papo Reto', artist: 'Charlie Brown Jr.' },
    ];

    global.fetch = buildInnerTubeTracksFetchMock(cbjrTracks);
    api.searchArtists = async (q) => {
      artistCalls.push(q);
      return [
        { id: 'UC_cbjr', name: 'Charlie Brown Jr.', thumbnailUrl: 'https://example.com/cbjr.jpg' },
        { id: 'UC_chorao', name: 'Chorão', thumbnailUrl: 'https://example.com/chorao.jpg' },
      ];
    };

    const page = await api.searchTracksPage('charlie brow jr', { targetCount: 5 });
    assert.strictEqual(
      artistCalls.length,
      1,
      'Must call searchArtists only once when primary results already include the inferred artist'
    );
    assert.strictEqual(page.artists[0].name, 'Charlie Brown Jr.');

    // Query identical to inferred artist name with empty primary must not trigger redundant call
    artistCalls.length = 0;
    api.searchArtists = async (q) => {
      artistCalls.push(q);
      return [];
    };
    const sameQueryPage = await api.searchTracksPage('charlie brown jr.', { targetCount: 5 });
    assert.deepStrictEqual(artistCalls, ['charlie brown jr.']);
    assert.deepStrictEqual(sameQueryPage.artists, []);
  } finally {
    global.fetch = originalFetch;
    api.searchArtists = originalSearchArtists;
  }
});

test('Flow 2: Pagination with continuationToken never invokes searchArtists or artist inference fallback', async () => {
  const originalFetch = global.fetch;
  const originalSearchArtists = api.searchArtists;
  let artistCalls = 0;

  try {
    const tracks = [
      { title: 'Hail to the King', artist: 'Avenged Sevenfold' },
      { title: 'Nightmare', artist: 'Avenged Sevenfold' },
      { title: 'Afterlife', artist: 'Avenged Sevenfold' },
      { title: 'Bat Country', artist: 'Avenged Sevenfold' },
    ];

    global.fetch = buildInnerTubeTracksFetchMock(tracks);
    api.searchArtists = async () => {
      artistCalls += 1;
      return [{ id: 'UC_a7x', name: 'Avenged Sevenfold', thumbnailUrl: '' }];
    };

    const page = await api.searchTracksPage('avenged stanford', {
      targetCount: 4,
      continuationToken: 'page_2_token',
    });

    assert.strictEqual(page.tracks.length, 4);
    assert.strictEqual(artistCalls, 0, 'Pagination must not trigger artist search or fallback');
    assert.strictEqual(page.artists, undefined);
  } finally {
    global.fetch = originalFetch;
    api.searchArtists = originalSearchArtists;
  }
});

test('Flow 2: extractYouTubeUrlVideoId parses valid single-video URLs and rejects text, playlists, and other hosts', () => {
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://youtu.be/kJQP7kiw5Fk?si=abc123&t=42'),
    'kJQP7kiw5Fk'
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://music.youtube.com/watch?v=9bZkp7q19f0&list=RDAMVM9bZkp7q19f0'),
    '9bZkp7q19f0'
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://m.youtube.com/shorts/abcdefghijk?feature=share'),
    'abcdefghijk'
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://www.youtube.com/live/1234567890_'),
    '1234567890_'
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://www.youtube.com/embed/a1b2c3d4e5f'),
    'a1b2c3d4e5f'
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://www.youtube.com/v/z9y8x7w6v5u'),
    'z9y8x7w6v5u'
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('youtu.be/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );

  // Must reject normal queries, playlists, invalid IDs, and non-YouTube domains
  assert.strictEqual(provider.extractYouTubeUrlVideoId('Charlie Brown Jr'), null);
  assert.strictEqual(provider.extractYouTubeUrlVideoId('dQw4w9WgXcQ'), null);
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://www.youtube.com/playlist?list=PL1234567890'),
    null
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://open.spotify.com/track/dQw4w9WgXcQ'),
    null
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://youtu.be/short'),
    null
  );
  assert.strictEqual(
    provider.extractYouTubeUrlVideoId('https://youtu.be/dQw4w9WgXcQ texto extra'),
    null
  );
});

test('Flow 2: searchTracksPage resolves direct link to exact track + related tracks and uses neutral error message on failure', async () => {
  const originalGetAudioStream = api.getAudioStream;
  const originalGetRelatedTracks = api.getRelatedTracks;
  const originalSearchArtists = api.searchArtists;

  try {
    api.getAudioStream = async (id) => ({
      videoId: id,
      title: 'Como Tudo Deve Ser',
      artist: 'Charlie Brown Jr.',
      duration: 273,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      streamUrl: 'https://cdn.example.com/audio.m4a',
      mimeType: 'audio/mp4',
      format: 'm4a',
      bitrate: 128000,
    });
    api.searchArtists = async (q) => [
      {
        id: 'UCcharliebrownjr',
        name: q,
        subtitle: 'Artista',
        thumbnailUrl: 'https://example.com/cbjr.jpg',
      },
    ];
    api.getRelatedTracks = async (id) => [
      // Duplicate of seed must be filtered out
      {
        id,
        title: 'Como Tudo Deve Ser',
        artist: 'Charlie Brown Jr.',
        duration: 273,
        formattedDuration: '4:33',
        thumbnailUrl: 'https://example.com/dup.jpg',
      },
      {
        id: 'rel_track_01',
        title: 'Céu Azul',
        artist: 'Charlie Brown Jr.',
        duration: 199,
        formattedDuration: '3:19',
        thumbnailUrl: 'https://example.com/rel1.jpg',
      },
      {
        id: 'rel_track_02',
        title: 'Só os Loucos Sabem',
        artist: 'Charlie Brown Jr.',
        duration: 206,
        formattedDuration: '3:26',
        thumbnailUrl: 'https://example.com/rel2.jpg',
      },
    ];

    const page = await api.searchTracksPage('https://youtu.be/kJQP7kiw5Fk?si=xyz');
    assert.strictEqual(page.tracks.length, 3);
    assert.strictEqual(page.tracks[0].id, 'kJQP7kiw5Fk');
    assert.strictEqual(page.tracks[0].title, 'Como Tudo Deve Ser');
    assert.strictEqual(page.tracks[0].formattedDuration, '4:33');
    assert.strictEqual(page.tracks[1].id, 'rel_track_01');
    assert.strictEqual(page.tracks[2].id, 'rel_track_02');
    assert.strictEqual(page.artists.length, 1);
    assert.strictEqual(page.artists[0].id, 'UCcharliebrownjr');
    assert.strictEqual(page.continuationToken, null);

    // Unavailable track must throw neutral error message (even when getAudioStream throws AllInstancesFailedError)
    api.getAudioStream = async () => {
      throw new api.AllInstancesFailedError({ 'https://fallback.example': 'HTTP 404' });
    };
    await assert.rejects(
      () => api.searchTracksPage('https://www.youtube.com/watch?v=00000000000'),
      (err) => {
        assert.ok(err instanceof Error);
        assert.strictEqual(err instanceof api.AllInstancesFailedError, false);
        assert.strictEqual(/youtube/i.test(err.message), false, 'Error message must not mention YouTube');
        assert.strictEqual(/v[ií]deo/i.test(err.message), false, 'Error message must not mention vídeo');
        assert.ok(err.message.includes('música'));
        return true;
      }
    );

    // Related tracks failure must never fail the primary direct link resolution
    api.getAudioStream = async (id) => ({
      videoId: id,
      title: 'Faixa Isolada',
      artist: 'Artista Solo',
      duration: 180,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      streamUrl: 'https://cdn.example.com/solo.m4a',
      mimeType: 'audio/mp4',
      format: 'm4a',
      bitrate: 128000,
    });
    api.getRelatedTracks = async () => {
      throw new Error('Related endpoint down');
    };
    const resilientPage = await api.searchTracksPage('https://youtu.be/dQw4w9WgXcQ');
    assert.strictEqual(resilientPage.tracks.length, 1);
    assert.strictEqual(resilientPage.tracks[0].id, 'dQw4w9WgXcQ');
    assert.strictEqual(resilientPage.continuationToken, null);
  } finally {
    api.getAudioStream = originalGetAudioStream;
    api.getRelatedTracks = originalGetRelatedTracks;
    api.searchArtists = originalSearchArtists;
  }
});

test('Flow 2: Direct link combines primary artist(s) + top related track artists (filtering noise) and falls back to /browse similar artists when only 1 matches', async () => {
  const originalGetAudioStream = api.getAudioStream;
  const originalGetRelatedTracks = api.getRelatedTracks;
  const originalSearchArtists = api.searchArtists;
  const originalFetch = global.fetch;

  try {
    // 1. Cover with dual primary artists + related tracks + fan upload noise
    api.getAudioStream = async (id) => ({
      videoId: id,
      title: 'Ex Factor - Lauryn Hill (Joseph Solomon Cover)',
      artist: 'Joseph Solomon',
      duration: 294,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      streamUrl: 'https://cdn.example.com/cover.m4a',
      mimeType: 'audio/mp4',
      format: 'm4a',
      bitrate: 128000,
    });
    api.getRelatedTracks = async () => [
      { id: 'r1', title: 'Doo Wop', artist: 'Lauryn Hill', duration: 240, formattedDuration: '4:00', thumbnailUrl: '' },
      { id: 'r2', title: 'On & On', artist: 'Erykah Badu', duration: 225, formattedDuration: '3:45', thumbnailUrl: '' },
      { id: 'r3', title: 'Bag Lady', artist: 'Erykah Badu', duration: 300, formattedDuration: '5:00', thumbnailUrl: '' },
      { id: 'r4', title: 'Untitled (How Does It Feel)', artist: "D'Angelo", duration: 420, formattedDuration: '7:00', thumbnailUrl: '' },
      { id: 'r5', title: 'Random Live Rip', artist: 'HiddenHalo', duration: 400, formattedDuration: '6:40', thumbnailUrl: '' },
    ];
    api.searchArtists = async (q) => {
      const lower = q.toLowerCase();
      if (lower.includes('lauryn')) {
        return [{ id: 'UClauryn', name: 'Ms. Lauryn Hill', subtitle: 'Artista', thumbnailUrl: 'https://img/lh.jpg' }];
      }
      if (lower.includes('joseph solomon')) {
        return [{ id: 'UCjoseph', name: 'Joseph Solomon', subtitle: 'Artista', thumbnailUrl: 'https://img/js.jpg' }];
      }
      if (lower.includes('erykah')) {
        return [{ id: 'UCerykah', name: 'Erykah Badu', subtitle: 'Artista', thumbnailUrl: 'https://img/eb.jpg' }];
      }
      if (lower.includes('angelo')) {
        return [{ id: 'UCdangelo', name: "D'Angelo", subtitle: 'Artista', thumbnailUrl: 'https://img/da.jpg' }];
      }
      // Noise channel returns an unrelated artist -> must be rejected by strict match
      return [{ id: 'UCunrelated', name: 'Completely Different Band', subtitle: 'Artista', thumbnailUrl: 'https://img/no.jpg' }];
    };

    const hybridPage = await api.searchTracksPage('https://youtu.be/dQw4w9WgXcQ');
    const artistIds = hybridPage.artists.map((a) => a.id);
    assert.ok(artistIds.includes('UCjoseph'), 'Primary uploader artist must be included');
    assert.ok(artistIds.includes('UClauryn'), 'Primary title artist must be included');
    assert.ok(artistIds.includes('UCerykah'), 'Frequent related artist Erykah Badu must be included');
    assert.ok(artistIds.includes('UCdangelo'), 'Related artist D Angelo must be included');
    assert.strictEqual(artistIds.includes('UCunrelated'), false, 'Unrelated noise match must be filtered out');
    // Erykah Badu (2 tracks) must come before D'Angelo (1 track)
    assert.ok(artistIds.indexOf('UCerykah') < artistIds.indexOf('UCdangelo'));

    // 2. Obscure link with 0 related tracks -> only 1 official artist -> /browse fallback pulls similar artists
    api.getAudioStream = async (id) => ({
      videoId: id,
      title: 'Faixa Rara',
      artist: 'Joseph Solomon',
      duration: 200,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      streamUrl: 'https://cdn.example.com/rare.m4a',
      mimeType: 'audio/mp4',
      format: 'm4a',
      bitrate: 128000,
    });
    api.getRelatedTracks = async () => [];
    global.fetch = async (url) => {
      if (String(url).includes('/youtubei/v1/browse')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contents: {
              singleColumnBrowseResultsRenderer: {
                tabs: [{
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [{
                          musicCarouselShelfRenderer: {
                            header: {
                              musicCarouselShelfBasicHeaderRenderer: {
                                title: { runs: [{ text: 'Fãs também curtem' }] },
                              },
                            },
                            contents: [
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'Daniel Caesar' }] },
                                  subtitle: { runs: [{ text: 'Artista' }] },
                                  navigationEndpoint: { browseEndpoint: { browseId: 'UCdanielcaesar' } },
                                  thumbnailRenderer: {
                                    musicThumbnailRenderer: {
                                      thumbnail: { thumbnails: [{ url: 'https://img/dc.jpg' }] },
                                    },
                                  },
                                },
                              },
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'H.E.R.' }] },
                                  subtitle: { runs: [{ text: 'Artista' }] },
                                  navigationEndpoint: { browseEndpoint: { browseId: 'UCherartist' } },
                                  thumbnailRenderer: {
                                    musicThumbnailRenderer: {
                                      thumbnail: { thumbnails: [{ url: 'https://img/her.jpg' }] },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        }],
                      },
                    },
                  },
                }],
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const fallbackPage = await api.searchTracksPage('https://youtu.be/kJQP7kiw5Fk');
    assert.deepStrictEqual(
      fallbackPage.artists.map((a) => a.id),
      ['UCjoseph', 'UCdanielcaesar', 'UCherartist']
    );

    // 3. Normal text search returning only 1 artist (e.g. typo "braison tyller" -> Bryson Tiller)
    // must also expand with similar artists via /browse so the shelf never shows a lonely circle
    api.searchArtists = async () => [
      { id: 'UCbrysontiller', name: 'Bryson Tiller', subtitle: 'Artista', thumbnailUrl: 'https://img/bt.jpg' },
    ];
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/youtubei/v1/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contents: {
              sectionListRenderer: {
                contents: [{
                  itemSectionRenderer: {
                    contents: [{
                      videoRenderer: {
                        videoId: 'dQw4w9WgXcQ',
                        title: { runs: [{ text: "Bryson Tiller - Don't" }] },
                        shortBylineText: { runs: [{ text: 'Bryson Tiller' }] },
                        lengthText: { runs: [{ text: '3:18' }] },
                        thumbnail: { thumbnails: [{ url: 'https://img/bt.jpg' }] },
                      },
                    }],
                  },
                }],
              },
            },
          }),
        };
      }
      if (urlStr.includes('/youtubei/v1/browse')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contents: {
              singleColumnBrowseResultsRenderer: {
                tabs: [{
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [{
                          musicCarouselShelfRenderer: {
                            header: {
                              musicCarouselShelfBasicHeaderRenderer: {
                                title: { runs: [{ text: 'Fãs também curtem' }] },
                              },
                            },
                            contents: [
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'PARTYNEXTDOOR' }] },
                                  subtitle: { runs: [{ text: 'Artista' }] },
                                  navigationEndpoint: { browseEndpoint: { browseId: 'UCpartynextdoor' } },
                                  thumbnailRenderer: {
                                    musicThumbnailRenderer: {
                                      thumbnail: { thumbnails: [{ url: 'https://img/pnd.jpg' }] },
                                    },
                                  },
                                },
                              },
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'Bryson Tiller' }] },
                                  subtitle: { runs: [{ text: 'Artista' }] },
                                  navigationEndpoint: { browseEndpoint: { browseId: 'UCbrysontiller' } },
                                  thumbnailRenderer: {
                                    musicThumbnailRenderer: {
                                      thumbnail: { thumbnails: [{ url: 'https://img/bt.jpg' }] },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        }],
                      },
                    },
                  },
                }],
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const normalSingleArtistPage = await api.searchTracksPage('braison tyller', { targetCount: 1 });
    assert.deepStrictEqual(
      normalSingleArtistPage.artists.map((a) => a.id),
      ['UCbrysontiller', 'UCpartynextdoor']
    );
  } finally {
    api.getAudioStream = originalGetAudioStream;
    api.getRelatedTracks = originalGetRelatedTracks;
    api.searchArtists = originalSearchArtists;
    global.fetch = originalFetch;
  }
});

test('Provider: getAudioStream Invidious fallback returns complete userAgent and headers and omits cookies', async () => {
  const originalFetch = global.fetch;
  const capturedCredentials = [];
  provider.invalidateStreamCache('fallback123');
  try {
    global.fetch = async (url, init) => {
      capturedCredentials.push(init?.credentials);
      const urlStr = String(url);
      if (urlStr.includes('youtube.com/youtubei/v1/')) {
        return { ok: false, status: 503, statusText: 'Unavailable' };
      }
      if (urlStr.includes('/api/v1/videos/fallback123')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: 'Fallback Song',
            author: 'Fallback Artist',
            lengthSeconds: 190,
            adaptiveFormats: [
              {
                url: 'https://rr1.googlevideo.com/videoplayback?id=fallback123',
                type: 'audio/mp4; codecs="mp4a.40.2"',
                container: 'm4a',
                bitrate: '128000',
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const result = await api.getAudioStream('fallback123');
    assert.strictEqual(result.streamUrl, 'https://rr1.googlevideo.com/videoplayback?id=fallback123');
    assert.strictEqual(result.userAgent, provider.INNERTUBE_USER_AGENT);
    assert.strictEqual(result.headers?.['User-Agent'], provider.INNERTUBE_USER_AGENT);
    assert.strictEqual(result.headers?.Referer, 'https://www.youtube.com/');
    assert.strictEqual(result.headers?.Origin, 'https://www.youtube.com');
    assert.ok(capturedCredentials.length > 0 && capturedCredentials.every((c) => c === 'omit'), 'All provider fetch calls must omit cookies');
  } finally {
    provider.invalidateStreamCache('fallback123');
    global.fetch = originalFetch;
  }
});


