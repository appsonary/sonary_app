const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');

const WORK_MANAGER_DEP = 'implementation("androidx.work:work-runtime-ktx:2.9.0")';
const FGS_DATA_SYNC_PERM = 'android.permission.FOREGROUND_SERVICE_DATA_SYNC';
const WORK_FGS_SERVICE = 'androidx.work.impl.foreground.SystemForegroundService';
const CANCEL_RECEIVER = 'com.sonarypro.app.downloads.SonaryDownloadCancelReceiver';
const PACKAGE_IMPORT = 'import com.sonarypro.app.downloads.SonaryDownloadPackage';

const KOTLIN_FILES = {
  'SonaryDownloadEvents.kt': `package com.sonarypro.app.downloads

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class ResolvedAudioStream(
  val url: String,
  val headers: Map<String, String>,
)

data class StreamBridgeResponse(
  val streamUrl: String?,
  val headersJson: String?,
  val error: String?,
)

object SonaryDownloadEvents {
  const val EVENT_NAME = "SonaryDownloadQueueChanged"

  @Volatile
  private var reactContext: ReactApplicationContext? = null

  private val cancelledTrackIds = ConcurrentHashMap.newKeySet<String>()
  private val pendingStreamRequests = ConcurrentHashMap<String, CompletableDeferred<StreamBridgeResponse>>()

  @Volatile
  var cancelAllRequested: Boolean = false

  @Volatile
  var isWorkerRunning: Boolean = false

  fun attachReactContext(context: ReactApplicationContext) {
    reactContext = context
  }

  fun hasActiveJsRuntime(): Boolean {
    val ctx = reactContext ?: return false
    return try {
      ctx.hasActiveReactInstance()
    } catch (_: Throwable) {
      false
    }
  }

  fun markTrackCancelled(trackId: String) {
    if (trackId.isNotEmpty()) {
      cancelledTrackIds.add(trackId)
    }
  }

  fun clearTrackCancelled(trackId: String) {
    cancelledTrackIds.remove(trackId)
  }

  fun isTrackCancelled(trackId: String): Boolean {
    return cancelAllRequested || cancelledTrackIds.contains(trackId)
  }

  fun clearAllCancellations() {
    cancelAllRequested = false
    cancelledTrackIds.clear()
    for ((id, deferred) in pendingStreamRequests.entries) {
      if (pendingStreamRequests.remove(id, deferred)) {
        deferred.cancel()
      }
    }
  }

  suspend fun requestStreamFromJs(
    trackId: String,
    forceRefresh: Boolean,
    timeoutMs: Long = 15_000L,
  ): StreamBridgeResponse? {
    if (!hasActiveJsRuntime()) return null
    val requestId = UUID.randomUUID().toString()
    val deferred = CompletableDeferred<StreamBridgeResponse>()
    pendingStreamRequests[requestId] = deferred

    val map = Arguments.createMap().apply {
      putString("type", "needStream")
      putString("requestId", requestId)
      putString("trackId", trackId)
      putBoolean("forceRefresh", forceRefresh)
    }
    emit(map)

    return try {
      withTimeoutOrNull(timeoutMs) {
        deferred.await()
      }
    } finally {
      pendingStreamRequests.remove(requestId)
    }
  }

  fun completeStreamRequest(
    requestId: String,
    streamUrl: String?,
    headersJson: String?,
    error: String?,
  ) {
    val deferred = pendingStreamRequests.remove(requestId) ?: return
    deferred.complete(
      StreamBridgeResponse(
        streamUrl = streamUrl,
        headersJson = headersJson,
        error = error,
      ),
    )
  }

  fun emitProgress(trackId: String, progress: Double) {
    val map = Arguments.createMap().apply {
      putString("type", "progress")
      putString("trackId", trackId)
      putDouble("progress", progress)
    }
    emit(map)
  }

  fun emitCompleted(
    trackId: String,
    title: String,
    artist: String,
    duration: Int,
    thumbnailUrl: String,
    localAudioUri: String,
    localArtworkUri: String?,
    downloadedAt: Long,
  ) {
    val map = Arguments.createMap().apply {
      putString("type", "completed")
      putString("trackId", trackId)
      putString("title", title)
      putString("artist", artist)
      putInt("duration", duration)
      putString("thumbnailUrl", thumbnailUrl)
      putString("localAudioUri", localAudioUri)
      if (localArtworkUri != null) {
        putString("localArtworkUri", localArtworkUri)
      }
      putDouble("downloadedAt", downloadedAt.toDouble())
    }
    emit(map)
  }

  fun emitError(trackId: String, message: String) {
    val map = Arguments.createMap().apply {
      putString("type", "error")
      putString("trackId", trackId)
      putString("error", message)
    }
    emit(map)
  }

  fun emitCancelled(trackId: String) {
    val map = Arguments.createMap().apply {
      putString("type", "cancelled")
      putString("trackId", trackId)
    }
    emit(map)
  }

  fun emitSync() {
    val map = Arguments.createMap().apply {
      putString("type", "sync")
    }
    emit(map)
  }

  private fun emit(params: WritableMap) {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    try {
      ctx
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, params)
    } catch (_: Throwable) {
      // Ignora quando o bridge JS está sendo desmontado
    }
  }
}
`,

  'SonaryDownloadDb.kt': `package com.sonarypro.app.downloads

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class QueuedTrackRecord(
  val trackId: String,
  val title: String,
  val artist: String,
  val duration: Int,
  val thumbnailUrl: String,
  val status: String,
  val progress: Double,
  val error: String?,
  val localAudioUri: String?,
  val localArtworkUri: String?,
  val downloadedAt: Long?,
  val streamUrl: String?,
  val headersJson: String?,
)

data class QueuedTrackInput(
  val trackId: String,
  val title: String,
  val artist: String,
  val duration: Int,
  val thumbnailUrl: String,
  val streamUrl: String? = null,
  val headersJson: String? = null,
)

class SonaryDownloadDb private constructor(
  context: Context,
) : SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  override fun onConfigure(db: SQLiteDatabase) {
    super.onConfigure(db)
    db.enableWriteAheadLogging()
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS download_queue (
        trackId TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration INTEGER NOT NULL,
        thumbnailUrl TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        localAudioUri TEXT,
        localArtworkUri TEXT,
        downloadedAt INTEGER,
        streamUrl TEXT,
        headersJson TEXT,
        position INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      """.trimIndent(),
    )
    db.execSQL(
      "CREATE INDEX IF NOT EXISTS idx_download_queue_pos ON download_queue(position ASC, createdAt ASC);",
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    onCreate(db)
    if (oldVersion < 2) {
      ensureColumnExists(db, "download_queue", "streamUrl", "TEXT")
      ensureColumnExists(db, "download_queue", "headersJson", "TEXT")
    }
  }

  private fun ensureColumnExists(
    db: SQLiteDatabase,
    table: String,
    column: String,
    definition: String,
  ) {
    var exists = false
    db.rawQuery("PRAGMA table_info(\$table)", null).use { cursor ->
      val nameIdx = cursor.getColumnIndex("name")
      while (cursor.moveToNext()) {
        if (nameIdx >= 0 && cursor.getString(nameIdx) == column) {
          exists = true
          break
        }
      }
    }
    if (!exists) {
      db.execSQL("ALTER TABLE \$table ADD COLUMN \$column \$definition;")
    }
  }

  @Synchronized
  fun enqueueBatch(items: List<QueuedTrackInput>) {
    if (items.isEmpty()) return
    val db = writableDatabase
    val now = System.currentTimeMillis()
    var nextPos = 0
    db.rawQuery("SELECT COALESCE(MAX(position), -1) + 1 FROM download_queue", null).use { c ->
      if (c.moveToFirst()) nextPos = c.getInt(0)
    }

    db.beginTransaction()
    try {
      for (item in items) {
        val values = ContentValues().apply {
          put("trackId", item.trackId)
          put("title", item.title.ifBlank { "Música" })
          put("artist", item.artist.ifBlank { "Artista" })
          put("duration", item.duration.coerceAtLeast(0))
          put("thumbnailUrl", item.thumbnailUrl)
          put("status", "pending")
          put("progress", 0.0)
          putNull("error")
          putNull("localAudioUri")
          putNull("localArtworkUri")
          putNull("downloadedAt")
          if (!item.streamUrl.isNullOrBlank()) put("streamUrl", item.streamUrl) else putNull("streamUrl")
          if (!item.headersJson.isNullOrBlank()) put("headersJson", item.headersJson) else putNull("headersJson")
          put("position", nextPos++)
          put("createdAt", now)
          put("updatedAt", now)
        }
        db.insertWithOnConflict("download_queue", null, values, SQLiteDatabase.CONFLICT_REPLACE)
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  @Synchronized
  fun updateStreamInfo(trackId: String, streamUrl: String, headersJson: String?) {
    val values = ContentValues().apply {
      put("streamUrl", streamUrl)
      if (!headersJson.isNullOrBlank()) put("headersJson", headersJson) else putNull("headersJson")
      put("updatedAt", System.currentTimeMillis())
    }
    writableDatabase.update("download_queue", values, "trackId = ?", arrayOf(trackId))
  }

  @Synchronized
  fun clearStreamInfo(trackId: String) {
    val values = ContentValues().apply {
      putNull("streamUrl")
      putNull("headersJson")
      put("updatedAt", System.currentTimeMillis())
    }
    writableDatabase.update("download_queue", values, "trackId = ?", arrayOf(trackId))
  }

  @Synchronized
  fun getQueueSnapshot(): List<QueuedTrackRecord> {
    val db = readableDatabase
    val result = mutableListOf<QueuedTrackRecord>()
    db.rawQuery(
      """
      SELECT trackId, title, artist, duration, thumbnailUrl, status, progress, error,
             localAudioUri, localArtworkUri, downloadedAt, streamUrl, headersJson
      FROM download_queue
      ORDER BY position ASC, createdAt ASC
      """.trimIndent(),
      null,
    ).use { cursor ->
      while (cursor.moveToNext()) {
        result.add(
          QueuedTrackRecord(
            trackId = cursor.getString(0),
            title = cursor.getString(1) ?: "Música",
            artist = cursor.getString(2) ?: "Artista",
            duration = cursor.getInt(3),
            thumbnailUrl = cursor.getString(4) ?: "",
            status = cursor.getString(5) ?: "pending",
            progress = cursor.getDouble(6),
            error = cursor.getString(7),
            localAudioUri = cursor.getString(8),
            localArtworkUri = cursor.getString(9),
            downloadedAt = if (cursor.isNull(10)) null else cursor.getLong(10),
            streamUrl = cursor.getString(11),
            headersJson = cursor.getString(12),
          ),
        )
      }
    }
    return result
  }

  @Synchronized
  fun resetInterruptedToPending() {
    val values = ContentValues().apply {
      put("status", "pending")
      put("progress", 0.0)
      put("updatedAt", System.currentTimeMillis())
    }
    writableDatabase.update("download_queue", values, "status = ?", arrayOf("downloading"))
  }

  @Synchronized
  fun nextPendingItem(requireStreamUrl: Boolean = false): QueuedTrackRecord? {
    val whereClause = if (requireStreamUrl) {
      "status = 'pending' AND streamUrl IS NOT NULL AND streamUrl != ''"
    } else {
      "status = 'pending'"
    }
    readableDatabase.rawQuery(
      """
      SELECT trackId, title, artist, duration, thumbnailUrl, status, progress, error,
             localAudioUri, localArtworkUri, downloadedAt, streamUrl, headersJson
      FROM download_queue
      WHERE \$whereClause
      ORDER BY position ASC, createdAt ASC
      LIMIT 1
      """.trimIndent(),
      null,
    ).use { cursor ->
      if (!cursor.moveToFirst()) return null
      return QueuedTrackRecord(
        trackId = cursor.getString(0),
        title = cursor.getString(1) ?: "Música",
        artist = cursor.getString(2) ?: "Artista",
        duration = cursor.getInt(3),
        thumbnailUrl = cursor.getString(4) ?: "",
        status = cursor.getString(5) ?: "pending",
        progress = cursor.getDouble(6),
        error = cursor.getString(7),
        localAudioUri = cursor.getString(8),
        localArtworkUri = cursor.getString(9),
        downloadedAt = if (cursor.isNull(10)) null else cursor.getLong(10),
        streamUrl = cursor.getString(11),
        headersJson = cursor.getString(12),
      )
    }
  }

  @Synchronized
  fun countActiveAndPending(): Int {
    readableDatabase.rawQuery(
      "SELECT COUNT(*) FROM download_queue WHERE status IN ('pending', 'downloading')",
      null,
    ).use { c ->
      return if (c.moveToFirst()) c.getInt(0) else 0
    }
  }

  @Synchronized
  fun updateQueueState(trackId: String, status: String, progress: Double, error: String?) {
    val values = ContentValues().apply {
      put("status", status)
      put("progress", progress)
      if (error != null) put("error", error) else putNull("error")
      put("updatedAt", System.currentTimeMillis())
    }
    writableDatabase.update("download_queue", values, "trackId = ?", arrayOf(trackId))
  }

  @Synchronized
  fun markCompleted(
    trackId: String,
    localAudioUri: String,
    localArtworkUri: String?,
    downloadedAt: Long,
  ) {
    val values = ContentValues().apply {
      put("status", "completed")
      put("progress", 1.0)
      putNull("error")
      put("localAudioUri", localAudioUri)
      if (localArtworkUri != null) put("localArtworkUri", localArtworkUri) else putNull("localArtworkUri")
      put("downloadedAt", downloadedAt)
      put("updatedAt", System.currentTimeMillis())
    }
    writableDatabase.update("download_queue", values, "trackId = ?", arrayOf(trackId))
  }

  @Synchronized
  fun removeQueueItem(trackId: String) {
    writableDatabase.delete("download_queue", "trackId = ?", arrayOf(trackId))
  }

  @Synchronized
  fun clearActiveItems() {
    writableDatabase.delete("download_queue", "status IN ('pending', 'downloading')", null)
  }

  @Synchronized
  fun clearFinishedItems() {
    writableDatabase.delete("download_queue", "status IN ('completed', 'error')", null)
  }

  @Synchronized
  fun clearCompletedItems() {
    writableDatabase.delete("download_queue", "status = 'completed'", null)
  }

  companion object {
    private const val DB_NAME = "sonary_downloads.db"
    private const val DB_VERSION = 2

    @Volatile
    private var instance: SonaryDownloadDb? = null

    fun getInstance(context: Context): SonaryDownloadDb {
      return instance ?: synchronized(this) {
        instance ?: SonaryDownloadDb(context).also { instance = it }
      }
    }
  }
}
`,

  'SonaryDownloadCancelReceiver.kt': `package com.sonarypro.app.downloads

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager

class SonaryDownloadCancelReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    SonaryDownloadEvents.cancelAllRequested = true
    SonaryDownloadEvents.isWorkerRunning = false
    System.setProperty("sonary.downloads.running", "false")
    try {
      SonaryDownloadDb.getInstance(context.applicationContext).clearActiveItems()
    } catch (_: Throwable) {
    }
    WorkManager.getInstance(context.applicationContext)
      .cancelUniqueWork(SonaryDownloadWorker.UNIQUE_WORK_NAME)
    SonaryDownloadEvents.emitSync()
  }
}
`,

  'SonaryDownloadWorker.kt': `package com.sonarypro.app.downloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class SonaryDownloadWorker(
  appContext: Context,
  workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

  private class DownloadAbortedException : RuntimeException("Download cancelado")
  private class StreamPendingJsException : RuntimeException("Aguardando sessão do app para resolver stream")

  private val db = SonaryDownloadDb.getInstance(appContext)
  private val notificationManager =
    appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override suspend fun getForegroundInfo(): ForegroundInfo {
    return buildForegroundInfo("Preparando downloads...", null, 0, true)
  }

  private suspend fun trySetForegroundSafely(info: ForegroundInfo) {
    try {
      setForeground(info)
    } catch (_: Throwable) {
      try {
        notificationManager.notify(NOTIFICATION_ID, info.notification)
      } catch (_: Throwable) {
      }
    }
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val powerManager = applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    val wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "Sonary:DownloadWakeLock",
    )
    wakeLock.setReferenceCounted(false)
    wakeLock.acquire(30 * 60 * 1000L)
    SonaryDownloadEvents.isWorkerRunning = true
    System.setProperty("sonary.downloads.running", "true")

    try {
      ensureNotificationChannel()
      db.resetInterruptedToPending()

      val tracksDir = File(applicationContext.filesDir, "tracks").apply { mkdirs() }
      val thumbsDir = File(applicationContext.filesDir, "thumbnails").apply { mkdirs() }

      var processedCount = 0
      var pausedForJs = false

      do {
        SonaryDownloadEvents.isWorkerRunning = true
        System.setProperty("sonary.downloads.running", "true")

        while (!isStopped && !SonaryDownloadEvents.cancelAllRequested) {
          val item = db.nextPendingItem(requireStreamUrl = !SonaryDownloadEvents.hasActiveJsRuntime()) ?: break
          val remaining = db.countActiveAndPending()
          val totalBatch = processedCount + remaining

          if (SonaryDownloadEvents.isTrackCancelled(item.trackId)) {
            SonaryDownloadEvents.clearTrackCancelled(item.trackId)
            db.removeQueueItem(item.trackId)
            SonaryDownloadEvents.emitCancelled(item.trackId)
            continue
          }

          val finalAudioFile = File(tracksDir, "\${item.trackId}.m4a")
          val partAudioFile = File(tracksDir, "\${item.trackId}.part")
          val finalThumbFile = File(thumbsDir, "\${item.trackId}.jpg")
          val partThumbFile = File(thumbsDir, "\${item.trackId}.part.jpg")

          if (finalAudioFile.exists() && finalAudioFile.length() > MIN_AUDIO_BYTES) {
            val localUri = Uri.fromFile(finalAudioFile).toString()
            val savedArtUri = if (finalThumbFile.exists() && finalThumbFile.length() > 100L) {
              Uri.fromFile(finalThumbFile).toString()
            } else {
              null
            }
            val effectiveThumb = savedArtUri ?: item.thumbnailUrl
            val nowMs = System.currentTimeMillis()
            db.markCompleted(item.trackId, localUri, savedArtUri, nowMs)
            SonaryDownloadEvents.emitCompleted(
              trackId = item.trackId,
              title = item.title,
              artist = item.artist,
              duration = item.duration,
              thumbnailUrl = effectiveThumb,
              localAudioUri = localUri,
              localArtworkUri = savedArtUri,
              downloadedAt = nowMs,
            )
            processedCount += 1
            continue
          }

          db.updateQueueState(item.trackId, "downloading", 0.0, null)
          SonaryDownloadEvents.emitProgress(item.trackId, 0.0)
          trySetForegroundSafely(
            buildForegroundInfo(
              title = "Baixando \${processedCount + 1} de \$totalBatch",
              subtitle = item.title,
              progressPct = 0,
              indeterminate = true,
            ),
          )

          try {
            checkDiskSpace()
            downloadWithRetry(
              item = item,
              partAudioFile = partAudioFile,
              finalAudioFile = finalAudioFile,
              currentIndex = processedCount + 1,
              totalBatch = totalBatch,
            )

            if (isStopped || SonaryDownloadEvents.isTrackCancelled(item.trackId)) {
              throw DownloadAbortedException()
            }

            val savedArtUri = downloadThumbnail(item.thumbnailUrl, partThumbFile, finalThumbFile)
            val finalAudioUri = Uri.fromFile(finalAudioFile).toString()
            val effectiveThumb = savedArtUri ?: item.thumbnailUrl
            val nowMs = System.currentTimeMillis()

            db.markCompleted(item.trackId, finalAudioUri, savedArtUri, nowMs)
            SonaryDownloadEvents.emitCompleted(
              trackId = item.trackId,
              title = item.title,
              artist = item.artist,
              duration = item.duration,
              thumbnailUrl = effectiveThumb,
              localAudioUri = finalAudioUri,
              localArtworkUri = savedArtUri,
              downloadedAt = nowMs,
            )
            processedCount += 1
          } catch (_: DownloadAbortedException) {
            partAudioFile.delete()
            partThumbFile.delete()
            SonaryDownloadEvents.clearTrackCancelled(item.trackId)
            db.removeQueueItem(item.trackId)
            SonaryDownloadEvents.emitCancelled(item.trackId)
          } catch (_: StreamPendingJsException) {
            db.updateQueueState(item.trackId, "pending", 0.0, null)
            SonaryDownloadEvents.emitSync()
            pausedForJs = true
            break
          } catch (ce: CancellationException) {
            throw ce
          } catch (err: Throwable) {
            partAudioFile.delete()
            partThumbFile.delete()
            val msg = err.message ?: "Falha no download"
            db.updateQueueState(item.trackId, "error", 0.0, msg)
            SonaryDownloadEvents.emitError(item.trackId, msg)
            processedCount += 1
          }
        }

        SonaryDownloadEvents.isWorkerRunning = false
      } while (
        !pausedForJs &&
        !isStopped &&
        !SonaryDownloadEvents.cancelAllRequested &&
        db.nextPendingItem(requireStreamUrl = !SonaryDownloadEvents.hasActiveJsRuntime()) != null
      )

      if (SonaryDownloadEvents.cancelAllRequested) {
        db.clearActiveItems()
        SonaryDownloadEvents.clearAllCancellations()
        SonaryDownloadEvents.emitSync()
        Result.success()
      } else if (isStopped) {
        db.resetInterruptedToPending()
        SonaryDownloadEvents.emitSync()
        Result.retry()
      } else {
        Result.success()
      }
    } catch (_: CancellationException) {
      withContext(NonCancellable) {
        if (SonaryDownloadEvents.cancelAllRequested) {
          db.clearActiveItems()
          SonaryDownloadEvents.clearAllCancellations()
        } else {
          db.resetInterruptedToPending()
        }
        SonaryDownloadEvents.emitSync()
      }
      if (SonaryDownloadEvents.cancelAllRequested) Result.success() else Result.retry()
    } finally {
      SonaryDownloadEvents.isWorkerRunning = false
      System.setProperty("sonary.downloads.running", "false")
      if (wakeLock.isHeld) {
        wakeLock.release()
      }
    }
  }

  private fun checkDiskSpace() {
    val stat = StatFs(applicationContext.filesDir.absolutePath)
    val freeBytes = stat.availableBytes
    if (freeBytes < MIN_FREE_DISK_BYTES) {
      val freeMb = (freeBytes / (1024L * 1024L)).toInt()
      throw RuntimeException("Espaço em disco insuficiente (\$freeMb MB disponíveis).")
    }
  }

  private fun parseHeadersJson(headersJson: String?): Map<String, String> {
    if (headersJson.isNullOrBlank()) return emptyMap()
    return try {
      val json = JSONObject(headersJson)
      val map = mutableMapOf<String, String>()
      val keys = json.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        val value = json.optString(key, "")
        if (key.isNotBlank() && value.isNotBlank()) {
          map[key] = value
        }
      }
      map
    } catch (_: Throwable) {
      emptyMap()
    }
  }

  private suspend fun resolveStreamForItem(
    item: QueuedTrackRecord,
    forceRefresh: Boolean,
  ): ResolvedAudioStream {
    if (!forceRefresh && !item.streamUrl.isNullOrBlank()) {
      return ResolvedAudioStream(
        url = item.streamUrl,
        headers = parseHeadersJson(item.headersJson),
      )
    }

    val response = SonaryDownloadEvents.requestStreamFromJs(
      trackId = item.trackId,
      forceRefresh = forceRefresh,
    )
    if (response == null) {
      if (!forceRefresh) {
        throw StreamPendingJsException()
      }
      throw RuntimeException("Link temporário expirado em segundo plano. Abra o app para retomar.")
    }
    if (!response.error.isNullOrBlank() || response.streamUrl.isNullOrBlank()) {
      throw RuntimeException(response.error ?: "Falha ao resolver stream de áudio")
    }

    db.updateStreamInfo(item.trackId, response.streamUrl, response.headersJson)
    return ResolvedAudioStream(
      url = response.streamUrl,
      headers = parseHeadersJson(response.headersJson),
    )
  }

  private suspend fun downloadWithRetry(
    item: QueuedTrackRecord,
    partAudioFile: File,
    finalAudioFile: File,
    currentIndex: Int,
    totalBatch: Int,
  ) {
    val initialStream = resolveStreamForItem(item, forceRefresh = false)

    try {
      executeHttpDownload(item, initialStream, partAudioFile, finalAudioFile, currentIndex, totalBatch)
    } catch (firstErr: Throwable) {
      if (
        firstErr is DownloadAbortedException ||
        firstErr is StreamPendingJsException ||
        isStopped ||
        SonaryDownloadEvents.isTrackCancelled(item.trackId)
      ) {
        throw firstErr
      }
      // Remove .part potencialmente expirado, invalida stream persistido e solicita novo stream ao provedor JS
      partAudioFile.delete()
      db.clearStreamInfo(item.trackId)
      val freshStream = resolveStreamForItem(item, forceRefresh = true)
      executeHttpDownload(item, freshStream, partAudioFile, finalAudioFile, currentIndex, totalBatch)
    }
  }

  private suspend fun executeHttpDownload(
    item: QueuedTrackRecord,
    stream: ResolvedAudioStream,
    partAudioFile: File,
    finalAudioFile: File,
    currentIndex: Int,
    totalBatch: Int,
  ) {
    val existingBytes = if (partAudioFile.exists()) partAudioFile.length() else 0L
    val conn = (URL(stream.url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 15000
      readTimeout = 20000
      instanceFollowRedirects = true
      for ((headerKey, headerVal) in stream.headers) {
        if (headerKey.isNotBlank() && headerVal.isNotBlank()) {
          setRequestProperty(headerKey, headerVal)
        }
      }
      if (existingBytes > 0L) {
        setRequestProperty("Range", "bytes=\$existingBytes-")
      }
    }

    try {
      val status = conn.responseCode
      if (status !in 200..299) {
        throw RuntimeException("Servidor de mídia retornou HTTP \$status")
      }

      // Se o servidor retornar 200 OK (e não 206 Partial Content), isPartialResume = false
      // garante que FileOutputStream(partAudioFile, false) sobrescreva do byte 0.
      val isPartialResume = status == HttpURLConnection.HTTP_PARTIAL && existingBytes > 0L
      val offset = if (isPartialResume) existingBytes else 0L
      val contentLength = conn.contentLengthLong
      val totalExpected = if (contentLength > 0L) offset + contentLength else -1L

      var writtenTotal = offset
      var lastEmitTime = 0L
      var lastEmitPct = -1

      conn.inputStream.use { input ->
        FileOutputStream(partAudioFile, isPartialResume).use { output ->
          val buffer = ByteArray(16 * 1024)
          while (true) {
            if (isStopped || SonaryDownloadEvents.isTrackCancelled(item.trackId)) {
              throw DownloadAbortedException()
            }
            val read = input.read(buffer)
            if (read == -1) break
            output.write(buffer, 0, read)
            writtenTotal += read

            if (totalExpected > 0L) {
              val ratio = (writtenTotal.toDouble() / totalExpected.toDouble()).coerceIn(0.0, 1.0)
              val pct = (ratio * 100).toInt()
              val now = System.currentTimeMillis()
              if (pct != lastEmitPct && (now - lastEmitTime >= 350L || pct - lastEmitPct >= 3)) {
                lastEmitTime = now
                lastEmitPct = pct
                SonaryDownloadEvents.emitProgress(item.trackId, ratio)
                try {
                  notificationManager.notify(
                    NOTIFICATION_ID,
                    buildNotification(
                      title = "Baixando \$currentIndex de \$totalBatch",
                      subtitle = "\${item.title} • \$pct%",
                      progressPct = pct,
                      indeterminate = false,
                    ),
                  )
                } catch (_: Throwable) {
                }
              }
            }
          }
          output.flush()
        }
      }

      if (isStopped || SonaryDownloadEvents.isTrackCancelled(item.trackId)) {
        throw DownloadAbortedException()
      }

      val fileLen = partAudioFile.length()
      if (!partAudioFile.exists() || fileLen < MIN_AUDIO_BYTES) {
        throw RuntimeException("Arquivo baixado inválido ou vazio (\$fileLen bytes)")
      }
      if (totalExpected > 20480L && fileLen < (totalExpected * 0.95).toLong()) {
        throw RuntimeException("Download incompleto (\$fileLen de \$totalExpected bytes)")
      }

      if (finalAudioFile.exists()) finalAudioFile.delete()
      if (!partAudioFile.renameTo(finalAudioFile)) {
        partAudioFile.copyTo(finalAudioFile, overwrite = true)
        partAudioFile.delete()
      }
    } finally {
      conn.disconnect()
    }
  }

  private fun downloadThumbnail(urlStr: String, partFile: File, finalFile: File): String? {
    if (urlStr.isBlank() || !urlStr.startsWith("http")) return null
    return try {
      val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
        connectTimeout = 8000
        readTimeout = 8000
      }
      try {
        if (conn.responseCode !in 200..299) return null
        conn.inputStream.use { input ->
          FileOutputStream(partFile, false).use { output ->
            input.copyTo(output)
          }
        }
        if (partFile.exists() && partFile.length() > 100L) {
          if (finalFile.exists()) finalFile.delete()
          if (!partFile.renameTo(finalFile)) {
            partFile.copyTo(finalFile, overwrite = true)
            partFile.delete()
          }
          Uri.fromFile(finalFile).toString()
        } else {
          partFile.delete()
          null
        }
      } finally {
        conn.disconnect()
      }
    } catch (_: Throwable) {
      partFile.delete()
      null
    }
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Downloads em segundo plano",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Progresso da fila de downloads offline"
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      }
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(
    title: String,
    subtitle: String?,
    progressPct: Int,
    indeterminate: Boolean,
  ): Notification {
    ensureNotificationChannel()

    val openIntent = applicationContext.packageManager
      .getLaunchIntentForPackage(applicationContext.packageName)
      ?.let { intent ->
        PendingIntent.getActivity(
          applicationContext,
          0,
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }

    val cancelIntent = Intent(applicationContext, SonaryDownloadCancelReceiver::class.java)
    val cancelPendingIntent = PendingIntent.getBroadcast(
      applicationContext,
      1,
      cancelIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(title)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setProgress(100, progressPct.coerceIn(0, 100), indeterminate)
      .addAction(0, "Cancelar", cancelPendingIntent)
      .apply {
        if (!subtitle.isNullOrBlank()) setContentText(subtitle)
        if (openIntent != null) setContentIntent(openIntent)
      }

    return builder.build()
  }

  private fun buildForegroundInfo(
    title: String,
    subtitle: String?,
    progressPct: Int,
    indeterminate: Boolean,
  ): ForegroundInfo {
    val notification = buildNotification(title, subtitle, progressPct, indeterminate)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    const val UNIQUE_WORK_NAME = "sonary_download_queue"
    private const val CHANNEL_ID = "sonary_background_downloads"
    private const val NOTIFICATION_ID = 4201
    private const val MIN_AUDIO_BYTES = 10240L
    private const val MIN_FREE_DISK_BYTES = 25L * 1024L * 1024L
  }
}
`,

  'SonaryDownloadModule.kt': `package com.sonarypro.app.downloads

import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class SonaryDownloadModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val db = SonaryDownloadDb.getInstance(reactContext)

  init {
    SonaryDownloadEvents.attachReactContext(reactContext)
  }

  override fun getName(): String = "SonaryBackgroundDownloader"

  @ReactMethod
  fun addListener(eventName: String) {
    // Requerido pelo NativeEventEmitter do React Native
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Requerido pelo NativeEventEmitter do React Native
  }

  @ReactMethod
  fun enqueueItems(items: ReadableArray, promise: Promise) {
    try {
      SonaryDownloadEvents.cancelAllRequested = false
      val batch = mutableListOf<QueuedTrackInput>()
      for (i in 0 until items.size()) {
        val map = items.getMap(i) ?: continue
        val trackId = map.getString("trackId") ?: continue
        if (trackId.isBlank()) continue
        SonaryDownloadEvents.clearTrackCancelled(trackId)
        val durationVal = if (map.hasKey("duration") && !map.isNull("duration")) {
          map.getInt("duration")
        } else {
          0
        }
        val streamUrl = if (map.hasKey("streamUrl") && !map.isNull("streamUrl")) {
          map.getString("streamUrl")
        } else {
          null
        }
        val headersJson = if (map.hasKey("headersJson") && !map.isNull("headersJson")) {
          map.getString("headersJson")
        } else {
          null
        }
        batch.add(
          QueuedTrackInput(
            trackId = trackId,
            title = map.getString("title") ?: "Música",
            artist = map.getString("artist") ?: "Artista",
            duration = durationVal,
            thumbnailUrl = map.getString("thumbnailUrl") ?: "",
            streamUrl = streamUrl,
            headersJson = headersJson,
          ),
        )
      }
      db.enqueueBatch(batch)
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_ENQUEUE_ITEMS", err)
    }
  }

  @ReactMethod
  fun updateTrackStream(trackId: String, streamUrl: String, headersJson: String?, promise: Promise) {
    try {
      if (trackId.isNotBlank() && streamUrl.isNotBlank()) {
        db.updateStreamInfo(trackId, streamUrl, headersJson)
      }
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_UPDATE_TRACK_STREAM", err)
    }
  }

  @ReactMethod
  fun provideResolvedStream(
    requestId: String,
    streamUrl: String?,
    headersJson: String?,
    error: String?,
    promise: Promise,
  ) {
    try {
      SonaryDownloadEvents.completeStreamRequest(requestId, streamUrl, headersJson, error)
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_PROVIDE_STREAM", err)
    }
  }

  @ReactMethod
  fun getQueueSnapshot(promise: Promise) {
    try {
      val rows = db.getQueueSnapshot()
      val arr = Arguments.createArray()
      for (row in rows) {
        val map = Arguments.createMap().apply {
          putString("trackId", row.trackId)
          putString("title", row.title)
          putString("artist", row.artist)
          putInt("duration", row.duration)
          putString("thumbnailUrl", row.thumbnailUrl)
          putString("status", row.status)
          putDouble("progress", row.progress)
          if (row.error != null) putString("error", row.error)
          if (row.localAudioUri != null) putString("localAudioUri", row.localAudioUri)
          if (row.localArtworkUri != null) putString("localArtworkUri", row.localArtworkUri)
          if (row.downloadedAt != null) putDouble("downloadedAt", row.downloadedAt.toDouble())
        }
        arr.pushMap(map)
      }
      promise.resolve(arr)
    } catch (err: Throwable) {
      promise.reject("E_GET_QUEUE_SNAPSHOT", err)
    }
  }

  @ReactMethod
  fun enqueueSync(promise: Promise) {
    try {
      SonaryDownloadEvents.cancelAllRequested = false
      val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
      val request = OneTimeWorkRequestBuilder<SonaryDownloadWorker>()
        .setConstraints(constraints)
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .build()

      val policy = if (SonaryDownloadEvents.isWorkerRunning) {
        ExistingWorkPolicy.KEEP
      } else {
        ExistingWorkPolicy.REPLACE
      }

      WorkManager.getInstance(reactApplicationContext).enqueueUniqueWork(
        SonaryDownloadWorker.UNIQUE_WORK_NAME,
        policy,
        request,
      )
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_ENQUEUE_SYNC", err)
    }
  }

  @ReactMethod
  fun cancelTrack(trackId: String, promise: Promise) {
    try {
      SonaryDownloadEvents.markTrackCancelled(trackId)
      db.removeQueueItem(trackId)
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_CANCEL_TRACK", err)
    }
  }

  @ReactMethod
  fun cancelAll(promise: Promise) {
    try {
      SonaryDownloadEvents.cancelAllRequested = true
      SonaryDownloadEvents.isWorkerRunning = false
      System.setProperty("sonary.downloads.running", "false")
      db.clearActiveItems()
      WorkManager.getInstance(reactApplicationContext)
        .cancelUniqueWork(SonaryDownloadWorker.UNIQUE_WORK_NAME)
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_CANCEL_ALL", err)
    }
  }

  @ReactMethod
  fun clearFinished(promise: Promise) {
    try {
      db.clearFinishedItems()
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_CLEAR_FINISHED", err)
    }
  }

  @ReactMethod
  fun clearCompleted(promise: Promise) {
    try {
      db.clearCompletedItems()
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_CLEAR_COMPLETED", err)
    }
  }

  @ReactMethod
  fun isWorkerActive(promise: Promise) {
    promise.resolve(SonaryDownloadEvents.isWorkerRunning)
  }
}
`,

  'SonaryDownloadPackage.kt': `package com.sonarypro.app.downloads

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SonaryDownloadPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(SonaryDownloadModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`,
};

