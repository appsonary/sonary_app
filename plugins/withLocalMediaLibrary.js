const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');

const READ_MEDIA_AUDIO_PERM = 'android.permission.READ_MEDIA_AUDIO';
const READ_EXTERNAL_STORAGE_PERM = 'android.permission.READ_EXTERNAL_STORAGE';
const LOCAL_MEDIA_PACKAGE_IMPORT = 'import com.sonarypro.app.localmedia.SonaryLocalMediaPackage';

const KOTLIN_FILES = {
  'SonaryLocalMediaModule.kt': `package com.sonarypro.app.localmedia

import android.app.Activity
import android.app.RecoverableSecurityException
import android.content.ContentUris
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

private const val DELETE_MEDIA_REQUEST_CODE = 42081
private const val MIN_VALID_AUDIO_BYTES = 10_240L
private const val MAX_ARTWORK_DIMENSION = 400

class SonaryLocalMediaModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var pendingDeletePromise: Promise? = null
  private var pendingDeleteUri: Uri? = null

  private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity?,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode != DELETE_MEDIA_REQUEST_CODE) return
      val promise = pendingDeletePromise ?: return
      val uri = pendingDeleteUri
      pendingDeletePromise = null
      pendingDeleteUri = null

      val map = Arguments.createMap()
      if (resultCode == Activity.RESULT_OK) {
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && uri != null) {
          try {
            val rows = reactContext.contentResolver.delete(uri, null, null)
            map.putBoolean("deleted", rows > 0)
            map.putBoolean("cancelled", false)
            promise.resolve(map)
            return
          } catch (err: Throwable) {
            promise.reject("LOCAL_MEDIA_DELETE_FAILED", err.message ?: "Falha ao apagar arquivo", err)
            return
          }
        }
        map.putBoolean("deleted", true)
        map.putBoolean("cancelled", false)
        promise.resolve(map)
      } else {
        map.putBoolean("deleted", false)
        map.putBoolean("cancelled", true)
        promise.resolve(map)
      }
    }
  }

  init {
    reactContext.addActivityEventListener(activityEventListener)
  }

  override fun getName(): String = "SonaryLocalMedia"

  override fun invalidate() {
    super.invalidate()
    reactContext.removeActivityEventListener(activityEventListener)
    scope.cancel()
  }

  private fun parseCachedSignatures(rawJson: String?): Map<String, Pair<Long, Long>> {
    if (rawJson.isNullOrBlank()) return emptyMap()
    val result = HashMap<String, Pair<Long, Long>>()
    try {
      val root = JSONObject(rawJson)
      val keys = root.keys()
      while (keys.hasNext()) {
        val id = keys.next()
        val obj = root.optJSONObject(id) ?: continue
        val dateMod = obj.optLong("dateModified", -1L)
        val size = obj.optLong("fileSize", -1L)
        result[id] = Pair(dateMod, size)
      }
    } catch (_: Throwable) {
      // Ignora cache malformado e faz varredura completa
    }
    return result
  }

  private fun extractFolderName(relativePath: String?, legacyDataPath: String?): Pair<String, String> {
    val cleanRel = (relativePath ?: "").trim().replace("\\\\", "/").trimEnd('/')
    if (cleanRel.isNotEmpty()) {
      val folder = cleanRel.substringAfterLast('/').ifBlank { cleanRel }
      return Pair(folder, cleanRel)
    }
    val legacy = (legacyDataPath ?: "").trim().replace("\\\\", "/")
    if (legacy.isNotEmpty()) {
      val parent = legacy.substringBeforeLast('/', "")
      val folder = parent.substringAfterLast('/').ifBlank { "Armazenamento" }
      return Pair(folder, parent.ifBlank { folder })
    }
    return Pair("Armazenamento", "")
  }

  private fun saveEmbeddedArtwork(mediaStoreId: String, pictureBytes: ByteArray): String? {
    return try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(pictureBytes, 0, pictureBytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

      var sampleSize = 1
      val maxDim = maxOf(bounds.outWidth, bounds.outHeight)
      while (maxDim / sampleSize > MAX_ARTWORK_DIMENSION * 2) {
        sampleSize *= 2
      }
      val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sampleSize }
      val decoded = BitmapFactory.decodeByteArray(pictureBytes, 0, pictureBytes.size, decodeOpts)
        ?: return null

      val finalBitmap = if (decoded.width > MAX_ARTWORK_DIMENSION || decoded.height > MAX_ARTWORK_DIMENSION) {
        val ratio = MAX_ARTWORK_DIMENSION.toFloat() / maxOf(decoded.width, decoded.height).toFloat()
        val targetW = maxOf(1, (decoded.width * ratio).toInt())
        val targetH = maxOf(1, (decoded.height * ratio).toInt())
        val scaled = Bitmap.createScaledBitmap(decoded, targetW, targetH, true)
        if (scaled != decoded) decoded.recycle()
        scaled
      } else {
        decoded
      }

      val artDir = File(reactContext.filesDir, "local_artwork")
      if (!artDir.exists()) artDir.mkdirs()
      val outFile = File(artDir, "local_\${mediaStoreId}.jpg")
      FileOutputStream(outFile).use { fos ->
        finalBitmap.compress(Bitmap.CompressFormat.JPEG, 82, fos)
      }
      finalBitmap.recycle()
      Uri.fromFile(outFile).toString()
    } catch (_: Throwable) {
      null
    }
  }

  private data class ValidationResult(
    val isCorrupted: Boolean,
    val corruptionReason: String?,
    val title: String?,
    val artist: String?,
    val album: String?,
    val durationSec: Int,
    val artworkUri: String?,
  )

  private fun validateAndExtractMetadata(
    contentUri: Uri,
    mediaStoreId: String,
    fileSize: Long,
    fallbackDurationMs: Long,
  ): ValidationResult {
    if (fileSize in 0 until MIN_VALID_AUDIO_BYTES) {
      return ValidationResult(
        isCorrupted = true,
        corruptionReason = "Arquivo vazio ou incompleto",
        title = null,
        artist = null,
        album = null,
        durationSec = 0,
        artworkUri = null,
      )
    }

    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(reactContext, contentUri)
      val hasAudio = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)
      val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
      val durationMs = durationStr?.toLongOrNull() ?: fallbackDurationMs

      var confirmedAudio = hasAudio.equals("yes", ignoreCase = true)
      if (!confirmedAudio) {
        val extractor = MediaExtractor()
        try {
          extractor.setDataSource(reactContext, contentUri, null)
          for (i in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
            if (mime.startsWith("audio/")) {
              confirmedAudio = true
              break
            }
          }
        } catch (_: Throwable) {
          confirmedAudio = false
        } finally {
          try {
            extractor.release()
          } catch (_: Throwable) {
          }
        }
      }

      if (!confirmedAudio) {
        return ValidationResult(
          isCorrupted = true,
          corruptionReason = "Sem trilha de áudio válida",
          title = null,
          artist = null,
          album = null,
          durationSec = 0,
          artworkUri = null,
        )
      }

      if (durationMs <= 0L) {
        return ValidationResult(
          isCorrupted = true,
          corruptionReason = "Arquivo corrompido ou duração inválida",
          title = null,
          artist = null,
          album = null,
          durationSec = 0,
          artworkUri = null,
        )
      }

      val title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
      val artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
        ?: retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)
      val album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
      val embedded = retriever.embeddedPicture
      val artUri = if (embedded != null && embedded.isNotEmpty()) {
        saveEmbeddedArtwork(mediaStoreId, embedded)
      } else {
        null
      }

      return ValidationResult(
        isCorrupted = false,
        corruptionReason = null,
        title = title,
        artist = artist,
        album = album,
        durationSec = (durationMs / 1000L).toInt().coerceAtLeast(0),
        artworkUri = artUri,
      )
    } catch (sec: SecurityException) {
      return ValidationResult(
        isCorrupted = true,
        corruptionReason = "Sem permissão ou arquivo inacessível",
        title = null,
        artist = null,
        album = null,
        durationSec = 0,
        artworkUri = null,
      )
    } catch (_: Throwable) {
      return ValidationResult(
        isCorrupted = true,
        corruptionReason = "Arquivo corrompido ou formato incompatível",
        title = null,
        artist = null,
        album = null,
        durationSec = 0,
        artworkUri = null,
      )
    } finally {
      try {
        retriever.release()
      } catch (_: Throwable) {
      }
    }
  }

  @ReactMethod
  fun scanDeviceAudio(cachedSignaturesJson: String?, promise: Promise) {
    scope.launch {
      try {
        val cachedSignatures = parseCachedSignatures(cachedSignaturesJson)
        val projection = mutableListOf(
          MediaStore.Audio.Media._ID,
          MediaStore.Audio.Media.DISPLAY_NAME,
          MediaStore.Audio.Media.TITLE,
          MediaStore.Audio.Media.ARTIST,
          MediaStore.Audio.Media.ALBUM,
          MediaStore.Audio.Media.DURATION,
          MediaStore.Audio.Media.SIZE,
          MediaStore.Audio.Media.MIME_TYPE,
          MediaStore.Audio.Media.DATE_MODIFIED,
          MediaStore.Audio.Media.IS_RINGTONE,
          MediaStore.Audio.Media.IS_ALARM,
          MediaStore.Audio.Media.IS_NOTIFICATION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          projection.add(MediaStore.Audio.Media.RELATIVE_PATH)
        } else {
          @Suppress("DEPRECATION")
          projection.add(MediaStore.Audio.Media.DATA)
        }

        val selection =
          "\${MediaStore.Audio.Media.IS_RINGTONE} = 0 AND " +
          "\${MediaStore.Audio.Media.IS_ALARM} = 0 AND " +
          "\${MediaStore.Audio.Media.IS_NOTIFICATION} = 0"
        val sortOrder = "\${MediaStore.Audio.Media.DATE_MODIFIED} DESC"

        val items = Arguments.createArray()
        reactContext.contentResolver.query(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          projection.toTypedArray(),
          selection,
          null,
          sortOrder,
        )?.use { cursor ->
          val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
          val nameCol = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME)
          val titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE)
          val artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST)
          val albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM)
          val durationCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION)
          val sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE)
          val mimeCol = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE)
          val modCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_MODIFIED)
          val relCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
          } else {
            -1
          }
          @Suppress("DEPRECATION")
          val dataCol = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            cursor.getColumnIndex(MediaStore.Audio.Media.DATA)
          } else {
            -1
          }

          while (cursor.moveToNext()) {
            val numericId = cursor.getLong(idCol)
            val mediaStoreId = numericId.toString()
            val contentUri = ContentUris.withAppendedId(
              MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
              numericId,
            )
            val fileName = if (nameCol >= 0) cursor.getString(nameCol) ?: "" else ""
            val msTitle = if (titleCol >= 0) cursor.getString(titleCol) else null
            val msArtist = if (artistCol >= 0) cursor.getString(artistCol) else null
            val msAlbum = if (albumCol >= 0) cursor.getString(albumCol) else null
            val msDurationMs = if (durationCol >= 0) cursor.getLong(durationCol) else 0L
            val fileSize = if (sizeCol >= 0) cursor.getLong(sizeCol) else 0L
            val mimeType = if (mimeCol >= 0) cursor.getString(mimeCol) ?: "" else ""
            val dateModified = if (modCol >= 0) cursor.getLong(modCol) else 0L
            val relRaw = if (relCol >= 0) cursor.getString(relCol) else null
            val dataRaw = if (dataCol >= 0) cursor.getString(dataCol) else null
            val (folderName, relativePath) = extractFolderName(relRaw, dataRaw)

            val trackId = "local_\$mediaStoreId"
            val cached = cachedSignatures[trackId]
            val entry = Arguments.createMap().apply {
              putString("id", trackId)
              putString("mediaStoreId", mediaStoreId)
              putString("contentUri", contentUri.toString())
              putString("fileName", fileName)
              putString("folderName", folderName)
              putString("relativePath", relativePath)
              putString("mimeType", mimeType)
              putDouble("fileSize", fileSize.toDouble())
              putDouble("dateModified", dateModified.toDouble())
            }

            if (cached != null && cached.first == dateModified && cached.second == fileSize) {
              val isAccessible = try {
                reactContext.contentResolver.openAssetFileDescriptor(contentUri, "r")?.use { true } ?: false
              } catch (_: Throwable) {
                false
              }
              if (isAccessible) {
                entry.putBoolean("unchanged", true)
                items.pushMap(entry)
                continue
              }
            }

            entry.putBoolean("unchanged", false)
            val validation = validateAndExtractMetadata(
              contentUri = contentUri,
              mediaStoreId = mediaStoreId,
              fileSize = fileSize,
              fallbackDurationMs = msDurationMs,
            )

            entry.putBoolean("isCorrupted", validation.isCorrupted)
            if (validation.corruptionReason != null) {
              entry.putString("corruptionReason", validation.corruptionReason)
            } else {
              entry.putNull("corruptionReason")
            }
            entry.putString("title", validation.title ?: msTitle ?: "")
            entry.putString("artist", validation.artist ?: msArtist ?: "")
            entry.putString("album", validation.album ?: msAlbum ?: "")
            entry.putInt(
              "duration",
              if (validation.durationSec > 0) validation.durationSec else (msDurationMs / 1000L).toInt().coerceAtLeast(0),
            )
            if (validation.artworkUri != null) {
              entry.putString("artworkUri", validation.artworkUri)
            } else {
              entry.putNull("artworkUri")
            }

            items.pushMap(entry)
          }
        }

        promise.resolve(items)
      } catch (err: Throwable) {
        promise.reject("LOCAL_MEDIA_SCAN_FAILED", err.message ?: "Falha ao escanear áudios", err)
      }
    }
  }

  @ReactMethod
  fun verifyTrackPlayable(contentUriString: String, mediaStoreId: String, promise: Promise) {
    scope.launch {
      try {
        val uri = Uri.parse(contentUriString)
        var fileSize = -1L
        try {
          reactContext.contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
            fileSize = afd.length
          }
        } catch (_: Throwable) {
          fileSize = -1L
        }
        val validation = validateAndExtractMetadata(
          contentUri = uri,
          mediaStoreId = mediaStoreId,
          fileSize = if (fileSize >= 0L) fileSize else MIN_VALID_AUDIO_BYTES,
          fallbackDurationMs = 0L,
        )
        val map = Arguments.createMap().apply {
          putBoolean("isCorrupted", validation.isCorrupted)
          if (validation.corruptionReason != null) {
            putString("corruptionReason", validation.corruptionReason)
          } else {
            putNull("corruptionReason")
          }
          if (validation.title != null) putString("title", validation.title) else putNull("title")
          if (validation.artist != null) putString("artist", validation.artist) else putNull("artist")
          if (validation.album != null) putString("album", validation.album) else putNull("album")
          putInt("duration", validation.durationSec)
          if (validation.artworkUri != null) putString("artworkUri", validation.artworkUri) else putNull("artworkUri")
        }
        promise.resolve(map)
      } catch (err: Throwable) {
        promise.reject("LOCAL_MEDIA_VERIFY_FAILED", err.message ?: "Falha ao validar arquivo", err)
      }
    }
  }

  @ReactMethod
  fun requestDeleteMedia(contentUriString: String, promise: Promise) {
    val uri = try {
      Uri.parse(contentUriString)
    } catch (err: Throwable) {
      promise.reject("LOCAL_MEDIA_INVALID_URI", "URI inválida", err)
      return
    }

    val activity = currentActivity
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (activity == null) {
        promise.reject("LOCAL_MEDIA_NO_ACTIVITY", "Activity indisponível para confirmação de exclusão")
        return
      }
      if (pendingDeletePromise != null) {
        promise.reject("LOCAL_MEDIA_DELETE_BUSY", "Já existe uma exclusão em andamento")
        return
      }
      try {
        val pendingIntent = MediaStore.createDeleteRequest(reactContext.contentResolver, listOf(uri))
        pendingDeletePromise = promise
        pendingDeleteUri = uri
        activity.startIntentSenderForResult(
          pendingIntent.intentSender,
          DELETE_MEDIA_REQUEST_CODE,
          null,
          0,
          0,
          0,
        )
      } catch (err: Throwable) {
        pendingDeletePromise = null
        pendingDeleteUri = null
        promise.reject("LOCAL_MEDIA_DELETE_FAILED", err.message ?: "Falha ao solicitar exclusão", err)
      }
      return
    }

    if (pendingDeletePromise != null) {
      promise.reject("LOCAL_MEDIA_DELETE_BUSY", "Já existe uma exclusão em andamento")
      return
    }

    scope.launch {
      try {
        val rows = reactContext.contentResolver.delete(uri, null, null)
        val map = Arguments.createMap().apply {
          putBoolean("deleted", rows > 0)
          putBoolean("cancelled", false)
        }
        promise.resolve(map)
      } catch (err: SecurityException) {
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && err is RecoverableSecurityException && activity != null) {
          activity.runOnUiThread {
            try {
              pendingDeletePromise = promise
              pendingDeleteUri = uri
              activity.startIntentSenderForResult(
                err.userAction.actionIntent.intentSender,
                DELETE_MEDIA_REQUEST_CODE,
                null,
                0,
                0,
                0,
              )
            } catch (senderErr: Throwable) {
              pendingDeletePromise = null
              pendingDeleteUri = null
              promise.reject("LOCAL_MEDIA_DELETE_FAILED", senderErr.message ?: "Falha ao confirmar exclusão", senderErr)
            }
          }
        } else {
          promise.reject("LOCAL_MEDIA_DELETE_DENIED", err.message ?: "Sem permissão para apagar arquivo", err)
        }
      } catch (err: Throwable) {
        promise.reject("LOCAL_MEDIA_DELETE_FAILED", err.message ?: "Falha ao apagar arquivo", err)
      }
    }
  }
}
`,
  'SonaryLocalMediaPackage.kt': `package com.sonarypro.app.localmedia

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SonaryLocalMediaPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(SonaryLocalMediaModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`,
};

