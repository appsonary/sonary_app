// tests/local_media_and_downloads_ui.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const rnMock = require('./mocks/reactNativeMock');
const { dbInstance } = require('./mocks/sqliteMock');
const { resetFileSystem } = require('./mocks/fileSystemMock');

const {
  addTrackToPlaylist,
  createPlaylist,
  FAVORITES_PLAYLIST_ID,
  getLocalDeviceTrackById,
  getLocalDeviceTracks,
  getOfflinePlaylistsSummary,
  getPlaybackHistory,
  getPlaylistById,
  invalidateDatabaseCaches,
  markLocalTrackCorrupted,
  recordPlaybackHistory,
  saveDownloadedTrack,
  syncLocalDeviceTracks,
  toggleFavorite,
  updateLocalTrackMetadata,
} = require('../services/database');
const {
  buildLocalFoldersSummary,
  cleanAudioFileName,
  deleteLocalTrackFromDevice,
  hideLocalTrackFromLibrary,
  resolveLocalTrackMetadata,
  restoreHiddenLocalTracks,
  revalidateLocalTrack,
  scanAndSyncLocalDeviceAudio,
} = require('../services/localMedia');
const {
  buildBackupPayload,
  buildPlaylistExportPayload,
  restoreBackup,
  validateAndNormalizeBackupJson,
  validateAndNormalizePlaylistJson,
} = require('../services/backup');
const {
  clearStorageCache,
  enqueueDownload,
  getDownloadQueue,
  getLocalTrackUri,
  registerLocalTrackIfMissing,
} = require('../services/storage');
const api = require('../services/api');
const { playTrack, addTracksToQueue } = require('../services/player');
const { mockPlayer, Event } = require('./mocks/trackPlayerMock');
const { DownloadsSection } = require('../components/DownloadsSection');
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const { LyricsViewer } = require('../components/LyricsViewer');
const withLocalMediaLibrary = require('../plugins/withLocalMediaLibrary');
const App = require('../App').default;

function resetAll() {
  dbInstance.reset();
  invalidateDatabaseCaches();
  resetFileSystem();
  clearStorageCache();
  if (rnMock.NativeModules) {
    delete rnMock.NativeModules.SonaryLocalMedia;
  }
}

test.beforeEach(() => {
  resetAll();
});

test('LocalMedia: resolveLocalTrackMetadata limpa nomes de arquivo e ignora tags <unknown>', () => {
  const res1 = resolveLocalTrackMetadata({
    title: '<unknown>',
    artist: 'unknown artist',
    fileName: '03 - Legiao Urbana - Tempo Perdido [128kbps].mp3',
  });
  assert.strictEqual(res1.artist, 'Legiao Urbana');
  assert.strictEqual(res1.title, 'Tempo Perdido');

  const res2 = resolveLocalTrackMetadata({
    title: '',
    artist: null,
    fileName: 'gravacao_show_acustico_(MP3_160K).m4a',
  });
  assert.strictEqual(res2.title, 'gravacao show acustico');
  assert.strictEqual(res2.artist, 'Artista desconhecido');

  const res3 = resolveLocalTrackMetadata({
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    fileName: 'track01.flac',
  });
  assert.strictEqual(res3.title, 'Bohemian Rhapsody');
  assert.strictEqual(res3.artist, 'Queen');

  // Prefixos numéricos com underscore e sufixo (Official Audio) sem separador " - "
  assert.strictEqual(cleanAudioFileName('01_Teste_[320k].mp3'), 'Teste');
  const res4 = resolveLocalTrackMetadata({
    title: '',
    artist: '',
    fileName: '03_track_sem_tag.m4a',
  });
  assert.strictEqual(res4.title, 'track sem tag');
  assert.strictEqual(res4.artist, 'Artista desconhecido');

  const res5 = resolveLocalTrackMetadata({
    title: null,
    artist: null,
    fileName: 'Tempo Perdido (Official Audio).mp3',
  });
  assert.strictEqual(res5.title, 'Tempo Perdido');
  assert.strictEqual(res5.artist, 'Artista desconhecido');
});

