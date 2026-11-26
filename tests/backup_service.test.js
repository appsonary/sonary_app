// tests/backup_service.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const FileSystem = require('expo-file-system');
const App = require('../App').default;
const { SideDrawerMenu } = require('../components/SideDrawerMenu');
const { BackupModal } = require('../components/BackupModal');
const { DownloadQueueModal } = require('../components/DownloadQueueModal');
const {
  FAVORITES_PLAYLIST_ID,
  addTrackToPlaylist,
  createPlaylist,
  getDownloadedTracks,
  getPlaybackHistory,
  getPlaylistById,
  getPlaylists,
  getSearchHistory,
  initDatabase,
  recordPlaybackHistory,
  recordSearchHistory,
  saveCachedLyrics,
  saveDownloadedTrack,
  setAppSetting,
  toggleFavorite,
  updatePlaylist,
} = require('../services/database');
const {
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  BackupValidationError,
  MAX_BACKUP_FILE_BYTES,
  buildBackupPayload,
  exportBackupToFile,
  getBackupPreview,
  pickBackupFile,
  restoreBackup,
  saveBackupToDevice,
  validateAndNormalizeBackupJson,
} = require('../services/backup');
const {
  PLAYLIST_COVERS_DIRECTORY,
  cancelAllDownloads,
  clearFinishedDownloads,
  enqueuePlaylistDownload,
  getDownloadQueue,
  retryAllFailedDownloads,
  setAudioStreamResolver,
} = require('../services/storage');
const { actAsync, getAllText, resetAllMocks } = require('./helpers/testUtils');

// Minimal valid JPEG base64 (starts with FF D8 FF -> /9j/)
const VALID_JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS';

test.beforeEach(async () => {
  resetAllMocks();
  global.__documentPickerMock = null;
  global.__sharingMock = null;
  setAudioStreamResolver(async (id) => ({
    streamUrl: `https://mock.stream/${id}.m4a`,
    headers: { 'User-Agent': 'SonaryTest/1.0' },
  }));
  await initDatabase();
});

test.afterEach(async () => {
  await cancelAllDownloads();
  clearFinishedDownloads();
  setAudioStreamResolver(null);
  global.__documentPickerMock = null;
  global.__sharingMock = null;
});

