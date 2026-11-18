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

test('Flow 2: "Salvar offline" downloads track into Baixadas tab, preserves downloadedIds across searches, and surfaces download errors', async () => {
  const { setAudioStreamResolver, clearStorageCache } = require('../services/storage');
  const { saveDownloadedTrack } = require('../services/database');
  const fileSystemMock = require('./mocks/fileSystemMock');

  await saveDownloadedTrack({
    id: 'pre_existing_dl',
    title: 'Pre Existing Offline',
    artist: 'Old Artist',
    duration: 200,
    thumbnailUrl: 'https://example.com/old.jpg',
    localUri: `${fileSystemMock.documentDirectory}tracks/pre_existing_dl.m4a`,
    downloadedAt: Date.now(),
  });
  fileSystemMock.files.set(
    `${fileSystemMock.documentDirectory}tracks/pre_existing_dl.m4a`,
    { isDirectory: false, size: 1024 * 1024 }
  );

  api.searchTracksPage = async () => ({
    tracks: [
      {
        id: 'save_offline_1',
        title: 'Save Me Offline',
        artist: 'Offline Hero',
        duration: 210,
        formattedDuration: '3:30',
        thumbnailUrl: 'https://example.com/save.jpg',
      },
      {
        id: 'save_offline_fail',
        title: 'Broken Stream Track',
        artist: 'Fail Hero',
        duration: 190,
        formattedDuration: '3:10',
        thumbnailUrl: 'https://example.com/fail.jpg',
      },
    ],
    continuationToken: null,
  });

  setAudioStreamResolver(async (id) => {
    if (id === 'save_offline_fail') {
      throw new Error('HTTP 403 Forbidden');
    }
    return {
      streamUrl: `https://stream.example.com/${id}.m4a`,
      headers: {
        'User-Agent': 'SonaryTest/1.0',
        Referer: 'https://www.youtube.com/',
        Origin: 'https://www.youtube.com',
      },
    };
  });

  try {
    let tree;
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('Offline Hero');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });

    // Open 3-dots menu on first search result and tap "Salvar offline"
    const moreBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Mais opções para Save Me Offline'
    );
    await actAsync(async () => {
      moreBtn.props.onPress({ stopPropagation: () => {} });
    });

    const saveBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Salvar offline'
    );
    await actAsync(async () => {
      saveBtn.props.onPress({ stopPropagation: () => {} });
      await new Promise((r) => setTimeout(r, 40));
    });

    // Switch to Baixadas tab and verify both tracks appear
    const downloadsTabBtn = findButtonByText(root, 'Baixadas');
    await actAsync(async () => {
      downloadsTabBtn.props.onPress();
    });
    const downloadsText = getAllText(root);
    assert.ok(
      downloadsText.includes('Save Me Offline'),
      'Track saved via "Salvar offline" must appear in Baixadas tab'
    );
    assert.ok(
      downloadsText.includes('Pre Existing Offline'),
      'Pre-existing downloaded track must remain preserved after search'
    );

    // Go back to Buscar and verify downloaded track badge + trigger a failing download
    const searchTabBtn = findButtonByText(root, 'Buscar');
    await actAsync(async () => {
      searchTabBtn.props.onPress();
    });

    const searchDownloadedBadges = root.findAll(
      (n) => n.type === 'View' && n.props.accessibilityLabel === 'Baixada'
    );
    assert.ok(
      searchDownloadedBadges.length >= 2,
      'Search screen (QuickPicks and TrackCard) must show green Folder badge for downloaded tracks'
    );
    assert.strictEqual(
      searchDownloadedBadges[0].find((n) => n.type === 'LucideIcon' && n.props.name === 'Folder').props.color,
      '#2BA640'
    );

    const failMoreBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Mais opções para Broken Stream Track'
    );
    await actAsync(async () => {
      failMoreBtn.props.onPress({ stopPropagation: () => {} });
    });
    const failSaveBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Salvar offline'
    );
    await actAsync(async () => {
      failSaveBtn.props.onPress({ stopPropagation: () => {} });
      await new Promise((r) => setTimeout(r, 40));
    });

    const errorUiText = getAllText(root);
    assert.ok(
      errorUiText.includes('Falha ao baixar "Broken Stream Track"'),
      'Failed download must surface explicit error message in UI'
    );

    // Verify CircularDownloadProgress renders white circular SVG ring + % label
    const { TrackCard, CircularDownloadProgress } = require('../components/TrackCard');
    let ringTree;
    await actAsync(async () => {
      ringTree = renderer.create(
        React.createElement(TrackCard, {
          id: 'ring_1',
          title: 'Self Aware',
          artist: 'Temper City',
          durationText: '3:15',
          isDownloading: true,
          downloadProgress: 20,
          onPress: () => {},
          onPlayNext: () => {},
        })
      );
    });
    const ringComp = ringTree.root.findByType(CircularDownloadProgress);
    assert.strictEqual(ringComp.props.progress, 20);
    const circles = ringComp.findAll((n) => n.type === 'SvgElement' && n.props.tag === 'Circle');
    assert.strictEqual(circles.length, 2, 'Should render background track and white progress arc');
    assert.strictEqual(circles[1].props.stroke, '#FFFFFF');
    assert.ok(getAllText(ringComp).includes('20%'));
  } finally {
    setAudioStreamResolver();
    fileSystemMock.resetFileSystem();
    clearStorageCache();
  }
});

