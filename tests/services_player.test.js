// tests/services_player.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  setupPlayer,
  playTrack,
  playTrackPreservingQueue,
  playTrackList,
  addTracksToQueue,
  skipToNext,
  skipToPrevious,
  togglePlayback,
  seekTo,
  seekRelative,
  getQueue,
  resetPlayer,
  playNextTrack,
  addTrackToEndOfQueue,
  removeTrackFromQueue,
  moveTrackInQueue,
  getActiveTrackIndex,
  enableShuffle,
  disableShuffle,
  skipToIndex,
} = require('../services/player');
const { mockPlayer, State } = require('./mocks/trackPlayerMock');

test.beforeEach(() => {
  mockPlayer.resetState();
});

test('Player: setupPlayer initializes TrackPlayer successfully', async () => {
  const result = await setupPlayer();
  assert.strictEqual(result, true);
  assert.strictEqual(mockPlayer.isInitialized, true);
  assert.ok(mockPlayer.options);
  assert.ok(mockPlayer.options.capabilities.length > 0);
});

test('Player: playTrack resets queue and starts playback', async () => {
  await playTrack({
    id: 'track_1',
    url: 'https://stream.example.com/audio.mp4',
    title: 'Song A',
    artist: 'Artist A',
    artwork: 'https://example.com/art.jpg',
    duration: 210,
  });

  assert.strictEqual(mockPlayer.state, State.Playing);
  const queue = await getQueue();
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].id, 'track_1');
  assert.strictEqual(queue[0].title, 'Song A');
  assert.strictEqual(queue[0].artist, 'Artist A');
  assert.strictEqual(queue[0].headers?.Referer, undefined, 'Player must not inject hardcoded third-party Referer');
  assert.strictEqual(queue[0].headers?.Origin, undefined, 'Player must not inject hardcoded third-party Origin');

  // Custom headers from MediaProvider must be forwarded verbatim
  await playTrack({
    id: 'track_2',
    url: 'https://stream.example.com/audio2.mp4',
    title: 'Song B',
    artist: 'Artist B',
    headers: {
      'User-Agent': 'ProviderUA/2.0',
      'X-Provider-Token': 'abc123',
    },
  });
  const queueAfter = await getQueue();
  assert.strictEqual(queueAfter[0].headers?.['User-Agent'], 'ProviderUA/2.0');
  assert.strictEqual(queueAfter[0].headers?.['X-Provider-Token'], 'abc123');
});

test('Player: playTrackList loads multiple tracks and starts playback at initial index', async () => {
  const tracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1', duration: 100 },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2', duration: 200 },
    { id: '3', url: 'https://ex.com/3', title: 'T3', artist: 'A3', duration: 300 },
  ];

  await playTrackList(tracks, 1);

  assert.strictEqual(mockPlayer.state, State.Playing);
  const queue = await getQueue();
  assert.strictEqual(queue.length, 3);
  assert.strictEqual(mockPlayer.activeTrackIndex, 1);
  assert.strictEqual(mockPlayer.getActiveTrack().title, 'T2');
});

test('Player: addTracksToQueue adds tracks without resetting active track', async () => {
  await playTrack({
    id: 'init',
    url: 'https://ex.com/init',
    title: 'Init Track',
    artist: 'Init Artist',
  });

  await addTracksToQueue([
    { id: 'next_1', url: 'https://ex.com/next1', title: 'Next 1', artist: 'Artist' },
    { id: 'next_2', url: 'https://ex.com/next2', title: 'Next 2', artist: 'Artist' },
  ]);

  const queue = await getQueue();
  assert.strictEqual(queue.length, 3);
  assert.strictEqual(queue[0].id, 'init');
  assert.strictEqual(queue[1].id, 'next_1');
  assert.strictEqual(queue[2].id, 'next_2');
  assert.strictEqual(mockPlayer.getActiveTrack().id, 'init');
});

test('Player: togglePlayback switches between playing and paused', async () => {
  await playTrack({
    id: 't1',
    url: 'https://ex.com/t1',
    title: 'Song',
    artist: 'Artist',
  });

  assert.strictEqual(mockPlayer.state, State.Playing);

  await togglePlayback();
  assert.strictEqual(mockPlayer.state, State.Paused);

  await togglePlayback();
  assert.strictEqual(mockPlayer.state, State.Playing);
});

test('Player: skipToNext advances active track in queue', async () => {
  const tracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1', duration: 100 },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2', duration: 200 },
  ];
  await playTrackList(tracks, 0);
  assert.strictEqual(mockPlayer.getActiveTrack().id, '1');

  const skipped = await skipToNext();
  assert.strictEqual(skipped, true);
  assert.strictEqual(mockPlayer.getActiveTrack().id, '2');

  // Skip at end of queue returns false
  const endSkip = await skipToNext();
  assert.strictEqual(endSkip, false);
});

