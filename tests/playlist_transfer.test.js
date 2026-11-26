// tests/playlist_transfer.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const FileSystem = require('expo-file-system');
const SQLite = require('expo-sqlite');
const { Keyboard, StyleSheet } = require('react-native');
const App = require('../App').default;
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const { PlaylistImportModal } = require('../components/PlaylistImportModal');
const {
  FAVORITES_PLAYLIST_ID,
  addTrackToPlaylist,
  createPlaylist,
  getPlaylistById,
  getPlaylists,
  initDatabase,
  saveDownloadedTrack,
  toggleFavorite,
  updatePlaylist,
} = require('../services/database');
const {
  BACKUP_APP_ID,
  BackupValidationError,
  MAX_PLAYLIST_FILE_BYTES,
  PLAYLIST_EXPORT_SCHEMA_VERSION,
  PLAYLIST_EXPORT_TYPE,
  buildBackupPayload,
  buildPlaylistExportPayload,
  exportPlaylistToFile,
  formatPlaylistExportFileName,
  getPlaylistImportPreview,
  importPlaylistFromExport,
  pickPlaylistFile,
  savePlaylistToDevice,
  validateAndNormalizeBackupJson,
  validateAndNormalizePlaylistJson,
} = require('../services/backup');
const {
  PLAYLIST_COVERS_DIRECTORY,
  cancelAllDownloads,
  clearFinishedDownloads,
  getDownloadQueue,
  setAudioStreamResolver,
} = require('../services/storage');
const { actAsync, findButtonByText, getAllText, resetAllMocks } = require('./helpers/testUtils');

// Minimal valid JPEG base64 (starts with FF D8 FF -> /9j/)
const VALID_JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS';

test.beforeEach(async () => {
  resetAllMocks();
  global.__documentPickerMock = null;
  global.__sharingMock = null;
  global.__safMock = null;
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
  global.__safMock = null;
});