test('Backup export: serializes playlists, favorites, base64 custom cover, histories, offline refs and excludes ephemeral caches', async () => {
  const pl = await createPlaylist('Rock Clássico', 'Melhores dos anos 80');
  const coverUri = `${PLAYLIST_COVERS_DIRECTORY}${pl.id}_12345.jpg`;
  await FileSystem.writeAsStringAsync(coverUri, VALID_JPEG_B64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await updatePlaylist(pl.id, 'Rock Clássico', 'Melhores dos anos 80', coverUri);

  await addTrackToPlaylist(pl.id, {
    id: 'trk_1',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    duration: 354,
    thumbnailUrl: 'https://img.example.com/queen.jpg',
  });
  await toggleFavorite({
    id: 'trk_fav',
    title: 'Hotel California',
    artist: 'Eagles',
    duration: 391,
    thumbnailUrl: 'https://img.example.com/eagles.jpg',
  });
  await recordPlaybackHistory({
    id: 'trk_1',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    duration: 354,
    thumbnailUrl: 'https://img.example.com/queen.jpg',
  });
  await recordSearchHistory('Queen');
  await saveDownloadedTrack({
    id: 'trk_off',
    title: 'Stairway to Heaven',
    artist: 'Led Zeppelin',
    duration: 482,
    thumbnailUrl: 'https://img.example.com/zep.jpg',
    localUri: 'file:///data/user/0/com.sonarypro/files/tracks/trk_off.m4a',
    downloadedAt: Date.now(),
  });
  // Ephemeral/internal entries that MUST NOT leak into backup
  await saveCachedLyrics('trk_1', 'plain', '{"plainText":"test"}');
  await setAppSetting('updater_last_check_at', '999999');

  const payload = await buildBackupPayload();
  const raw = JSON.stringify(payload);

  assert.strictEqual(payload.app, BACKUP_APP_ID);
  assert.strictEqual(payload.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.strictEqual(payload.data.playlists.length, 2);
  const exportedUserPl = payload.data.playlists.find((p) => p.id === pl.id);
  assert.ok(exportedUserPl, 'User playlist must be exported');
  assert.strictEqual(exportedUserPl.customCoverBase64, VALID_JPEG_B64);
  assert.strictEqual(exportedUserPl.tracks.length, 1);

  const exportedFav = payload.data.playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);
  assert.ok(exportedFav, 'Favorites playlist must be exported');
  assert.strictEqual(exportedFav.tracks.length, 1);
  assert.strictEqual(exportedFav.tracks[0].trackId, 'trk_fav');

  assert.strictEqual(payload.data.playbackHistory.length, 1);
  assert.deepStrictEqual(payload.data.searchHistory, ['Queen']);
  assert.strictEqual(payload.data.offlineTrackRefs.length, 1);
  assert.strictEqual(payload.data.offlineTrackRefs[0].id, 'trk_off');
  assert.strictEqual(raw.includes('localUri'), false, 'Backup must never include localUri');
  assert.strictEqual(raw.includes('updater_last_check_at'), false, 'Backup must not include internal settings');
  assert.strictEqual(raw.includes('plainText'), false, 'Backup must not include lyrics cache');

  let sharedUri = null;
  global.__sharingMock = {
    isAvailableAsync: async () => true,
    shareAsync: async (uri) => {
      sharedUri = uri;
    },
  };
  const expRes = await exportBackupToFile();
  assert.strictEqual(expRes.shared, true);
  assert.ok(expRes.fileName.startsWith('sonary-backup-'));
  assert.strictEqual(sharedUri, expRes.fileUri);
});

test('Backup validation: rejects malformed JSON, unknown schemaVersion, >15MB, prototype pollution, unsafe URLs and bad base64 covers', () => {
  assert.throws(() => validateAndNormalizeBackupJson(''), BackupValidationError);
  assert.throws(() => validateAndNormalizeBackupJson('{invalid'), BackupValidationError);
  assert.throws(
    () => validateAndNormalizeBackupJson(JSON.stringify({ app: 'other', schemaVersion: 1, data: { playlists: [] } })),
    BackupValidationError
  );
  assert.throws(
    () => validateAndNormalizeBackupJson(JSON.stringify({ app: BACKUP_APP_ID, schemaVersion: 99, data: { playlists: [] } })),
    BackupValidationError
  );
  assert.throws(
    () => validateAndNormalizeBackupJson('a'.repeat(MAX_BACKUP_FILE_BYTES + 1)),
    BackupValidationError
  );

  // Prototype pollution + path traversal ID + javascript:/file:// URLs + fake base64 cover
  const maliciousJson = JSON.stringify({
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '1.0.13',
    exportedAt: 1700000000000,
    __proto__: { polluted: true },
    data: {
      playlists: [
        {
          id: '../../etc/passwd',
          name: 'Evil',
          tracks: [],
        },
        {
          id: 'pl_safe_1',
          name: 'Safe Playlist',
          customCoverBase64: 'SGVsbG8gd29ybGQh', // "Hello world!" - not JPEG/PNG magic bytes
          tracks: [
            {
              trackId: 't1',
              title: 'Song\u0000Clean',
              artist: 'Artist',
              duration: 180,
              thumbnailUrl: 'javascript:alert(1)',
              position: 0,
              addedAt: 1700000000000,
            },
            {
              trackId: 't2',
              title: 'Song 2',
              artist: 'Artist 2',
              duration: 200,
              thumbnailUrl: 'file:///etc/shadow',
              position: 1,
              addedAt: 1700000000000,
            },
          ],
        },
      ],
      playbackHistory: [],
      searchHistory: ['Rock', 'rock', 'Jazz'],
      offlineTrackRefs: [],
    },
  });

  const normalized = validateAndNormalizeBackupJson(maliciousJson);
  assert.strictEqual(({}).polluted, undefined, 'Object prototype must not be polluted');
  assert.strictEqual(normalized.data.playlists.length, 1, 'Path traversal playlist ID must be dropped');
  assert.strictEqual(normalized.data.playlists[0].id, 'pl_safe_1');
  assert.strictEqual(normalized.data.playlists[0].customCoverBase64, null, 'Non-image base64 must be stripped');
  assert.strictEqual(normalized.data.playlists[0].tracks[0].title, 'SongClean');
  assert.strictEqual(normalized.data.playlists[0].tracks[0].thumbnailUrl, '', 'javascript: URL must be stripped');
  assert.strictEqual(normalized.data.playlists[0].tracks[1].thumbnailUrl, '', 'file:// URL must be stripped');
  assert.deepStrictEqual(normalized.data.searchHistory, ['Rock', 'Jazz']);
});

test('Backup restore: merge preserves local data without duplicates, restores base64 cover, and enqueues missing offline tracks', async () => {
  // Existing local data
  const localPl = await createPlaylist('Local Only');
  await toggleFavorite({
    id: 'fav_local',
    title: 'Local Fav',
    artist: 'Local Artist',
    duration: 150,
    thumbnailUrl: 'https://img.example.com/local.jpg',
  });
  const alreadyAudioUri = `${FileSystem.documentDirectory}tracks/off_already.m4a`;
  FileSystem.files.set(alreadyAudioUri, { isDirectory: false, size: 1024 * 64 });
  await saveDownloadedTrack({
    id: 'off_already',
    title: 'Already Offline',
    artist: 'Artist',
    duration: 200,
    thumbnailUrl: 'https://img.example.com/a.jpg',
    localUri: alreadyAudioUri,
    downloadedAt: Date.now(),
  });

  const backup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [
          {
            id: FAVORITES_PLAYLIST_ID,
            name: 'Músicas Curtidas',
            isSystem: true,
            tracks: [
              { trackId: 'fav_local', title: 'Local Fav', artist: 'Local Artist', duration: 150, thumbnailUrl: '', position: 0, addedAt: 1000 },
              { trackId: 'fav_new', title: 'New Fav', artist: 'New Artist', duration: 210, thumbnailUrl: 'https://img.example.com/new.jpg', position: 1, addedAt: 2000 },
            ],
          },
          {
            id: 'pl_backup_1',
            name: 'From Backup',
            description: 'Restaurada',
            isSystem: false,
            customCoverBase64: VALID_JPEG_B64,
            tracks: [
              { trackId: 'b_trk_1', title: 'Backup Song', artist: 'Band', duration: 240, thumbnailUrl: 'https://img.example.com/b.jpg', position: 0, addedAt: 2000 },
            ],
          },
        ],
        playbackHistory: [
          { trackId: 'b_trk_1', title: 'Backup Song', artist: 'Band', duration: 240, thumbnailUrl: '', playedAt: 5000 },
        ],
        searchHistory: ['Backup Query'],
        offlineTrackRefs: [
          { id: 'off_already', title: 'Already Offline', artist: 'Artist', duration: 200, thumbnailUrl: '' },
          { id: 'off_missing', title: 'Missing Offline', artist: 'Artist B', duration: 190, thumbnailUrl: '' },
        ],
      },
    })
  );

  const preview = await getBackupPreview(backup);
  assert.strictEqual(preview.userPlaylistCount, 1);
  assert.strictEqual(preview.favoritesCount, 2);
  assert.strictEqual(preview.customCoverCount, 1);
  assert.strictEqual(preview.offlineTotalCount, 2);
  assert.strictEqual(preview.offlineMissingCount, 1);

  const result = await restoreBackup(backup, { mode: 'merge', enqueueOfflineDownloads: true });
  assert.strictEqual(result.mode, 'merge');
  assert.strictEqual(result.restoredCoversCount, 1);
  assert.strictEqual(result.enqueuedOfflineCount, 1);

  const allPlaylists = await getPlaylists();
  assert.ok(allPlaylists.some((p) => p.id === localPl.id), 'Local playlist must be preserved in merge mode');
  const restoredPl = await getPlaylistById('pl_backup_1');
  assert.ok(restoredPl, 'Backup playlist must be restored');
  assert.strictEqual(restoredPl.hasCustomCover, true);
  assert.ok(restoredPl.thumbnailUrl.startsWith(PLAYLIST_COVERS_DIRECTORY));

  const favDetail = await getPlaylistById(FAVORITES_PLAYLIST_ID);
  assert.strictEqual(favDetail.tracks.length, 2, 'Favorites must merge without duplicating fav_local');

  const history = await getPlaybackHistory(20);
  assert.strictEqual(history.length, 1);
  const searches = await getSearchHistory();
  assert.ok(searches.includes('Backup Query'));
  const queue = getDownloadQueue();
  assert.ok(queue.some((q) => q.track.id === 'off_missing'));
});

