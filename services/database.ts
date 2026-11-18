import * as SQLite from 'expo-sqlite';

/**
 * Identificador reservado da playlist de sistema para "Músicas Curtidas"
 */
export const FAVORITES_PLAYLIST_ID = '__favorites__';

/**
 * Interface que representa os metadados e localização de uma faixa persistida offline.
 */
export interface DownloadedTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  localUri: string;
  downloadedAt: number;
}

/**
 * Resumo de uma playlist para listagem e cards de navegação.
 */
export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  hasCustomCover: boolean;
  coverThumbnails: string[];
  isSystem: boolean;
  trackCount: number;
  totalDuration: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Item de faixa pertencente a uma playlist.
 * Inclui informação reativa sobre disponibilidade offline no dispositivo.
 */
export interface PlaylistTrackItem {
  playlistId: string;
  id: string;
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  position: number;
  addedAt: number;
  localUri?: string | null;
  isDownloaded: boolean;
}

/**
 * Detalhes completos de uma playlist, incluindo suas faixas ordenadas.
 */
export interface PlaylistDetail extends PlaylistSummary {
  tracks: PlaylistTrackItem[];
}

/**
 * Dados mínimos necessários para adicionar uma faixa a uma playlist ou favoritos.
 */
export interface TrackInput {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
}

const MAX_PLAYLIST_DETAIL_CACHE = 20;

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;
let cacheEpoch = 0;
let lastMockGeneration: number | undefined = undefined;

let playlistsCache: PlaylistSummary[] | null = null;
const playlistDetailCache = new Map<string, PlaylistDetail>();
let downloadedTracksCache: DownloadedTrack[] | null = null;
const downloadedByIdMap = new Map<string, DownloadedTrack>();
let favoriteIdsCache: Set<string> | null = null;
let searchHistoryCache: string[] | null = null;

let playlistsInFlight: Promise<PlaylistSummary[]> | null = null;
const playlistDetailInFlight = new Map<string, Promise<PlaylistDetail | null>>();
let downloadedTracksInFlight: Promise<DownloadedTrack[]> | null = null;
let favoriteIdsInFlight: Promise<Set<string>> | null = null;
let searchHistoryInFlight: Promise<string[]> | null = null;

function clonePlaylists(list: PlaylistSummary[]): PlaylistSummary[] {
  return list.map((p) => ({
    ...p,
    coverThumbnails: [...(p.coverThumbnails || [])],
  }));
}

function clonePlaylistDetail(detail: PlaylistDetail): PlaylistDetail {
  return {
    ...detail,
    coverThumbnails: [...(detail.coverThumbnails || [])],
    tracks: detail.tracks.map((t) => ({ ...t })),
  };
}

function cloneDownloadedTracks(list: DownloadedTrack[]): DownloadedTrack[] {
  return list.map((t) => ({ ...t }));
}

function setPlaylistDetailCache(id: string, detail: PlaylistDetail): void {
  playlistDetailCache.delete(id);
  playlistDetailCache.set(id, clonePlaylistDetail(detail));
  if (playlistDetailCache.size > MAX_PLAYLIST_DETAIL_CACHE) {
    const oldestKey = playlistDetailCache.keys().next().value;
    if (oldestKey !== undefined) {
      playlistDetailCache.delete(oldestKey);
    }
  }
}

function syncMockGeneration(): void {
  const gen = (dbInstance as { _generation?: number } | null)?._generation;
  if (typeof gen === 'number') {
    if (lastMockGeneration !== undefined && gen !== lastMockGeneration) {
      invalidateDatabaseCaches();
    }
    lastMockGeneration = gen;
  }
}

/**
 * Invalida todos os caches em memória do banco de dados.
 */
export function invalidateDatabaseCaches(): void {
  cacheEpoch += 1;
  playlistsCache = null;
  playlistDetailCache.clear();
  downloadedTracksCache = null;
  downloadedByIdMap.clear();
  favoriteIdsCache = null;
  searchHistoryCache = null;
  playlistsInFlight = null;
  playlistDetailInFlight.clear();
  downloadedTracksInFlight = null;
  favoriteIdsInFlight = null;
  searchHistoryInFlight = null;
}

/**
 * Retorna snapshot síncrono das playlists em cache para hidratação imediata da UI.
 */
export function getCachedPlaylists(): PlaylistSummary[] | null {
  syncMockGeneration();
  return playlistsCache ? clonePlaylists(playlistsCache) : null;
}

/**
 * Retorna snapshot síncrono dos detalhes da playlist em cache para hidratação imediata da UI.
 */
export function getCachedPlaylistById(id: string): PlaylistDetail | null {
  syncMockGeneration();
  const cached = playlistDetailCache.get(id);
  if (!cached) return null;
  setPlaylistDetailCache(id, cached);
  return clonePlaylistDetail(cached);
}

/**
 * Obtém a instância singleton do banco SQLite.
 */
async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('sonary.db');
  }
  syncMockGeneration();
  return dbInstance;
}

/**
 * Inicializa o banco de dados e cria as tabelas de faixas offline,
 * playlists e faixas de playlists, garantindo a existência da playlist
 * de sistema para Músicas Curtidas.
 */