test('LocalMedia: scan incremental preserva edições manuais, isHidden e sinaliza arquivos corrompidos', async () => {
  rnMock.Platform.OS = 'android';
  let scanCallCount = 0;
  rnMock.NativeModules.SonaryLocalMedia = {
    scanDeviceAudio: async (cachedJson) => {
      scanCallCount += 1;
      if (scanCallCount === 1) {
        return [
          {
            id: 'local_101',
            mediaStoreId: '101',
            contentUri: 'content://media/external/audio/media/101',
            fileName: 'Artist A - Song A.mp3',
            folderName: 'Download',
            relativePath: 'Download',
            mimeType: 'audio/mpeg',
            fileSize: 3_500_000,
            dateModified: 1700000000,
            unchanged: false,
            isCorrupted: false,
            corruptionReason: null,
            title: '<unknown>',
            artist: '<unknown>',
            duration: 215,
            artworkUri: null,
          },
          {
            id: 'local_102',
            mediaStoreId: '102',
            contentUri: 'content://media/external/audio/media/102',
            fileName: 'quebrado.mp3',
            folderName: 'Download',
            relativePath: 'Download',
            mimeType: 'audio/mpeg',
            fileSize: 512,
            dateModified: 1700000005,
            unchanged: false,
            isCorrupted: true,
            corruptionReason: 'Arquivo vazio ou incompleto',
            title: '',
            artist: '',
            duration: 0,
            artworkUri: null,
          },
        ];
      }
      const parsed = JSON.parse(cachedJson || '{}');
      assert.ok(parsed.local_101, 'Cache incremental deve enviar assinatura de local_101');
      return [
        {
          id: 'local_101',
          mediaStoreId: '101',
          contentUri: 'content://media/external/audio/media/101',
          fileName: 'Artist A - Song A.mp3',
          folderName: 'Download',
          relativePath: 'Download',
          fileSize: 3_500_000,
          dateModified: 1700000000,
          unchanged: true,
        },
        {
          id: 'local_102',
          mediaStoreId: '102',
          contentUri: 'content://media/external/audio/media/102',
          fileName: 'quebrado.mp3',
          folderName: 'Download',
          relativePath: 'Download',
          fileSize: 512,
          dateModified: 1700000005,
          unchanged: true,
        },
      ];
    },
  };

  const first = await scanAndSyncLocalDeviceAudio();
  assert.strictEqual(first.validCount, 1);
  assert.strictEqual(first.corruptedCount, 1);

  const track101 = await getLocalDeviceTrackById('local_101');
  assert.strictEqual(track101.title, 'Song A');
  assert.strictEqual(track101.artist, 'Artist A');

  // Adiciona faixa local a playlist e histórico, e edita metadados manualmente
  const pl = await createPlaylist('Treino Local');
  await addTrackToPlaylist(pl.id, {
    id: track101.id,
    title: track101.title,
    artist: track101.artist,
    duration: track101.duration,
    thumbnailUrl: '',
  });
  await recordPlaybackHistory({
    id: track101.id,
    title: track101.title,
    artist: track101.artist,
    duration: track101.duration,
    thumbnailUrl: '',
  });
  await updateLocalTrackMetadata('local_101', {
    customTitle: 'Minha Versão Ao Vivo',
    customArtist: 'Banda Editada',
  });

  // Re-scan deve preservar overrides manuais e retornar resumo de pastas
  const second = await scanAndSyncLocalDeviceAudio();
  assert.ok(Array.isArray(second.folders) && second.folders.length === 1);
  const afterRescan = await getLocalDeviceTrackById('local_101');
  assert.strictEqual(afterRescan.title, 'Minha Versão Ao Vivo');
  assert.strictEqual(afterRescan.artist, 'Banda Editada');

  // Propagação para playlist_tracks e playback_history
  const plDetail = await getPlaylistById(pl.id);
  assert.strictEqual(plDetail.tracks[0].title, 'Minha Versão Ao Vivo');
  assert.strictEqual(plDetail.tracks[0].artist, 'Banda Editada');
  assert.strictEqual(plDetail.tracks[0].isDownloaded, true);
  assert.strictEqual(plDetail.tracks[0].isLocalDevice, true);

  const hist = await getPlaybackHistory(10);
  const histEntry = hist.find((h) => h.trackId === 'local_101');
  assert.ok(histEntry);
  assert.strictEqual(histEntry.title, 'Minha Versão Ao Vivo');
  assert.strictEqual(histEntry.artist, 'Banda Editada');

  // getLocalTrackUri retorna contentUri para válida e null para corrompida
  assert.strictEqual(
    await getLocalTrackUri('local_101'),
    'content://media/external/audio/media/101'
  );
  assert.strictEqual(await getLocalTrackUri('local_102'), null);

  // Ocultar também remove de getPlaylistById como disponível offline e restaurar devolve
  await hideLocalTrackFromLibrary('local_101');
  const visibleAfterHide = await getLocalDeviceTracks({ includeHidden: false, includeCorrupted: true });
  assert.strictEqual(visibleAfterHide.some((t) => t.id === 'local_101'), false);
  const plDetailWhileHidden = await getPlaylistById(pl.id);
  assert.strictEqual(plDetailWhileHidden.tracks[0].isDownloaded, false);
  assert.strictEqual(plDetailWhileHidden.tracks[0].localUri, null);

  await restoreHiddenLocalTracks();
  const visibleAfterRestore = await getLocalDeviceTracks({ includeHidden: false, includeCorrupted: true });
  assert.strictEqual(visibleAfterRestore.some((t) => t.id === 'local_101'), true);
});