test('Backup restore: replace mode clears old user playlists/history while preserving local downloaded_tracks', async () => {
  await createPlaylist('Old Playlist');
  await recordSearchHistory('Old Search');
  await saveDownloadedTrack({
    id: 'keep_m4a',
    title: 'Keep Offline',
    artist: 'Artist',
    duration: 180,
    thumbnailUrl: '',
    localUri: 'file:///data/user/0/com.sonarypro/files/tracks/keep_m4a.m4a',
    downloadedAt: Date.now(),
  });

  const backup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [
          { id: 'pl_fresh', name: 'Fresh Only', isSystem: false, tracks: [] },
        ],
        playbackHistory: [],
        searchHistory: ['Fresh Search'],
        offlineTrackRefs: [],
      },
    })
  );

  await restoreBackup(backup, { mode: 'replace', enqueueOfflineDownloads: false });

  const allPlaylists = await getPlaylists();
  assert.strictEqual(allPlaylists.some((p) => p.name === 'Old Playlist'), false);
  assert.strictEqual(allPlaylists.some((p) => p.id === 'pl_fresh'), true);
  assert.deepStrictEqual(await getSearchHistory(), ['Fresh Search']);
  const downloads = await getDownloadedTracks();
  assert.strictEqual(downloads.length, 1, 'Local downloaded_tracks must remain intact on replace');
});

test('Backup UI: SideDrawerMenu shows "Backup e dados" and BackupModal previews and restores picked JSON', async () => {
  let backupClicked = false;
  let drawerTree;
  await actAsync(async () => {
    drawerTree = renderer.create(
      React.createElement(SideDrawerMenu, {
        visible: true,
        onClose: () => {},
        onOpenDownloadQueue: () => {},
        onOpenRecentHistory: () => {},
        onOpenStats: () => {},
        onOpenUpdates: () => {},
        onOpenBackup: () => {
          backupClicked = true;
        },
        onOpenSettings: () => {},
        onOpenSupport: () => {},
      })
    );
  });

  const drawerText = getAllText(drawerTree.root);
  assert.ok(drawerText.includes('Backup e dados'), 'SideDrawerMenu must display "Backup e dados"');
  const backupBtn = drawerTree.root.find(
    (n) => n.type === 'TouchableOpacity' && getAllText(n).includes('Backup e dados')
  );
  await actAsync(async () => {
    backupBtn.props.onPress();
  });
  assert.strictEqual(backupClicked, true);

  // Pick and restore inside BackupModal
  const sampleUri = `${FileSystem.cacheDirectory}picked-backup.json`;
  const sampleJson = JSON.stringify({
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '1.0.13',
    exportedAt: Date.now(),
    data: {
      playlists: [{ id: 'pl_ui_1', name: 'UI Restored', isSystem: false, tracks: [] }],
      playbackHistory: [],
      searchHistory: ['Lo-Fi'],
      offlineTrackRefs: [],
    },
  });
  await FileSystem.writeAsStringAsync(sampleUri, sampleJson, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  global.__documentPickerMock = {
    getDocumentAsync: async () => ({
      canceled: false,
      assets: [{ uri: sampleUri, name: 'picked-backup.json', size: sampleJson.length }],
    }),
  };

  let restoredResult = null;
  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(BackupModal, {
        visible: true,
        onClose: () => {},
        onBackupRestored: (res) => {
          restoredResult = res;
        },
      })
    );
  });

  const importBtn = modalTree.root.findByProps({ testID: 'backup-import-btn' });
  await actAsync(async () => {
    await importBtn.props.onPress();
  });

  const previewPanel = modalTree.root.findByProps({ testID: 'backup-preview-panel' });
  assert.ok(previewPanel, 'Preview panel must appear after picking valid backup');

  const confirmBtn = modalTree.root.findByProps({ testID: 'backup-confirm-restore-btn' });
  await actAsync(async () => {
    await confirmBtn.props.onPress();
  });

  assert.ok(restoredResult, 'onBackupRestored must be called');
  assert.strictEqual(restoredResult.mode, 'merge');
  const pl = await getPlaylistById('pl_ui_1');
  assert.ok(pl, 'Playlist from BackupModal must be persisted in SQLite');
});