export async function initDatabase(): Promise<void> {
  syncMockGeneration();
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const db = await getDatabase();

    // 1. Tabela de downloads offline físicos
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS downloaded_tracks (
        id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        duration INTEGER,
        thumbnailUrl TEXT,
        localUri TEXT,
        downloadedAt INTEGER
      );
    `);

    // 2. Tabela de playlists / coleções
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        thumbnailUrl TEXT,
        isSystem INTEGER DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);

    // 3. Tabela associativa de faixas nas playlists
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlistId TEXT NOT NULL,
        trackId TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration INTEGER NOT NULL,
        thumbnailUrl TEXT,
        position INTEGER NOT NULL,
        addedAt INTEGER NOT NULL,
        PRIMARY KEY (playlistId, trackId)
      );
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos ON playlist_tracks(playlistId, position);
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_trackId ON playlist_tracks(trackId);
    `);

    // 4. Tabela de histórico de reprodução local
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS playback_history (
        id TEXT PRIMARY KEY,
        trackId TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration INTEGER NOT NULL,
        thumbnailUrl TEXT,
        playedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_playback_history_playedAt ON playback_history(playedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_playback_history_trackId ON playback_history(trackId);
    `);

    // 5. Tabela de configurações e retomada de sessão
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 6. Tabela de cache persistente de letras (L2 Cache)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS lyrics_cache (
        trackId TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);

    // 7. Tabela persistente da fila de downloads (compartilhada via WAL com WorkManager nativo)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS download_queue (
        trackId TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration INTEGER NOT NULL,
        thumbnailUrl TEXT,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        streamUrl TEXT,
        headersJson TEXT,
        position INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_download_queue_pos ON download_queue(position ASC, createdAt ASC);
    `);

    // Pragmas de performance para leituras concorrentes sem bloqueio (WAL + cache em memória)
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -8000;
    `);

    // 7. Criação idempotente da playlist reservada de sistema para Favoritos
    const now = Date.now();
    await db.runAsync(
      `INSERT OR IGNORE INTO playlists (
        id, name, description, thumbnailUrl, isSystem, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 1, ?, ?);`,
      [
        FAVORITES_PLAYLIST_ID,
        'Músicas Curtidas',
        'Suas faixas favoritas salvas com ❤️',
        null,
        now,
        now,
      ]
    );
  })();

  return initPromise;
}

/* ==========================================================================
   DOWNLOADED TRACKS (MÚSICAS BAIXADAS OFFLINE)
   ========================================================================== */

function invalidateDownloadedCaches(): void {
  cacheEpoch += 1;
  downloadedTracksCache = null;
  downloadedByIdMap.clear();
  downloadedTracksInFlight = null;
  playlistDetailCache.clear();
  playlistDetailInFlight.clear();
  playlistsCache = null;
  playlistsInFlight = null;
}

function invalidatePlaylistCaches(playlistId: string): void {
  cacheEpoch += 1;
  playlistsCache = null;
  playlistsInFlight = null;
  playlistDetailCache.delete(playlistId);
  playlistDetailInFlight.delete(playlistId);
  if (playlistId === FAVORITES_PLAYLIST_ID) {
    favoriteIdsCache = null;
    favoriteIdsInFlight = null;
  }
}

/**
 * Persiste ou atualiza uma faixa baixada no banco SQLite.
 */
export async function saveDownloadedTrack(track: DownloadedTrack): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO downloaded_tracks (
      id, title, artist, duration, thumbnailUrl, localUri, downloadedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      track.id,
      track.title,
      track.artist,
      track.duration,
      track.thumbnailUrl,
      track.localUri,
      track.downloadedAt,
    ]
  );
  invalidateDownloadedCaches();
}

/**
 * Retorna todas as faixas salvas offline ordenadas pela data de download (mais recentes primeiro).
 */
export async function getDownloadedTracks(): Promise<DownloadedTrack[]> {
  await initDatabase();
  if (downloadedTracksCache !== null) {
    return cloneDownloadedTracks(downloadedTracksCache);
  }
  if (downloadedTracksInFlight) {
    return cloneDownloadedTracks(await downloadedTracksInFlight);
  }

  const epoch = cacheEpoch;
  const pending = (async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadedTrack>(
      `SELECT id, title, artist, duration, thumbnailUrl, localUri, downloadedAt 
       FROM downloaded_tracks 
       ORDER BY downloadedAt DESC;`
    );
    if (epoch === cacheEpoch) {
      downloadedTracksCache = cloneDownloadedTracks(rows);
      downloadedByIdMap.clear();
      for (const row of rows) {
        downloadedByIdMap.set(row.id, { ...row });
      }
    }
    return rows;
  })();

  downloadedTracksInFlight = pending;
  try {
    return cloneDownloadedTracks(await pending);
  } finally {
    if (downloadedTracksInFlight === pending) {
      downloadedTracksInFlight = null;
    }
  }
}

/**
 * Obtém uma faixa baixada pelo seu ID, se existir.
 */
export async function getDownloadedTrackById(id: string): Promise<DownloadedTrack | null> {
  await initDatabase();
  if (downloadedTracksCache === null) {
    await getDownloadedTracks();
  }
  const hit = downloadedByIdMap.get(id);
  return hit ? { ...hit } : null;
}

/**
 * Remove uma faixa baixada do banco de dados SQLite.
 */
export async function deleteDownloadedTrack(id: string): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM downloaded_tracks WHERE id = ?;`, [id]);
  invalidateDownloadedCaches();
}

/**
 * Verifica se uma faixa está persistida no banco SQLite.
 */
export async function isDownloaded(id: string): Promise<boolean> {
  await initDatabase();
  if (downloadedTracksCache === null) {
    await getDownloadedTracks();
  }
  return downloadedByIdMap.has(id);
}

/**
 * Retorna os IDs presentes no banco para uma lista de IDs informada (consulta em lote).
 */
