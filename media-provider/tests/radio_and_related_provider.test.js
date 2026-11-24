// media-provider/tests/radio_and_related_provider.test.js
const test = require('node:test');
const assert = require('node:assert');
const api = require('../../services/api');
const player = require('../../services/player');
const db = require('../../services/database');
const { resetAllMocks } = require('../../tests/helpers/testUtils');
const { mockPlayer } = require('../../tests/mocks/trackPlayerMock');

const originalFetch = global.fetch;

test.beforeEach(async () => {
  resetAllMocks();
  await db.initDatabase();
});

test.afterEach(() => {
  global.fetch = originalFetch;
});

test('LRA-003 & LRA-004: getTrackRadio extracts continuationToken and replaceUpcomingQueue preserves active track', async () => {
  global.fetch = async (url, init) => {
    if (String(url).includes('/youtubei/v1/next')) {
      const body = JSON.parse(init.body);
      assert.strictEqual(body.playlistId, 'RDAMVMseed_123');
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
                                      videoId: 'radio_track_1',
                                      title: { runs: [{ text: 'Radio Hit 1' }] },
                                      shortBylineText: { runs: [{ text: 'Radio Artist 1' }] },
                                      lengthText: { simpleText: '3:15' },
                                    },
                                  },
                                  {
                                    continuationItemRenderer: {
                                      continuationEndpoint: {
                                        continuationCommand: {
                                          token: 'NEXT_RADIO_TOKEN_999',
                                        },
                                      },
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
    return { ok: false, status: 404 };
  };

  const radioRes = await api.getTrackRadio('seed_123');
  assert.strictEqual(radioRes.tracks.length, 1);
  assert.strictEqual(radioRes.tracks[0].id, 'radio_track_1');
  assert.strictEqual(radioRes.continuationToken, 'NEXT_RADIO_TOKEN_999');

  // Test replaceUpcomingQueue in player service
  await player.playTrackList(
    [
      { id: 'current_1', url: 'https://example.com/1.m4a', title: 'Playing Now', artist: 'A' },
      { id: 'old_next_2', url: 'https://example.com/2.m4a', title: 'Old Next', artist: 'B' },
    ],
    0
  );

  await player.replaceUpcomingQueue([
    { id: 'radio_track_1', url: 'https://example.com/r1.m4a', title: 'Radio Hit 1', artist: 'Radio Artist 1' },
    { id: 'radio_track_2', url: 'https://example.com/r2.m4a', title: 'Radio Hit 2', artist: 'Radio Artist 2' },
  ]);

  const updatedQueue = await player.getQueue();
  assert.strictEqual(updatedQueue.length, 3);
  assert.strictEqual(updatedQueue[0].id, 'current_1', 'Active playing track must be preserved');
  assert.strictEqual(updatedQueue[1].id, 'radio_track_1', 'Upcoming queue must be replaced with radio tracks');
});


test('LRA-007: getRelatedTracks sends RDAMVM playlistId, extracts real artist from channel titles (e.g. COLORS), filters out YouTube Shorts, and falls back to artist/style search instead of raw videoId', async () => {
  // 1. Verify extractTrackMetadata parses "Leon Thomas - VIBES DON'T LIE | A COLORS SHOW" on channel "COLORS"
  const meta = api.extractTrackMetadata(
    "Leon Thomas - VIBES DON'T LIE | A COLORS SHOW",
    'COLORS'
  );
  assert.strictEqual(meta.primaryArtist, 'Leon Thomas');
  assert.strictEqual(meta.secondaryArtist, 'COLORS');
  assert.strictEqual(meta.cleanTitle, "VIBES DON'T LIE");

  // 2. Verify /youtubei/v1/next receives playlistId: RDAMVM<id> and filters out Shorts (< 45s or #preppy/#vertiy)
  let capturedNextPayload = null;
  global.fetch = async (url, init) => {
    if (String(url).includes('/youtubei/v1/next')) {
      capturedNextPayload = JSON.parse(init.body);
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
                                      videoId: 'seed_lt_1',
                                      title: { runs: [{ text: "Leon Thomas - VIBES DON'T LIE" }] },
                                      shortBylineText: { runs: [{ text: 'Leon Thomas' }] },
                                      lengthText: { simpleText: '3:16' },
                                    },
                                  },
                                  {
                                    playlistPanelVideoRenderer: {
                                      videoId: 'short_junk_1',
                                      title: { runs: [{ text: 'Coloque nos comentários se arde...' }] },
                                      shortBylineText: { runs: [{ text: 'versos' }] },
                                      lengthText: { simpleText: '0:13' },
                                    },
                                  },
                                  {
                                    playlistPanelVideoRenderer: {
                                      videoId: 'short_junk_2',
                                      title: { runs: [{ text: '5 0 4...🎀/ #nflopaaa #preppy #vertiy' }] },
                                      shortBylineText: { runs: [{ text: 'Duda' }] },
                                      lengthText: { simpleText: '2:10' },
                                    },
                                  },
                                  {
                                    playlistPanelVideoRenderer: {
                                      videoId: 'lt_mutt_1',
                                      title: { runs: [{ text: 'MUTT' }] },
                                      shortBylineText: { runs: [{ text: 'Leon Thomas' }] },
                                      lengthText: { simpleText: '3:12' },
                                    },
                                  },
                                  {
                                    playlistPanelVideoRenderer: {
                                      videoId: 'lt_treasure_2',
                                      title: { runs: [{ text: 'Treasure In The Hills' }] },
                                      shortBylineText: { runs: [{ text: 'Leon Thomas' }] },
                                      lengthText: { simpleText: '3:05' },
                                    },
                                  },
                                  {
                                    playlistPanelVideoRenderer: {
                                      videoId: 'giv_heartbreak_3',
                                      title: { runs: [{ text: 'Heartbreak Anniversary' }] },
                                      shortBylineText: { runs: [{ text: 'Giveon' }] },
                                      lengthText: { simpleText: '3:18' },
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
    return { ok: false, status: 404 };
  };

  const related = await api.getRelatedTracks(
    'seed_lt_1',
    "Leon Thomas - VIBES DON'T LIE | A COLORS SHOW",
    'COLORS'
  );

  assert.strictEqual(
    capturedNextPayload.playlistId,
    'RDAMVMseed_lt_1',
    'Must include RDAMVM playlistId so YouTube Music returns the 50-track radio mix instead of only the current video'
  );
  assert.strictEqual(capturedNextPayload.isAudioOnly, true);
  assert.strictEqual(related.length, 3, 'Must filter out 0:13 Shorts and #preppy/#vertiy spam');
  assert.deepStrictEqual(
    related.map((t) => t.id),
    ['lt_mutt_1', 'lt_treasure_2', 'giv_heartbreak_3']
  );

  // 3. Verify fallback when /next fails: NEVER searches raw videoId when title/artist exist
  const searchedQueries = [];
  global.fetch = async (url, init) => {
    if (String(url).includes('/youtubei/v1/next')) {
      return { ok: false, status: 500 };
    }
    if (String(url).includes('/youtubei/v1/search')) {
      const body = JSON.parse(init.body);
      searchedQueries.push(body.query);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          contents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: 'short_bad',
                          title: { runs: [{ text: 'algo não está certo 😔 #vertiy' }] },
                          ownerText: { runs: [{ text: 'Sam2025play' }] },
                          lengthText: { simpleText: '0:21' },
                        },
                      },
                      {
                        videoRenderer: {
                          videoId: 'lt_crash_out',
                          title: { runs: [{ text: 'Leon Thomas - Crash Out (Official Audio)' }] },
                          ownerText: { runs: [{ text: 'Leon Thomas' }] },
                          lengthText: { simpleText: '3:28' },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const fallbackRelated = await api.getRelatedTracks(
    'seed_lt_1',
    "Leon Thomas - VIBES DON'T LIE | A COLORS SHOW",
    'COLORS'
  );

  assert.ok(
    !searchedQueries.includes('seed_lt_1'),
    'Must NEVER search for raw videoId when track metadata is available'
  );
  assert.ok(
    searchedQueries.some((q) => q.includes('Leon Thomas')),
    'Fallback must search for real extracted artist "Leon Thomas"'
  );
  assert.strictEqual(fallbackRelated.length, 1);
  assert.strictEqual(fallbackRelated[0].id, 'lt_crash_out');
});