test('Backup export: falls back to Android SAF when Sharing.isAvailableAsync returns false', async () => {
  const { Platform } = require('react-native');
  const originalOs = Platform.OS;
  Platform.OS = 'android';

  let createdSafUri = null;
  global.__safMock = {
    requestDirectoryPermissionsAsync: async () => ({
      granted: true,
      directoryUri: 'content://com.android.externalstorage/tree/primary%3ADownload',
    }),
    createFileAsync: async (dirUri, fileName) => {
      createdSafUri = `${dirUri}/${fileName}`;
      return createdSafUri;
    },
  };
  global.__sharingMock = {
    isAvailableAsync: async () => false,
    shareAsync: async () => {
      throw new Error('shareAsync should not be called when unavailable');
    },
  };

  try {
    const res = await exportBackupToFile();
    assert.strictEqual(res.shared, true, 'Android SAF fallback must mark export as shared');
    assert.ok(createdSafUri, 'SAF createFileAsync must be called');
    const savedContent = await FileSystem.readAsStringAsync(createdSafUri);
    const parsed = JSON.parse(savedContent);
    assert.strictEqual(parsed.app, BACKUP_APP_ID);
  } finally {
    Platform.OS = originalOs;
    global.__safMock = null;
  }
});

test('Backup restore: merge preserves favorites description and cleans up orphan/replaced cover files', async () => {
  const localPl = await createPlaylist('Newer Local', 'Desc local');
  const oldCoverUri = `${PLAYLIST_COVERS_DIRECTORY}${localPl.id}_old.jpg`;
  await FileSystem.writeAsStringAsync(oldCoverUri, VALID_JPEG_B64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await updatePlaylist(localPl.id, 'Newer Local', 'Desc local', oldCoverUri);

  // Backup has older updatedAt for localPl -> must keep oldCoverUri and delete unused newly-written cover
  const olderBackup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [
          { id: FAVORITES_PLAYLIST_ID, name: 'Músicas Curtidas', isSystem: true, tracks: [] },
          {
            id: localPl.id,
            name: 'Older Backup Name',
            isSystem: false,
            updatedAt: 1000,
            customCoverBase64: VALID_JPEG_B64,
            tracks: [],
          },
        ],
        playbackHistory: [],
        searchHistory: [],
        offlineTrackRefs: [],
      },
    })
  );

  const resOlder = await restoreBackup(olderBackup, { mode: 'merge', enqueueOfflineDownloads: false });
  assert.strictEqual(resOlder.restoredCoversCount, 0, 'Unadopted cover must not count as restored');

  const favAfter = await getPlaylistById(FAVORITES_PLAYLIST_ID);
  assert.strictEqual(
    favAfter.description,
    'Suas faixas favoritas salvas com ❤️',
    'Favorites description must not be wiped to null on merge'
  );

  const coversAfterOlder = Array.from(FileSystem.files.keys()).filter((k) =>
    k.startsWith(PLAYLIST_COVERS_DIRECTORY)
  );
  assert.deepStrictEqual(coversAfterOlder, [oldCoverUri], 'Unused backup cover must be removed from disk');

  // Backup with newer updatedAt -> must replace cover and delete oldCoverUri
  const newerBackup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [
          {
            id: localPl.id,
            name: 'Newer Backup Name',
            isSystem: false,
            updatedAt: Date.now() + 60_000,
            customCoverBase64: VALID_JPEG_B64,
            tracks: [],
          },
        ],
        playbackHistory: [],
        searchHistory: [],
        offlineTrackRefs: [],
      },
    })
  );

  const resNewer = await restoreBackup(newerBackup, { mode: 'merge', enqueueOfflineDownloads: false });
  assert.strictEqual(resNewer.restoredCoversCount, 1);
  assert.strictEqual(FileSystem.files.has(oldCoverUri), false, 'Replaced cover must be removed from disk');
});

test('Backup restore: rolls back newly written cover files when SQLite transaction fails', async () => {
  const sqliteMock = require('./mocks/sqliteMock');
  const db = await sqliteMock.openDatabaseAsync('sonary.db');
  const originalRunAsync = db.runAsync.bind(db);

  const backup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [
          {
            id: 'pl_rollback_1',
            name: 'Will Fail',
            isSystem: false,
            customCoverBase64: VALID_JPEG_B64,
            tracks: [],
          },
        ],
        playbackHistory: [],
        searchHistory: [],
        offlineTrackRefs: [],
      },
    })
  );

  db.runAsync = async (sql, params) => {
    if (String(sql).includes('INSERT INTO playlists')) {
      throw new Error('Simulated SQLite write failure');
    }
    return originalRunAsync(sql, params);
  };

  try {
    await assert.rejects(
      () => restoreBackup(backup, { mode: 'merge', enqueueOfflineDownloads: false }),
      /Simulated SQLite write failure/
    );
  } finally {
    db.runAsync = originalRunAsync;
  }

  const leakedCovers = Array.from(FileSystem.files.keys()).filter((k) =>
    k.startsWith(PLAYLIST_COVERS_DIRECTORY) && k.includes('pl_rollback_1')
  );
  assert.strictEqual(leakedCovers.length, 0, 'Newly written cover must be deleted on transaction rollback');
  assert.strictEqual(await getPlaylistById('pl_rollback_1'), null, 'Failed playlist must not be committed');
});

