// tests/services_database.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const {
  initDatabase,
  getPlaylists,
  getCachedPlaylists,
  createPlaylist,
  getPlaylistById,
  getCachedPlaylistById,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  isFavorite,
  toggleFavorite,
  getFavoriteTrackIds,
  getFavoriteTracks,
  saveDownloadedTrack,
  getDownloadedTracks,
  getDownloadedTrackById,
  isDownloaded,
  getDownloadedTrackIds,
  deleteDownloadedTrack,
  FAVORITES_PLAYLIST_ID,
  recordPlaybackHistory,
  getPlaybackHistory,
  clearPlaybackHistory,
  savePlaybackSession,
  getPlaybackSession,
  isTrackInPlaylist,
  getSearchHistory,
  recordSearchHistory,
} = require('../services/database');
const {
  enqueueDownload,
  enqueuePlaylistDownload,
  getDownloadQueue,
  setAudioStreamResolver,
  getLocalTrackUri,
  clearStorageCache,
  savePlaylistCover,
  deletePlaylistCover,
  pickPlaylistCoverFromGallery,
  PLAYLIST_COVERS_DIRECTORY,
} = require('../services/storage');
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const { getAllText } = require('./helpers/testUtils');
const { dbInstance } = require('./mocks/sqliteMock');
const fileSystemMock = require('./mocks/fileSystemMock');

test.beforeEach(() => {
  dbInstance.reset();
});

test('Database: initDatabase creates default system favorites playlist', async () => {
  await initDatabase();
  const playlists = await getPlaylists();
  assert.strictEqual(playlists.length, 1);
  assert.strictEqual(playlists[0].id, FAVORITES_PLAYLIST_ID);
  assert.strictEqual(playlists[0].name, 'Músicas Curtidas');
  assert.strictEqual(playlists[0].isSystem, true);
});

test('Database: createPlaylist and getPlaylists return created playlist', async () => {
  await initDatabase();
  const pl = await createPlaylist('Treino Pesado', 'Músicas para malhar');
  assert.ok(pl.id);
  assert.strictEqual(pl.name, 'Treino Pesado');
  assert.strictEqual(pl.description, 'Músicas para malhar');
  assert.strictEqual(pl.isSystem, false);

  const list = await getPlaylists();
  assert.strictEqual(list.length, 2);
  // Favorites is always first
  assert.strictEqual(list[0].id, FAVORITES_PLAYLIST_ID);
  assert.strictEqual(list[1].name, 'Treino Pesado');
});

test('Database: addTrackToPlaylist, getPlaylistById, and removeTrackFromPlaylist', async () => {
  await initDatabase();
  const pl = await createPlaylist('Rock Classics');
  const track1 = {
    id: 'track_1',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    duration: 354,
    thumbnailUrl: 'https://example.com/queen.jpg',
  };
  const track2 = {
    id: 'track_2',
    title: 'Stairway to Heaven',
    artist: 'Led Zeppelin',
    duration: 482,
    thumbnailUrl: 'https://example.com/led.jpg',
  };

  await addTrackToPlaylist(pl.id, track1);
  await addTrackToPlaylist(pl.id, track2);

  const detail = await getPlaylistById(pl.id);
  assert.ok(detail);
  assert.strictEqual(detail.trackCount, 2);
  assert.strictEqual(detail.totalDuration, 354 + 482);
  assert.strictEqual(detail.tracks.length, 2);
  assert.strictEqual(detail.tracks[0].title, 'Bohemian Rhapsody');
  assert.strictEqual(detail.tracks[1].title, 'Stairway to Heaven');

  // Remove first track
  await removeTrackFromPlaylist(pl.id, 'track_1');
  const updated = await getPlaylistById(pl.id);
  assert.strictEqual(updated.trackCount, 1);
  assert.strictEqual(updated.tracks[0].title, 'Stairway to Heaven');
});