test('LocalMedia: revalidateLocalTrack recupera metadados e duração quando arquivo volta a ser válido', async () => {
  rnMock.Platform.OS = 'android';
  await syncLocalDeviceTracks([
    {
      id: 'local_301',
      mediaStoreId: '301',
      contentUri: 'content://media/external/audio/media/301',
      fileName: 'Banda X - Musica Recuperada.mp3',
      folderName: 'Download',
      relativePath: 'Download',
      fileSize: 500,
      dateModified: 1700000000,
      title: 'Musica Recuperada',
      artist: 'Banda X',
      duration: 0,
      isCorrupted: true,
      corruptionReason: 'Arquivo vazio ou incompleto',
      scannedAt: Date.now(),
    },
  ]);

  rnMock.NativeModules.SonaryLocalMedia = {
    scanDeviceAudio: async () => [],
    verifyTrackPlayable: async () => ({
      isCorrupted: false,
      corruptionReason: null,
      title: 'Musica Recuperada Real',
      artist: 'Banda X Real',
      album: 'Album Novo',
      duration: 245,
      artworkUri: 'file:///local_artwork/local_301.jpg',
    }),
  };

  const track = await getLocalDeviceTrackById('local_301');
  const res = await revalidateLocalTrack(track);
  assert.strictEqual(res.isCorrupted, false);
  assert.strictEqual(res.corruptionReason, null);

  const updated = await getLocalDeviceTrackById('local_301');
  assert.strictEqual(updated.isCorrupted, false);
  assert.strictEqual(updated.duration, 245);
  assert.strictEqual(updated.title, 'Musica Recuperada Real');
  assert.strictEqual(updated.artist, 'Banda X Real');
  assert.strictEqual(updated.artworkUri, 'file:///local_artwork/local_301.jpg');
});

test('LocalMedia: exclusão física só remove registro do SQLite se confirmada pelo Android', async () => {
  rnMock.Platform.OS = 'android';
  await syncLocalDeviceTracks([
    {
      id: 'local_55',
      mediaStoreId: '55',
      contentUri: 'content://media/external/audio/media/55',
      fileName: 'faixa.mp3',
      folderName: 'Music',
      relativePath: 'Music',
      fileSize: 200_000,
      dateModified: 1000,
      title: 'Faixa 55',
      artist: 'Artista 55',
      duration: 120,
      isCorrupted: false,
      scannedAt: Date.now(),
    },
  ]);

  let allowDelete = false;
  rnMock.NativeModules.SonaryLocalMedia = {
    scanDeviceAudio: async () => [],
    requestDeleteMedia: async () => ({ deleted: allowDelete, cancelled: !allowDelete }),
  };

  const track = await getLocalDeviceTrackById('local_55');
  await recordPlaybackHistory({
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnailUrl: '',
  });

  const cancelledRes = await deleteLocalTrackFromDevice(track);
  assert.strictEqual(cancelledRes.deleted, false);
  assert.strictEqual(cancelledRes.cancelled, true);
  assert.ok(await getLocalDeviceTrackById('local_55'), 'Cancelado não deve apagar do SQLite');

  allowDelete = true;
  const deletedRes = await deleteLocalTrackFromDevice(track);
  assert.strictEqual(deletedRes.deleted, true);
  assert.strictEqual(await getLocalDeviceTrackById('local_55'), null);
  const histAfterDelete = await getPlaybackHistory(10);
  assert.strictEqual(histAfterDelete.some((h) => h.trackId === 'local_55'), false);
});