test('Player: skipToPrevious rewinds if position > 3s or steps back if <= 3s', async () => {
  const tracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1', duration: 100 },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2', duration: 200 },
  ];
  await playTrackList(tracks, 1);
  assert.strictEqual(mockPlayer.getActiveTrack().id, '2');

  // Position is at 0 (<= 3s), should step back to track 1
  mockPlayer.position = 0;
  const skippedBack = await skipToPrevious();
  assert.strictEqual(skippedBack, true);
  assert.strictEqual(mockPlayer.getActiveTrack().id, '1');

  // Now advance position to 10s (> 3s) without force -> rewinds track 1
  mockPlayer.position = 10;
  const rewound = await skipToPrevious();
  assert.strictEqual(rewound, true);
  assert.strictEqual(mockPlayer.position, 0);
  assert.strictEqual(mockPlayer.getActiveTrack().id, '1');

  // Force previous track from track 2 even when position > 3s -> skips directly back to track 1
  await playTrackList(tracks, 1);
  mockPlayer.position = 45;
  const forcedBack = await skipToPrevious(true);
  assert.strictEqual(forcedBack, true);
  assert.strictEqual(mockPlayer.getActiveTrack().id, '1');
});

test('Player: seekTo and seekRelative update player position', async () => {
  await playTrack({
    id: 'seek_test',
    url: 'https://ex.com/seek',
    title: 'Seek Song',
    artist: 'Artist',
    duration: 300,
  });

  await seekTo(150);
  assert.strictEqual(mockPlayer.position, 150);

  await seekRelative(15);
  assert.strictEqual(mockPlayer.position, 165);

  await seekRelative(-30);
  assert.strictEqual(mockPlayer.position, 135);
});

test('Player: resetPlayer clears queue and resets state', async () => {
  await playTrack({
    id: 'to_reset',
    url: 'https://ex.com/reset',
    title: 'Reset Song',
    artist: 'Artist',
  });

  assert.strictEqual((await getQueue()).length, 1);
  await resetPlayer();
  assert.strictEqual((await getQueue()).length, 0);
  assert.strictEqual(mockPlayer.state, State.None);
});

test('Player: playNextTrack inserts track immediately after active track', async () => {
  const tracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1' },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2' },
  ];
  await playTrackList(tracks, 0);

  const nextTrack = { id: 'next_priority', url: 'https://ex.com/np', title: 'Next Priority', artist: 'NP' };
  await playNextTrack(nextTrack);

  const queue = await getQueue();
  assert.strictEqual(queue.length, 3);
  assert.strictEqual(queue[0].id, '1');
  assert.strictEqual(queue[1].id, 'next_priority');
  assert.strictEqual(queue[2].id, '2');
  assert.strictEqual(await getActiveTrackIndex(), 0);
});

test('Player: addTrackToEndOfQueue appends track to the end of the queue', async () => {
  const tracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1' },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2' },
  ];
  await playTrackList(tracks, 0);

  await addTrackToEndOfQueue({ id: 'end_track', url: 'https://ex.com/end', title: 'End Track', artist: 'End' });

  const queue = await getQueue();
  assert.strictEqual(queue.length, 3);
  assert.strictEqual(queue[2].id, 'end_track');
});

test('Player: removeTrackFromQueue removes item and rejects removing active track or invalid index', async () => {
  const tracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1' },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2' },
    { id: '3', url: 'https://ex.com/3', title: 'T3', artist: 'A3' },
  ];
  await playTrackList(tracks, 1); // active is T2 (index 1)

  // Cannot remove active track
  const removeActive = await removeTrackFromQueue(1);
  assert.strictEqual(removeActive, false);

  // Out of bounds
  const removeOOB = await removeTrackFromQueue(99);
  assert.strictEqual(removeOOB, false);

  // Remove valid non-active track (index 2)
  const removeSuccess = await removeTrackFromQueue(2);
  assert.strictEqual(removeSuccess, true);
  const queue = await getQueue();
  assert.strictEqual(queue.length, 2);
  assert.strictEqual(queue[0].id, '1');
  assert.strictEqual(queue[1].id, '2');
});