export async function getDownloadedTrackIds(ids: string[]): Promise<Set<string>> {
  if (!ids || ids.length === 0) {
    return new Set<string>();
  }
  await initDatabase();
  if (downloadedTracksCache === null) {
    await getDownloadedTracks();
  }
  return new Set<string>(ids.filter((id) => downloadedByIdMap.has(id)));
}

/* ==========================================================================
   PLAYLISTS & COLEÇÕES (CRUD RELACIONAL LOCAL-FIRST)
   ========================================================================== */

/**
 * Cria uma nova playlist no banco de dados.
 */
export async function createPlaylist(
  name: string,
  description?: string
): Promise<PlaylistSummary> {
  await initDatabase();
  const db = await getDatabase();

  const trimmedName = name.trim() || 'Minha Playlist';
  const id = `pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO playlists (
      id, name, description, thumbnailUrl, isSystem, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, 0, ?, ?);`,
    [id, trimmedName, description?.trim() || null, null, now, now]
  );

  cacheEpoch += 1;
  playlistsCache = null;
  playlistsInFlight = null;

  return {
    id,
    name: trimmedName,
    description: description?.trim() || null,
    thumbnailUrl: null,
    hasCustomCover: false,
    coverThumbnails: [],
    isSystem: false,
    trackCount: 0,
    totalDuration: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Retorna a lista de todas as playlists, calculando dinamicamente:
 * - Quantidade de faixas (`trackCount`)
 * - Duração total acumulada em segundos (`totalDuration`)
 * - Thumbnail calculada a partir da primeira faixa da lista se não houver capa customizada
 * 
 * Ordenação: A playlist de sistema "Músicas Curtidas" é retornada sempre em primeiro lugar,
 * seguida pelas playlists criadas pelo usuário ordenadas pela data de atualização.
 */
export async function getPlaylists(): Promise<PlaylistSummary[]> {
  await initDatabase();
  if (playlistsCache !== null) {
    return clonePlaylists(playlistsCache);
  }
  if (playlistsInFlight) {
    return clonePlaylists(await playlistsInFlight);
  }

  const epoch = cacheEpoch;
  const pending = (async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string;
      name: string;
      description: string | null;
      thumbnailUrl: string | null;
      isSystem: number;
      createdAt: number;
      updatedAt: number;
      trackCount: number;
      totalDuration: number;
      firstTrackThumbnail: string | null;
    }>(`
      SELECT 
        p.id,
        p.name,
        p.description,
        p.thumbnailUrl,
        p.isSystem,
        p.createdAt,
        p.updatedAt,
        COUNT(pt.trackId) AS trackCount,
        COALESCE(SUM(pt.duration), 0) AS totalDuration,
        (
          SELECT pt2.thumbnailUrl 
          FROM playlist_tracks pt2 
          WHERE pt2.playlistId = p.id 
          ORDER BY pt2.position ASC 
          LIMIT 1
        ) AS firstTrackThumbnail
      FROM playlists p
      LEFT JOIN playlist_tracks pt ON p.id = pt.playlistId
      GROUP BY p.id
      ORDER BY p.isSystem DESC, p.updatedAt DESC;
    `);

    const thumbRows = await db.getAllAsync<{
      playlistId: string;
      thumbnailUrl: string;
      position: number;
    }>(`
      SELECT playlistId, thumbnailUrl, position
      FROM playlist_tracks
      WHERE thumbnailUrl IS NOT NULL AND thumbnailUrl != ''
      ORDER BY playlistId ASC, position ASC;
    `);

    const firstFourByPlaylist = new Map<string, string[]>();
    for (const row of thumbRows) {
      if (!row.playlistId || !row.thumbnailUrl) continue;
      let list = firstFourByPlaylist.get(row.playlistId);
      if (!list) {
        list = [];
        firstFourByPlaylist.set(row.playlistId, list);
      }
      if (list.length < 4) {
        list.push(row.thumbnailUrl);
      }
    }

    const mapped = rows.map((r) => {
      const hasCustomCover = Boolean(r.thumbnailUrl);
      const queriedThumbs = firstFourByPlaylist.get(r.id) || [];
      const coverThumbnails = hasCustomCover
        ? []
        : queriedThumbs.length > 0
          ? queriedThumbs
          : r.firstTrackThumbnail
            ? [r.firstTrackThumbnail]
            : [];

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        thumbnailUrl: r.thumbnailUrl || coverThumbnails[0] || r.firstTrackThumbnail || null,
        hasCustomCover,
        coverThumbnails,
        isSystem: Boolean(r.isSystem),
        trackCount: Number(r.trackCount || 0),
        totalDuration: Number(r.totalDuration || 0),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    if (epoch === cacheEpoch) {
      playlistsCache = clonePlaylists(mapped);
    }
    return mapped;
  })();

  playlistsInFlight = pending;
  try {
    return clonePlaylists(await pending);
  } finally {
    if (playlistsInFlight === pending) {
      playlistsInFlight = null;
    }
  }
}

/**
 * Obtém os detalhes completos de uma playlist e todas as suas faixas ordenadas por posição.
 * Cruza em tempo real com downloaded_tracks para indicar se cada música está baixada offline.
 */
export async function getPlaylistById(id: string): Promise<PlaylistDetail | null> {
  await initDatabase();
  const cached = playlistDetailCache.get(id);
  if (cached) {
    setPlaylistDetailCache(id, cached);
    return clonePlaylistDetail(cached);
  }
  const existingFlight = playlistDetailInFlight.get(id);
  if (existingFlight) {
    const res = await existingFlight;
    return res ? clonePlaylistDetail(res) : null;
  }

  const epoch = cacheEpoch;
  const pending = (async () => {
    const db = await getDatabase();

    const playlistRow = await db.getFirstAsync<{
      id: string;
      name: string;
      description: string | null;
      thumbnailUrl: string | null;
      isSystem: number;
      createdAt: number;
      updatedAt: number;
    }>(
      `SELECT id, name, description, thumbnailUrl, isSystem, createdAt, updatedAt
       FROM playlists 
       WHERE id = ?;`,
      [id]
    );

    if (!playlistRow) {
      return null;
    }

    const tracksRows = await db.getAllAsync<{
      playlistId: string;
      trackId: string;
      title: string;
      artist: string;
      duration: number;
      thumbnailUrl: string;
      position: number;
      addedAt: number;
      localUri: string | null;
      isDownloaded: number;
    }>(
      `SELECT 
        pt.playlistId,
        pt.trackId,
        pt.title,
        pt.artist,
        pt.duration,
        pt.thumbnailUrl,
        pt.position,
        pt.addedAt,
        dt.localUri,
        CASE WHEN dt.id IS NOT NULL THEN 1 ELSE 0 END AS isDownloaded
      FROM playlist_tracks pt
      LEFT JOIN downloaded_tracks dt ON pt.trackId = dt.id
      WHERE pt.playlistId = ?
      ORDER BY pt.position ASC;`,
      [id]
    );

    const tracks: PlaylistTrackItem[] = tracksRows.map((t) => ({
      playlistId: t.playlistId,
      id: t.trackId,
      trackId: t.trackId,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      thumbnailUrl: t.thumbnailUrl,
      position: t.position,
      addedAt: t.addedAt,
      localUri: t.localUri,
      isDownloaded: Boolean(t.isDownloaded),
    }));

    const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
    const hasCustomCover = Boolean(playlistRow.thumbnailUrl);
    const coverThumbnails = hasCustomCover
      ? []
      : tracks
          .map((t) => t.thumbnailUrl)
          .filter((uri): uri is string => Boolean(uri))
          .slice(0, 4);
    const calculatedThumbnail =
      playlistRow.thumbnailUrl || coverThumbnails[0] || null;

    const detail: PlaylistDetail = {
      id: playlistRow.id,
      name: playlistRow.name,
      description: playlistRow.description,
      thumbnailUrl: calculatedThumbnail,
      hasCustomCover,
      coverThumbnails,
      isSystem: Boolean(playlistRow.isSystem),
      trackCount: tracks.length,
      totalDuration,
      createdAt: playlistRow.createdAt,
      updatedAt: playlistRow.updatedAt,
      tracks,
    };

    if (epoch === cacheEpoch) {
      setPlaylistDetailCache(id, detail);
      if (id === FAVORITES_PLAYLIST_ID) {
        favoriteIdsCache = new Set(tracks.map((t) => t.trackId));
      }
    }
    return detail;
  })();

  playlistDetailInFlight.set(id, pending);
  try {
    const result = await pending;
    return result ? clonePlaylistDetail(result) : null;
  } finally {
    if (playlistDetailInFlight.get(id) === pending) {
      playlistDetailInFlight.delete(id);
    }
  }
}

/**
 * Atualiza o nome, descrição e (opcionalmente) capa customizada de uma playlist.
 * Passe `thumbnailUrl: null` para remover a capa customizada e voltar à capa automática.
 * Playlists de sistema não têm o nome ou capa alterados para manter a integridade visual.
 */
export async function updatePlaylist(
  id: string,
  name: string,
  description?: string,
  thumbnailUrl?: string | null
): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  const now = Date.now();

  if (id === FAVORITES_PLAYLIST_ID) {
    await db.runAsync(
      `UPDATE playlists SET description = ?, updatedAt = ? WHERE id = ?;`,
      [description?.trim() || null, now, id]
    );
    invalidatePlaylistCaches(id);
    return;
  }

  if (thumbnailUrl !== undefined) {
    await db.runAsync(
      `UPDATE playlists SET name = ?, description = ?, thumbnailUrl = ?, updatedAt = ? WHERE id = ?;`,
      [name.trim() || 'Minha Playlist', description?.trim() || null, thumbnailUrl || null, now, id]
    );
  } else {
    await db.runAsync(
      `UPDATE playlists SET name = ?, description = ?, updatedAt = ? WHERE id = ?;`,
      [name.trim() || 'Minha Playlist', description?.trim() || null, now, id]
    );
  }
  invalidatePlaylistCaches(id);
}