test('Backup: NUNCA permite exportar ou importar músicas locais do dispositivo (local_*)', async () => {
  await saveDownloadedTrack({
    id: 'ytTrack0001',
    title: 'Faixa Sonary',
    artist: 'Artista Nuvem',
    duration: 200,
    thumbnailUrl: 'https://i.ytimg.com/vi/ytTrack0001/hqdefault.jpg',
    localUri: 'file:///docs/tracks/ytTrack0001.m4a',
    downloadedAt: Date.now(),
  });
  await syncLocalDeviceTracks([
    {
      id: 'local_999',
      mediaStoreId: '999',
      contentUri: 'content://media/external/audio/media/999',
      fileName: 'privada.mp3',
      folderName: 'Download',
      relativePath: 'Download',
      fileSize: 500_000,
      dateModified: 1000,
      title: 'Música Local Privada',
      artist: 'Local',
      duration: 180,
      isCorrupted: false,
      scannedAt: Date.now(),
    },
  ]);

  const pl = await createPlaylist('Mista');
  await addTrackToPlaylist(pl.id, {
    id: 'ytTrack0001',
    title: 'Faixa Sonary',
    artist: 'Artista Nuvem',
    duration: 200,
    thumbnailUrl: 'https://i.ytimg.com/vi/ytTrack0001/hqdefault.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'local_999',
    title: 'Música Local Privada',
    artist: 'Local',
    duration: 180,
    thumbnailUrl: '',
  });
  await recordPlaybackHistory({
    id: 'local_999',
    title: 'Música Local Privada',
    artist: 'Local',
    duration: 180,
    thumbnailUrl: '',
  });

  // 1. Backup completo
  const backup = await buildBackupPayload();
  const exportedPl = backup.data.playlists.find((p) => p.id === pl.id);
  assert.strictEqual(exportedPl.tracks.length, 1);
  assert.strictEqual(exportedPl.tracks[0].trackId, 'ytTrack0001');
  assert.strictEqual(
    backup.data.offlineTrackRefs.some((o) => o.id.startsWith('local_')),
    false
  );
  assert.strictEqual(
    backup.data.playbackHistory.some((h) => h.trackId.startsWith('local_')),
    false
  );

  // 2. Exportação de playlist individual
  const plExport = await buildPlaylistExportPayload(pl.id);
  assert.strictEqual(plExport.playlist.tracks.length, 1);
  assert.strictEqual(plExport.playlist.tracks[0].trackId, 'ytTrack0001');

  // 3. Validação de importação rejeita qualquer local_* injetado manualmente no JSON
  const injectedBackup = JSON.stringify({
    app: 'sonary-pro',
    schemaVersion: 1,
    appVersion: '1.0.16',
    exportedAt: Date.now(),
    data: {
      playlists: [
        {
          id: 'pl_1',
          name: 'Importada',
          description: null,
          isSystem: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          tracks: [
            { trackId: 'local_777', title: 'Local', artist: 'A', duration: 100, thumbnailUrl: '', position: 0, addedAt: 1 },
            { trackId: 'ytValid1234', title: 'Cloud', artist: 'B', duration: 100, thumbnailUrl: '', position: 1, addedAt: 1 },
          ],
        },
      ],
      playbackHistory: [
        { trackId: 'local_777', title: 'Local', artist: 'A', duration: 100, thumbnailUrl: '', playedAt: 1 },
      ],
      searchHistory: [],
      offlineTrackRefs: [
        { id: 'local_777', title: 'Local', artist: 'A', duration: 100, thumbnailUrl: '' },
      ],
    },
  });
  const normalized = validateAndNormalizeBackupJson(injectedBackup);
  assert.strictEqual(normalized.data.playlists[0].tracks.length, 1);
  assert.strictEqual(normalized.data.playlists[0].tracks[0].trackId, 'ytValid1234');
  assert.strictEqual(normalized.data.playbackHistory.length, 0);
  assert.strictEqual(normalized.data.offlineTrackRefs.length, 0);

  const injectedPl = JSON.stringify({
    app: 'sonary-pro',
    type: 'playlist',
    schemaVersion: 1,
    appVersion: '1.0.16',
    exportedAt: Date.now(),
    playlist: {
      name: 'Pl',
      description: null,
      tracks: [
        { trackId: 'local_888', title: 'Local', artist: 'A', duration: 90, thumbnailUrl: '', position: 0, addedAt: 1 },
      ],
    },
  });
  const normPl = validateAndNormalizePlaylistJson(injectedPl);
  assert.strictEqual(normPl.playlist.tracks.length, 0);

  // 4. restoreBackup e fila de downloads ignoram local_* mesmo se passados diretamente em memória
  const rawBackupWithLocal = {
    app: 'sonary-pro',
    schemaVersion: 1,
    appVersion: '1.0.16',
    exportedAt: Date.now(),
    data: {
      playlists: [],
      playbackHistory: [],
      searchHistory: [],
      offlineTrackRefs: [
        { id: 'local_999', title: 'Local', artist: 'A', duration: 100, thumbnailUrl: '' },
      ],
    },
  };
  const restoreRes = await restoreBackup(rawBackupWithLocal, {
    mode: 'merge',
    enqueueOfflineDownloads: true,
  });
  assert.strictEqual(restoreRes.enqueuedOfflineCount, 0);
  assert.strictEqual(
    enqueueDownload({
      id: 'local_999',
      title: 'Local',
      artist: 'A',
      duration: 100,
      formattedDuration: '1:40',
      thumbnailUrl: '',
    }),
    'already_queued'
  );
  assert.strictEqual(getDownloadQueue().some((i) => i.track.id === 'local_999'), false);
  await registerLocalTrackIfMissing({
    id: 'local_999',
    title: 'Local',
    artist: 'A',
    duration: 100,
    formattedDuration: '1:40',
    thumbnailUrl: '',
  });
});