test('Flow 2: Queuing multiple tracks shows pending state and opens DownloadQueueModal from BrandHeader', async () => {
  const {
    cancelAllDownloads,
    clearFinishedDownloads,
    setAudioStreamResolver,
    clearStorageCache,
  } = require('../services/storage');
  const fileSystemMock = require('./mocks/fileSystemMock');

  const mockResults = [
    {
      id: 'mq_1',
      title: 'First Queued Song',
      artist: 'Artist One',
      duration: 200,
      formattedDuration: '3:20',
      thumbnailUrl: 'https://example.com/1.jpg',
    },
    {
      id: 'mq_2',
      title: 'Second Queued Song',
      artist: 'Artist Two',
      duration: 210,
      formattedDuration: '3:30',
      thumbnailUrl: 'https://example.com/2.jpg',
    },
  ];

  api.searchTracks = async () => mockResults;

  let releaseFirstDownload = null;
  setAudioStreamResolver(async (id) => ({
    streamUrl: `https://mock.example.com/${id}.m4a`,
  }));
  fileSystemMock.setCreateDownloadResumable((url, fileUri) => ({
    downloadAsync: () =>
      new Promise((resolve, reject) => {
        if (fileUri.includes('mq_1')) {
          releaseFirstDownload = {
            resolve: () => {
              fileSystemMock.files.set(fileUri, { isDirectory: false, url, size: 1024 * 1024 });
              resolve({ uri: fileUri, status: 200 });
            },
            reject,
          };
          return;
        }
        fileSystemMock.files.set(fileUri, { isDirectory: false, url, size: 1024 * 1024 });
        resolve({ uri: fileUri, status: 200 });
      }),
    cancelAsync: async () => {
      releaseFirstDownload?.reject(new Error('Cancelled'));
    },
  }));

  try {
    let tree;
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });
    const root = tree.root;

    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('Queue Test');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });

    const queueTrack = async (title) => {
      const moreBtn = root.find(
        (n) =>
          n.type === 'TouchableOpacity' &&
          n.props.accessibilityLabel === `Mais opções para ${title}`
      );
      await actAsync(async () => {
        moreBtn.props.onPress({ stopPropagation: () => {} });
      });
      const saveBtn = root.find(
        (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Salvar offline'
      );
      await actAsync(async () => {
        saveBtn.props.onPress({ stopPropagation: () => {} });
      });
    };

    await queueTrack('First Queued Song');
    await queueTrack('Second Queued Song');

    // Second track must visibly indicate "Na fila" while first is downloading
    const pendingBadge = root.find(
      (n) => n.props && n.props.accessibilityLabel === 'Na fila de downloads'
    );
    assert.ok(pendingBadge, 'Pending track in search results must show "Na fila" badge');

    // Open 3-dots menu on actively downloading track ('First Queued Song') and verify "Baixando..." state
    const firstMoreBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Mais opções para First Queued Song'
    );
    await actAsync(async () => {
      firstMoreBtn.props.onPress({ stopPropagation: () => {} });
    });
    const activeSaveBtn = root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Salvar offline'
    );
    assert.ok(
      getAllText(activeSaveBtn).includes('Baixando'),
      'TrackContextSheet for actively downloading track must display "Baixando..." instead of "Salvar offline"'
    );
    await actAsync(async () => {
      activeSaveBtn.props.onPress({ stopPropagation: () => {} });
    });

    // BrandHeader shows notification dot on menu button and SideDrawerMenu displays count (2) to open DownloadQueueModal
    const menuBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Abrir menu'
    );
    assert.ok(menuBtn, 'BrandHeader must expose hamburger menu button');
    assert.ok(
      menuBtn.findAll(
        (n) => n.type === 'View' && n.props && n.props.testID === 'header-menu-dot'
      ).length === 1,
      'BrandHeader menu button must show notification dot when downloads are queued'
    );

    await actAsync(async () => {
      menuBtn.props.onPress();
    });

    const drawerQueueBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Fila de downloads'
    );
    assert.ok(drawerQueueBtn, 'SideDrawerMenu must expose Fila de downloads item');
    assert.ok(
      getAllText(drawerQueueBtn).includes('2'),
      'SideDrawerMenu Fila de downloads must display count pill (2)'
    );

    await actAsync(async () => {
      drawerQueueBtn.props.onPress();
    });

    const modalText = getAllText(root);
    assert.ok(modalText.includes('Fila de downloads'));
    assert.ok(modalText.includes('First Queued Song'));
    assert.ok(modalText.includes('Second Queued Song'));
    assert.ok(modalText.includes('Na fila'));

    // Cancel pending second track directly inside DownloadQueueModal
    const cancelSecondBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Cancelar download de Second Queued Song'
    );
    await actAsync(async () => {
      cancelSecondBtn.props.onPress();
    });

    assert.strictEqual(
      root.findAll(
        (n) =>
          n.type === 'TouchableOpacity' &&
          n.props.accessibilityLabel === 'Cancelar download de Second Queued Song'
      ).length,
      0,
      'Cancelled pending item must be removed from DownloadQueueModal'
    );

    releaseFirstDownload?.resolve();
    await actAsync(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
  } finally {
    await cancelAllDownloads();
    clearFinishedDownloads();
    fileSystemMock.setCreateDownloadResumable(null);
    setAudioStreamResolver();
    fileSystemMock.resetFileSystem();
    clearStorageCache();
  }
});