test('Database: updatePlaylist and deletePlaylist', async () => {
  await initDatabase();
  const pl = await createPlaylist('Jazz Chill');
  await updatePlaylist(pl.id, 'Smooth Jazz', 'Relaxing jazz');

  const detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.name, 'Smooth Jazz');
  assert.strictEqual(detail.description, 'Relaxing jazz');

  // Deleting user playlist succeeds
  const deleted = await deletePlaylist(pl.id);
  assert.strictEqual(deleted, true);
  const check = await getPlaylistById(pl.id);
  assert.strictEqual(check, null);

  // Deleting system favorites playlist is protected
  const deleteFav = await deletePlaylist(FAVORITES_PLAYLIST_ID);
  assert.strictEqual(deleteFav, false);
});

test('Database: toggleFavorite, isFavorite, getFavoriteTrackIds', async () => {
  await initDatabase();
  const track = {
    id: 'fav_1',
    title: 'Starboy',
    artist: 'The Weeknd',
    duration: 230,
    thumbnailUrl: 'https://example.com/starboy.jpg',
  };

  assert.strictEqual(await isFavorite('fav_1'), false);
  const nowFav = await toggleFavorite(track);
  assert.strictEqual(nowFav, true);
  assert.strictEqual(await isFavorite('fav_1'), true);

  const favIds = await getFavoriteTrackIds(['fav_1', 'other_track']);
  assert.ok(favIds.has('fav_1'));
  assert.strictEqual(favIds.has('other_track'), false);

  const favTracks = await getFavoriteTracks();
  assert.strictEqual(favTracks.length, 1);
  assert.strictEqual(favTracks[0].title, 'Starboy');

  // Toggle again to remove
  const unFav = await toggleFavorite(track);
  assert.strictEqual(unFav, false);
  assert.strictEqual(await isFavorite('fav_1'), false);
});

test('Database: saveDownloadedTrack, getDownloadedTracks, and deleteDownloadedTrack', async () => {
  await initDatabase();
  const dlTrack = {
    id: 'dl_1',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    duration: 200,
    thumbnailUrl: 'https://example.com/bl.jpg',
    localUri: 'file:///data/tracks/dl_1.m4a',
    downloadedAt: Date.now(),
  };

  await saveDownloadedTrack(dlTrack);
  assert.strictEqual(await isDownloaded('dl_1'), true);

  const list = await getDownloadedTracks();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'dl_1');

  const single = await getDownloadedTrackById('dl_1');
  assert.strictEqual(single.title, 'Blinding Lights');

  const idSet = await getDownloadedTrackIds(['dl_1', 'dl_2']);
  assert.ok(idSet.has('dl_1'));
  assert.strictEqual(idSet.has('dl_2'), false);

  await deleteDownloadedTrack('dl_1');
  assert.strictEqual(await isDownloaded('dl_1'), false);
});

test('Database: recordPlaybackHistory, getPlaybackHistory, and clearPlaybackHistory', async () => {
  await initDatabase();
  const trackA = {
    id: 'track_a',
    title: 'Song Alpha',
    artist: 'Artist Alpha',
    duration: 180,
    thumbnailUrl: 'https://ex.com/a.jpg',
  };
  const trackB = {
    id: 'track_b',
    title: 'Song Beta',
    artist: 'Artist Beta',
    duration: 210,
    thumbnailUrl: 'https://ex.com/b.jpg',
  };

  await recordPlaybackHistory(trackA);
  await recordPlaybackHistory(trackB);

  let history = await getPlaybackHistory();
  assert.strictEqual(history.length, 2);
  // trackB was played most recently
  assert.strictEqual(history[0].trackId, 'track_b');
  assert.strictEqual(history[1].trackId, 'track_a');

  // Playing trackA again updates its playedAt without creating a duplicate
  await recordPlaybackHistory({ ...trackA, title: 'Song Alpha (Remastered)' });
  history = await getPlaybackHistory();
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].trackId, 'track_a');
  assert.strictEqual(history[0].title, 'Song Alpha (Remastered)');

  // Clear history
  await clearPlaybackHistory();
  assert.strictEqual((await getPlaybackHistory()).length, 0);
});

test('Database: savePlaybackSession and getPlaybackSession', async () => {
  await initDatabase();
  assert.strictEqual(await getPlaybackSession(), null);

  const session = {
    track: {
      id: 'sess_1',
      title: 'Current Session Track',
      artist: 'Artist S',
      duration: 240,
      thumbnailUrl: 'https://ex.com/s.jpg',
    },
    positionSec: 85,
    playlistContext: { type: 'playlist', id: 'pl_rock' },
    savedAt: Date.now(),
  };

  await savePlaybackSession(session);
  const restored = await getPlaybackSession();
  assert.ok(restored);
  assert.strictEqual(restored.track.id, 'sess_1');
  assert.strictEqual(restored.positionSec, 85);
  assert.strictEqual(restored.playlistContext.id, 'pl_rock');
});