test('Player: moveTrackInQueue reorders queue items safely', async () => {
  const tracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1' },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2' },
    { id: '3', url: 'https://ex.com/3', title: 'T3', artist: 'A3' },
  ];
  await playTrackList(tracks, 0);

  // Invalid moves
  assert.strictEqual(await moveTrackInQueue(0, 0), false);
  assert.strictEqual(await moveTrackInQueue(-1, 2), false);
  assert.strictEqual(await moveTrackInQueue(0, 10), false);

  // Valid move: move track 0 to index 2
  const moved = await moveTrackInQueue(0, 2);
  assert.strictEqual(moved, true);

  const queue = await getQueue();
  assert.strictEqual(queue[0].id, '2');
  assert.strictEqual(queue[1].id, '3');
  assert.strictEqual(queue[2].id, '1');
  assert.strictEqual(await getActiveTrackIndex(), 2);
});

test('Player: moveTrackInQueue moves upcoming track to top of Up Next without TrackPlayer.move desync', async () => {
  const tracks = [
    { id: '0', url: 'https://ex.com/0', title: 'Current', artist: 'A0' },
    { id: '1', url: 'https://ex.com/1', title: 'Next1', artist: 'A1' },
    { id: '2', url: 'https://ex.com/2', title: 'Next2', artist: 'A2' },
    { id: '3', url: 'https://ex.com/3', title: 'Next3', artist: 'A3' },
  ];
  await playTrackList(tracks, 0);
  mockPlayer.callLog = [];

  // Move last upcoming track (index 3) to top of "A seguir" (index 1)
  const movedUp = await moveTrackInQueue(3, 1);
  assert.strictEqual(movedUp, true);

  let queue = await getQueue();
  assert.deepStrictEqual(
    queue.map((t) => t.id),
    ['0', '3', '1', '2']
  );
  assert.strictEqual(await getActiveTrackIndex(), 0);
  assert.strictEqual(
    mockPlayer.callLog.some((c) => c.method === 'move'),
    false,
    'Upcoming reorder must avoid native TrackPlayer.move'
  );

  // Move top upcoming track (index 1) back down to end (index 3)
  const movedDown = await moveTrackInQueue(1, 3);
  assert.strictEqual(movedDown, true);

  queue = await getQueue();
  assert.deepStrictEqual(
    queue.map((t) => t.id),
    ['0', '1', '2', '3']
  );
  assert.strictEqual(await getActiveTrackIndex(), 0);
});

test('Player: enableShuffle and disableShuffle preserve original queue on un-shuffle', async () => {
  const originalTracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1' },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2' },
    { id: '3', url: 'https://ex.com/3', title: 'T3', artist: 'A3' },
    { id: '4', url: 'https://ex.com/4', title: 'T4', artist: 'A4' },
  ];
  await playTrackList(originalTracks, 0);

  // Enable shuffle
  const shuffled = await enableShuffle(originalTracks, '1');
  assert.strictEqual(shuffled[0].id, '1', 'Active track must remain first in shuffled list');
  assert.strictEqual(shuffled.length, 4);

  // Disable shuffle (Un-shuffle) restores original order
  const unShuffled = await disableShuffle(originalTracks, '1');
  assert.strictEqual(unShuffled.length, 4);
  assert.strictEqual(unShuffled[0].id, '1');
  assert.strictEqual(unShuffled[1].id, '2');
  assert.strictEqual(unShuffled[2].id, '3');
  assert.strictEqual(unShuffled[3].id, '4');

  const nativeQueue = await getQueue();
  assert.strictEqual(nativeQueue.length, 4);
  assert.strictEqual(nativeQueue[0].id, '1');
  assert.strictEqual(nativeQueue[1].id, '2');
  assert.strictEqual(nativeQueue[2].id, '3');
  assert.strictEqual(nativeQueue[3].id, '4');
});