/**
 * Exclui uma playlist e todas as associações de faixas correspondentes.
 * Não permite a exclusão da playlist de sistema (Músicas Curtidas).
 */
export async function deletePlaylist(id: string): Promise<boolean> {
  if (id === FAVORITES_PLAYLIST_ID) {
    return false; // Playlist de sistema protegida
  }

  await initDatabase();
  const db = await getDatabase();

  await db.runAsync(`DELETE FROM playlist_tracks WHERE playlistId = ?;`, [id]);
  await db.runAsync(`DELETE FROM playlists WHERE id = ?;`, [id]);
  invalidatePlaylistCaches(id);
  return true;
}

/**
 * Adiciona uma faixa a uma playlist.
 * Se a faixa já estiver na playlist, atualiza os metadados mantendo a posição original.
 */
export async function addTrackToPlaylist(
  playlistId: string,
  track: TrackInput
): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  const now = Date.now();

  // Verifica se a faixa já existe para manter a posição atual
  const existing = await db.getFirstAsync<{ position: number }>(
    `SELECT position FROM playlist_tracks WHERE playlistId = ? AND trackId = ?;`,
    [playlistId, track.id]
  );

  let position = existing ? existing.position : 0;

  if (!existing) {
    const maxRow = await db.getFirstAsync<{ nextPos: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS nextPos 
       FROM playlist_tracks 
       WHERE playlistId = ?;`,
      [playlistId]
    );
    position = maxRow ? maxRow.nextPos : 0;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO playlist_tracks (
      playlistId, trackId, title, artist, duration, thumbnailUrl, position, addedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      playlistId,
      track.id,
      track.title,
      track.artist,
      track.duration,
      track.thumbnailUrl,
      position,
      now,
    ]
  );

  await db.runAsync(`UPDATE playlists SET updatedAt = ? WHERE id = ?;`, [
    now,
    playlistId,
  ]);
  invalidatePlaylistCaches(playlistId);
}

/**
 * Remove uma faixa de uma playlist específica.
 */
export async function removeTrackFromPlaylist(
  playlistId: string,
  trackId: string
): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  const now = Date.now();

  await db.runAsync(
    `DELETE FROM playlist_tracks WHERE playlistId = ? AND trackId = ?;`,
    [playlistId, trackId]
  );

  await db.runAsync(`UPDATE playlists SET updatedAt = ? WHERE id = ?;`, [
    now,
    playlistId,
  ]);
  invalidatePlaylistCaches(playlistId);
}

/**
 * Reordena as faixas de uma playlist com base em uma nova lista ordenada de IDs.
 */
export async function reorderPlaylistTracks(
  playlistId: string,
  orderedTrackIds: string[]
): Promise<void> {
  if (!orderedTrackIds || orderedTrackIds.length === 0) return;

  await initDatabase();
  const db = await getDatabase();
  const now = Date.now();

  const executeReorder = async () => {
    for (let i = 0; i < orderedTrackIds.length; i++) {
      await db.runAsync(
        `UPDATE playlist_tracks SET position = ? WHERE playlistId = ? AND trackId = ?;`,
        [i, playlistId, orderedTrackIds[i]]
      );
    }

    await db.runAsync(`UPDATE playlists SET updatedAt = ? WHERE id = ?;`, [
      now,
      playlistId,
    ]);
  };

  const dbWithTx = db as SQLite.SQLiteDatabase & {
    withTransactionAsync?: (task: () => Promise<void>) => Promise<void>;
  };
  if (typeof dbWithTx.withTransactionAsync === 'function') {
    await dbWithTx.withTransactionAsync(executeReorder);
  } else {
    await executeReorder();
  }

  invalidatePlaylistCaches(playlistId);
}

/* ==========================================================================
   MÚSICAS CURTIDAS (FAVORITOS DE SISTEMA)
   ========================================================================== */

async function ensureFavoriteIdsCache(): Promise<Set<string>> {
  await initDatabase();
  if (favoriteIdsCache !== null) {
    return favoriteIdsCache;
  }
  if (favoriteIdsInFlight) {
    return favoriteIdsInFlight;
  }

  const epoch = cacheEpoch;
  const pending = (async () => {
    const detail = await getPlaylistById(FAVORITES_PLAYLIST_ID);
    const favSet = new Set<string>(detail ? detail.tracks.map((t) => t.trackId) : []);
    if (epoch === cacheEpoch) {
      favoriteIdsCache = favSet;
    }
    return favSet;
  })();

  favoriteIdsInFlight = pending;
  try {
    return await pending;
  } finally {
    if (favoriteIdsInFlight === pending) {
      favoriteIdsInFlight = null;
    }
  }
}

/**
 * Verifica se uma faixa específica está favoritada nas Músicas Curtidas.
 */
export async function isFavorite(trackId: string): Promise<boolean> {
  const favSet = await ensureFavoriteIdsCache();
  return favSet.has(trackId);
}

/**
 * Alterna o estado de favorito de uma faixa (adiciona se não existir, remove se existir).
 * Retorna true se a faixa agora está curtida, false se foi descurtida.
 */
export async function toggleFavorite(track: TrackInput): Promise<boolean> {
  const currentlyFavorite = await isFavorite(track.id);
  if (currentlyFavorite) {
    await removeTrackFromPlaylist(FAVORITES_PLAYLIST_ID, track.id);
    return false;
  } else {
    await addTrackToPlaylist(FAVORITES_PLAYLIST_ID, track);
    return true;
  }
}

/**
 * Retorna os IDs favoritados para uma lista de IDs informada (consulta em lote).
 * Usado para preencher os corações nos resultados da busca sem causar lag na UI.
 */
export async function getFavoriteTrackIds(trackIds: string[]): Promise<Set<string>> {
  if (!trackIds || trackIds.length === 0) {
    return new Set<string>();
  }
  const favSet = await ensureFavoriteIdsCache();
  return new Set<string>(trackIds.filter((id) => favSet.has(id)));
}

/**
 * Retorna todas as faixas favoritadas na playlist Músicas Curtidas.
 */
export async function getFavoriteTracks(): Promise<PlaylistTrackItem[]> {
  const detail = await getPlaylistById(FAVORITES_PLAYLIST_ID);
  return detail ? detail.tracks : [];
}

/* ==========================================================================
   PLAYLIST DUPLICATE DETECTION (DETECÇÃO DE DUPLICATAS)
   ========================================================================== */

/**
 * Verifica de forma atômica se uma faixa já existe em uma playlist específica.
 */
export async function isTrackInPlaylist(playlistId: string, trackId: string): Promise<boolean> {
  await initDatabase();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ trackId: string }>(
    `SELECT trackId FROM playlist_tracks WHERE playlistId = ? AND trackId = ? LIMIT 1;`,
    [playlistId, trackId]
  );
  return !!row;
}

/* ==========================================================================
   PLAYBACK HISTORY (HISTÓRICO LOCAL DE REPRODUÇÃO)
   ========================================================================== */

export interface HistoryTrackItem {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  duration: number;
  playedAt: number;
}

let lastHistoryTimestamp = 0;
function getMonotonicNow(): number {
  const now = Date.now();
  if (now <= lastHistoryTimestamp) {
    lastHistoryTimestamp += 1;
    return lastHistoryTimestamp;
  }
  lastHistoryTimestamp = now;
  return now;
}

/**
 * Registra uma faixa no histórico local de reprodução.
 * Se a faixa já foi ouvida anteriormente, atualiza o timestamp `playedAt`.
 * Aplica retenção automática garantindo no máximo 500 faixas recentes.
 */
export async function recordPlaybackHistory(track: TrackInput): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  const now = getMonotonicNow();

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM playback_history WHERE trackId = ? LIMIT 1;`,
    [track.id]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE playback_history SET title = ?, artist = ?, duration = ?, thumbnailUrl = ?, playedAt = ? WHERE id = ?;`,
      [track.title, track.artist, track.duration, track.thumbnailUrl, now, existing.id]
    );
  } else {
    const id = `hist_${track.id}_${now}`;
    await db.runAsync(
      `INSERT INTO playback_history (id, trackId, title, artist, duration, thumbnailUrl, playedAt) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [id, track.id, track.title, track.artist, track.duration, track.thumbnailUrl, now]
    );
  }

  // Retenção automática dos 500 itens mais recentes
  await db.runAsync(
    `DELETE FROM playback_history WHERE id NOT IN (SELECT id FROM playback_history ORDER BY playedAt DESC LIMIT 500);`
  );
}

