// tests/flow2_search.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const api = require('../services/api');
const {
  actAsync,
  findButtonByText,
  findSearchActionButton,
  findButtonByIcon,
  findInputByPlaceholder,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const { initDatabase } = require('../services/database');

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

test('Flow 2: Search input ignores empty queries', async () => {
  let searchCalled = false;
  api.searchTracks = async () => {
    searchCalled = true;
    return [];
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const searchBtn = findSearchActionButton(root);
  assert.ok(searchBtn);

  // Press search with empty query
  await actAsync(async () => {
    searchBtn.props.onPress();
  });

  assert.strictEqual(searchCalled, false, 'Should not trigger search when query is empty');
});

test('Flow 2: Performs search and displays list of track results', async () => {
  const mockResults = [
    {
      id: 'coldplay_1',
      title: 'Viva La Vida',
      artist: 'Coldplay',
      duration: 242,
      formattedDuration: '4:02',
      thumbnailUrl: 'https://example.com/vivalavida.jpg',
    },
    {
      id: 'coldplay_2',
      title: 'Yellow',
      artist: 'Coldplay',
      duration: 269,
      formattedDuration: '4:29',
      thumbnailUrl: 'https://example.com/yellow.jpg',
    },
  ];

  api.searchTracks = async (q) => {
    assert.strictEqual(q, 'Coldplay');
    return mockResults;
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  assert.ok(input, 'Search input should exist');

  // Type search query
  await actAsync(async () => {
    input.props.onChangeText('Coldplay');
  });

  // Submit search
  const searchBtn = findSearchActionButton(root);
  await actAsync(async () => {
    searchBtn.props.onPress();
  });

  const text = getAllText(root);
  assert.ok(text.includes('Viva La Vida'), 'Result 1 title should be displayed');
  assert.ok(text.includes('Yellow'), 'Result 2 title should be displayed');
  assert.ok(text.includes('Coldplay') && text.includes('4:02'), 'Result 1 artist & duration should be displayed');
  assert.ok(text.includes('Coldplay') && text.includes('4:29'), 'Result 2 artist & duration should be displayed');

  // Verify contextual 3-dots menu button exists on each card (replacing cluttered inline buttons)
  const moreBtns = root.findAll(
    (n) => n.type === 'LucideIcon' && n.props.name === 'MoreVertical'
  );
  assert.ok(moreBtns.length >= 2, 'Each track card should have More options menu icon');
});

test('Flow 2: Displays error banner when search API fails and allows dismissing it', async () => {
  api.searchTracks = async () => {
    throw new api.AllInstancesFailedError({
      'node-1': 'Connection timeout',
      'node-2': '503 Service Unavailable',
    });
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('Queen');
  });

  const searchBtn = findSearchActionButton(root);
  await actAsync(async () => {
    searchBtn.props.onPress();
  });

  let text = getAllText(root);
  assert.ok(
    text.includes('Todas as instâncias da API falharam'),
    'Should display failure message'
  );

  // Dismiss error by pressing X
  const closeBtn = findButtonByIcon(root, 'X');
  assert.ok(closeBtn, 'Close button should be present in error box');

  await actAsync(async () => {
    closeBtn.props.onPress();
  });

  text = getAllText(root);
  assert.strictEqual(
    text.includes('Todas as instâncias da API falharam'),
    false,
    'Error banner should be dismissed'
  );
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

test('Flow 2: UI renders "Carregar mais" button after search and appends non-duplicate tracks', async () => {
  const makeTrack = (n) => ({
    id: `ui_track_${n}`,
    title: `Song ${n}`,
    artist: 'Tester',
    duration: 200,
    formattedDuration: '3:20',
    thumbnailUrl: `https://example.com/ui_${n}.jpg`,
  });

  const batch1 = Array.from({ length: 30 }, (_, i) => makeTrack(i + 1));
  const batch2 = [makeTrack(30), ...Array.from({ length: 30 }, (_, i) => makeTrack(i + 31))];

  api.searchTracksPage = async (_q, opts = {}) => {
    if (!opts.continuationToken) {
      return { tracks: batch1, continuationToken: 'next_page_token' };
    }
    assert.strictEqual(opts.continuationToken, 'next_page_token');
    return { tracks: batch2, continuationToken: null };
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  const input = findInputByPlaceholder(root, 'Buscar faixas');
  await actAsync(async () => {
    input.props.onChangeText('Test Mix');
  });
  await actAsync(async () => {
    findSearchActionButton(root).props.onPress();
  });

  assert.ok(getAllText(root).includes('30 faixas'), 'Initial badge should show 30 tracks');
  const loadMoreBtn = root.findByProps({ testID: 'search-load-more-button' });
  assert.ok(loadMoreBtn, '"Carregar mais" button must render when continuationToken is present');

  await actAsync(async () => {
    loadMoreBtn.props.onPress();
  });

  const finalText = getAllText(root);
  assert.ok(finalText.includes('60 faixas'), 'Duplicate Song 30 must be filtered so total becomes 60 faixas');
  assert.ok(finalText.includes('Song 60'), 'Newly loaded track 60 must appear in list');
  assert.strictEqual(
    root.findAllByProps({ testID: 'search-load-more-button' }).length,
    0,
    '"Carregar mais" button hides once continuationToken is exhausted'
  );
});