function syncDownloadKotlinFiles(projectRoot) {
  const targetDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'sonarypro',
    'app',
    'downloads'
  );
  fs.mkdirSync(targetDir, { recursive: true });
  let changed = false;

  for (const existingFile of fs.readdirSync(targetDir)) {
    if (
      existingFile.endsWith('.kt') &&
      !Object.prototype.hasOwnProperty.call(KOTLIN_FILES, existingFile)
    ) {
      fs.unlinkSync(path.join(targetDir, existingFile));
      changed = true;
    }
  }

  for (const [filename, content] of Object.entries(KOTLIN_FILES)) {
    const filePath = path.join(targetDir, filename);
    const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (prev !== content) {
      fs.writeFileSync(filePath, content, 'utf8');
      changed = true;
    }
  }
  return changed;
}

function patchBuildGradleString(contents) {
  if (contents.includes('androidx.work:work-runtime-ktx')) {
    return contents;
  }
  return contents.replace(
    /(dependencies\s*\{\s*\r?\n)/,
    `$1    ${WORK_MANAGER_DEP}\n`
  );
}

function patchMainApplicationString(contents) {
  let next = contents;
  if (!next.includes(PACKAGE_IMPORT)) {
    next = next.replace(
      /(package\s+[\w.]+)/,
      `$1\n\n${PACKAGE_IMPORT}`
    );
  }
  if (!next.includes('SonaryDownloadPackage()')) {
    if (next.includes('PackageList(this).packages.apply {')) {
      next = next.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        `$1\n              add(SonaryDownloadPackage())`
      );
    } else if (next.includes('PackageList(this).packages')) {
      next = next.replace(
        /PackageList\(this\)\.packages/,
        `PackageList(this).packages.apply {\n              add(SonaryDownloadPackage())\n            }`
      );
    }
  }
  return next;
}

