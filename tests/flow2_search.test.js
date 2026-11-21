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

test('Flow 2: Search displays Artistas above QuickPicks, opens ArtistProfileModal with channelId, clears on X, and handles empty artists/tracks cleanly', async () => {
  const originalSearchArtists = api.searchArtists;
  const originalGetArtistProfile = api.getArtistProfile;
  const mockArtists = [
    {
      id: 'UC_cbjr',
      name: 'Charlie Brown Jr.',
      subtitle: 'Artista • 10,2 mi ouvintes mensais',
      thumbnailUrl: 'https://example.com/cbjr.jpg',
    },
    {
      id: 'UC_chorao',
      name: 'Chorão',
      subtitle: 'Artista',
      thumbnailUrl: 'https://example.com/chorao.jpg',
    },
  ];
  const mockTracks = [
    {
      id: 'cbjr_t1',
      title: 'Só os Loucos Sabem',
      artist: 'Charlie Brown Jr.',
      duration: 206,
      formattedDuration: '3:26',
      thumbnailUrl: 'https://example.com/t1.jpg',
    },
  ];

  const profileCalls = [];
  api.searchTracks = async () => mockTracks;
  api.searchArtists = async () => mockArtists;
  api.getArtistProfile = async (name, channelId) => {
    profileCalls.push({ name, channelId });
    return {
      name,
      channelId,
      avatarUrl: 'https://example.com/cbjr.jpg',
      topTracks: mockTracks,
      albums: [],
      singles: [],
    };
  };

  let tree;
  try {
    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });

    const root = tree.root;
    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('Charlie Brown Jr');
    });

    const searchBtn = findSearchActionButton(root);
    await actAsync(async () => {
      searchBtn.props.onPress();
    });

    const artistSection = root.find(
      (n) => n.type === 'View' && n.props.testID === 'artist-results-section'
    );
    assert.ok(artistSection, 'ArtistResultsSection must render when artists are returned');
    const sectionText = getAllText(artistSection);
    assert.ok(sectionText.includes('Artistas'));
    assert.ok(sectionText.includes('Charlie Brown Jr.'));
    assert.ok(sectionText.includes('Chorão'));

    // Verifica ordem: Artistas aparece acima de Escolhas Rápidas
    const fullText = getAllText(root);
    const artistsPos = fullText.indexOf('Artistas');
    const quickPicksPos = fullText.indexOf('Escolhas Rápidas');
    assert.ok(artistsPos >= 0 && quickPicksPos > artistsPos, 'Artistas must appear above Escolhas Rápidas');

    // Tocar no artista abre o ArtistProfileModal com name e channelId corretos
    const artistBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Abrir perfil do artista Charlie Brown Jr.'
    );
    await actAsync(async () => {
      artistBtn.props.onPress();
    });

    const profileModal = root.find(
      (n) => n.type === 'View' && n.props.testID === 'artist-profile-modal'
    );
    assert.ok(profileModal, 'Tapping an artist must open ArtistProfileModal');
    assert.ok(getAllText(profileModal).includes('Charlie Brown Jr.'));
    assert.deepStrictEqual(profileCalls[0], {
      name: 'Charlie Brown Jr.',
      channelId: 'UC_cbjr',
    });

    // Fechar o perfil inline mantém a busca intacta e preserva a barra de navegação
    assert.ok(
      findButtonByText(root, 'Buscar'),
      'NavigationTabBar must remain visible while ArtistProfileModal is open inline'
    );
    const backBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Voltar'
    );
    await actAsync(async () => {
      backBtn.props.onPress();
    });
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-profile-modal').length,
      0
    );
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-results-section').length,
      1
    );

    // Tocar no botão X ("Limpar busca") limpa busca e remove seção de artistas
    const clearBtn = root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Limpar busca'
    );
    await actAsync(async () => {
      clearBtn.props.onPress();
    });
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-results-section').length,
      0,
      'Tapping X clear button must clear artist results'
    );

    // Busca com faixas mas sem artistas omite a seção Artistas
    api.searchArtists = async () => [];
    api.searchTracks = async () => mockTracks;
    await actAsync(async () => {
      input.props.onChangeText('somente faixas');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-results-section').length,
      0,
      'ArtistResultsSection must not render when artists array is empty'
    );

    // Busca com artistas mas sem faixas exibe Artistas e NÃO renderiza Descoberta/Playlists abaixo
    api.searchArtists = async () => mockArtists;
    api.searchTracks = async () => [];
    await actAsync(async () => {
      input.props.onChangeText('somente artistas');
    });
    await actAsync(async () => {
      findSearchActionButton(root).props.onPress();
    });
    assert.strictEqual(
      root.findAll((n) => n.type === 'View' && n.props.testID === 'artist-results-section').length,
      1
    );
    assert.strictEqual(
      root.findAll((n) => n.props.testID === 'genre-chips-carousel').length,
      0,
      'Must not render Discovery genre chips beneath artist-only search results'
    );
  } finally {
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
    api.searchArtists = originalSearchArtists;
    api.getArtistProfile = originalGetArtistProfile;
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
    api.extractYouTubeUrlVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://youtu.be/kJQP7kiw5Fk?si=abc123&t=42'),
    'kJQP7kiw5Fk'
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://music.youtube.com/watch?v=9bZkp7q19f0&list=RDAMVM9bZkp7q19f0'),
    '9bZkp7q19f0'
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://m.youtube.com/shorts/abcdefghijk?feature=share'),
    'abcdefghijk'
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://www.youtube.com/live/1234567890_'),
    '1234567890_'
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://www.youtube.com/embed/a1b2c3d4e5f'),
    'a1b2c3d4e5f'
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://www.youtube.com/v/z9y8x7w6v5u'),
    'z9y8x7w6v5u'
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('youtu.be/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );

  // Must reject normal queries, playlists, invalid IDs, and non-YouTube domains
  assert.strictEqual(api.extractYouTubeUrlVideoId('Charlie Brown Jr'), null);
  assert.strictEqual(api.extractYouTubeUrlVideoId('dQw4w9WgXcQ'), null);
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://www.youtube.com/playlist?list=PL1234567890'),
    null
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://open.spotify.com/track/dQw4w9WgXcQ'),
    null
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://youtu.be/short'),
    null
  );
  assert.strictEqual(
    api.extractYouTubeUrlVideoId('https://youtu.be/dQw4w9WgXcQ texto extra'),
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

test('Flow 2: Pasting a direct link in Search UI displays exact song + related tracks and skips search history', async () => {
  const { getSearchHistory } = require('../services/database');
  const originalGetAudioStream = api.getAudioStream;
  const originalGetRelatedTracks = api.getRelatedTracks;
  const originalSearchArtists = api.searchArtists;

  let tree;
  try {
    api.getAudioStream = async (id) => ({
      videoId: id,
      title: 'Música Secreta do Link',
      artist: 'Banda Exemplo',
      duration: 215,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      streamUrl: 'https://cdn.example.com/secret.m4a',
      mimeType: 'audio/mp4',
      format: 'm4a',
      bitrate: 128000,
    });
    api.searchArtists = async (q) => {
      if (q.toLowerCase().includes('relacionado')) {
        return [
          {
            id: 'UCartistarel',
            name: 'Artista Relacionado',
            subtitle: 'Artista',
            thumbnailUrl: 'https://example.com/rel_artist.jpg',
          },
        ];
      }
      return [
        {
          id: 'UCbandaexemplo',
          name: 'Banda Exemplo',
          subtitle: 'Artista',
          thumbnailUrl: 'https://example.com/banda.jpg',
        },
      ];
    };
    api.getRelatedTracks = async () => [
      {
        id: 'rel_secret_1',
        title: 'Faixa Relacionada 1',
        artist: 'Artista Relacionado',
        duration: 185,
        formattedDuration: '3:05',
        thumbnailUrl: 'https://example.com/rel.jpg',
      },
    ];

    await actAsync(async () => {
      tree = renderer.create(React.createElement(App));
    });

    const root = tree.root;
    const input = findInputByPlaceholder(root, 'Buscar faixas');
    await actAsync(async () => {
      input.props.onChangeText('https://youtu.be/dQw4w9WgXcQ?si=test');
    });

    const searchBtn = findSearchActionButton(root);
    await actAsync(async () => {
      await searchBtn.props.onPress();
    });

    const fullText = getAllText(root);
    assert.ok(fullText.includes('ENCONTRADO PELO LINK'), 'Direct link search must show eyebrow label');
    assert.ok(fullText.includes('Resultado Preciso'), 'Direct link search must show Resultado Preciso hero section');
    assert.ok(fullText.includes('Tocar a seguir'), 'Direct link hero card must show Tocar a seguir action');
    assert.ok(fullText.includes('Salvar na playlist'), 'Direct link hero card must show Salvar na playlist action');
    assert.ok(fullText.includes('Baixar'), 'Direct link hero card must show Baixar action');
    assert.ok(fullText.includes('Artistas'), 'Direct link search must show Artistas shelf above Escolhas Rápidas');
    assert.ok(fullText.includes('Música Secreta do Link'), 'Exact track from link must appear in search results');
    assert.ok(fullText.includes('Faixas Relacionadas'), 'Related section header must appear below direct link card');
    assert.ok(fullText.includes('Faixa Relacionada 1'), 'Related track must appear below exact track');
    assert.strictEqual(
      root.findAll(
        (node) => node.type === 'View' && node.props.testID === 'direct-link-result-section'
      ).length,
      1,
      'Direct link section must render once'
    );

    const history = await getSearchHistory();
    assert.strictEqual(history.length, 0, 'Direct link must not be saved in search history');

    // Normal text search must NOT show the direct-link Resultado Preciso section
    const originalSearchTracks = api.searchTracks;
    try {
      api.searchTracks = async () => [
        {
          id: 'normal_track_1',
          title: 'Música Normal',
          artist: 'Artista Comum',
          duration: 200,
          formattedDuration: '3:20',
          thumbnailUrl: 'https://example.com/norm.jpg',
        },
      ];
      await actAsync(async () => {
        input.props.onChangeText('Artista Comum');
      });
      await actAsync(async () => {
        await findSearchActionButton(root).props.onPress();
      });
      assert.strictEqual(
        root.findAllByProps({ testID: 'direct-link-result-section' }).length,
        0,
        'Normal text search must not render DirectLinkResultCard'
      );
      assert.ok(getAllText(root).includes('Músicas e Resultados'));
    } finally {
      api.searchTracks = originalSearchTracks;
    }
  } finally {
    if (tree) {
      await actAsync(async () => {
        tree.unmount();
      });
    }
    api.getAudioStream = originalGetAudioStream;
    api.getRelatedTracks = originalGetRelatedTracks;
    api.searchArtists = originalSearchArtists;
  }
});