test('Backup App integration: renders a single BackupModal with local summary and updates App state after restore', async () => {
  await createPlaylist('Existing Local');

  const sampleUri = `${FileSystem.cacheDirectory}app-restore.json`;
  const sampleJson = JSON.stringify({
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '1.0.13',
    exportedAt: Date.now(),
    data: {
      playlists: [
        { id: 'pl_app_int', name: 'App Restored Playlist', isSystem: false, tracks: [] },
      ],
      playbackHistory: [],
      searchHistory: ['Synthwave'],
      offlineTrackRefs: [],
    },
  });
  await FileSystem.writeAsStringAsync(sampleUri, sampleJson, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  global.__documentPickerMock = {
    getDocumentAsync: async () => ({
      canceled: false,
      assets: [{ uri: sampleUri, name: 'app-restore.json', size: sampleJson.length }],
    }),
  };

  let appTree;
  await actAsync(async () => {
    appTree = renderer.create(React.createElement(App));
  });

  // Open BackupModal via SideDrawerMenu prop on App
  const drawer = appTree.root.findByType(SideDrawerMenu);
  await actAsync(async () => {
    drawer.props.onOpenBackup();
  });

  const modals = appTree.root.findAllByType(BackupModal);
  assert.strictEqual(modals.length, 1, 'App must render strictly one BackupModal instance');

  const localSummary = appTree.root.findByProps({ testID: 'backup-local-summary' });
  assert.ok(localSummary, 'BackupModal must display local summary in initial state');

  const importBtn = appTree.root.findByProps({ testID: 'backup-import-btn' });
  await actAsync(async () => {
    await importBtn.props.onPress();
  });

  const confirmBtn = appTree.root.findByProps({ testID: 'backup-confirm-restore-btn' });
  await actAsync(async () => {
    await confirmBtn.props.onPress();
  });

  const restored = await getPlaylistById('pl_app_int');
  assert.ok(restored, 'Restored playlist must be persisted after App modal flow');
  assert.deepStrictEqual(await getSearchHistory(), ['Synthwave']);

  await actAsync(async () => {
    appTree.unmount();
  });
});

test('Backup export: SAF error does not re-prompt and cancelled SAF shows error instead of false success in BackupModal', async () => {
  const { Platform } = require('react-native');
  const originalOs = Platform.OS;
  Platform.OS = 'android';

  let safPromptCount = 0;
  global.__sharingMock = {
    isAvailableAsync: async () => false,
    shareAsync: async () => {},
  };
  global.__safMock = {
    requestDirectoryPermissionsAsync: async () => {
      safPromptCount += 1;
      return { granted: true, directoryUri: 'content://mock/dir' };
    },
    createFileAsync: async () => {
      throw new Error('SAF disk full');
    },
  };

  try {
    await assert.rejects(() => exportBackupToFile(), /SAF disk full/);
    assert.strictEqual(safPromptCount, 1, 'SAF picker must only be prompted once on error');

    // Cancelled SAF -> BackupModal must show error banner and NOT call onBackupExported
    global.__safMock = {
      requestDirectoryPermissionsAsync: async () => ({ granted: false }),
    };
    let exportedCalled = false;
    let modalTree;
    await actAsync(async () => {
      modalTree = renderer.create(
        React.createElement(BackupModal, {
          visible: true,
          onClose: () => {},
          onBackupExported: () => {
            exportedCalled = true;
          },
        })
      );
    });

    const startExportBtn = modalTree.root.findByProps({ testID: 'backup-start-export-btn' });
    await actAsync(async () => {
      startExportBtn.props.onPress();
    });

    const exportBtn = modalTree.root.findByProps({ testID: 'backup-export-btn' });
    await actAsync(async () => {
      await exportBtn.props.onPress();
    });

    assert.strictEqual(exportedCalled, false, 'onBackupExported must not fire when SAF is cancelled');
    assert.ok(
      modalTree.root.findByProps({ testID: 'backup-error-banner' }),
      'BackupModal must display error banner when export is cancelled'
    );
  } finally {
    Platform.OS = originalOs;
    global.__safMock = null;
  }
});

test('Backup restore: replace mode cleans up pre-existing unreferenced orphan cover files', async () => {
  const orphanCoverUri = `${PLAYLIST_COVERS_DIRECTORY}orphan_unreferenced.jpg`;
  await FileSystem.writeAsStringAsync(orphanCoverUri, VALID_JPEG_B64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const backup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [
          {
            id: 'pl_with_cover',
            name: 'Fresh Cover',
            isSystem: false,
            customCoverBase64: VALID_JPEG_B64,
            tracks: [],
          },
        ],
        playbackHistory: [],
        searchHistory: [],
        offlineTrackRefs: [],
      },
    })
  );

  const res = await restoreBackup(backup, { mode: 'replace', enqueueOfflineDownloads: false });
  assert.strictEqual(res.restoredCoversCount, 1);
  assert.strictEqual(FileSystem.files.has(orphanCoverUri), false, 'Orphan cover must be deleted on replace');
  const remainingCovers = Array.from(FileSystem.files.keys()).filter((k) =>
    k.startsWith(PLAYLIST_COVERS_DIRECTORY)
  );
  assert.strictEqual(remainingCovers.length, 1, 'Newly restored cover must be preserved');
});