test('Database: isTrackInPlaylist detects existing track', async () => {
  await initDatabase();
  const pl = await createPlaylist('Jazz Session');
  const track = {
    id: 'jazz_1',
    title: 'Autumn Leaves',
    artist: 'Bill Evans',
    duration: 320,
    thumbnailUrl: 'https://ex.com/jazz.jpg',
  };

  assert.strictEqual(await isTrackInPlaylist(pl.id, 'jazz_1'), false);
  await addTrackToPlaylist(pl.id, track);
  assert.strictEqual(await isTrackInPlaylist(pl.id, 'jazz_1'), true);
});

test('Storage: enqueueDownload and enqueuePlaylistDownload manage queue items', async () => {
  setAudioStreamResolver(async (id) => ({
    streamUrl: `https://mock.example.com/${id}.m4a`,
  }));

  try {
    const track1 = {
      id: 'q_track_1',
      title: 'Queue 1',
      artist: 'Artist Q',
      duration: 150,
      formattedDuration: '2:30',
      thumbnailUrl: 'https://ex.com/q1.jpg',
    };
    const track2 = {
      id: 'q_track_2',
      title: 'Queue 2',
      artist: 'Artist Q',
      duration: 180,
      formattedDuration: '3:00',
      thumbnailUrl: 'https://ex.com/q2.jpg',
    };

    enqueueDownload(track1);
    let queue = getDownloadQueue();
    assert.ok(queue.some((i) => i.track.id === 'q_track_1'));

    enqueuePlaylistDownload([track1, track2]);
    queue = getDownloadQueue();
    assert.ok(queue.some((i) => i.track.id === 'q_track_1'));
    assert.ok(queue.some((i) => i.track.id === 'q_track_2'));

    // Wait for queue processing microtasks to finish
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    setAudioStreamResolver();
  }
});

test('Database Cache: read-through cache executes 0 SQLite queries on subsequent reads', async () => {
  await initDatabase();
  const pl = await createPlaylist('Cache Hit Mix');
  await addTrackToPlaylist(pl.id, {
    id: 'ch_1',
    title: 'Cached Track',
    artist: 'Artist C',
    duration: 210,
    thumbnailUrl: 'https://ex.com/c.jpg',
  });
  await toggleFavorite({
    id: 'ch_fav',
    title: 'Fav Cached',
    artist: 'Artist F',
    duration: 190,
    thumbnailUrl: 'https://ex.com/f.jpg',
  });
  await saveDownloadedTrack({
    id: 'ch_dl',
    title: 'Downloaded Cached',
    artist: 'Artist D',
    duration: 200,
    thumbnailUrl: 'https://ex.com/d.jpg',
    localUri: 'file:///data/tracks/ch_dl.m4a',
    downloadedAt: Date.now(),
  });
  await recordSearchHistory('synthwave');

  // Warm caches
  await getPlaylists();
  await getPlaylistById(pl.id);
  await getDownloadedTracks();
  await getFavoriteTrackIds(['ch_fav', 'missing']);
  await getSearchHistory(5);

  const origGetAll = dbInstance.getAllAsync.bind(dbInstance);
  const origGetFirst = dbInstance.getFirstAsync.bind(dbInstance);
  let queryCount = 0;

  dbInstance.getAllAsync = async (...args) => {
    queryCount += 1;
    return origGetAll(...args);
  };
  dbInstance.getFirstAsync = async (...args) => {
    queryCount += 1;
    return origGetFirst(...args);
  };

  try {
    const playlists = await getPlaylists();
    assert.strictEqual(playlists.length, 2);

    const detail = await getPlaylistById(pl.id);
    assert.strictEqual(detail.tracks.length, 1);

    const downloaded = await getDownloadedTracks();
    assert.strictEqual(downloaded.length, 1);

    const dlById = await getDownloadedTrackById('ch_dl');
    assert.strictEqual(dlById.title, 'Downloaded Cached');

    assert.strictEqual(await isDownloaded('ch_dl'), true);
    assert.strictEqual(await isDownloaded('missing'), false);

    const dlSet = await getDownloadedTrackIds(['ch_dl', 'missing']);
    assert.strictEqual(dlSet.has('ch_dl'), true);
    assert.strictEqual(dlSet.has('missing'), false);

    assert.strictEqual(await isFavorite('ch_fav'), true);
    assert.strictEqual(await isFavorite('missing'), false);

    const favSet = await getFavoriteTrackIds(['ch_fav', 'missing']);
    assert.strictEqual(favSet.has('ch_fav'), true);

    const history = await getSearchHistory(5);
    assert.deepStrictEqual(history, ['synthwave']);

    assert.strictEqual(queryCount, 0, 'Warm reads must execute 0 SQLite queries');
  } finally {
    dbInstance.getAllAsync = origGetAll;
    dbInstance.getFirstAsync = origGetFirst;
  }
});