test('Flow 2: Cold start with persisted completed and error download queue items does not fire false toasts or error banners', async () => {
  const { upsertPersistedDownloadQueueBatch } = require('../services/database');
  const { clearFinishedDownloads } = require('../services/storage');

  await upsertPersistedDownloadQueueBatch([
    {
      trackId: 'old_done_1',
      title: 'Old Completed Track',
      artist: 'Past Artist',
      duration: 180,
      thumbnailUrl: 'https://example.com/old_done.jpg',
      status: 'completed',
      progress: 1,
    },
    {
      trackId: 'old_err_1',
      title: 'Old Failed Track',
      artist: 'Past Artist',
      duration: 200,
      thumbnailUrl: 'https://example.com/old_err.jpg',
      status: 'error',
      progress: 0,
      error: 'HTTP 403',
    },
  ]);

  try {
    let tree;
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
      await new Promise((r) => setTimeout(r, 40));
    });

    const bootText = getAllText(tree.root);
    assert.strictEqual(
      bootText.includes('"Old Completed Track" salva em Baixadas'),
      false,
      'Cold start must not fire toast for old completed item from previous session'
    );
    assert.strictEqual(
      bootText.includes('Falha ao baixar "Old Failed Track"'),
      false,
      'Cold start must not fire error banner/toast for old failed item from previous session'
    );
  } finally {
    clearFinishedDownloads();
  }
});