/**
 * Obtém o histórico de reprodução ordenado do mais recente para o mais antigo.
 */
export async function getPlaybackHistory(limit: number = 50): Promise<HistoryTrackItem[]> {
  await initDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<HistoryTrackItem>(
    `SELECT id, trackId, title, artist, thumbnailUrl, duration, playedAt FROM playback_history ORDER BY playedAt DESC LIMIT ?;`,
    [limit]
  );
  return rows;
}

/**
 * Limpa todo o histórico de faixas ouvidas.
 */
export async function clearPlaybackHistory(): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM playback_history;`);
}

/* ==========================================================================
   PLAYBACK SESSION RESTORATION (RETOMADA DE SESSÃO)
   ========================================================================== */

export interface PlaybackSessionState {
  track: TrackInput;
  positionSec: number;
  playlistContext?: { type: string; id?: string };
  savedAt: number;
}

/**
 * Persiste o estado da sessão atual no SQLite para permitir retomada após reabertura.
 */
export async function savePlaybackSession(state: PlaybackSessionState): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  const json = JSON.stringify(state);
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('playback_session', ?);`,
    [json]
  );
}

/**
 * Recupera o último estado de sessão salvo se houver.
 */
export async function getPlaybackSession(): Promise<PlaybackSessionState | null> {
  await initDatabase();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'playback_session' LIMIT 1;`
  );
  if (!row || !row.value) return null;
  try {
    return JSON.parse(row.value) as PlaybackSessionState;
  } catch {
    return null;
  }
}

const SEARCH_HISTORY_KEY = 'search_history';
const MAX_SEARCH_HISTORY = 12;

/**
 * Retorna os termos de busca recentes salvos localmente no SQLite.
 */
export async function getSearchHistory(limit: number = MAX_SEARCH_HISTORY): Promise<string[]> {
  await initDatabase();
  if (searchHistoryCache !== null) {
    return searchHistoryCache.slice(0, limit);
  }
  if (searchHistoryInFlight) {
    return (await searchHistoryInFlight).slice(0, limit);
  }

  const epoch = cacheEpoch;
  const pending = (async () => {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ? LIMIT 1;`,
      [SEARCH_HISTORY_KEY]
    );
    let list: string[] = [];
    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) {
          list = parsed.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0
          );
        }
      } catch {
        list = [];
      }
    }
    if (epoch === cacheEpoch) {
      searchHistoryCache = [...list];
    }
    return list;
  })();

  searchHistoryInFlight = pending;
  try {
    return (await pending).slice(0, limit);
  } finally {
    if (searchHistoryInFlight === pending) {
      searchHistoryInFlight = null;
    }
  }
}