test('Playlist export: formats safe slug filenames and serializes user playlist with custom cover', async () => {
  assert.strictEqual(formatPlaylistExportFileName('Canada'), 'sonary-playlist-canada.json');
  assert.strictEqual(
    formatPlaylistExportFileName('Músicas Curtidas ❤️ #1'),
    'sonary-playlist-musicas-curtidas-1.json'
  );
  assert.strictEqual(formatPlaylistExportFileName('   !!!   '), 'sonary-playlist.json');

  const pl = await createPlaylist('Canada', 'Viagem de inverno');
  const coverUri = `${PLAYLIST_COVERS_DIRECTORY}${pl.id}_cover.jpg`;
  await FileSystem.writeAsStringAsync(coverUri, VALID_JPEG_B64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await updatePlaylist(pl.id, 'Canada', 'Viagem de inverno', coverUri);

  await addTrackToPlaylist(pl.id, {
    id: 'dQw4w9WgXcQ',
    title: 'Wet Socks',
    artist: 'Richy Mitch & The Coal Miners',
    duration: 195,
    thumbnailUrl: 'file:///local/thumb.jpg', // local URI should fallback to YouTube HTTPS thumb
  });
  await addTrackToPlaylist(pl.id, {
    id: 'trk_second',
    title: 'Northern Wind',
    artist: 'City and Colour',
    duration: 242,
    thumbnailUrl: 'https://img.example.com/northern.jpg',
  });

  const payload = await buildPlaylistExportPayload(pl.id);
  assert.strictEqual(payload.app, BACKUP_APP_ID);
  assert.strictEqual(payload.type, PLAYLIST_EXPORT_TYPE);
  assert.strictEqual(payload.schemaVersion, PLAYLIST_EXPORT_SCHEMA_VERSION);
  assert.strictEqual(payload.playlist.name, 'Canada');
  assert.strictEqual(payload.playlist.description, 'Viagem de inverno');
  assert.strictEqual(payload.playlist.customCoverBase64, VALID_JPEG_B64);
  assert.strictEqual(payload.playlist.tracks.length, 2);
  assert.strictEqual(
    payload.playlist.tracks[0].thumbnailUrl,
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
  );
  assert.strictEqual(payload.playlist.tracks[1].position, 1);
});

test('Playlist export: supports exporting system playlist Músicas Curtidas without custom cover', async () => {
  await toggleFavorite({
    id: 'fav_1',
    title: 'Everlong',
    artist: 'Foo Fighters',
    duration: 250,
    thumbnailUrl: 'https://img.example.com/everlong.jpg',
  });

  const payload = await buildPlaylistExportPayload(FAVORITES_PLAYLIST_ID);
  assert.strictEqual(payload.type, PLAYLIST_EXPORT_TYPE);
  assert.strictEqual(payload.playlist.name, 'Músicas Curtidas');
  assert.strictEqual(payload.playlist.customCoverBase64, null);
  assert.strictEqual(payload.playlist.tracks.length, 1);
  assert.strictEqual(payload.playlist.tracks[0].trackId, 'fav_1');
});

test('Playlist export: shares via Sharing API and saves via Android SAF', async () => {
  const pl = await createPlaylist('Canada');
  await addTrackToPlaylist(pl.id, {
    id: 'trk_can_1',
    title: 'Lake Louise',
    artist: 'Band',
    duration: 180,
    thumbnailUrl: 'https://img.example.com/lake.jpg',
  });

  let sharedUri = null;
  global.__sharingMock = {
    isAvailableAsync: async () => true,
    shareAsync: async (uri) => {
      sharedUri = uri;
    },
  };

  const shareRes = await exportPlaylistToFile(pl.id);
  assert.strictEqual(shareRes.shared, true);
  assert.strictEqual(shareRes.fileName, 'sonary-playlist-canada.json');
  assert.ok(sharedUri && sharedUri.endsWith('sonary-playlist-canada.json'));

  const writtenJson = await FileSystem.readAsStringAsync(sharedUri);
  const parsed = validateAndNormalizePlaylistJson(writtenJson);
  assert.strictEqual(parsed.playlist.name, 'Canada');

  global.__safMock = {
    requestDirectoryPermissionsAsync: async () => ({
      granted: true,
      directoryUri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload',
    }),
    createFileAsync: async (dirUri, fileName) => `${dirUri}/${fileName}`,
  };

  const safRes = await savePlaylistToDevice(pl.id);
  assert.strictEqual(safRes.shared, true);
  assert.strictEqual(safRes.fileName, 'sonary-playlist-canada.json');
  assert.ok(safRes.fileUri.startsWith('content://'));
  const safWritten = await FileSystem.readAsStringAsync(safRes.fileUri);
  assert.strictEqual(validateAndNormalizePlaylistJson(safWritten).playlist.name, 'Canada');
});

test('Playlist validation: enforces trust boundaries and cross-detects full backup vs single playlist', async () => {
  // Rejects oversized file (ASCII and multi-byte UTF-8)
  assert.throws(
    () => validateAndNormalizePlaylistJson('x'.repeat(MAX_PLAYLIST_FILE_BYTES + 1)),
    (err) => err instanceof BackupValidationError && err.message.includes('5 MB')
  );
  // 'é' is 1 UTF-16 code unit but 2 UTF-8 bytes
  assert.throws(
    () => validateAndNormalizePlaylistJson('é'.repeat(Math.floor(MAX_PLAYLIST_FILE_BYTES / 2) + 1)),
    (err) => err instanceof BackupValidationError && err.message.includes('5 MB')
  );

  // Rejects invalid JSON, unknown app & unknown schemaVersion
  assert.throws(
    () => validateAndNormalizePlaylistJson('{broken'),
    BackupValidationError
  );
  assert.throws(
    () => validateAndNormalizePlaylistJson(JSON.stringify({ app: 'other-app', type: 'playlist', schemaVersion: 1 })),
    BackupValidationError
  );
  assert.throws(
    () =>
      validateAndNormalizePlaylistJson(
        JSON.stringify({
          app: BACKUP_APP_ID,
          type: PLAYLIST_EXPORT_TYPE,
          schemaVersion: 99,
          playlist: { name: 'Future', tracks: [] },
        })
      ),
    (err) => err instanceof BackupValidationError && err.message.includes('v99')
  );

  // Cross-detection: full backup passed to playlist importer
  const fullBackup = await buildBackupPayload();
  assert.throws(
    () => validateAndNormalizePlaylistJson(JSON.stringify(fullBackup)),
    (err) =>
      err instanceof BackupValidationError &&
      err.message.includes('backup completo') &&
      err.message.includes('Backup e dados')
  );

  // Cross-detection: single playlist passed to full backup importer
  const pl = await createPlaylist('Canada');
  const singleExport = await buildPlaylistExportPayload(pl.id);
  assert.throws(
    () => validateAndNormalizeBackupJson(JSON.stringify(singleExport)),
    (err) =>
      err instanceof BackupValidationError &&
      err.message.includes('playlist individual') &&
      err.message.includes('Importar')
  );

  // Strips prototype pollution keys, invalid cover base64, invalid URLs and duplicate tracks
  const dirtyJson = `{
    "app": "sonary-pro",
    "type": "playlist",
    "schemaVersion": 1,
    "__proto__": { "polluted": true },
    "playlist": {
      "name": "  Mix Limpo  ",
      "customCoverBase64": "not-valid-base64",
      "tracks": [
        { "trackId": "t1", "title": "Song 1", "artist": "Art 1", "duration": 120, "thumbnailUrl": "javascript:alert(1)", "position": 1 },
        { "trackId": "t1", "title": "Dup", "artist": "Dup", "duration": 90, "position": 2 },
        { "trackId": "t2", "title": "Song 2", "artist": "Art 2", "duration": 200, "thumbnailUrl": "https://img.example.com/2.jpg", "position": 0 }
      ]
    }
  }`;
  const clean = validateAndNormalizePlaylistJson(dirtyJson);
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(clean.playlist.name, 'Mix Limpo');
  assert.strictEqual(clean.playlist.customCoverBase64, null);
  assert.strictEqual(clean.playlist.tracks.length, 2);
  assert.strictEqual(clean.playlist.tracks[0].thumbnailUrl, '');
});

test('Playlist import: creates brand new playlist with custom cover, nameOverride, order and optional offline downloads', async () => {
  const sourcePl = await createPlaylist('Canada', 'Estrada');
  const coverUri = `${PLAYLIST_COVERS_DIRECTORY}${sourcePl.id}_orig.jpg`;
  await FileSystem.writeAsStringAsync(coverUri, VALID_JPEG_B64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await updatePlaylist(sourcePl.id, 'Canada', 'Estrada', coverUri);

  await addTrackToPlaylist(sourcePl.id, {
    id: 'trk_a',
    title: 'Track A',
    artist: 'Artist A',
    duration: 180,
    thumbnailUrl: 'https://img.example.com/a.jpg',
  });
  await addTrackToPlaylist(sourcePl.id, {
    id: 'trk_b',
    title: 'Track B',
    artist: 'Artist B',
    duration: 210,
    thumbnailUrl: 'https://img.example.com/b.jpg',
  });

  // Mark trk_a as already downloaded locally
  const localA = `${FileSystem.documentDirectory}tracks/trk_a.m4a`;
  await FileSystem.writeAsStringAsync(localA, 'x'.repeat(20000));
  await saveDownloadedTrack({
    id: 'trk_a',
    title: 'Track A',
    artist: 'Artist A',
    duration: 180,
    thumbnailUrl: 'https://img.example.com/a.jpg',
    localUri: localA,
    downloadedAt: Date.now(),
  });

  const exported = await buildPlaylistExportPayload(sourcePl.id);
  const preview = await getPlaylistImportPreview(exported);
  assert.strictEqual(preview.trackCount, 2);
  assert.strictEqual(preview.totalDuration, 390);
  assert.strictEqual(preview.hasCustomCover, true);
  assert.ok(preview.customCoverDataUri.startsWith('data:image/jpeg;base64,'));
  assert.strictEqual(preview.offlineMissingCount, 1);

  const imported = await importPlaylistFromExport(exported, {
    nameOverride: 'Canada (Amigo)',
    enqueueOfflineDownloads: true,
  });

  assert.notStrictEqual(imported.playlist.id, sourcePl.id, 'Must always create a new local playlist ID');
  assert.strictEqual(imported.playlist.name, 'Canada (Amigo)');
  assert.strictEqual(imported.restoredCustomCover, true);
  assert.strictEqual(imported.enqueuedOfflineCount, 1, 'Should enqueue only missing track trk_b');

  const detail = await getPlaylistById(imported.playlist.id);
  assert.ok(detail);
  assert.strictEqual(detail.hasCustomCover, true);
  assert.strictEqual(detail.tracks.length, 2);
  assert.strictEqual(detail.tracks[0].trackId, 'trk_a');
  assert.strictEqual(detail.tracks[1].trackId, 'trk_b');

  const coverInfo = await FileSystem.getInfoAsync(detail.thumbnailUrl);
  assert.strictEqual(coverInfo.exists, true);

  const queueIds = getDownloadQueue().map((item) => item.track.id);
  assert.ok(queueIds.includes('trk_b'));
  assert.strictEqual(queueIds.includes('trk_a'), false);
});

test('Playlist import: preview orders coverThumbnails by position and rolls back cover file if SQLite fails', async () => {
  const unordered = validateAndNormalizePlaylistJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      type: PLAYLIST_EXPORT_TYPE,
      schemaVersion: PLAYLIST_EXPORT_SCHEMA_VERSION,
      playlist: {
        name: 'Out Of Order',
        tracks: [
          { trackId: 't_second', title: 'Second', artist: 'A', duration: 100, thumbnailUrl: 'https://img.example.com/2.jpg', position: 1 },
          { trackId: 't_first', title: 'First', artist: 'A', duration: 100, thumbnailUrl: 'https://img.example.com/1.jpg', position: 0 },
        ],
      },
    })
  );
  const preview = await getPlaylistImportPreview(unordered);
  assert.deepStrictEqual(preview.coverThumbnails, [
    'https://img.example.com/1.jpg',
    'https://img.example.com/2.jpg',
  ]);

  const withCover = validateAndNormalizePlaylistJson(
    JSON.stringify({
      app: BACKUP_APP_ID,
      type: PLAYLIST_EXPORT_TYPE,
      schemaVersion: PLAYLIST_EXPORT_SCHEMA_VERSION,
      playlist: {
        name: 'Rollback Test',
        customCoverBase64: VALID_JPEG_B64,
        tracks: [{ trackId: 't_rb', title: 'Song', artist: 'Art', duration: 120, position: 0 }],
      },
    })
  );

  const beforeFiles = await FileSystem.readDirectoryAsync(PLAYLIST_COVERS_DIRECTORY).catch(() => []);
  const origTx = SQLite.dbInstance.withTransactionAsync;
  SQLite.dbInstance.withTransactionAsync = async () => {
    throw new Error('SQLite disk full');
  };
  try {
    await assert.rejects(
      () => importPlaylistFromExport(withCover),
      /SQLite disk full/
    );
  } finally {
    SQLite.dbInstance.withTransactionAsync = origTx;
  }

  const afterFiles = await FileSystem.readDirectoryAsync(PLAYLIST_COVERS_DIRECTORY).catch(() => []);
  assert.deepStrictEqual(
    afterFiles,
    beforeFiles,
    'Custom cover file must be deleted on SQLite failure rollback'
  );
});

