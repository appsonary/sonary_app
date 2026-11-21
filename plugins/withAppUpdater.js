const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');

const REQUEST_INSTALL_PERM = 'android.permission.REQUEST_INSTALL_PACKAGES';
const FGS_DATA_SYNC_PERM = 'android.permission.FOREGROUND_SERVICE_DATA_SYNC';
const WORK_MANAGER_DEP = 'implementation("androidx.work:work-runtime-ktx:2.9.0")';
const WORK_FGS_SERVICE = 'androidx.work.impl.foreground.SystemForegroundService';
const UPDATER_CANCEL_RECEIVER = 'com.sonarypro.app.updater.SonaryUpdaterCancelReceiver';
const UPDATER_PROVIDER_AUTHORITY = '${applicationId}.updater.fileprovider';
const UPDATER_PACKAGE_IMPORT = 'import com.sonarypro.app.updater.SonaryUpdaterPackage';

const FILE_PROVIDER_PATHS_XML = `<?xml version="1.0" encoding="utf-8"?>
<paths>
  <cache-path name="updater_cache" path="updates/" />
  <files-path name="updater_files" path="updates/" />
</paths>
`;

const KOTLIN_FILES = {
  'SonaryUpdaterStateStore.kt': `package com.sonarypro.app.updater

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

data class SonaryUpdaterState(
  val status: String = "idle",
  val versionName: String? = null,
  val versionCode: Int? = null,
  val apkName: String? = null,
  val apkUrl: String? = null,
  val sha256: String? = null,
  val sizeBytes: Long? = null,
  val releaseNotes: String? = null,
  val releaseUrl: String? = null,
  val localUri: String? = null,
  val progress: Double = 0.0,
  val error: String? = null,
  val sha256Verified: Boolean = false,
  val updatedAt: Long = 0L,
) {
  fun toWritableMap(): WritableMap = Arguments.createMap().apply {
    putString("status", status)
    if (versionName != null) putString("versionName", versionName) else putNull("versionName")
    if (versionCode != null && versionCode > 0) putInt("versionCode", versionCode) else putNull("versionCode")
    if (apkName != null) putString("apkName", apkName) else putNull("apkName")
    if (apkUrl != null) putString("apkUrl", apkUrl) else putNull("apkUrl")
    if (sha256 != null) putString("sha256", sha256) else putNull("sha256")
    if (sizeBytes != null && sizeBytes > 0L) putDouble("sizeBytes", sizeBytes.toDouble()) else putNull("sizeBytes")
    if (releaseNotes != null) putString("releaseNotes", releaseNotes) else putNull("releaseNotes")
    if (releaseUrl != null) putString("releaseUrl", releaseUrl) else putNull("releaseUrl")
    if (localUri != null) putString("localUri", localUri) else putNull("localUri")
    putDouble("progress", progress.coerceIn(0.0, 1.0))
    if (error != null) putString("error", error) else putNull("error")
    putBoolean("sha256Verified", sha256Verified)
    putDouble("updatedAt", updatedAt.toDouble())
  }
}

class SonaryUpdaterStateStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun read(): SonaryUpdaterState {
    val status = prefs.getString("status", "idle") ?: "idle"
    val rawCode = prefs.getInt("versionCode", -1)
    val rawSize = prefs.getLong("sizeBytes", -1L)
    return SonaryUpdaterState(
      status = status,
      versionName = prefs.getString("versionName", null),
      versionCode = if (rawCode > 0) rawCode else null,
      apkName = prefs.getString("apkName", null),
      apkUrl = prefs.getString("apkUrl", null),
      sha256 = prefs.getString("sha256", null),
      sizeBytes = if (rawSize > 0L) rawSize else null,
      releaseNotes = prefs.getString("releaseNotes", null),
      releaseUrl = prefs.getString("releaseUrl", null),
      localUri = prefs.getString("localUri", null),
      progress = prefs.getFloat("progress", 0f).toDouble(),
      error = prefs.getString("error", null),
      sha256Verified = prefs.getBoolean("sha256Verified", false),
      updatedAt = prefs.getLong("updatedAt", 0L),
    )
  }

  fun write(state: SonaryUpdaterState) {
    prefs.edit().apply {
      putString("status", state.status)
      putString("versionName", state.versionName)
      putInt("versionCode", state.versionCode ?: -1)
      putString("apkName", state.apkName)
      putString("apkUrl", state.apkUrl)
      putString("sha256", state.sha256)
      putLong("sizeBytes", state.sizeBytes ?: -1L)
      putString("releaseNotes", state.releaseNotes)
      putString("releaseUrl", state.releaseUrl)
      putString("localUri", state.localUri)
      putFloat("progress", state.progress.coerceIn(0.0, 1.0).toFloat())
      putString("error", state.error)
      putBoolean("sha256Verified", state.sha256Verified)
      putLong("updatedAt", state.updatedAt)
      apply()
    }
  }

  fun clear() {
    prefs.edit().clear().apply()
  }

  companion object {
    private const val PREFS_NAME = "sonary_app_updater_state"
  }
}
`,

  'SonaryUpdaterEvents.kt': `package com.sonarypro.app.updater

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object SonaryUpdaterEvents {
  const val EVENT_NAME = "SonaryUpdaterDownloadChanged"

  @Volatile
  private var reactContext: ReactApplicationContext? = null

  @Volatile
  var cancelled: Boolean = false

  @Volatile
  var isWorkerRunning: Boolean = false

  fun attachReactContext(context: ReactApplicationContext) {
    reactContext = context
  }

  fun emitState(state: SonaryUpdaterState) {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    try {
      ctx
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, state.toWritableMap())
    } catch (_: Throwable) {
      // Ignora caso o runtime JS não esteja pronto
    }
  }
}
`,

  'SonaryUpdaterCancelReceiver.kt': `package com.sonarypro.app.updater

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager
import java.io.File

class SonaryUpdaterCancelReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != ACTION_CANCEL) return
    val appCtx = context.applicationContext
    SonaryUpdaterEvents.cancelled = true
    System.setProperty("sonary.updater.running", "false")
    WorkManager.getInstance(appCtx).cancelUniqueWork(SonaryUpdaterWorker.UNIQUE_WORK_NAME)

    try {
      val updatesDir = File(appCtx.cacheDir, "updates")
      updatesDir.listFiles()?.forEach { file ->
        if (file.name.endsWith(".part")) {
          file.delete()
        }
      }
    } catch (_: Throwable) {
      // ignore cleanup error
    }

    val nm = appCtx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    nm?.cancel(SonaryUpdaterWorker.NOTIFICATION_ID)
    nm?.cancel(SonaryUpdaterWorker.READY_NOTIFICATION_ID)

    val store = SonaryUpdaterStateStore(appCtx)
    store.clear()
    SonaryUpdaterEvents.emitState(SonaryUpdaterState(status = "idle", updatedAt = System.currentTimeMillis()))
  }

  companion object {
    const val ACTION_CANCEL = "com.sonarypro.app.updater.ACTION_CANCEL"
  }
}
`,

  'SonaryUpdaterWorker.kt': `package com.sonarypro.app.updater

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class SonaryUpdaterWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

  private val store = SonaryUpdaterStateStore(appContext)
  private val notificationManager =
    appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override suspend fun getForegroundInfo(): ForegroundInfo {
    val current = store.read()
    val label = current.versionName?.let { "v$it" } ?: "nova versão"
    return buildProgressForegroundInfo("Baixando atualização ($label)", 0, true)
  }

  private suspend fun trySetForegroundSafely(info: ForegroundInfo) {
    try {
      setForeground(info)
    } catch (_: Throwable) {
      try {
        ensureNotificationChannel()
        notificationManager.notify(NOTIFICATION_ID, info.notification)
      } catch (_: Throwable) {
        // Ignora se POST_NOTIFICATIONS não foi concedida
      }
    }
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    SonaryUpdaterEvents.isWorkerRunning = true
    System.setProperty("sonary.updater.running", "true")

    val stored = store.read()
    val apkUrl = inputData.getString(KEY_APK_URL) ?: stored.apkUrl ?: ""
    val versionName = inputData.getString(KEY_VERSION_NAME) ?: stored.versionName ?: ""
    val rawCode = inputData.getInt(KEY_VERSION_CODE, stored.versionCode ?: -1)
    val versionCode = if (rawCode > 0) rawCode else null
    val rawApkName = inputData.getString(KEY_APK_NAME) ?: stored.apkName ?: "sonary-update.apk"
    val safeName = rawApkName.replace(Regex("[^a-zA-Z0-9._-]"), "_").ifBlank { "sonary-update.apk" }
    val sha256 = inputData.getString(KEY_SHA256)?.takeIf { it.isNotBlank() } ?: stored.sha256
    val rawSize = inputData.getLong(KEY_SIZE_BYTES, stored.sizeBytes ?: -1L)
    val sizeBytes = if (rawSize > 0L) rawSize else null
    val releaseNotes = inputData.getString(KEY_RELEASE_NOTES) ?: stored.releaseNotes
    val releaseUrl = inputData.getString(KEY_RELEASE_URL) ?: stored.releaseUrl

    val updatesDir = File(applicationContext.cacheDir, "updates").apply { mkdirs() }
    val partFile = File(updatesDir, "$safeName.part")
    val finalFile = File(updatesDir, safeName)

    val baseState = SonaryUpdaterState(
      status = "downloading",
      versionName = versionName.ifBlank { null },
      versionCode = versionCode,
      apkName = safeName,
      apkUrl = apkUrl.ifBlank { null },
      sha256 = sha256,
      sizeBytes = sizeBytes,
      releaseNotes = releaseNotes,
      releaseUrl = releaseUrl,
      progress = 0.0,
      updatedAt = System.currentTimeMillis(),
    )

    try {
      if (!isTrustedGitHubUrl(apkUrl)) {
        failDownload(baseState, "URL de download da atualização não é confiável.")
        return@withContext Result.failure()
      }

      if (isStopped || SonaryUpdaterEvents.cancelled) {
        partFile.delete()
        return@withContext Result.success()
      }

      // Remove APKs antigos antes de baixar o novo
      updatesDir.listFiles()?.forEach { file ->
        if (file.name.endsWith(".apk") || file.name.endsWith(".part")) {
          file.delete()
        }
      }

      store.write(baseState)
      SonaryUpdaterEvents.emitState(baseState)
      val titleLabel = if (versionName.isNotBlank()) "Baixando Sonary v$versionName" else "Baixando atualização"
      trySetForegroundSafely(buildProgressForegroundInfo(titleLabel, 0, true))

      val conn = openTrustedConnection(apkUrl)
      try {
        val statusCode = conn.responseCode
        if (statusCode < 200 || statusCode >= 300) {
          partFile.delete()
          failDownload(baseState, "Falha ao baixar APK (HTTP $statusCode).")
          return@withContext Result.failure()
        }

        val contentLength = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          conn.contentLengthLong
        } else {
          conn.contentLength.toLong()
        }
        val expectedBytes = if (contentLength > 0L) contentLength else (sizeBytes ?: -1L)

        var totalRead = 0L
        var lastEmitAt = 0L
        var lastPct = -1

        conn.inputStream.use { input ->
          FileOutputStream(partFile).use { output ->
            val buffer = ByteArray(16 * 1024)
            while (true) {
              if (isStopped || SonaryUpdaterEvents.cancelled) {
                partFile.delete()
                store.clear()
                SonaryUpdaterEvents.emitState(
                  SonaryUpdaterState(status = "idle", updatedAt = System.currentTimeMillis())
                )
                return@withContext Result.success()
              }
              val read = input.read(buffer)
              if (read == -1) break
              output.write(buffer, 0, read)
              totalRead += read

              val now = System.currentTimeMillis()
              if (expectedBytes > 0L && now - lastEmitAt >= 250L) {
                lastEmitAt = now
                val ratio = (totalRead.toDouble() / expectedBytes.toDouble()).coerceIn(0.0, 1.0)
                val pct = (ratio * 100.0).toInt().coerceIn(0, 100)
                val progressState = baseState.copy(progress = ratio, updatedAt = now)
                store.write(progressState)
                SonaryUpdaterEvents.emitState(progressState)
                if (pct != lastPct) {
                  lastPct = pct
                  try {
                    notificationManager.notify(
                      NOTIFICATION_ID,
                      buildProgressNotification(titleLabel, pct, false)
                    )
                  } catch (_: Throwable) {
                    // ignore
                  }
                }
              }
            }
            output.flush()
          }
        }
      } finally {
        conn.disconnect()
      }

      if (isStopped || SonaryUpdaterEvents.cancelled) {
        partFile.delete()
        store.clear()
        SonaryUpdaterEvents.emitState(
          SonaryUpdaterState(status = "idle", updatedAt = System.currentTimeMillis())
        )
        return@withContext Result.success()
      }

      if (!partFile.exists() || partFile.length() < MIN_VALID_APK_BYTES) {
        partFile.delete()
        failDownload(baseState, "Arquivo APK baixado parece inválido ou corrompido.")
        return@withContext Result.failure()
      }

      if (finalFile.exists()) {
        finalFile.delete()
      }
      if (!partFile.renameTo(finalFile)) {
        partFile.copyTo(finalFile, overwrite = true)
        partFile.delete()
      }

      var shaVerified = false
      if (!sha256.isNullOrBlank()) {
        val matches = verifyFileSha256(finalFile, sha256)
        if (!matches) {
          finalFile.delete()
          failDownload(baseState, "Falha na verificação de integridade SHA-256 do APK.")
          return@withContext Result.failure()
        }
        shaVerified = true
      }

      val localUri = "file://\${finalFile.absolutePath}"
      val readyState = baseState.copy(
        status = "ready",
        localUri = localUri,
        progress = 1.0,
        error = null,
        sha256Verified = shaVerified,
        updatedAt = System.currentTimeMillis(),
      )
      store.write(readyState)
      SonaryUpdaterEvents.emitState(readyState)
      notificationManager.cancel(NOTIFICATION_ID)
      postReadyNotification(versionName)
      return@withContext Result.success()
    } catch (err: Throwable) {
      partFile.delete()
      if (isStopped || SonaryUpdaterEvents.cancelled) {
        store.clear()
        SonaryUpdaterEvents.emitState(
          SonaryUpdaterState(status = "idle", updatedAt = System.currentTimeMillis())
        )
        return@withContext Result.success()
      }
      failDownload(baseState, err.message ?: "Falha ao baixar atualização.")
      return@withContext Result.failure()
    } finally {
      SonaryUpdaterEvents.isWorkerRunning = false
      System.setProperty("sonary.updater.running", "false")
    }
  }

  private fun failDownload(baseState: SonaryUpdaterState, message: String) {
    val errorState = baseState.copy(
      status = "error",
      error = message,
      updatedAt = System.currentTimeMillis(),
    )
    store.write(errorState)
    SonaryUpdaterEvents.emitState(errorState)
    notificationManager.cancel(NOTIFICATION_ID)
  }

  private fun openTrustedConnection(initialUrl: String): HttpURLConnection {
    var currentUrl = initialUrl
    var hops = 0
    while (hops <= 5) {
      if (!isTrustedGitHubUrl(currentUrl)) {
        throw SecurityException("URL de redirecionamento não confiável.")
      }
      val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = 15000
        readTimeout = 30000
        setRequestProperty("User-Agent", "SonaryProUpdater/1.0")
      }
      val code = conn.responseCode
      if (code in listOf(301, 302, 303, 307, 308)) {
        val location = conn.getHeaderField("Location")
        conn.disconnect()
        if (location.isNullOrBlank()) {
          throw IllegalStateException("Redirecionamento HTTP sem destino.")
        }
        currentUrl = URL(URL(currentUrl), location).toString()
        hops += 1
        continue
      }
      return conn
    }
    throw IllegalStateException("Muitos redirecionamentos ao baixar atualização.")
  }

  private fun verifyFileSha256(file: File, expectedSha256: String): Boolean {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(16 * 1024)
    FileInputStream(file).use { input ->
      while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        digest.update(buffer, 0, read)
      }
    }
    val actualHex = digest.digest().joinToString("") { "%02x".format(it) }
    return actualHex.equals(expectedSha256.trim(), ignoreCase = true)
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Atualizações do aplicativo",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      }
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun buildOpenUpdaterPendingIntent(): PendingIntent {
    val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse("com.sonarypro.app://update")).apply {
      setPackage(applicationContext.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    return PendingIntent.getActivity(applicationContext, 4302, openIntent, flags)
  }

  private fun buildProgressNotification(
    title: String,
    percent: Int,
    indeterminate: Boolean,
  ): android.app.Notification {
    ensureNotificationChannel()
    val cancelIntent = Intent(applicationContext, SonaryUpdaterCancelReceiver::class.java).apply {
      action = SonaryUpdaterCancelReceiver.ACTION_CANCEL
    }
    val cancelFlags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val cancelPendingIntent = PendingIntent.getBroadcast(applicationContext, 4301, cancelIntent, cancelFlags)

    val subtitle = if (indeterminate) "Preparando download..." else "Baixando em segundo plano • $percent%"
    return NotificationCompat.Builder(applicationContext, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setSmallIcon(applicationContext.applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setProgress(100, percent, indeterminate)
      .setContentIntent(buildOpenUpdaterPendingIntent())
      .addAction(0, "Cancelar", cancelPendingIntent)
      .build()
  }

  private fun buildProgressForegroundInfo(
    title: String,
    percent: Int,
    indeterminate: Boolean,
  ): ForegroundInfo {
    val notification = buildProgressNotification(title, percent, indeterminate)
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

  private fun postReadyNotification(versionName: String) {
    try {
      ensureNotificationChannel()
      val title = if (versionName.isNotBlank()) {
        "Atualização v$versionName pronta"
      } else {
        "Atualização do Sonary pronta"
      }
      val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText("Toque para instalar a nova versão.")
        .setSmallIcon(applicationContext.applicationInfo.icon)
        .setAutoCancel(true)
        .setSilent(true)
        .setContentIntent(buildOpenUpdaterPendingIntent())
        .build()
      notificationManager.notify(READY_NOTIFICATION_ID, notification)
    } catch (_: Throwable) {
      // Ignora caso POST_NOTIFICATIONS não esteja habilitada
    }
  }

  companion object {
    const val UNIQUE_WORK_NAME = "sonary_app_update_download"
    const val CHANNEL_ID = "sonary_app_updates"
    const val NOTIFICATION_ID = 4301
    const val READY_NOTIFICATION_ID = 4302
    private const val MIN_VALID_APK_BYTES = 1024L * 1024L

    const val KEY_APK_URL = "apkUrl"
    const val KEY_APK_NAME = "apkName"
    const val KEY_VERSION_NAME = "versionName"
    const val KEY_VERSION_CODE = "versionCode"
    const val KEY_SHA256 = "sha256"
    const val KEY_SIZE_BYTES = "sizeBytes"
    const val KEY_RELEASE_NOTES = "releaseNotes"
    const val KEY_RELEASE_URL = "releaseUrl"

    fun isTrustedGitHubUrl(rawUrl: String): Boolean {
      return try {
        val uri = Uri.parse(rawUrl)
        if (!"https".equals(uri.scheme, ignoreCase = true)) return false
        val host = uri.host?.lowercase() ?: return false
        host == "github.com" ||
          host == "githubusercontent.com" ||
          host.endsWith(".githubusercontent.com")
      } catch (_: Throwable) {
        false
      }
    }
  }
}
`,

  'SonaryUpdaterModule.kt': `package com.sonarypro.app.updater

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.Executors

class SonaryUpdaterModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val ioExecutor = Executors.newSingleThreadExecutor()
  private val store = SonaryUpdaterStateStore(reactContext)

  init {
    SonaryUpdaterEvents.attachReactContext(reactContext)
  }

  override fun getName(): String = "SonaryAppUpdater"

  @ReactMethod
  fun addListener(eventName: String) {
    // Necessário para NativeEventEmitter no React Native
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Necessário para NativeEventEmitter no React Native
  }

  @ReactMethod
  fun getInstalledVersion(promise: Promise) {
    try {
      val pm = reactApplicationContext.packageManager
      val pkgName = reactApplicationContext.packageName
      val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getPackageInfo(pkgName, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(pkgName, 0)
      }
      val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        info.longVersionCode.toInt()
      } else {
        @Suppress("DEPRECATION")
        info.versionCode
      }
      val result = Arguments.createMap().apply {
        putString("versionName", info.versionName ?: "0.0.0")
        putInt("versionCode", versionCode)
      }
      promise.resolve(result)
    } catch (err: Throwable) {
      promise.reject("E_GET_VERSION", err)
    }
  }

  @ReactMethod
  fun canRequestPackageInstalls(promise: Promise) {
    try {
      val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.packageManager.canRequestPackageInstalls()
      } else {
        true
      }
      promise.resolve(allowed)
    } catch (err: Throwable) {
      promise.reject("E_CAN_INSTALL", err)
    }
  }

  @ReactMethod
  fun openInstallPermissionSettings(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val intent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:\${reactApplicationContext.packageName}")
        ).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
      }
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_OPEN_INSTALL_SETTINGS", err)
    }
  }

  @ReactMethod
  fun verifySha256(fileUri: String, expectedSha256: String, promise: Promise) {
    ioExecutor.execute {
      try {
        val file = resolveLocalFile(fileUri)
        if (!file.exists() || !file.isFile || file.length() <= 0L) {
          promise.resolve(false)
          return@execute
        }
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(16 * 1024)
        FileInputStream(file).use { input ->
          while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            digest.update(buffer, 0, read)
          }
        }
        val actualHex = digest.digest().joinToString("") { "%02x".format(it) }
        val matches = actualHex.equals(expectedSha256.trim(), ignoreCase = true)
        promise.resolve(matches)
      } catch (err: Throwable) {
        promise.reject("E_VERIFY_SHA256", err)
      }
    }
  }

  @ReactMethod
  fun installApk(fileUri: String, promise: Promise) {
    try {
      val file = resolveLocalFile(fileUri)
      if (!file.exists() || file.length() <= 0L) {
        promise.reject("E_APK_MISSING", "Arquivo APK de atualização não encontrado.")
        return
      }

      val nm = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      nm?.cancel(SonaryUpdaterWorker.READY_NOTIFICATION_ID)

      val authority = "\${reactApplicationContext.packageName}.updater.fileprovider"
      val contentUri = FileProvider.getUriForFile(reactApplicationContext, authority, file)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_INSTALL_APK", err)
    }
  }

  @ReactMethod
  fun startBackgroundDownload(params: ReadableMap, promise: Promise) {
    try {
      val apkUrl = if (params.hasKey("apkUrl")) params.getString("apkUrl") ?: "" else ""
      if (!SonaryUpdaterWorker.isTrustedGitHubUrl(apkUrl)) {
        promise.reject("E_UNTRUSTED_URL", "URL de download da atualização não é confiável.")
        return
      }
      val versionName = if (params.hasKey("versionName")) params.getString("versionName") ?: "" else ""
      val versionCode = if (params.hasKey("versionCode") && !params.isNull("versionCode")) params.getInt("versionCode") else -1
      val apkName = if (params.hasKey("apkName")) params.getString("apkName") ?: "sonary-update.apk" else "sonary-update.apk"
      val sha256 = if (params.hasKey("sha256") && !params.isNull("sha256")) params.getString("sha256") else null
      val sizeBytes = if (params.hasKey("sizeBytes") && !params.isNull("sizeBytes")) params.getDouble("sizeBytes").toLong() else -1L
      val releaseNotes = if (params.hasKey("releaseNotes") && !params.isNull("releaseNotes")) params.getString("releaseNotes") else null
      val releaseUrl = if (params.hasKey("releaseUrl") && !params.isNull("releaseUrl")) params.getString("releaseUrl") else null

      SonaryUpdaterEvents.cancelled = false
      val initialState = SonaryUpdaterState(
        status = "downloading",
        versionName = versionName.ifBlank { null },
        versionCode = if (versionCode > 0) versionCode else null,
        apkName = apkName,
        apkUrl = apkUrl,
        sha256 = sha256,
        sizeBytes = if (sizeBytes > 0L) sizeBytes else null,
        releaseNotes = releaseNotes,
        releaseUrl = releaseUrl,
        progress = 0.0,
        error = null,
        updatedAt = System.currentTimeMillis(),
      )
      store.write(initialState)
      SonaryUpdaterEvents.emitState(initialState)

      // releaseNotes já é persistido no SonaryUpdaterStateStore (evita limite de 10KB do WorkManager Data)
      val input = Data.Builder()
        .putString(SonaryUpdaterWorker.KEY_APK_URL, apkUrl)
        .putString(SonaryUpdaterWorker.KEY_APK_NAME, apkName)
        .putString(SonaryUpdaterWorker.KEY_VERSION_NAME, versionName)
        .putInt(SonaryUpdaterWorker.KEY_VERSION_CODE, versionCode)
        .putString(SonaryUpdaterWorker.KEY_SHA256, sha256 ?: "")
        .putLong(SonaryUpdaterWorker.KEY_SIZE_BYTES, sizeBytes)
        .putString(SonaryUpdaterWorker.KEY_RELEASE_URL, releaseUrl ?: "")
        .build()

      val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

      val request = OneTimeWorkRequestBuilder<SonaryUpdaterWorker>()
        .setInputData(input)
        .setConstraints(constraints)
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .build()

      WorkManager.getInstance(reactApplicationContext).enqueueUniqueWork(
        SonaryUpdaterWorker.UNIQUE_WORK_NAME,
        ExistingWorkPolicy.REPLACE,
        request,
      )
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_START_BG_UPDATE", err)
    }
  }

  @ReactMethod
  fun cancelBackgroundDownload(promise: Promise) {
    try {
      SonaryUpdaterEvents.cancelled = true
      System.setProperty("sonary.updater.running", "false")
      WorkManager.getInstance(reactApplicationContext)
        .cancelUniqueWork(SonaryUpdaterWorker.UNIQUE_WORK_NAME)

      val updatesDir = File(reactApplicationContext.cacheDir, "updates")
      updatesDir.listFiles()?.forEach { file ->
        if (file.name.endsWith(".part")) {
          file.delete()
        }
      }

      val nm = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      nm?.cancel(SonaryUpdaterWorker.NOTIFICATION_ID)
      nm?.cancel(SonaryUpdaterWorker.READY_NOTIFICATION_ID)

      store.clear()
      SonaryUpdaterEvents.emitState(
        SonaryUpdaterState(status = "idle", updatedAt = System.currentTimeMillis())
      )
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_CANCEL_BG_UPDATE", err)
    }
  }

  @ReactMethod
  fun getDownloadState(promise: Promise) {
    ioExecutor.execute {
      try {
        val current = store.read()
        if (current.status == "ready") {
          val uri = current.localUri
          val exists = !uri.isNullOrBlank() && resolveLocalFile(uri).let { it.exists() && it.length() > 0L }
          if (!exists) {
            store.clear()
            promise.resolve(SonaryUpdaterState(status = "idle").toWritableMap())
            return@execute
          }
        } else if (current.status == "downloading" && !SonaryUpdaterEvents.isWorkerRunning) {
          val hasActiveWork = try {
            val infos = runBlocking {
              WorkManager.getInstance(reactApplicationContext)
                .getWorkInfosForUniqueWorkFlow(SonaryUpdaterWorker.UNIQUE_WORK_NAME)
                .first()
            }
            infos.any {
              it.state == WorkInfo.State.ENQUEUED ||
                it.state == WorkInfo.State.RUNNING ||
                it.state == WorkInfo.State.BLOCKED
            }
          } catch (_: Throwable) {
            true
          }
          if (!hasActiveWork) {
            store.clear()
            promise.resolve(SonaryUpdaterState(status = "idle").toWritableMap())
            return@execute
          }
        }
        promise.resolve(current.toWritableMap())
      } catch (err: Throwable) {
        promise.reject("E_GET_DOWNLOAD_STATE", err)
      }
    }
  }

  @ReactMethod
  fun clearDownloadState(promise: Promise) {
    try {
      val nm = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      nm?.cancel(SonaryUpdaterWorker.READY_NOTIFICATION_ID)
      store.clear()
      SonaryUpdaterEvents.emitState(
        SonaryUpdaterState(status = "idle", updatedAt = System.currentTimeMillis())
      )
      promise.resolve(null)
    } catch (err: Throwable) {
      promise.reject("E_CLEAR_DOWNLOAD_STATE", err)
    }
  }

  private fun resolveLocalFile(fileUri: String): File {
    val parsed = Uri.parse(fileUri)
    val rawPath = if (parsed.scheme == "file" && !parsed.path.isNullOrBlank()) {
      parsed.path!!
    } else {
      fileUri
    }
    return File(rawPath)
  }
}
`,

  'SonaryUpdaterPackage.kt': `package com.sonarypro.app.updater

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SonaryUpdaterPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(SonaryUpdaterModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`,
};