test('Backup save to device & share UX: SAF save confirms real write, SAF cancel stays silent, and Share Sheet avoids false success banner', async () => {
  const { Platform } = require('react-native');
  const originalOs = Platform.OS;
  Platform.OS = 'android';

  try {
    // 1. Save to device (SAF granted) -> writes file and shows real success
    let createdUri = null;
    global.__safMock = {
      requestDirectoryPermissionsAsync: async () => ({
        granted: true,
        directoryUri: 'content://com.android.externalstorage/tree/primary%3ADownload',
      }),
      createFileAsync: async (dirUri, fileName) => {
        createdUri = `${dirUri}/${fileName}`;
        return createdUri;
      },
    };

    const directRes = await saveBackupToDevice();
    assert.strictEqual(directRes.shared, true);
    assert.strictEqual(directRes.fileUri, createdUri);
    const savedJson = JSON.parse(await FileSystem.readAsStringAsync(createdUri));
    assert.strictEqual(savedJson.app, BACKUP_APP_ID);

    let exportedName = null;
    let modalTree;
    await actAsync(async () => {
      modalTree = renderer.create(
        React.createElement(BackupModal, {
          visible: true,
          onClose: () => {},
          onBackupExported: (name) => {
            exportedName = name;
          },
        })
      );
    });

    const startExportBtn = modalTree.root.findByProps({ testID: 'backup-start-export-btn' });
    await actAsync(async () => {
      startExportBtn.props.onPress();
    });

    const saveBtn = modalTree.root.findByProps({ testID: 'backup-save-device-btn' });
    await actAsync(async () => {
      await saveBtn.props.onPress();
    });
    assert.ok(exportedName && exportedName.startsWith('sonary-backup-'));
    assert.ok(modalTree.root.findByProps({ testID: 'backup-success-banner' }));

    // 2. Save to device cancelled (SAF denied) -> no false success banner, no onBackupExported
    exportedName = null;
    global.__safMock = {
      requestDirectoryPermissionsAsync: async () => ({ granted: false }),
    };
    await actAsync(async () => {
      await saveBtn.props.onPress();
    });
    assert.strictEqual(exportedName, null);
    assert.strictEqual(
      modalTree.root.findAllByProps({ testID: 'backup-success-banner' }).length,
      0,
      'Cancelled SAF save must not show success banner'
    );

    // 3. Share Sheet closes -> must NOT show false green success banner or fire onBackupExported
    let shareCalled = false;
    global.__sharingMock = {
      isAvailableAsync: async () => true,
      shareAsync: async () => {
        shareCalled = true;
      },
    };
    const shareBtn = modalTree.root.findByProps({ testID: 'backup-export-btn' });
    await actAsync(async () => {
      await shareBtn.props.onPress();
    });
    assert.strictEqual(shareCalled, true);
    assert.strictEqual(exportedName, null, 'Share Sheet must not fire onBackupExported');
    assert.strictEqual(
      modalTree.root.findAllByProps({ testID: 'backup-success-banner' }).length,
      0,
      'Share Sheet must not display false success banner after closing'
    );
  } finally {
    Platform.OS = originalOs;
    global.__safMock = null;
  }
});