test('UI: PlaylistDetailModal shows Export option for both user playlists and Músicas Curtidas without destructive actions on system playlist', async () => {
  await toggleFavorite({
    id: 'fav_ui_1',
    title: 'Black',
    artist: 'Pearl Jam',
    duration: 343,
    thumbnailUrl: 'https://img.example.com/pj.jpg',
  });

  let sharedCalled = false;
  global.__sharingMock = {
    isAvailableAsync: async () => true,
    shareAsync: async () => {
      sharedCalled = true;
    },
  };

  let modalTree;
  await actAsync(async () => {
    modalTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: FAVORITES_PLAYLIST_ID,
        onClose: () => {},
        onPlayTrack: () => {},
        onPlayAll: () => {},
      })
    );
  });

  const root = modalTree.root;
  const moreBtn = root.findByProps({ accessibilityLabel: 'Mais opções da playlist' });
  assert.ok(moreBtn, 'Options button (...) must be visible on Músicas Curtidas');

  await actAsync(async () => {
    moreBtn.props.onPress();
  });

  const sheetText = getAllText(root);
  assert.ok(sheetText.includes('Exportar playlist (.json)'), 'Export option must be rendered');
  assert.ok(sheetText.includes('Baixar playlist'), 'Download option must be rendered');
  assert.strictEqual(sheetText.includes('Excluir playlist'), false, 'System playlist must never show delete option');
  assert.strictEqual(sheetText.includes('Nome e detalhes'), false, 'System playlist must never show edit option');

  // Open export submenu
  const exportBtn = root.findByProps({ accessibilityLabel: 'Exportar playlist em JSON' });
  await actAsync(async () => {
    exportBtn.props.onPress();
  });

  assert.ok(root.findByProps({ testID: 'playlist-export-submenu' }), 'Export submenu should appear');
  const shareOption = root.findByProps({ accessibilityLabel: 'Compartilhar arquivo da playlist' });
  const saveOption = root.findByProps({ accessibilityLabel: 'Salvar playlist no dispositivo' });
  assert.ok(shareOption && saveOption, 'Both Share and Save to Device options must be shown');

  await actAsync(async () => {
    await shareOption.props.onPress();
  });
  assert.strictEqual(sharedCalled, true);

  // Also verify user playlist shows Export alongside edit/delete actions
  const userPl = await createPlaylist('Roadtrip');
  let userTree;
  await actAsync(async () => {
    userTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: userPl.id,
        onClose: () => {},
        onPlayTrack: () => {},
        onPlayAll: () => {},
      })
    );
  });
  await actAsync(async () => {
    userTree.root.findByProps({ accessibilityLabel: 'Mais opções da playlist' }).props.onPress();
  });
  const userSheetText = getAllText(userTree.root);
  assert.ok(userSheetText.includes('Exportar playlist (.json)'), 'User playlist must show Export option');
  assert.ok(userSheetText.includes('Nome e detalhes'), 'User playlist must keep edit option');
  assert.ok(userSheetText.includes('Excluir playlist'), 'User playlist must keep delete option');
});