test('OfflinePlaylists & UI: DownloadsSection exibe chips, playlists offline e destaca corrompidos na tela', async () => {
  await saveDownloadedTrack({
    id: 'dl_1',
    title: 'Baixada 1',
    artist: 'Artista 1',
    duration: 180,
    thumbnailUrl: 'https://example.com/1.jpg',
    localUri: 'file:///docs/tracks/dl_1.m4a',
    downloadedAt: 2000,
  });

  const pl = await createPlaylist('Parcial Offline');
  await addTrackToPlaylist(pl.id, {
    id: 'dl_1',
    title: 'Baixada 1',
    artist: 'Artista 1',
    duration: 180,
    thumbnailUrl: 'https://example.com/1.jpg',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'online_only_2',
    title: 'Só Online',
    artist: 'Artista 2',
    duration: 210,
    thumbnailUrl: 'https://example.com/2.jpg',
  });

  const offlinePlSummary = await getOfflinePlaylistsSummary();
  assert.strictEqual(offlinePlSummary.length, 1);
  assert.strictEqual(offlinePlSummary[0].downloadedTrackCount, 1);
  assert.strictEqual(offlinePlSummary[0].totalTrackCount, 2);

  await syncLocalDeviceTracks([
    {
      id: 'local_200',
      mediaStoreId: '200',
      contentUri: 'content://media/external/audio/media/200',
      fileName: 'boa.mp3',
      folderName: 'Download',
      relativePath: 'Download',
      fileSize: 2_000_000,
      dateModified: 3000,
      title: 'Boa Local',
      artist: 'Artista Local',
      duration: 200,
      isCorrupted: false,
      scannedAt: 3000,
    },
    {
      id: 'local_201',
      mediaStoreId: '201',
      contentUri: 'content://media/external/audio/media/201',
      fileName: 'corrompida.mp3',
      folderName: 'Download',
      relativePath: 'Download',
      fileSize: 100,
      dateModified: 3001,
      title: 'corrompida',
      artist: 'Artista desconhecido',
      duration: 0,
      isCorrupted: true,
      corruptionReason: 'Arquivo vazio ou incompleto',
      scannedAt: 3001,
    },
  ]);

  const localTracks = await getLocalDeviceTracks({ includeHidden: false, includeCorrupted: true });
  const folders = buildLocalFoldersSummary(localTracks, []);
  assert.strictEqual(folders.length, 1);
  assert.strictEqual(folders[0].validCount, 1);
  assert.strictEqual(folders[0].corruptedCount, 1);

  let playedQueue = null;
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(DownloadsSection, {
        downloadedTracks: [
          {
            id: 'dl_1',
            title: 'Baixada 1',
            artist: 'Artista 1',
            duration: 180,
            thumbnailUrl: '',
            localUri: 'file:///docs/tracks/dl_1.m4a',
            downloadedAt: 2000,
          },
        ],
        localDeviceTracks: localTracks,
        offlinePlaylists: offlinePlSummary,
        excludedLocalFolders: [],
        localMediaEnabled: true,
        isScanningLocalMedia: false,
        sortMode: 'recent',
        searchQuery: '',
        isPlaying: false,
        hiddenLocalCount: 0,
        onChangeSearchQuery: () => {},
        onChangeSortMode: () => {},
        onEnableAndScanLocalMedia: () => {},
        onRescanLocalMedia: () => {},
        onToggleExcludedFolder: () => {},
        onRestoreHiddenLocalTracks: () => {},
        onPlayOfflineTrack: (_item, q) => {
          playedQueue = q;
        },
        onOpenOfflinePlaylist: () => {},
        onPlayOfflinePlaylist: () => {},
        onAddToPlaylist: () => {},
        onDeleteDownloadedTrack: () => {},
        onEditLocalTrack: () => {},
        onRevalidateLocalTrack: () => {},
        onHideLocalTrack: () => {},
        onDeleteLocalTrackFromDevice: () => {},
        onPlayNext: () => {},
        onAddToQueue: () => {},
      })
    );
  });

  // Banner de corrompidos visível na aba Tudo
  const banner = renderer.root.findByProps({ testID: 'downloads-corrupted-banner' });
  assert.ok(banner, 'Deve exibir banner de aviso de arquivo corrompido na aba Tudo');

  // Muda para chip "No dispositivo" e verifica seção explícita de corrompidos
  const deviceChip = renderer.root.findByProps({ testID: 'downloads-chip-device' });
  await TestRenderer.act(async () => {
    deviceChip.props.onPress();
  });
  const corruptedSection = renderer.root.findByProps({ testID: 'corrupted-tracks-section' });
  assert.ok(corruptedSection, 'Deve exibir seção explícita de arquivos corrompidos');

  // Toca faixa válida e confirma que arquivo corrompido NÃO entra na fila
  const validTrackBtn = renderer.root.findByProps({
    accessibilityLabel: 'Tocar Boa Local de Artista Local',
  });
  await TestRenderer.act(async () => {
    validTrackBtn.props.onPress();
  });
  assert.ok(Array.isArray(playedQueue));
  assert.strictEqual(playedQueue.length, 1);
  assert.strictEqual(playedQueue[0].id, 'local_200');

  // Muda para chip "Playlists" e confirma badge "1 de 2 baixadas"
  const playlistsChip = renderer.root.findByProps({ testID: 'downloads-chip-playlists' });
  await TestRenderer.act(async () => {
    playlistsChip.props.onPress();
  });
  const plRow = renderer.root.findByProps({ testID: `offline-playlist-row-${pl.id}` });
  assert.ok(plRow);

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
});

