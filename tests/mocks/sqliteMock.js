// tests/mocks/sqliteMock.js

class InMemorySQLiteDatabase {
  constructor() {
    this._generation = 0;
    this.reset();
  }

  reset() {
    this._generation += 1;
    this.downloadedTracks = new Map();
    this.playlists = new Map();
    this.playlistTracks = [];
    this.playbackHistory = [];
    this.appSettings = new Map();
    this.lyricsCache = new Map();
    this.downloadQueue = new Map();
    this.localDeviceTracks = new Map();
    const now = Date.now();
    this.playlists.set('__favorites__', {
      id: '__favorites__',
      name: 'Músicas Curtidas',
      description: 'Suas faixas favoritas salvas com ❤️',
      thumbnailUrl: null,
      isSystem: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  async execAsync(sql) {
    // Schema creation scripts are no-ops since we manage maps/arrays
    return;
  }

  async withTransactionAsync(fn) {
    const snapPlaylists = new Map(
      Array.from(this.playlists.entries()).map(([k, v]) => [k, { ...v }])
    );
    const snapPlaylistTracks = this.playlistTracks.map((t) => ({ ...t }));
    const snapHistory = this.playbackHistory.map((h) => ({ ...h }));
    const snapSettings = new Map(this.appSettings.entries());
    try {
      return await fn();
    } catch (err) {
      this.playlists = snapPlaylists;
      this.playlistTracks = snapPlaylistTracks;
      this.playbackHistory = snapHistory;
      this.appSettings = snapSettings;
      throw err;
    }
  }

  async runAsync(sql, params = []) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    // 1. Insert into playlists (ignore or normal)
    if (cleanSql.includes('INSERT') && cleanSql.includes('INTO playlists')) {
      const [id, name, description, thumbnailUrl, createdAt, updatedAt] =
        params.length === 6
          ? params
          : [params[0], params[1], params[2], params[3], params[5] || params[4], params[6] || params[5]];
      const isSystem = cleanSql.includes('1, ?, ?') || params[4] === 1 ? 1 : 0;

      if (cleanSql.includes('INSERT OR IGNORE') && this.playlists.has(id)) {
        return { lastInsertRowId: 0, changes: 0 };
      }

      this.playlists.set(id, {
        id,
        name,
        description: description || null,
        thumbnailUrl: thumbnailUrl || null,
        isSystem,
        createdAt: createdAt || Date.now(),
        updatedAt: updatedAt || Date.now(),
      });
      return { lastInsertRowId: 1, changes: 1 };
    }

    // 2. Insert or replace into downloaded_tracks
    if (cleanSql.includes('INSERT OR REPLACE INTO downloaded_tracks')) {
      const [id, title, artist, duration, thumbnailUrl, localUri, downloadedAt] = params;
      this.downloadedTracks.set(id, {
        id,
        title,
        artist,
        duration,
        thumbnailUrl,
        localUri,
        downloadedAt,
      });
      return { lastInsertRowId: 1, changes: 1 };
    }

    // 3. Delete from downloaded_tracks
    if (cleanSql.includes('DELETE FROM downloaded_tracks WHERE id = ?')) {
      const [id] = params;
      const deleted = this.downloadedTracks.delete(id);
      return { lastInsertRowId: 0, changes: deleted ? 1 : 0 };
    }

    // 4. Update playlists
    if (cleanSql.includes('UPDATE playlists SET name = ?, description = ?, thumbnailUrl = ?')) {
      const [name, description, thumbnailUrl, updatedAt, id] = params;
      const pl = this.playlists.get(id);
      if (pl) {
        pl.name = name;
        pl.description = description || null;
        pl.thumbnailUrl = thumbnailUrl || null;
        pl.updatedAt = updatedAt;
      }
      return { lastInsertRowId: 0, changes: pl ? 1 : 0 };
    }

    if (cleanSql.includes('UPDATE playlists SET name = ?')) {
      const [name, description, updatedAt, id] = params;
      const pl = this.playlists.get(id);
      if (pl) {
        pl.name = name;
        pl.description = description || null;
        pl.updatedAt = updatedAt;
      }
      return { lastInsertRowId: 0, changes: pl ? 1 : 0 };
    }

    if (cleanSql.includes('UPDATE playlists SET description = ?')) {
      const [description, updatedAt, id] = params;
      const pl = this.playlists.get(id);
      if (pl) {
        pl.description = description || null;
        pl.updatedAt = updatedAt;
      }
      return { lastInsertRowId: 0, changes: pl ? 1 : 0 };
    }

    if (cleanSql.includes('UPDATE playlists SET updatedAt = ? WHERE id = ?')) {
      const [updatedAt, id] = params;
      const pl = this.playlists.get(id);
      if (pl) {
        pl.updatedAt = updatedAt;
      }
      return { lastInsertRowId: 0, changes: pl ? 1 : 0 };
    }

    // 5. Delete from playlists and playlist_tracks
    if (cleanSql.includes('DELETE FROM playlist_tracks WHERE playlistId = ? AND trackId = ?')) {
      const [playlistId, trackId] = params;
      const prevLen = this.playlistTracks.length;
      this.playlistTracks = this.playlistTracks.filter(
        (t) => !(t.playlistId === playlistId && t.trackId === trackId)
      );
      return { lastInsertRowId: 0, changes: prevLen - this.playlistTracks.length };
    }

    if (cleanSql.includes('DELETE FROM playlist_tracks WHERE playlistId = ?')) {
      const [playlistId] = params;
      const prevLen = this.playlistTracks.length;
      this.playlistTracks = this.playlistTracks.filter((t) => t.playlistId !== playlistId);
      return { lastInsertRowId: 0, changes: prevLen - this.playlistTracks.length };
    }

    if (cleanSql === 'DELETE FROM playlist_tracks;' || cleanSql === 'DELETE FROM playlist_tracks') {
      const prevLen = this.playlistTracks.length;
      this.playlistTracks = [];
      return { lastInsertRowId: 0, changes: prevLen };
    }

    if (cleanSql.includes('DELETE FROM playlists WHERE isSystem = 0')) {
      let removed = 0;
      for (const [id, pl] of Array.from(this.playlists.entries())) {
        if (!pl.isSystem) {
          this.playlists.delete(id);
          removed += 1;
        }
      }
      return { lastInsertRowId: 0, changes: removed };
    }

    if (cleanSql.includes('DELETE FROM playlists WHERE id = ?')) {
      const [id] = params;
      const deleted = this.playlists.delete(id);
      return { lastInsertRowId: 0, changes: deleted ? 1 : 0 };
    }

    // 6. Insert or replace into playlist_tracks
    if (cleanSql.includes('INSERT OR REPLACE INTO playlist_tracks')) {
      const [playlistId, trackId, title, artist, duration, thumbnailUrl, position, addedAt] = params;
      const existingIdx = this.playlistTracks.findIndex(
        (t) => t.playlistId === playlistId && t.trackId === trackId
      );
      const trackItem = {
        playlistId,
        trackId,
        title,
        artist,
        duration,
        thumbnailUrl,
        position,
        addedAt,
      };
      if (existingIdx >= 0) {
        this.playlistTracks[existingIdx] = trackItem;
      } else {
        this.playlistTracks.push(trackItem);
      }
      return { lastInsertRowId: 1, changes: 1 };
    }

    // 7. Update playlist_tracks position
    if (cleanSql.includes('UPDATE playlist_tracks SET position = ?')) {
      const [position, playlistId, trackId] = params;
      const track = this.playlistTracks.find(
        (t) => t.playlistId === playlistId && t.trackId === trackId
      );
      if (track) {
        track.position = position;
      }
      return { lastInsertRowId: 0, changes: track ? 1 : 0 };
    }

    // 8. Update playback_history
    if (cleanSql.includes('UPDATE playback_history SET title = ?, artist = ?, thumbnailUrl = ? WHERE trackId = ?')) {
      const [title, artist, thumbnailUrl, trackId] = params;
      let changes = 0;
      for (const h of this.playbackHistory) {
        if (h.trackId === trackId) {
          h.title = title;
          h.artist = artist;
          h.thumbnailUrl = thumbnailUrl;
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }

    if (cleanSql.includes('UPDATE playback_history SET')) {
      const [title, artist, duration, thumbnailUrl, playedAt, id] = params;
      const item = this.playbackHistory.find((h) => h.id === id);
      if (item) {
        item.title = title;
        item.artist = artist;
        item.duration = duration;
        item.thumbnailUrl = thumbnailUrl;
        item.playedAt = playedAt;
      }
      return { lastInsertRowId: 0, changes: item ? 1 : 0 };
    }

    // 9. Insert (or replace) into playback_history
    if (
      cleanSql.includes('INSERT INTO playback_history') ||
      cleanSql.includes('INSERT OR REPLACE INTO playback_history')
    ) {
      const [id, trackId, title, artist, duration, thumbnailUrl, playedAt] = params;
      const entry = {
        id,
        trackId,
        title,
        artist,
        duration,
        thumbnailUrl,
        playedAt,
      };
      const existingIdx = this.playbackHistory.findIndex((h) => h.id === id);
      if (existingIdx >= 0) {
        this.playbackHistory[existingIdx] = entry;
      } else {
        this.playbackHistory.push(entry);
      }
      return { lastInsertRowId: 1, changes: 1 };
    }

    // 10. Delete playback_history retention limit
    if (cleanSql.includes('DELETE FROM playback_history WHERE id NOT IN')) {
      this.playbackHistory.sort((a, b) => b.playedAt - a.playedAt);
      if (this.playbackHistory.length > 500) {
        this.playbackHistory = this.playbackHistory.slice(0, 500);
      }
      return { lastInsertRowId: 0, changes: 1 };
    }

    // 10b. Delete specific track from playback_history
    if (cleanSql.includes('DELETE FROM playback_history WHERE trackId = ?')) {
      const [trackId] = params;
      const prevLen = this.playbackHistory.length;
      this.playbackHistory = this.playbackHistory.filter((h) => h.trackId !== trackId);
      return { lastInsertRowId: 0, changes: prevLen - this.playbackHistory.length };
    }

    // 11. Clear playback_history
    if (cleanSql.includes('DELETE FROM playback_history')) {
      const count = this.playbackHistory.length;
      this.playbackHistory = [];
      return { lastInsertRowId: 0, changes: count };
    }

    // 12. App settings insert or replace
    if (cleanSql.includes('INSERT OR REPLACE INTO app_settings')) {
      const [key, value] = params.length === 1 ? ['playback_session', params[0]] : params;
      this.appSettings.set(key, value);
      return { lastInsertRowId: 1, changes: 1 };
    }

    // 13. Lyrics cache insert or replace
    if (cleanSql.includes('INSERT OR REPLACE INTO lyrics_cache')) {
      const [trackId, type, payload, updatedAt] = params;
      this.lyricsCache.set(trackId, { trackId, type, payload, updatedAt });
      return { lastInsertRowId: 1, changes: 1 };
    }

    // 14. Download queue persistence
    if (cleanSql.includes('INSERT OR REPLACE INTO download_queue')) {
      const [
        trackId,
        title,
        artist,
        duration,
        thumbnailUrl,
        status,
        progress,
        error,
        streamUrl,
        headersJson,
        position,
        createdAt,
        updatedAt,
      ] = params;
      this.downloadQueue.set(trackId, {
        trackId,
        title,
        artist,
        duration,
        thumbnailUrl: thumbnailUrl || '',
        status,
        progress,
        error: error || null,
        streamUrl: streamUrl || null,
        headersJson: headersJson || null,
        position,
        createdAt,
        updatedAt,
      });
      return { lastInsertRowId: 1, changes: 1 };
    }

    if (
      cleanSql.includes("UPDATE download_queue SET status = 'pending', progress = 0") &&
      cleanSql.includes("WHERE status = 'downloading'")
    ) {
      const [updatedAt] = params;
      let changes = 0;
      for (const item of this.downloadQueue.values()) {
        if (item.status === 'downloading') {
          item.status = 'pending';
          item.progress = 0;
          item.updatedAt = updatedAt;
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }

    if (cleanSql.includes('UPDATE download_queue SET status = ?, progress = ?, error = ?, updatedAt = ? WHERE trackId = ?')) {
      const [status, progress, error, updatedAt, trackId] = params;
      const item = this.downloadQueue.get(trackId);
      if (item) {
        item.status = status;
        item.progress = progress;
        item.error = error || null;
        item.updatedAt = updatedAt;
      }
      return { lastInsertRowId: 0, changes: item ? 1 : 0 };
    }

    if (cleanSql.includes('DELETE FROM download_queue WHERE trackId = ?')) {
      const [trackId] = params;
      const deleted = this.downloadQueue.delete(trackId);
      return { lastInsertRowId: 0, changes: deleted ? 1 : 0 };
    }

    if (cleanSql.includes("DELETE FROM download_queue WHERE status IN ('completed', 'error')")) {
      let changes = 0;
      for (const [k, v] of this.downloadQueue.entries()) {
        if (v.status === 'completed' || v.status === 'error') {
          this.downloadQueue.delete(k);
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }

    if (cleanSql.includes("DELETE FROM download_queue WHERE status = 'completed'")) {
      let changes = 0;
      for (const [k, v] of this.downloadQueue.entries()) {
        if (v.status === 'completed') {
          this.downloadQueue.delete(k);
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }

    if (cleanSql.includes("DELETE FROM download_queue WHERE status IN ('pending', 'downloading')")) {
      let changes = 0;
      for (const [k, v] of this.downloadQueue.entries()) {
        if (v.status === 'pending' || v.status === 'downloading') {
          this.downloadQueue.delete(k);
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }

    if (cleanSql.includes('DELETE FROM playlist_tracks WHERE trackId = ?')) {
      const [trackId] = params;
      const prevLen = this.playlistTracks.length;
      this.playlistTracks = this.playlistTracks.filter((t) => t.trackId !== trackId);
      return { lastInsertRowId: 0, changes: prevLen - this.playlistTracks.length };
    }

    if (cleanSql.includes('UPDATE playlist_tracks SET title = ?, artist = ?, thumbnailUrl = ? WHERE trackId = ?')) {
      const [title, artist, thumbnailUrl, trackId] = params;
      let changes = 0;
      for (const t of this.playlistTracks) {
        if (t.trackId === trackId) {
          t.title = title;
          t.artist = artist;
          t.thumbnailUrl = thumbnailUrl;
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }

    // 15. Local device tracks CRUD
    if (cleanSql.includes('INSERT OR REPLACE INTO local_device_tracks')) {
      const [
        id,
        mediaStoreId,
        contentUri,
        fileName,
        folderName,
        relativePath,
        mimeType,
        fileSize,
        dateModified,
        title,
        artist,
        album,
        duration,
        artworkUri,
        customTitle,
        customArtist,
        customArtworkUri,
        isCorrupted,
        corruptionReason,
        isHidden,
        scannedAt,
      ] = params;
      this.localDeviceTracks.set(id, {
        id,
        mediaStoreId,
        contentUri,
        fileName,
        folderName,
        relativePath,
        mimeType,
        fileSize,
        dateModified,
        title,
        artist,
        album,
        duration,
        artworkUri,
        customTitle,
        customArtist,
        customArtworkUri,
        isCorrupted,
        corruptionReason,
        isHidden,
        scannedAt,
      });
      return { lastInsertRowId: 1, changes: 1 };
    }

    if (cleanSql.includes('UPDATE local_device_tracks SET customTitle = ?, customArtist = ?, customArtworkUri = ? WHERE id = ?')) {
      const [customTitle, customArtist, customArtworkUri, id] = params;
      const item = this.localDeviceTracks.get(id);
      if (item) {
        item.customTitle = customTitle;
        item.customArtist = customArtist;
        item.customArtworkUri = customArtworkUri;
      }
      return { lastInsertRowId: 0, changes: item ? 1 : 0 };
    }

    if (cleanSql.includes('UPDATE local_device_tracks SET isCorrupted = 0, corruptionReason = NULL, title = ?, artist = ?, album = ?, duration = ?, artworkUri = ? WHERE id = ?')) {
      const [title, artist, album, duration, artworkUri, id] = params;
      const item = this.localDeviceTracks.get(id);
      if (item) {
        item.isCorrupted = 0;
        item.corruptionReason = null;
        item.title = title;
        item.artist = artist;
        item.album = album;
        item.duration = duration;
        item.artworkUri = artworkUri;
      }
      return { lastInsertRowId: 0, changes: item ? 1 : 0 };
    }

    if (cleanSql.includes('UPDATE local_device_tracks SET isCorrupted = ?, corruptionReason = ? WHERE id = ?')) {
      const [isCorrupted, corruptionReason, id] = params;
      const item = this.localDeviceTracks.get(id);
      if (item) {
        item.isCorrupted = isCorrupted;
        item.corruptionReason = corruptionReason;
      }
      return { lastInsertRowId: 0, changes: item ? 1 : 0 };
    }

    if (cleanSql.includes('UPDATE local_device_tracks SET isHidden = ? WHERE id = ?')) {
      const [isHidden, id] = params;
      const item = this.localDeviceTracks.get(id);
      if (item) {
        item.isHidden = isHidden;
      }
      return { lastInsertRowId: 0, changes: item ? 1 : 0 };
    }

    if (cleanSql.includes('UPDATE local_device_tracks SET isHidden = 0 WHERE isHidden = 1')) {
      let changes = 0;
      for (const item of this.localDeviceTracks.values()) {
        if (item.isHidden) {
          item.isHidden = 0;
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }

    if (cleanSql.includes('DELETE FROM local_device_tracks WHERE id = ?')) {
      const [id] = params;
      const deleted = this.localDeviceTracks.delete(id);
      return { lastInsertRowId: 0, changes: deleted ? 1 : 0 };
    }

    return { lastInsertRowId: 0, changes: 0 };
  }

  async getAllAsync(sql, params = []) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    // 1. Downloaded tracks list
    if (cleanSql.includes('FROM downloaded_tracks') && cleanSql.includes('ORDER BY downloadedAt DESC')) {
      return Array.from(this.downloadedTracks.values()).sort(
        (a, b) => b.downloadedAt - a.downloadedAt
      );
    }

    // 2. Downloaded tracks IN (...)
    if (cleanSql.includes('FROM downloaded_tracks WHERE id IN')) {
      return params
        .filter((id) => this.downloadedTracks.has(id))
        .map((id) => ({ id }));
    }

    // 3. Playlists list with track count and total duration
    if (cleanSql.includes('FROM playlists p LEFT JOIN playlist_tracks pt')) {
      const result = [];
      for (const p of this.playlists.values()) {
        const pTracks = this.playlistTracks
          .filter((t) => t.playlistId === p.id)
          .sort((a, b) => a.position - b.position);
        const trackCount = pTracks.length;
        const totalDuration = pTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
        const firstTrackThumbnail = pTracks.length > 0 ? pTracks[0].thumbnailUrl : null;

        result.push({
          id: p.id,
          name: p.name,
          description: p.description,
          thumbnailUrl: p.thumbnailUrl,
          isSystem: p.isSystem,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          trackCount,
          totalDuration,
          firstTrackThumbnail,
        });
      }

      // ORDER BY p.isSystem DESC, p.updatedAt DESC
      result.sort((a, b) => {
        if (b.isSystem !== a.isSystem) return b.isSystem - a.isSystem;
        return b.updatedAt - a.updatedAt;
      });
      return result;
    }

    // 4b. Playlist thumbnails ordered for 2x2 collage calculation
    if (
      cleanSql.includes('FROM playlist_tracks') &&
      cleanSql.includes('ORDER BY playlistId ASC, position ASC')
    ) {
      if (cleanSql.includes('SELECT playlistId, trackId, duration FROM playlist_tracks')) {
        return [...this.playlistTracks]
          .sort((a, b) => {
            if (a.playlistId !== b.playlistId) {
              return a.playlistId.localeCompare(b.playlistId);
            }
            return a.position - b.position;
          })
          .map((t) => ({
            playlistId: t.playlistId,
            trackId: t.trackId,
            duration: t.duration,
          }));
      }
      return [...this.playlistTracks]
        .filter((t) => Boolean(t.thumbnailUrl))
        .sort((a, b) => {
          if (a.playlistId !== b.playlistId) {
            return a.playlistId.localeCompare(b.playlistId);
          }
          return a.position - b.position;
        })
        .map((t) => ({
          playlistId: t.playlistId,
          thumbnailUrl: t.thumbnailUrl,
          position: t.position,
        }));
    }

    // 4. Playlist tracks for specific playlist
    if (cleanSql.includes('FROM playlist_tracks pt') && cleanSql.includes('WHERE pt.playlistId = ?')) {
      const [playlistId] = params;
      const tracks = this.playlistTracks
        .filter((t) => t.playlistId === playlistId)
        .sort((a, b) => a.position - b.position)
        .map((t) => {
          const dl = this.downloadedTracks.get(t.trackId);
          const ldt = this.localDeviceTracks.get(t.trackId);
          const validLocal = ldt && !ldt.isCorrupted && !ldt.isHidden ? ldt : null;
          return {
            playlistId: t.playlistId,
            trackId: t.trackId,
            title: (ldt && ldt.customTitle) || t.title,
            artist: (ldt && ldt.customArtist) || t.artist,
            duration: t.duration,
            thumbnailUrl: (ldt && (ldt.customArtworkUri || ldt.artworkUri)) || t.thumbnailUrl,
            position: t.position,
            addedAt: t.addedAt,
            localUri: dl ? dl.localUri : validLocal ? validLocal.contentUri : null,
            isDownloaded: dl || validLocal ? 1 : 0,
            isLocalDevice: ldt ? 1 : 0,
            isCorrupted: ldt ? ldt.isCorrupted : 0,
            corruptionReason: ldt ? ldt.corruptionReason : null,
          };
        });
      return tracks;
    }

    // 8. Local device tracks list
    if (cleanSql.includes('FROM local_device_tracks')) {
      return Array.from(this.localDeviceTracks.values()).sort((a, b) => {
        if (b.dateModified !== a.dateModified) return b.dateModified - a.dateModified;
        return b.scannedAt - a.scannedAt;
      });
    }

    // 5. Favorite tracks IN (...)
    if (cleanSql.includes('WHERE playlistId = ? AND trackId IN')) {
      const [favId, ...ids] = params;
      const favTracks = this.playlistTracks.filter(
        (t) => t.playlistId === favId && ids.includes(t.trackId)
      );
      return favTracks.map((t) => ({ trackId: t.trackId }));
    }

    // 6. Playback history list
    if (cleanSql.includes('FROM playback_history ORDER BY playedAt DESC')) {
      const limit = params[0] || 50;
      const sorted = [...this.playbackHistory].sort((a, b) => b.playedAt - a.playedAt);
      return sorted.slice(0, limit);
    }

    // 7. Persisted download queue list
    if (cleanSql.includes('FROM download_queue')) {
      return Array.from(this.downloadQueue.values()).sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.createdAt - b.createdAt;
      });
    }

    return [];
  }

  async getFirstAsync(sql, params = []) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    // 1. Downloaded track by id
    if (cleanSql.includes('FROM downloaded_tracks WHERE id = ?')) {
      const [id] = params;
      const track = this.downloadedTracks.get(id);
      return track ? { ...track } : null;
    }

    // 2. Playlist by id
    if (cleanSql.includes('FROM playlists WHERE id = ?')) {
      const [id] = params;
      const pl = this.playlists.get(id);
      return pl ? { ...pl } : null;
    }

    // 3. Track position in playlist
    if (cleanSql.includes('SELECT position FROM playlist_tracks WHERE playlistId = ? AND trackId = ?')) {
      const [playlistId, trackId] = params;
      const track = this.playlistTracks.find(
        (t) => t.playlistId === playlistId && t.trackId === trackId
      );
      return track ? { position: track.position } : null;
    }

    // 4. Next position (MAX(position) + 1)
    if (cleanSql.includes('MAX(position)')) {
      if (cleanSql.includes('FROM download_queue')) {
        const items = Array.from(this.downloadQueue.values());
        if (items.length === 0) return { nextPos: 0 };
        return { nextPos: Math.max(...items.map((i) => i.position)) + 1 };
      }
      const [playlistId] = params;
      const tracks = this.playlistTracks.filter((t) => t.playlistId === playlistId);
      if (tracks.length === 0) {
        return { nextPos: 0 };
      }
      const maxPos = Math.max(...tracks.map((t) => t.position));
      return { nextPos: maxPos + 1 };
    }

    // 5. Favorite track check
    if (cleanSql.includes('SELECT trackId FROM playlist_tracks WHERE playlistId = ? AND trackId = ?')) {
      const [playlistId, trackId] = params;
      const fav = this.playlistTracks.find(
        (t) => t.playlistId === playlistId && t.trackId === trackId
      );
      return fav ? { trackId: fav.trackId } : null;
    }

    // 6. Playback history item by trackId
    if (cleanSql.includes('FROM playback_history WHERE trackId = ?')) {
      const [trackId] = params;
      const item = this.playbackHistory.find((h) => h.trackId === trackId);
      return item ? { id: item.id } : null;
    }

    // 7. App settings by key
    if (cleanSql.includes('FROM app_settings WHERE key =')) {
      const key = params[0] || 'playback_session';
      const value = this.appSettings.get(key);
      return value !== undefined ? { value } : null;
    }

    // 8. Lyrics cache by trackId
    if (cleanSql.includes('FROM lyrics_cache WHERE trackId = ?')) {
      const [trackId] = params;
      const entry = this.lyricsCache.get(trackId);
      return entry ? { ...entry } : null;
    }

    // 9. Local device track by id
    if (cleanSql.includes('FROM local_device_tracks WHERE id = ?')) {
      const [id] = params;
      const entry = this.localDeviceTracks.get(id);
      return entry ? { ...entry } : null;
    }

    return null;
  }
}

const dbInstance = new InMemorySQLiteDatabase();

async function openDatabaseAsync(name) {
  return dbInstance;
}

module.exports = {
  InMemorySQLiteDatabase,
  dbInstance,
  openDatabaseAsync,
};