test('Backup offline artwork & queue resilience: preserves HTTP cover URLs, discounts active queue in preview, and retries all failed downloads', async () => {
  // 1. Offline track whose downloaded_tracks.thumbnailUrl is local file://
  const pl = await createPlaylist('Offline Mix');
  await addTrackToPlaylist(pl.id, {
    id: 'trk_in_pl_1',
    title: 'In Playlist',
    artist: 'Artist A',
    duration: 200,
    thumbnailUrl: 'https://img.example.com/in-playlist.jpg',
  });
  await saveDownloadedTrack({
    id: 'trk_in_pl_1',
    title: 'In Playlist',
    artist: 'Artist A',
    duration: 200,
    thumbnailUrl: 'file:///data/user/0/com.sonarypro/files/thumbnails/trk_in_pl_1.jpg',
    localUri: 'file:///data/user/0/com.sonarypro/files/tracks/trk_in_pl_1.m4a',
    downloadedAt: Date.now(),
  });
  // YouTube 11-char ID not in any playlist/history -> must fall back to i.ytimg.com
  await saveDownloadedTrack({
    id: 'dQw4w9WgXcQ',
    title: 'YT Fallback Track',
    artist: 'Artist B',
    duration: 213,
    thumbnailUrl: 'file:///data/user/0/com.sonarypro/files/thumbnails/dQw4w9WgXcQ.jpg',
    localUri: 'file:///data/user/0/com.sonarypro/files/tracks/dQw4w9WgXcQ.m4a',
    downloadedAt: Date.now(),
  });

  const payload = await buildBackupPayload();
  const refInPl = payload.data.offlineTrackRefs.find((r) => r.id === 'trk_in_pl_1');
  const refYt = payload.data.offlineTrackRefs.find((r) => r.id === 'dQw4w9WgXcQ');
  assert.strictEqual(
    refInPl.thumbnailUrl,
    'https://img.example.com/in-playlist.jpg',
    'Export must recover HTTP thumbnail from playlist/history instead of dropping file:// to empty'
  );
  assert.strictEqual(
    refYt.thumbnailUrl,
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    'Export must fall back to YouTube hqdefault thumbnail for 11-char video IDs'
  );

  // 2. Preview discounts tracks already queued as pending/downloading & legacy backup recovers artwork on restore
  const legacyBackup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [],
        playbackHistory: [],
        searchHistory: [],
        offlineTrackRefs: [
          { id: 'abcDEF12345', title: 'Legacy Missing', artist: 'Artist C', duration: 180, thumbnailUrl: '' },
          { id: 'xyzUVW67890', title: 'Already Queued', artist: 'Artist D', duration: 190, thumbnailUrl: '' },
        ],
      },
    })
  );

  // Put xyzUVW67890 in queue before preview (keep resolver pending so it stays active)
  let releaseResolver;
  setAudioStreamResolver(
    () =>
      new Promise((resolve) => {
        releaseResolver = () =>
          resolve({ streamUrl: 'https://mock.stream/delayed.m4a', headers: {} });
      })
  );
  enqueuePlaylistDownload([
    {
      id: 'xyzUVW67890',
      title: 'Already Queued',
      artist: 'Artist D',
      duration: 190,
      formattedDuration: '3:10',
      thumbnailUrl: '',
    },
  ]);

  const preview = await getBackupPreview(legacyBackup);
  assert.strictEqual(
    preview.offlineMissingCount,
    1,
    'Preview must discount tracks already pending/downloading in the download queue'
  );

  const restoreRes = await restoreBackup(legacyBackup, {
    mode: 'merge',
    enqueueOfflineDownloads: true,
  });
  assert.strictEqual(restoreRes.enqueuedOfflineCount, 1);
  const queuedLegacy = getDownloadQueue().find((q) => q.track.id === 'abcDEF12345');
  assert.ok(queuedLegacy);
  assert.strictEqual(
    queuedLegacy.track.thumbnailUrl,
    'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg',
    'Restore must recover YouTube HTTP thumbnail for legacy backups with empty thumbnailUrl'
  );

  if (releaseResolver) releaseResolver();
  await cancelAllDownloads();

  // 3. DownloadQueueModal renders "Tentar novamente (2)" and triggers retryAllFailedDownloads
  let retryAllClicks = 0;
  let queueModalTree;
  await actAsync(async () => {
    queueModalTree = renderer.create(
      React.createElement(DownloadQueueModal, {
        visible: true,
        queue: [
          {
            track: { id: 'err_1', title: 'Fail 1', artist: 'A', duration: 100, formattedDuration: '1:40', thumbnailUrl: '' },
            status: 'error',
            progress: 0,
            error: 'HTTP 503',
          },
          {
            track: { id: 'err_2', title: 'Fail 2', artist: 'B', duration: 120, formattedDuration: '2:00', thumbnailUrl: '' },
            status: 'error',
            progress: 0,
            error: 'HTTP 503',
          },
        ],
        onClose: () => {},
        onCancelItem: () => {},
        onRetryItem: () => {},
        onRetryAllFailed: () => {
          retryAllClicks += 1;
        },
        onCancelAll: () => {},
        onClearFinished: () => {},
      })
    );
  });

  const retryAllBtn = queueModalTree.root.findByProps({ testID: 'download-queue-retry-all-btn' });
  await actAsync(async () => {
    retryAllBtn.props.onPress();
  });
  assert.strictEqual(retryAllClicks, 1, 'Retry all button must trigger onRetryAllFailed');
});

test('Backup restore & preview: re-enqueues tracks whose SQLite record exists but .m4a file is missing on disk', async () => {
  // Track exists in SQLite downloaded_tracks, but its .m4a file was deleted externally
  await saveDownloadedTrack({
    id: 'ghost_disk_1',
    title: 'Deleted From Disk',
    artist: 'Artist Ghost',
    duration: 185,
    thumbnailUrl: 'https://img.example.com/ghost.jpg',
    localUri: `${FileSystem.documentDirectory}tracks/ghost_disk_1.m4a`,
    downloadedAt: Date.now(),
  });

  // Track exists both in SQLite and on disk (>10KB)
  const intactUri = `${FileSystem.documentDirectory}tracks/intact_disk_1.m4a`;
  FileSystem.files.set(intactUri, { isDirectory: false, size: 1024 * 64 });
  await saveDownloadedTrack({
    id: 'intact_disk_1',
    title: 'Intact On Disk',
    artist: 'Artist Intact',
    duration: 200,
    thumbnailUrl: 'https://img.example.com/intact.jpg',
    localUri: intactUri,
    downloadedAt: Date.now(),
  });

  const backup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [],
        playbackHistory: [],
        searchHistory: [],
        offlineTrackRefs: [
          { id: 'ghost_disk_1', title: 'Deleted From Disk', artist: 'Artist Ghost', duration: 185, thumbnailUrl: 'https://img.example.com/ghost.jpg' },
          { id: 'intact_disk_1', title: 'Intact On Disk', artist: 'Artist Intact', duration: 200, thumbnailUrl: 'https://img.example.com/intact.jpg' },
        ],
      },
    })
  );

  const preview = await getBackupPreview(backup);
  assert.strictEqual(
    preview.offlineMissingCount,
    1,
    'Preview must count SQLite tracks whose .m4a file is missing on disk'
  );

  const res = await restoreBackup(backup, { mode: 'merge', enqueueOfflineDownloads: true });
  assert.strictEqual(res.enqueuedOfflineCount, 1, 'Restore must re-enqueue tracks missing .m4a on disk');
  const queue = getDownloadQueue();
  assert.ok(queue.some((q) => q.track.id === 'ghost_disk_1'));
  assert.strictEqual(queue.some((q) => q.track.id === 'intact_disk_1'), false);
});