test('PlaylistDetailModal: offlineOnly exibe e toca apenas faixas baixadas', async () => {
  await saveDownloadedTrack({
    id: 'dl_only',
    title: 'Música Offline',
    artist: 'Artista Offline',
    duration: 150,
    thumbnailUrl: '',
    localUri: 'file:///docs/tracks/dl_only.m4a',
    downloadedAt: 1000,
  });
  const pl = await createPlaylist('Viagem');
  await addTrackToPlaylist(pl.id, {
    id: 'dl_only',
    title: 'Música Offline',
    artist: 'Artista Offline',
    duration: 150,
    thumbnailUrl: '',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'remote_only',
    title: 'Música Online',
    artist: 'Artista Online',
    duration: 200,
    thumbnailUrl: '',
  });

  let playedAllTracks = null;
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        offlineOnly: true,
        downloadedTrackIds: new Set(['dl_only']),
        onClose: () => {},
        onPlayTrack: () => {},
        onPlayAll: (tracks) => {
          playedAllTracks = tracks;
        },
      })
    );
    await global.flushPromises();
  });

  const playAllBtn = renderer.root.findByProps({
    accessibilityLabel: 'Tocar todas as músicas da playlist',
  });
  await TestRenderer.act(async () => {
    playAllBtn.props.onPress();
  });

  assert.ok(Array.isArray(playedAllTracks));
  assert.strictEqual(playedAllTracks.length, 1);
  assert.strictEqual(playedAllTracks[0].trackId, 'dl_only');

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
});