async function writeSearchHistory(list: string[]): Promise<string[]> {
  await initDatabase();
  const normalizedList = list.slice(0, MAX_SEARCH_HISTORY);
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
    [SEARCH_HISTORY_KEY, JSON.stringify(normalizedList)]
  );
  cacheEpoch += 1;
  searchHistoryCache = [...normalizedList];
  searchHistoryInFlight = null;
  return normalizedList;
}

/**
 * Salva uma busca recente no topo da lista (sem duplicatas) no SQLite.
 */
export async function recordSearchHistory(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return getSearchHistory();
  const existing = await getSearchHistory(MAX_SEARCH_HISTORY);
  const normalized = trimmed.toLowerCase();
  const next = [
    trimmed,
    ...existing.filter((item) => item.trim().toLowerCase() !== normalized),
  ];
  return writeSearchHistory(next);
}

/**
 * Remove um item específico do histórico de buscas recente.
 */
export async function removeSearchHistoryItem(query: string): Promise<string[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return getSearchHistory();
  const existing = await getSearchHistory(MAX_SEARCH_HISTORY);
  const next = existing.filter((item) => item.trim().toLowerCase() !== normalized);
  return writeSearchHistory(next);
}

/**
 * Limpa todo o histórico de buscas recente salvo no SQLite.
 */