function syncLocalMediaKotlinFiles(projectRoot) {
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
    'localmedia'
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

  return changed;
}

function patchMainApplicationString(contents) {
  let next = contents;
  if (!next.includes(LOCAL_MEDIA_PACKAGE_IMPORT)) {
    next = next.replace(/(package\s+[\w.]+)/, `$1\n\n${LOCAL_MEDIA_PACKAGE_IMPORT}`);
  }
  if (!next.includes('SonaryLocalMediaPackage()')) {
    if (next.includes('PackageList(this).packages.apply {')) {
      next = next.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        `$1\n              add(SonaryLocalMediaPackage())`
      );
    } else if (next.includes('PackageList(this).packages')) {
      next = next.replace(
        /PackageList\(this\)\.packages/,
        `PackageList(this).packages.apply {\n              add(SonaryLocalMediaPackage())\n            }`
      );
    }
  }
  return next;
}

function patchAndroidManifestString(contents) {
  let next = contents;
  if (!next.includes(READ_MEDIA_AUDIO_PERM)) {
    next = next.replace(
      /(<manifest[^>]*>)/,
      `$1\n  <uses-permission android:name="${READ_MEDIA_AUDIO_PERM}"/>`
    );
  }
  // Limita READ_EXTERNAL_STORAGE para API <= 32 para boas práticas Android 13+
  next = next.replace(
    /<uses-permission\s+android:name="android\.permission\.READ_EXTERNAL_STORAGE"\s*\/>/,
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/>'
  );
  return next;
}