test('Database Cache: mutations invalidate affected caches deterministically', async () => {
  await initDatabase();
  const pl = await createPlaylist('Mutation Mix');
  const trackA = {
    id: 'm_a',
    title: 'Track A',
    artist: 'Artist A',
    duration: 180,
    thumbnailUrl: 'https://ex.com/a.jpg',
  };
  const trackB = {
    id: 'm_b',
    title: 'Track B',
    artist: 'Artist B',
    duration: 200,
    thumbnailUrl: 'https://ex.com/b.jpg',
  };

  // Warm initial caches
  await getPlaylists();
  await getPlaylistById(pl.id);
  await getDownloadedTracks();
  await isFavorite('m_a');

  // addTrackToPlaylist invalidates playlist summary & detail
  await addTrackToPlaylist(pl.id, trackA);
  await addTrackToPlaylist(pl.id, trackB);
  let detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.trackCount, 2);
  let summaries = await getPlaylists();
  assert.strictEqual(summaries.find((p) => p.id === pl.id).trackCount, 2);

  // reorderPlaylistTracks invalidates detail cache & uses transaction
  await reorderPlaylistTracks(pl.id, ['m_b', 'm_a']);
  detail = await getPlaylistById(pl.id);
  assert.deepStrictEqual(
    detail.tracks.map((t) => t.trackId),
    ['m_b', 'm_a']
  );

  // updatePlaylist invalidates summary & detail
  await updatePlaylist(pl.id, 'Renamed Mix', 'Updated desc');
  detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.name, 'Renamed Mix');
  assert.strictEqual(detail.description, 'Updated desc');

  // saveDownloadedTrack & deleteDownloadedTrack invalidate downloaded & playlist detail caches
  await saveDownloadedTrack({
    id: 'm_a',
    title: 'Track A',
    artist: 'Artist A',
    duration: 180,
    thumbnailUrl: 'https://ex.com/a.jpg',
    localUri: 'file:///data/tracks/m_a.m4a',
    downloadedAt: Date.now(),
  });
  detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.tracks.find((t) => t.trackId === 'm_a').isDownloaded, true);

  await deleteDownloadedTrack('m_a');
  assert.strictEqual(await isDownloaded('m_a'), false);
  detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.tracks.find((t) => t.trackId === 'm_a').isDownloaded, false);

  // removeTrackFromPlaylist invalidates detail
  await removeTrackFromPlaylist(pl.id, 'm_b');
  detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.trackCount, 1);

  // toggleFavorite invalidates favoriteIds & favorites playlist detail
  await toggleFavorite(trackA);
  assert.strictEqual(await isFavorite('m_a'), true);
  await toggleFavorite(trackA);
  assert.strictEqual(await isFavorite('m_a'), false);

  // recordSearchHistory updates searchHistoryCache
  await recordSearchHistory('ambient');
  assert.deepStrictEqual(await getSearchHistory(5), ['ambient']);

  // deletePlaylist invalidates summary & detail
  await deletePlaylist(pl.id);
  assert.strictEqual(await getPlaylistById(pl.id), null);
  assert.strictEqual(getCachedPlaylistById(pl.id), null);
});