function syncUpdaterKotlinFiles(projectRoot) {
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
    'updater'
  );
  fs.mkdirSync(targetDir, { recursive: true });
  let changed = false;

  for (const [filename, content] of Object.entries(KOTLIN_FILES)) {
    const filePath = path.join(targetDir, filename);
    const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (prev !== content) {
      fs.writeFileSync(filePath, content, 'utf8');
      changed = true;
    }
  }

  const xmlDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
  fs.mkdirSync(xmlDir, { recursive: true });
  const xmlPath = path.join(xmlDir, 'sonary_updater_paths.xml');
  const prevXml = fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath, 'utf8') : null;
  if (prevXml !== FILE_PROVIDER_PATHS_XML) {
    fs.writeFileSync(xmlPath, FILE_PROVIDER_PATHS_XML, 'utf8');
    changed = true;
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
  if (!next.includes(UPDATER_PACKAGE_IMPORT)) {
    next = next.replace(/(package\s+[\w.]+)/, `$1\n\n${UPDATER_PACKAGE_IMPORT}`);
  }
  if (!next.includes('SonaryUpdaterPackage()')) {
    if (next.includes('PackageList(this).packages.apply {')) {
      next = next.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        `$1\n              add(SonaryUpdaterPackage())`
      );
    } else if (next.includes('PackageList(this).packages')) {
      next = next.replace(
        /PackageList\(this\)\.packages/,
        `PackageList(this).packages.apply {\n              add(SonaryUpdaterPackage())\n            }`
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
  if (!next.includes(REQUEST_INSTALL_PERM)) {
    next = next.replace(
      /(<manifest[^>]*>)/,
      `$1\n  <uses-permission android:name="${REQUEST_INSTALL_PERM}"/>`
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
  if (!next.includes(UPDATER_CANCEL_RECEIVER)) {
    const receiverTag = `    <receiver android:name="${UPDATER_CANCEL_RECEIVER}" android:exported="false"/>\n`;
    next = next.replace(/(<application[^>]*>)/, `$1\n${receiverTag}`);
  }
  if (!next.includes(UPDATER_PROVIDER_AUTHORITY)) {
    const providerTag = [
      `    <provider`,
      `      android:name="androidx.core.content.FileProvider"`,
      `      android:authorities="${UPDATER_PROVIDER_AUTHORITY}"`,
      `      android:exported="false"`,
      `      android:grantUriPermissions="true">`,
      `      <meta-data`,
      `        android:name="android.support.FILE_PROVIDER_PATHS"`,
      `        android:resource="@xml/sonary_updater_paths"/>`,
      `    </provider>`,
    ].join('\n');
    next = next.replace(/(<\/application>)/, `${providerTag}\n  $1`);
  }
  return next;
}

function applyAppUpdaterPatches(projectRoot) {
  const androidDir = path.join(projectRoot, 'android');
  if (!fs.existsSync(androidDir)) return false;
  let changed = false;

  if (syncUpdaterKotlinFiles(projectRoot)) {
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

const withAppUpdater = (config) => {
  config = withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = patchBuildGradleString(modConfig.modResults.contents);
    return modConfig;
  });

  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    manifest.manifest.$ = manifest.manifest.$ || {};
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    for (const perm of [REQUEST_INSTALL_PERM, FGS_DATA_SYNC_PERM]) {
      const hasPerm = manifest.manifest['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === perm
      );
      if (!hasPerm) {
        manifest.manifest['uses-permission'].push({
          $: { 'android:name': perm },
        });
      }
    }

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    mainApplication.service = mainApplication.service || [];
    const hasWorkService = mainApplication.service.some(
      (s) => s.$ && s.$['android:name'] === WORK_FGS_SERVICE
    );
    if (!hasWorkService) {
      mainApplication.service.push({
        $: {
          'android:name': WORK_FGS_SERVICE,
          'android:foregroundServiceType': 'dataSync',
          'tools:node': 'merge',
        },
      });
    }

    mainApplication.receiver = mainApplication.receiver || [];
    const hasCancelReceiver = mainApplication.receiver.some(
      (r) => r.$ && r.$['android:name'] === UPDATER_CANCEL_RECEIVER
    );
    if (!hasCancelReceiver) {
      mainApplication.receiver.push({
        $: {
          'android:name': UPDATER_CANCEL_RECEIVER,
          'android:exported': 'false',
        },
      });
    }

    mainApplication.provider = mainApplication.provider || [];
    const hasProvider = mainApplication.provider.some(
      (p) => p.$ && p.$['android:authorities'] === UPDATER_PROVIDER_AUTHORITY
    );
    if (!hasProvider) {
      mainApplication.provider.push({
        $: {
          'android:name': 'androidx.core.content.FileProvider',
          'android:authorities': UPDATER_PROVIDER_AUTHORITY,
          'android:exported': 'false',
          'android:grantUriPermissions': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'android.support.FILE_PROVIDER_PATHS',
              'android:resource': '@xml/sonary_updater_paths',
            },
          },
        ],
      });
    }

    return modConfig;
  });

  config = withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents = patchMainApplicationString(modConfig.modResults.contents);
    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      syncUpdaterKotlinFiles(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);

  return config;
};

withAppUpdater.applyAppUpdaterPatches = applyAppUpdaterPatches;
withAppUpdater.patchBuildGradleString = patchBuildGradleString;
withAppUpdater.patchMainApplicationString = patchMainApplicationString;
withAppUpdater.patchAndroidManifestString = patchAndroidManifestString;
module.exports = withAppUpdater;