test('Player: playTrackPreservingQueue preserves upcoming queue when tracks follow active track, and resets when none remain', async () => {
  // 1. Empty queue -> starts fresh with preservedUpcomingCount = 0
  const fresh = await playTrackPreservingQueue({
    id: 'a',
    url: 'https://ex.com/a',
    title: 'A',
    artist: 'Artist A',
  });
  assert.strictEqual(fresh.preservedUpcomingCount, 0);
  assert.deepStrictEqual((await getQueue()).map((t) => t.id), ['a']);

  // 2. User queues U1 and U2 after active track 'a', then switches to 'b' -> preserves U1, U2
  await addTracksToQueue([
    { id: 'u1', url: 'https://ex.com/u1', title: 'U1', artist: 'Artist U1' },
    { id: 'u2', url: 'https://ex.com/u2', title: 'U2', artist: 'Artist U2' },
  ]);
  const switched = await playTrackPreservingQueue({
    id: 'b',
    url: 'https://ex.com/b',
    title: 'B',
    artist: 'Artist B',
  });
  assert.strictEqual(switched.preservedUpcomingCount, 2);
  let queue = await getQueue();
  let activeIdx = await getActiveTrackIndex();
  assert.deepStrictEqual(queue.map((t) => t.id), ['a', 'b', 'u1', 'u2']);
  assert.strictEqual(activeIdx, 1);
  assert.strictEqual(queue[activeIdx].id, 'b');

  // 3. Selecting a track already inside upcoming deduplicates it while preserving remaining upcoming tracks
  const pickedU2 = await playTrackPreservingQueue({
    id: 'u2',
    url: 'https://ex.com/u2',
    title: 'U2',
    artist: 'Artist U2',
  });
  assert.strictEqual(pickedU2.preservedUpcomingCount, 1);
  queue = await getQueue();
  activeIdx = await getActiveTrackIndex();
  assert.deepStrictEqual(queue.slice(activeIdx).map((t) => t.id), ['u2', 'u1']);

  // 4. Selecting the only remaining upcoming track ('u1') leaves no upcoming tracks -> resets cleanly
  const pickedLast = await playTrackPreservingQueue({
    id: 'u1',
    url: 'https://ex.com/u1',
    title: 'U1',
    artist: 'Artist U1',
  });
  assert.strictEqual(pickedLast.preservedUpcomingCount, 0);
  assert.deepStrictEqual((await getQueue()).map((t) => t.id), ['u1']);
});

test('Player: enableShuffle and disableShuffle mid-queue only shuffle upcoming tracks and never duplicate played history', async () => {
  const originalTracks = [
    { id: '1', url: 'https://ex.com/1', title: 'T1', artist: 'A1' },
    { id: '2', url: 'https://ex.com/2', title: 'T2', artist: 'A2' },
    { id: '3', url: 'https://ex.com/3', title: 'T3', artist: 'A3' },
    { id: '4', url: 'https://ex.com/4', title: 'T4', artist: 'A4' },
    { id: '5', url: 'https://ex.com/5', title: 'T5', artist: 'A5' },
  ];
  await playTrackList(originalTracks, 0);
  await skipToNext(); // activeIdx = 1 ('2')
  await skipToNext(); // activeIdx = 2 ('3')

  const currentIdx = await getActiveTrackIndex();
  assert.strictEqual(currentIdx, 2);

  // Enable shuffle while on track '3' (index 2): tracks '1' and '2' already played and stay behind
  const shuffled = await enableShuffle(originalTracks, '3', currentIdx);
  assert.deepStrictEqual(
    shuffled.slice(0, 3).map((t) => t.id),
    ['1', '2', '3'],
    'Prefix up to active track must remain untouched'
  );
  assert.deepStrictEqual(
    shuffled
      .slice(3)
      .map((t) => t.id)
      .sort(),
    ['4', '5'],
    'Only upcoming tracks after active index should be shuffled (no resurrected history)'
  );

  const nativeQueueShuffled = await getQueue();
  assert.deepStrictEqual(
    nativeQueueShuffled.slice(0, 3).map((t) => t.id),
    ['1', '2', '3']
  );
  assert.deepStrictEqual(
    nativeQueueShuffled
      .slice(3)
      .map((t) => t.id)
      .sort(),
    ['4', '5']
  );
  assert.strictEqual(nativeQueueShuffled.length, 5, 'No duplicate tracks allowed in native queue');

  // Un-shuffle back on '3' restores exact original upcoming order
  const unShuffled = await disableShuffle(originalTracks, '3', currentIdx);
  assert.deepStrictEqual(
    unShuffled.map((t) => t.id),
    ['1', '2', '3', '4', '5']
  );
  assert.deepStrictEqual(
    (await getQueue()).map((t) => t.id),
    ['1', '2', '3', '4', '5']
  );

  // Also test disabling shuffle AFTER advancing to another track while shuffled
  await enableShuffle(originalTracks, '3', 2);
  await skipToNext(); // activeIdx = 3 (either '4' or '5')
  const advancedQueue = await getQueue();
  const advancedIdx = await getActiveTrackIndex();
  const advancedActive = advancedQueue[advancedIdx];
  const expectedRemainingId = advancedActive.id === '4' ? '5' : '4';

  const restoredMidShuffle = await disableShuffle(
    originalTracks,
    advancedActive.id,
    advancedIdx
  );
  assert.strictEqual(restoredMidShuffle.length, 5);
  assert.strictEqual(restoredMidShuffle[advancedIdx].id, advancedActive.id);
  assert.strictEqual(restoredMidShuffle[4].id, expectedRemainingId);
});