test('Database Cache: LRU bounds at 20, defensive clones prevent mutation, and dbInstance.reset() clears cache', async () => {
  await initDatabase();
  const createdIds = [];
  for (let i = 0; i < 22; i++) {
    const pl = await createPlaylist(`LRU Playlist ${i}`);
    await addTrackToPlaylist(pl.id, {
      id: `lru_tr_${i}`,
      title: `Track ${i}`,
      artist: 'LRU Artist',
      duration: 120,
      thumbnailUrl: '',
    });
    createdIds.push(pl.id);
    await getPlaylistById(pl.id);
  }

  // First 2 playlists must be evicted from LRU cache of max 20
  assert.strictEqual(getCachedPlaylistById(createdIds[0]), null);
  assert.strictEqual(getCachedPlaylistById(createdIds[1]), null);
  assert.ok(getCachedPlaylistById(createdIds[21]));

  // Defensive clone: mutating returned detail.tracks does not corrupt cache
  const targetId = createdIds[21];
  const detail = await getPlaylistById(targetId);
  detail.tracks.push({
    playlistId: targetId,
    id: 'tampered',
    trackId: 'tampered',
    title: 'Tampered',
    artist: 'Tampered',
    duration: 1,
    thumbnailUrl: '',
    position: 99,
    addedAt: 0,
    isDownloaded: false,
  });
  const freshCached = getCachedPlaylistById(targetId);
  assert.strictEqual(freshCached.tracks.length, 1);

  // dbInstance.reset() invalidates cache automatically without resetAllMocks()
  await getPlaylists();
  assert.ok(getCachedPlaylists());
  dbInstance.reset();
  assert.strictEqual(getCachedPlaylists(), null);
  assert.strictEqual(getCachedPlaylistById(targetId), null);
  const postResetPlaylists = await getPlaylists();
  assert.strictEqual(postResetPlaylists.length, 1);
  assert.strictEqual(postResetPlaylists[0].id, FAVORITES_PLAYLIST_ID);
});

test('Sync Hydration & Storage Cache: PlaylistDetailModal renders cached tracks immediately and getLocalTrackUri hits memory', async () => {
  fileSystemMock.resetFileSystem();
  clearStorageCache();
  await initDatabase();

  const pl = await createPlaylist('Instant Open Mix');
  await addTrackToPlaylist(pl.id, {
    id: 'inst_1',
    title: 'First Frame Song',
    artist: 'Fast Artist',
    duration: 215,
    thumbnailUrl: 'https://ex.com/inst.jpg',
  });

  // Pre-warm playlist cache
  const warmed = await getPlaylistById(pl.id);
  assert.ok(warmed);
  assert.ok(getCachedPlaylistById(pl.id));

  // Render PlaylistDetailModal synchronously inside renderer.act without waiting async flush
  let modalTree;
  renderer.act(() => {
    modalTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        onClose: () => {},
        onPlayTrack: () => {},
        onPlayAll: () => {},
      })
    );
  });

  const renderedText = getAllText(modalTree.root);
  assert.ok(renderedText.includes('Instant Open Mix'));
  assert.ok(renderedText.includes('First Frame Song'));

  // Storage localUri cache hit & invalidation check
  const localPath = `${fileSystemMock.documentDirectory}tracks/inst_1.m4a`;
  fileSystemMock.files.set(localPath, { isDirectory: false, size: 1024 * 1024 });

  try {
    const uri1 = await getLocalTrackUri('inst_1');
    assert.strictEqual(uri1, localPath);

    // Delete underlying mock file without resetting FS: cached URI must still hit memory
    fileSystemMock.files.delete(localPath);
    const uri2 = await getLocalTrackUri('inst_1');
    assert.strictEqual(uri2, localPath, 'Second getLocalTrackUri must hit memory cache');

    // Resetting FileSystem increments generation and invalidates localUriCache
    fileSystemMock.resetFileSystem();
    const uri3 = await getLocalTrackUri('inst_1');
    assert.strictEqual(uri3, null, 'resetFileSystem must invalidate localUriCache automatically');
  } finally {
    fileSystemMock.resetFileSystem();
    clearStorageCache();
  }
});