function patchAndroidManifestString(contents) {
  let next = contents;
  if (!next.includes('xmlns:tools="http://schemas.android.com/tools"')) {
    next = next.replace(
      /<manifest\b([^>]*)>/,
      `<manifest$1 xmlns:tools="http://schemas.android.com/tools">`
    );
  }
  if (!next.includes(FGS_DATA_SYNC_PERM)) {
    next = next.replace(
      /(<manifest[^>]*>)/,
      `$1\n  <uses-permission android:name="${FGS_DATA_SYNC_PERM}"/>`
    );
  }
  if (!next.includes(WORK_FGS_SERVICE)) {
    const serviceTag = `    <service android:name="${WORK_FGS_SERVICE}" android:foregroundServiceType="dataSync" tools:node="merge"/>\n`;
    next = next.replace(/(<application[^>]*>)/, `$1\n${serviceTag}`);
  }
  if (!next.includes(CANCEL_RECEIVER)) {
    const receiverTag = `    <receiver android:name="${CANCEL_RECEIVER}" android:exported="false"/>\n`;
    next = next.replace(/(<application[^>]*>)/, `$1\n${receiverTag}`);
  }
  return next;
}

function applyBackgroundDownloadPatches(projectRoot) {
  const androidDir = path.join(projectRoot, 'android');
  if (!fs.existsSync(androidDir)) return false;
  let changed = false;

  if (syncDownloadKotlinFiles(projectRoot)) {
    changed = true;
  }

  const buildGradlePath = path.join(androidDir, 'app', 'build.gradle');
  if (fs.existsSync(buildGradlePath)) {
    const prev = fs.readFileSync(buildGradlePath, 'utf8');
    const next = patchBuildGradleString(prev);
    if (next !== prev) {
      fs.writeFileSync(buildGradlePath, next, 'utf8');
      changed = true;
    }
  }

  const mainAppPath = path.join(
    androidDir,
    'app',
    'src',
    'main',
    'java',
    'com',
    'sonarypro',
    'app',
    'MainApplication.kt'
  );
  if (fs.existsSync(mainAppPath)) {
    const prev = fs.readFileSync(mainAppPath, 'utf8');
    const next = patchMainApplicationString(prev);
    if (next !== prev) {
      fs.writeFileSync(mainAppPath, next, 'utf8');
      changed = true;
    }
  }

  const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    const prev = fs.readFileSync(manifestPath, 'utf8');
    const next = patchAndroidManifestString(prev);
    if (next !== prev) {
      fs.writeFileSync(manifestPath, next, 'utf8');
      changed = true;
    }
  }

  return changed;
}