test('UI: LibrarySection Import button opens PlaylistImportModal, supports rename + keyboard shift, and creates new playlist', async () => {
  const existingPl = await createPlaylist('Canada');
  await addTrackToPlaylist(existingPl.id, {
    id: 'trk_imp_1',
    title: 'Ophelia',
    artist: 'The Lumineers',
    duration: 160,
    thumbnailUrl: 'https://img.example.com/ophelia.jpg',
  });
  const exported = await buildPlaylistExportPayload(existingPl.id);
  const pickedUri = `${FileSystem.cacheDirectory}sonary-playlist-canada.json`;
  await FileSystem.writeAsStringAsync(pickedUri, JSON.stringify(exported));

  global.__documentPickerMock = {
    getDocumentAsync: async () => ({
      canceled: false,
      assets: [{ uri: pickedUri, name: 'sonary-playlist-canada.json', size: 512 }],
    }),
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });
  const root = tree.root;

  // Navigate to Playlists tab
  const playlistsTabBtn = findButtonByText(root, 'Playlists');
  await actAsync(async () => {
    playlistsTabBtn.props.onPress();
  });

  const importBtn = root.findByProps({ testID: 'library-import-playlist-button' });
  assert.ok(importBtn, 'Importar button must be visible in Sua Biblioteca header');

  await actAsync(async () => {
    await importBtn.props.onPress();
  });

  const modalSheet = root.findByProps({ testID: 'playlist-import-modal-sheet' });
  assert.ok(modalSheet, 'PlaylistImportModal must open after picking valid JSON');
  assert.ok(
    getAllText(root).includes('Já existe uma playlist com este nome'),
    'Collision hint must appear when matching existing playlist name'
  );

  // Android keyboard shift check
  await actAsync(async () => {
    Keyboard.__emit('keyboardDidShow', { endCoordinates: { height: 280 } });
  });
  const importModalNode = root.findByType(PlaylistImportModal);
  const kav = importModalNode.findByType('KeyboardAvoidingView');
  assert.strictEqual(StyleSheet.flatten(kav.props.style).paddingBottom, 280);
  await actAsync(async () => {
    Keyboard.__emit('keyboardDidHide', {});
  });

  // Rename, enable offline download toggle, and confirm import
  const nameInput = root.findByProps({ accessibilityLabel: 'Nome da playlist importada' });
  await actAsync(async () => {
    nameInput.props.onChangeText('Canada do João');
  });

  const offlineToggle = root.findByProps({ testID: 'playlist-import-offline-toggle' });
  assert.strictEqual(offlineToggle.props.accessibilityState.checked, false, 'Offline toggle must default to unchecked');
  await actAsync(async () => {
    offlineToggle.props.onPress();
  });

  const confirmBtn = root.findByProps({ testID: 'playlist-import-confirm-button' });
  await actAsync(async () => {
    await confirmBtn.props.onPress();
  });

  const allPlaylists = await getPlaylists();
  const importedPl = allPlaylists.find((p) => p.name === 'Canada do João');
  assert.ok(importedPl, 'Renamed imported playlist must be persisted in SQLite');
  assert.strictEqual(importedPl.trackCount, 1);
  assert.ok(
    getDownloadQueue().some((item) => item.track.id === 'trk_imp_1'),
    'Enabling offline toggle in PlaylistImportModal must enqueue missing tracks'
  );

  // Picking a full backup file via Importar should show guidance error and NOT open PlaylistImportModal
  const fullBackup = await buildBackupPayload();
  const backupUri = `${FileSystem.cacheDirectory}sonary-backup.json`;
  await FileSystem.writeAsStringAsync(backupUri, JSON.stringify(fullBackup));
  global.__documentPickerMock = {
    getDocumentAsync: async () => ({
      canceled: false,
      assets: [{ uri: backupUri, name: 'sonary-backup.json', size: 1024 }],
    }),
  };

  await actAsync(async () => {
    await root.findByProps({ testID: 'library-import-playlist-button' }).props.onPress();
  });
  assert.strictEqual(
    root.findAllByProps({ testID: 'playlist-import-modal-sheet' }).length,
    0,
    'Import modal must not open for full backup files'
  );
  assert.ok(
    getAllText(root).includes('backup completo'),
    'Error toast must guide user to Backup e dados'
  );
});