test('Playlist Covers: database computes coverThumbnails (up to 4) and persists custom cover updates/resets', async () => {
  fileSystemMock.resetFileSystem();
  await initDatabase();

  const pl = await createPlaylist('Collage Mix');
  assert.strictEqual(pl.hasCustomCover, false);
  assert.deepStrictEqual(pl.coverThumbnails, []);

  // Add 3 tracks: coverThumbnails has 3 items (UI renders only 1st until >= 4)
  for (let i = 1; i <= 3; i++) {
    await addTrackToPlaylist(pl.id, {
      id: `col_${i}`,
      title: `Track ${i}`,
      artist: 'Artist C',
      duration: 180,
      thumbnailUrl: `https://example.com/cov_${i}.jpg`,
    });
  }

  let summaryList = await getPlaylists();
  let summary = summaryList.find((p) => p.id === pl.id);
  assert.strictEqual(summary.hasCustomCover, false);
  assert.strictEqual(summary.coverThumbnails.length, 3);
  assert.strictEqual(summary.thumbnailUrl, 'https://example.com/cov_1.jpg');

  // Add 4th and 5th tracks: coverThumbnails capped at 4 in position ASC order
  await addTrackToPlaylist(pl.id, {
    id: 'col_4',
    title: 'Track 4',
    artist: 'Artist C',
    duration: 180,
    thumbnailUrl: 'https://example.com/cov_4.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'col_5',
    title: 'Track 5',
    artist: 'Artist C',
    duration: 180,
    thumbnailUrl: 'https://example.com/cov_5.jpg',
  });

  summaryList = await getPlaylists();
  summary = summaryList.find((p) => p.id === pl.id);
  assert.deepStrictEqual(summary.coverThumbnails, [
    'https://example.com/cov_1.jpg',
    'https://example.com/cov_2.jpg',
    'https://example.com/cov_3.jpg',
    'https://example.com/cov_4.jpg',
  ]);

  let detail = await getPlaylistById(pl.id);
  assert.strictEqual(detail.hasCustomCover, false);
  assert.deepStrictEqual(detail.coverThumbnails, [
    'https://example.com/cov_1.jpg',
    'https://example.com/cov_2.jpg',
    'https://example.com/cov_3.jpg',
    'https://example.com/cov_4.jpg',
  ]);

  // Save custom cover via gallery mock & image manipulator
  global.__imagePickerMock = {
    requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted', granted: true }),
    launchImageLibraryAsync: async () => ({
      canceled: false,
      assets: [{ uri: 'file:///cache/picked_cover.jpg', width: 1200, height: 800 }],
    }),
  };

  try {
    const picked = await pickPlaylistCoverFromGallery();
    assert.deepStrictEqual(picked, {
      uri: 'file:///cache/picked_cover.jpg',
      width: 1200,
      height: 800,
    });

    const savedCover = await savePlaylistCover(pl.id, picked.uri);
    assert.ok(savedCover.startsWith(PLAYLIST_COVERS_DIRECTORY));
    assert.ok(fileSystemMock.files.has(savedCover));

    await updatePlaylist(pl.id, 'Collage Mix Edited', 'With custom art', savedCover);

    summaryList = await getPlaylists();
    summary = summaryList.find((p) => p.id === pl.id);
    assert.strictEqual(summary.name, 'Collage Mix Edited');
    assert.strictEqual(summary.hasCustomCover, true);
    assert.strictEqual(summary.thumbnailUrl, savedCover);
    assert.deepStrictEqual(summary.coverThumbnails, []);

    detail = await getPlaylistById(pl.id);
    assert.strictEqual(detail.hasCustomCover, true);
    assert.strictEqual(detail.thumbnailUrl, savedCover);
    assert.deepStrictEqual(detail.coverThumbnails, []);

    // Reset back to automatic cover (null)
    await updatePlaylist(pl.id, 'Collage Mix Edited', 'Auto art', null);
    await deletePlaylistCover(savedCover);
    assert.strictEqual(fileSystemMock.files.has(savedCover), false);

    detail = await getPlaylistById(pl.id);
    assert.strictEqual(detail.hasCustomCover, false);
    assert.strictEqual(detail.coverThumbnails.length, 4);
    assert.strictEqual(detail.thumbnailUrl, 'https://example.com/cov_1.jpg');
  } finally {
    delete global.__imagePickerMock;
    fileSystemMock.resetFileSystem();
  }
});