export async function clearSearchHistory(): Promise<void> {
  await writeSearchHistory([]);
}

/* ==========================================================================
   LYRICS PERSISTENT CACHE (CACHE L2 DE LETRAS - SQLITE)
   ========================================================================== */

const DEFAULT_LYRICS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

export async function saveCachedLyrics(
  trackId: string,
  type: 'synced' | 'plain' | 'none',
  payloadJson: string
): Promise<void> {
  if (!trackId) return;
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO lyrics_cache (trackId, type, payload, updatedAt) VALUES (?, ?, ?, ?);`,
    [trackId, type, payloadJson, Date.now()]
  );
}

export async function getCachedLyrics(
  trackId: string,
  maxAgeMs: number = DEFAULT_LYRICS_TTL_MS
): Promise<{ type: 'synced' | 'plain' | 'none'; payload: string; updatedAt: number } | null> {
  if (!trackId) return null;
  await initDatabase();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    type: 'synced' | 'plain' | 'none';
    payload: string;
    updatedAt: number;
  }>(
    `SELECT type, payload, updatedAt FROM lyrics_cache WHERE trackId = ? LIMIT 1;`,
    [trackId]
  );
  if (!row || !row.payload) return null;
  if (Date.now() - row.updatedAt > maxAgeMs) {
    return null;
  }
  return row;
}

/* ==========================================================================
   SUPPORT NOTIFICATION STATE (AGRADECIMENTO E APOIO)
   ========================================================================== */

export const SUPPORT_NOTIFICATION_STATE_KEY = 'support_notification_state';
export const SUPPORT_DAILY_MIN_PLAYS = 15;

export interface SupportNotificationState {
  dateKey: string;
  dailyPlayCount: number;
  lastNotifiedDate: string | null;
  snoozeUntilDate: string | null;
}

let supportStateMutex: Promise<void> = Promise.resolve();

function withSupportStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = supportStateMutex.then(fn, fn);
  supportStateMutex = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Formata a data local do dispositivo como YYYY-MM-DD (nunca UTC).
 */
export function getTodayLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retorna o dia 10 do próximo mês do calendário local como YYYY-MM-DD.
 */
export function getNextMonthTenthDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const monthZeroBased = date.getMonth();
  const nextYear = monthZeroBased === 11 ? year + 1 : year;
  const nextMonth = monthZeroBased === 11 ? 1 : monthZeroBased + 2;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`;
}

function normalizeSupportNotificationState(
  raw: Partial<SupportNotificationState> | null | undefined,
  todayKey: string
): SupportNotificationState {
  const isSameDay = raw?.dateKey === todayKey;
  const dailyPlayCount =
    isSameDay && typeof raw?.dailyPlayCount === 'number' && Number.isFinite(raw.dailyPlayCount)
      ? Math.max(0, Math.floor(raw.dailyPlayCount))
      : 0;
  return {
    dateKey: todayKey,
    dailyPlayCount,
    lastNotifiedDate: typeof raw?.lastNotifiedDate === 'string' ? raw.lastNotifiedDate : null,
    snoozeUntilDate: typeof raw?.snoozeUntilDate === 'string' ? raw.snoozeUntilDate : null,
  };
}

/**
 * Verifica se as travas diárias e mensais permitem disparar a notificação de apoio.
 */
export function canTriggerSupportNotification(
  state: SupportNotificationState,
  date: Date = new Date()
): boolean {
  const todayKey = getTodayLocalDateKey(date);
  const dailyCount = state.dateKey === todayKey ? state.dailyPlayCount : 0;
  if (dailyCount <= SUPPORT_DAILY_MIN_PLAYS) {
    return false;
  }
  if (state.lastNotifiedDate === todayKey) {
    return false;
  }
  if (state.snoozeUntilDate && todayKey < state.snoozeUntilDate) {
    return false;
  }
  return true;
}