const withBackgroundDownloads = (config) => {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    manifest.manifest.$ = manifest.manifest.$ || {};
    manifest.manifest.$['xmlns:tools'] =
      manifest.manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const hasPerm = manifest.manifest['uses-permission'].some(
      (p) => p.$ && p.$['android:name'] === FGS_DATA_SYNC_PERM
    );
    if (!hasPerm) {
      manifest.manifest['uses-permission'].push({
        $: { 'android:name': FGS_DATA_SYNC_PERM },
      });
    }

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    mainApplication.service = mainApplication.service || [];
    const existingService = mainApplication.service.find(
      (s) => s.$ && s.$['android:name'] === WORK_FGS_SERVICE
    );
    if (existingService) {
      existingService.$['android:foregroundServiceType'] = 'dataSync';
      existingService.$['tools:node'] = 'merge';
    } else {
      mainApplication.service.push({
        $: {
          'android:name': WORK_FGS_SERVICE,
          'android:foregroundServiceType': 'dataSync',
          'tools:node': 'merge',
        },
      });
    }

    mainApplication.receiver = mainApplication.receiver || [];
    const hasReceiver = mainApplication.receiver.some(
      (r) => r.$ && r.$['android:name'] === CANCEL_RECEIVER
    );
    if (!hasReceiver) {
      mainApplication.receiver.push({
        $: {
          'android:name': CANCEL_RECEIVER,
          'android:exported': 'false',
        },
      });
    }

    return modConfig;
  });

  config = withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = patchBuildGradleString(modConfig.modResults.contents);
    return modConfig;
  });

  config = withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents = patchMainApplicationString(modConfig.modResults.contents);
    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      syncDownloadKotlinFiles(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);

  return config;
};

withBackgroundDownloads.applyBackgroundDownloadPatches = applyBackgroundDownloadPatches;
withBackgroundDownloads.patchBuildGradleString = patchBuildGradleString;
withBackgroundDownloads.patchMainApplicationString = patchMainApplicationString;
withBackgroundDownloads.patchAndroidManifestString = patchAndroidManifestString;
module.exports = withBackgroundDownloads;