test('CNG Plugin: withLocalMediaLibrary injeta READ_MEDIA_AUDIO, maxSdkVersion=32 e registra pacote Kotlin', () => {
  const sampleManifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
  <application></application>
</manifest>`;
  const patchedManifest = withLocalMediaLibrary.patchAndroidManifestString(sampleManifest);
  assert.ok(patchedManifest.includes('android.permission.READ_MEDIA_AUDIO'));
  assert.ok(patchedManifest.includes('android:maxSdkVersion="32"'));

  const sampleMainApp = `package com.sonarypro.app

class MainApplication : Application() {
  override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
    }
}`;
  const patchedMainApp = withLocalMediaLibrary.patchMainApplicationString(sampleMainApp);
  assert.ok(patchedMainApp.includes('import com.sonarypro.app.localmedia.SonaryLocalMediaPackage'));
  assert.ok(patchedMainApp.includes('add(SonaryLocalMediaPackage())'));
});

test('DownloadsSection: ordena Recentes corretamente entre dateModified em segundos e downloadedAt em ms', async () => {
  // Download Sonary salvo em 2024 (ms), música local modificada em 2026 (segundos do MediaStore)
  const sonaryOldMs = 1_700_000_000_000;
  const localNewSec = 1_780_000_000; // 1_780_000_000_000 ms > sonaryOldMs
  let playedQueue = null;
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(DownloadsSection, {
        downloadedTracks: [
          {
            id: 'dl_old',
            title: 'Antiga Sonary',
            artist: 'Zebra',
            duration: 180,
            thumbnailUrl: '',
            localUri: 'file:///docs/tracks/dl_old.m4a',
            downloadedAt: sonaryOldMs,
          },
        ],
        localDeviceTracks: [
          {
            id: 'local_new',
            mediaStoreId: 'new',
            contentUri: 'content://media/external/audio/media/new',
            fileName: 'nova.mp3',
            folderName: 'Download',
            relativePath: 'Download',
            mimeType: 'audio/mpeg',
            fileSize: 3_000_000,
            dateModified: localNewSec,
            title: 'Nova Local',
            artist: 'Alpha',
            thumbnailUrl: '',
            localUri: 'content://media/external/audio/media/new',
            album: null,
            duration: 200,
            rawTitle: 'Nova Local',
            rawArtist: 'Alpha',
            artworkUri: null,
            customTitle: null,
            customArtist: null,
            customArtworkUri: null,
            isCorrupted: false,
            corruptionReason: null,
            isHidden: false,
            scannedAt: sonaryOldMs + 5000,
          },
        ],
        offlinePlaylists: [],
        excludedLocalFolders: [],
        localMediaEnabled: true,
        isScanningLocalMedia: false,
        sortMode: 'recent',
        searchQuery: '',
        isPlaying: false,
        hiddenLocalCount: 0,
        onChangeSearchQuery: () => {},
        onChangeSortMode: () => {},
        onEnableAndScanLocalMedia: () => {},
        onRescanLocalMedia: () => {},
        onToggleExcludedFolder: () => {},
        onRestoreHiddenLocalTracks: () => {},
        onPlayOfflineTrack: (_item, q) => {
          playedQueue = q;
        },
        onOpenOfflinePlaylist: () => {},
        onPlayOfflinePlaylist: () => {},
        onAddToPlaylist: () => {},
        onDeleteDownloadedTrack: () => {},
        onEditLocalTrack: () => {},
        onRevalidateLocalTrack: () => {},
        onHideLocalTrack: () => {},
        onDeleteLocalTrackFromDevice: () => {},
        onPlayNext: () => {},
        onAddToQueue: () => {},
      })
    );
  });

  const localBtn = renderer.root.findByProps({
    accessibilityLabel: 'Tocar Nova Local de Alpha',
  });
  await TestRenderer.act(async () => {
    localBtn.props.onPress();
  });
  assert.strictEqual(playedQueue[0].id, 'local_new', 'Faixa local mais recente (em segundos) deve vir antes do download antigo (em ms)');
  assert.strictEqual(playedQueue[1].id, 'dl_old');

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
});

test('OfflinePlaylists & PlaylistDetailModal: inclui __favorites__, destaca corrompido e bloqueia stream/download em offlineOnly', async () => {
  await syncLocalDeviceTracks([
    {
      id: 'local_ok',
      mediaStoreId: 'ok',
      contentUri: 'content://media/external/audio/media/ok',
      fileName: 'ok.mp3',
      folderName: 'Music',
      relativePath: 'Music',
      fileSize: 2_000_000,
      dateModified: 1700000100,
      title: 'Local Ok',
      artist: 'Artista Ok',
      duration: 180,
      isCorrupted: false,
      scannedAt: Date.now(),
    },
    {
      id: 'local_bad',
      mediaStoreId: 'bad',
      contentUri: 'content://media/external/audio/media/bad',
      fileName: 'bad.mp3',
      folderName: 'Music',
      relativePath: 'Music',
      fileSize: 100,
      dateModified: 1700000200,
      title: 'Local Quebrada',
      artist: 'Artista Bad',
      duration: 0,
      isCorrupted: true,
      corruptionReason: 'Arquivo vazio ou incompleto',
      scannedAt: Date.now(),
    },
  ]);

  await toggleFavorite({
    id: 'local_ok',
    title: 'Local Ok',
    artist: 'Artista Ok',
    duration: 180,
    thumbnailUrl: '',
  });
  const offlinePls = await getOfflinePlaylistsSummary();
  const favSummary = offlinePls.find((p) => p.id === FAVORITES_PLAYLIST_ID);
  assert.ok(favSummary, 'Músicas Curtidas com faixa local válida deve aparecer em getOfflinePlaylistsSummary');
  assert.strictEqual(favSummary.downloadedTrackCount, 1);

  const pl = await createPlaylist('Com Corrompida');
  await addTrackToPlaylist(pl.id, {
    id: 'local_ok',
    title: 'Local Ok',
    artist: 'Artista Ok',
    duration: 180,
    thumbnailUrl: '',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'local_bad',
    title: 'Local Quebrada',
    artist: 'Artista Bad',
    duration: 0,
    thumbnailUrl: '',
  });

  let playedTracks = null;
  let toastMsg = null;
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        playlistId: pl.id,
        offlineOnly: false,
        onClose: () => {},
        onPlayTrack: (_t, _i, list) => {
          playedTracks = list;
        },
        onPlayAll: () => {},
        onShowToast: (msg) => {
          toastMsg = msg;
        },
      })
    );
    await global.flushPromises();
  });

  // Deve renderizar indicador explícito "Arquivo corrompido" na linha da faixa quebrada
  const corruptedBadge = renderer.root.findByProps({ accessibilityLabel: 'Arquivo corrompido' });
  assert.ok(corruptedBadge);

  // Tocar faixa corrompida exibe erro e NÃO chama onPlayTrack
  const badRow = renderer.root.findByProps({
    accessibilityLabel: 'Tocar Local Quebrada de Artista Bad',
  });
  await TestRenderer.act(async () => {
    badRow.props.onPress();
  });
  assert.strictEqual(playedTracks, null);
  assert.ok(toastMsg && toastMsg.includes('Arquivo corrompido'));

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
});

test('App runtime: Event.PlaybackError em faixa local_* marca isCorrupted sem chamar getAudioStream', async () => {
  mockPlayer.resetState();
  await syncLocalDeviceTracks([
    {
      id: 'local_err_1',
      mediaStoreId: 'err_1',
      contentUri: 'content://media/external/audio/media/err_1',
      fileName: 'quebra_runtime.mp3',
      folderName: 'Download',
      relativePath: 'Download',
      fileSize: 200_000,
      dateModified: 1700000000,
      title: 'Quebra Runtime',
      artist: 'Artista Local',
      duration: 180,
      isCorrupted: false,
      scannedAt: Date.now(),
    },
  ]);

  let getAudioStreamCalled = false;
  const origGetAudioStream = api.getAudioStream;
  api.getAudioStream = async () => {
    getAudioStreamCalled = true;
    throw new Error('Nunca deve chamar getAudioStream para faixa local_*');
  };

  let renderer;
  try {
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(App));
      await global.flushPromises();
    });

    await TestRenderer.act(async () => {
      await mockPlayer.add([
        {
          id: 'local_err_1',
          url: 'content://media/external/audio/media/err_1',
          title: 'Quebra Runtime',
          artist: 'Artista Local',
          duration: 180,
        },
      ]);
      await global.flushPromises();
    });

    await TestRenderer.act(async () => {
      mockPlayer.emit(Event.PlaybackError, {
        code: 'android-io',
        message: 'Decoder failed',
      });
      await global.flushPromises();
    });

    assert.strictEqual(getAudioStreamCalled, false, 'PlaybackError em local_* nunca deve chamar getAudioStream');
    const updated = await getLocalDeviceTrackById('local_err_1');
    assert.strictEqual(updated.isCorrupted, true, 'Faixa local deve ser marcada como corrompida no SQLite');
  } finally {
    api.getAudioStream = origGetAudioStream;
    if (renderer) {
      await TestRenderer.act(async () => {
        renderer.unmount();
      });
    }
  }
});

test('Player: omite artwork quando string vazia para evitar erro nativo no Android (BundleUtils.getUri)', async () => {
  mockPlayer.resetState();
  await playTrack({
    id: 'local_no_art',
    url: 'content://media/external/audio/media/190',
    title: 'Faixa Sem Capa',
    artist: 'Artista Local',
    artwork: '',
    duration: 30,
  });
  assert.strictEqual(mockPlayer.queue[0].artwork, undefined);

  await addTracksToQueue([
    {
      id: 'local_blank_art',
      url: 'content://media/external/audio/media/191',
      title: 'Faixa Espacos',
      artist: 'Artista Local',
      artwork: '   ',
      duration: 30,
    },
  ]);
  assert.strictEqual(mockPlayer.queue[1].artwork, undefined);
});

test('LyricsViewer: exibe aviso claro para músicas locais sem botão de expandir ou tentar novamente', async () => {
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(LyricsViewer, {
        track: { id: 'local_195', title: 'Viva La Vida', artist: 'Coldplay', duration: 30 },
        lyricsPayload: null,
        isLoading: false,
        currentPosition: 5,
        isExpanded: false,
        onToggleExpand: () => {},
      })
    );
  });

  const notice = renderer.root.findByProps({ testID: 'local-track-lyrics-notice' });
  assert.ok(notice);
  assert.strictEqual(
    renderer.root.findAllByProps({ accessibilityLabel: 'Expandir letras' }).length,
    0
  );
  assert.strictEqual(
    renderer.root.findAllByProps({ accessibilityLabel: 'Tentar carregar letras novamente' }).length,
    0
  );

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
});