async function readRawSupportState(): Promise<Partial<SupportNotificationState> | null> {
  await initDatabase();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ? LIMIT 1;`,
    [SUPPORT_NOTIFICATION_STATE_KEY]
  );
  if (!row || !row.value) return null;
  try {
    return JSON.parse(row.value) as Partial<SupportNotificationState>;
  } catch {
    return null;
  }
}

async function writeSupportState(state: SupportNotificationState): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
    [SUPPORT_NOTIFICATION_STATE_KEY, JSON.stringify(state)]
  );
}

/**
 * Obtém o estado atual de notificações de apoio já normalizado para a data local.
 */
export async function getSupportNotificationState(
  date: Date = new Date()
): Promise<SupportNotificationState> {
  return withSupportStateLock(async () => {
    const todayKey = getTodayLocalDateKey(date);
    const raw = await readRawSupportState();
    return normalizeSupportNotificationState(raw, todayKey);
  });
}

/**
 * Incrementa o contador diário de faixas realmente ouvidas (>= 30s), resetando na virada do dia.
 */
export async function incrementDailySupportPlayCount(
  date: Date = new Date()
): Promise<SupportNotificationState> {
  return withSupportStateLock(async () => {
    const todayKey = getTodayLocalDateKey(date);
    const current = normalizeSupportNotificationState(await readRawSupportState(), todayKey);
    const updated: SupportNotificationState = {
      ...current,
      dailyPlayCount: current.dailyPlayCount + 1,
    };
    await writeSupportState(updated);
    return updated;
  });
}

/**
 * Registra que a notificação de apoio foi enviada na data local informada.
 */
export async function markSupportNotificationSent(
  date: Date = new Date()
): Promise<SupportNotificationState> {
  return withSupportStateLock(async () => {
    const todayKey = getTodayLocalDateKey(date);
    const current = normalizeSupportNotificationState(await readRawSupportState(), todayKey);
    const updated: SupportNotificationState = {
      ...current,
      lastNotifiedDate: todayKey,
    };
    await writeSupportState(updated);
    return updated;
  });
}

/**
 * Bloqueia novas notificações de apoio até o dia 10 do próximo mês após cópia da chave Pix.
 */
export async function snoozeSupportNotificationsUntilNextMonth(
  date: Date = new Date()
): Promise<SupportNotificationState> {
  return withSupportStateLock(async () => {
    const todayKey = getTodayLocalDateKey(date);
    const current = normalizeSupportNotificationState(await readRawSupportState(), todayKey);
    const updated: SupportNotificationState = {
      ...current,
      snoozeUntilDate: getNextMonthTenthDateKey(date),
    };
    await writeSupportState(updated);
    return updated;
  });
}

/**
 * Zera o contador diário e todas as travas de notificação de apoio (uso em testes/dev).
 */
export async function resetSupportNotificationState(
  date: Date = new Date()
): Promise<SupportNotificationState> {
  return withSupportStateLock(async () => {
    const resetState: SupportNotificationState = {
      dateKey: getTodayLocalDateKey(date),
      dailyPlayCount: 0,
      lastNotifiedDate: null,
      snoozeUntilDate: null,
    };
    await writeSupportState(resetState);
    return resetState;
  });
}

/* ==========================================================================
   PERSISTENT DOWNLOAD QUEUE (FILA DE DOWNLOADS EM SQLITE / WAL)
   ========================================================================== */

export type PersistedDownloadStatus = 'pending' | 'downloading' | 'completed' | 'error';

export interface PersistedDownloadQueueRow {
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
  status: PersistedDownloadStatus;
  progress: number;
  error: string | null;
  streamUrl: string | null;
  headersJson: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertDownloadQueueInput {
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl?: string;
  status: PersistedDownloadStatus;
  progress?: number;
  error?: string | null;
  streamUrl?: string | null;
  headersJson?: string | null;
}

export async function getPersistedDownloadQueue(): Promise<PersistedDownloadQueueRow[]> {
  await initDatabase();
  const db = await getDatabase();
  return db.getAllAsync<PersistedDownloadQueueRow>(
    `SELECT trackId, title, artist, duration, thumbnailUrl, status, progress, error,
            streamUrl, headersJson, position, createdAt, updatedAt
     FROM download_queue
     ORDER BY position ASC, createdAt ASC;`
  );
}

export async function upsertPersistedDownloadQueueBatch(
  items: UpsertDownloadQueueInput[]
): Promise<void> {
  if (!items || items.length === 0) return;
  await initDatabase();
  const db = await getDatabase();
  const now = Date.now();

  const maxRow = await db.getFirstAsync<{ nextPos: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS nextPos FROM download_queue;`
  );
  let nextPos = maxRow ? maxRow.nextPos : 0;

  const writeBatch = async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO download_queue (
          trackId, title, artist, duration, thumbnailUrl, status, progress, error,
          streamUrl, headersJson, position, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          item.trackId,
          item.title || 'Música',
          item.artist || 'Artista',
          Math.max(0, Math.floor(item.duration || 0)),
          item.thumbnailUrl || '',
          item.status,
          item.progress ?? 0,
          item.error ?? null,
          item.streamUrl ?? null,
          item.headersJson ?? null,
          nextPos++,
          now,
          now,
        ]
      );
    }
  };

  const dbWithTx = db as SQLite.SQLiteDatabase & {
    withTransactionAsync?: (task: () => Promise<void>) => Promise<void>;
  };
  if (typeof dbWithTx.withTransactionAsync === 'function') {
    await dbWithTx.withTransactionAsync(writeBatch);
  } else {
    await writeBatch();
  }
}

export async function upsertPersistedDownloadQueueItem(
  item: UpsertDownloadQueueInput
): Promise<void> {
  return upsertPersistedDownloadQueueBatch([item]);
}

export async function updatePersistedDownloadQueueState(
  trackId: string,
  status: PersistedDownloadStatus,
  progress: number,
  error: string | null = null
): Promise<void> {
  if (!trackId) return;
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE download_queue SET status = ?, progress = ?, error = ?, updatedAt = ? WHERE trackId = ?;`,
    [status, progress, error, Date.now(), trackId]
  );
}

export async function resetInterruptedDownloadsToPending(): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE download_queue SET status = 'pending', progress = 0, updatedAt = ? WHERE status = 'downloading';`,
    [Date.now()]
  );
}

export async function removePersistedDownloadQueueItem(trackId: string): Promise<void> {
  if (!trackId) return;
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM download_queue WHERE trackId = ?;`, [trackId]);
}

export async function clearPersistedFinishedDownloads(): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM download_queue WHERE status IN ('completed', 'error');`);
}

export async function clearPersistedCompletedDownloads(): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM download_queue WHERE status = 'completed';`);
}

export async function clearPersistedActiveDownloads(): Promise<void> {
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM download_queue WHERE status IN ('pending', 'downloading');`);
}

export async function getAppSetting(key: string): Promise<string | null> {
  if (!key) return null;
  await initDatabase();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ? LIMIT 1;`,
    [key]
  );
  return row?.value ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  if (!key) return;
  await initDatabase();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
    [key, value]
  );
}