test('Storage queue: retryAllFailedDownloads re-enqueues all error items in batch and completes them', async () => {
  let shouldFail = true;
  setAudioStreamResolver(async (id) => {
    if (shouldFail) {
      throw new Error('HTTP 503 temporary outage');
    }
    return { streamUrl: `https://mock.stream/${id}.m4a`, headers: {} };
  });

  enqueuePlaylistDownload([
    { id: 'retry_batch_1', title: 'Retry 1', artist: 'A', duration: 150, formattedDuration: '2:30', thumbnailUrl: '' },
    { id: 'retry_batch_2', title: 'Retry 2', artist: 'B', duration: 160, formattedDuration: '2:40', thumbnailUrl: '' },
  ]);

  const waitUntil = async (predicate, timeoutMs = 1500) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error('Timed out waiting for download queue state');
  };

  await waitUntil(() => {
    const q = getDownloadQueue();
    return q.length === 2 && q.every((i) => i.status === 'error');
  });

  shouldFail = false;
  const retriedCount = retryAllFailedDownloads();
  assert.strictEqual(retriedCount, 2, 'retryAllFailedDownloads must return number of failed items re-enqueued');

  await waitUntil(() => {
    const q = getDownloadQueue();
    return q.length === 2 && q.every((i) => i.status === 'completed');
  });

  const downloaded = await getDownloadedTracks();
  assert.ok(downloaded.some((t) => t.id === 'retry_batch_1'));
  assert.ok(downloaded.some((t) => t.id === 'retry_batch_2'));
});

test('Storage queue: insufficient disk space pauses queue in pending without cascading errors or redundant stream retries', async () => {
  let resolveCalls = 0;
  FileSystem.setFreeDiskStorageBytes(5 * 1024 * 1024); // 5 MB (< 25 MB)
  setAudioStreamResolver(async (id) => {
    resolveCalls += 1;
    return { streamUrl: `https://mock.stream/${id}.m4a`, headers: {} };
  });

  try {
    enqueuePlaylistDownload([
      { id: 'disk_pause_1', title: 'Disk 1', artist: 'A', duration: 150, formattedDuration: '2:30', thumbnailUrl: '' },
      { id: 'disk_pause_2', title: 'Disk 2', artist: 'B', duration: 160, formattedDuration: '2:40', thumbnailUrl: '' },
    ]);

    await new Promise((r) => setTimeout(r, 120));

    const queue = getDownloadQueue();
    assert.strictEqual(queue.length, 2);
    assert.strictEqual(queue[0].status, 'pending', 'First track must return to pending on low disk space');
    assert.strictEqual(queue[1].status, 'pending', 'Second track must remain pending without error cascade');
    assert.strictEqual(resolveCalls, 1, 'Low disk space must not trigger redundant stream-refresh retry');
  } finally {
    FileSystem.setFreeDiskStorageBytes(1024 * 1024 * 1024);
  }
});

test('Android background downloads plugin: manifest patch injects ACCESS_NETWORK_STATE idempotently', () => {
  const { patchAndroidManifestString } = require('../plugins/withBackgroundDownloads');
  const sampleManifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application></application></manifest>';
  const patchedOnce = patchAndroidManifestString(sampleManifest);
  assert.ok(
    patchedOnce.includes('android.permission.ACCESS_NETWORK_STATE'),
    'Manifest patch must declare ACCESS_NETWORK_STATE for ConnectivityManager'
  );
  const patchedTwice = patchAndroidManifestString(patchedOnce);
  assert.strictEqual(patchedTwice, patchedOnce, 'Manifest patch must be idempotent');
});

test('Backup preview: verifies downloaded files in bounded chunks across >32 offline tracks', async () => {
  const refs = [];
  for (let i = 0; i < 40; i += 1) {
    const id = `chunk_trk_${i}`;
    const uri = `${FileSystem.documentDirectory}tracks/${id}.m4a`;
    // Even indices exist on disk; odd indices are missing on disk
    if (i % 2 === 0) {
      FileSystem.files.set(uri, { isDirectory: false, size: 1024 * 64 });
    }
    await saveDownloadedTrack({
      id,
      title: `Track ${i}`,
      artist: 'Artist',
      duration: 180,
      thumbnailUrl: '',
      localUri: uri,
      downloadedAt: Date.now(),
    });
    refs.push({ id, title: `Track ${i}`, artist: 'Artist', duration: 180, thumbnailUrl: '' });
  }

  const backup = validateAndNormalizeBackupJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.13',
      exportedAt: Date.now(),
      data: {
        playlists: [],
        playbackHistory: [],
        searchHistory: [],
        offlineTrackRefs: refs,
      },
    })
  );

  const preview = await getBackupPreview(backup);
  assert.strictEqual(preview.offlineTotalCount, 40);
  assert.strictEqual(preview.offlineMissingCount, 20, 'Chunked verification must detect all 20 missing .m4a files');
});