function applyLocalMediaLibraryPatches(projectRoot) {
  const androidDir = path.join(projectRoot, 'android');
  if (!fs.existsSync(androidDir)) return false;
  let changed = false;

  if (syncLocalMediaKotlinFiles(projectRoot)) {
    changed = true;
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

const withLocalMediaLibrary = (config) => {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const perms = manifest.manifest['uses-permission'];

    const hasReadAudio = perms.some((p) => p.$ && p.$['android:name'] === READ_MEDIA_AUDIO_PERM);
    if (!hasReadAudio) {
      perms.push({ $: { 'android:name': READ_MEDIA_AUDIO_PERM } });
    }

    const readExt = perms.find((p) => p.$ && p.$['android:name'] === READ_EXTERNAL_STORAGE_PERM);
    if (readExt && !readExt.$['android:maxSdkVersion']) {
      readExt.$['android:maxSdkVersion'] = '32';
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
      syncLocalMediaKotlinFiles(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);

  return config;
};

withLocalMediaLibrary.applyLocalMediaLibraryPatches = applyLocalMediaLibraryPatches;
withLocalMediaLibrary.patchMainApplicationString = patchMainApplicationString;
withLocalMediaLibrary.patchAndroidManifestString = patchAndroidManifestString;
module.exports = withLocalMediaLibrary;
