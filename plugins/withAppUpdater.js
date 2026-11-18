const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');

const REQUEST_INSTALL_PERM = 'android.permission.REQUEST_INSTALL_PACKAGES';
const UPDATER_PROVIDER_AUTHORITY = '${applicationId}.updater.fileprovider';
const UPDATER_PACKAGE_IMPORT = 'import com.sonarypro.app.updater.SonaryUpdaterPackage';

const FILE_PROVIDER_PATHS_XML = `<?xml version="1.0" encoding="utf-8"?>
<paths>
  <cache-path name="updater_cache" path="updates/" />
  <files-path name="updater_files" path="updates/" />
</paths>
`;

const KOTLIN_FILES = {
  'SonaryUpdaterModule.kt': `package com.sonarypro.app.updater

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.Executors

class SonaryUpdaterModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val ioExecutor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "SonaryAppUpdater"

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
  if (!next.includes(REQUEST_INSTALL_PERM)) {
    next = next.replace(
      /(<manifest[^>]*>)/,
      `$1\n  <uses-permission android:name="${REQUEST_INSTALL_PERM}"/>`
    );
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
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const hasPerm = manifest.manifest['uses-permission'].some(
      (p) => p.$ && p.$['android:name'] === REQUEST_INSTALL_PERM
    );
    if (!hasPerm) {
      manifest.manifest['uses-permission'].push({
        $: { 'android:name': REQUEST_INSTALL_PERM },
      });
    }

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
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
withAppUpdater.patchMainApplicationString = patchMainApplicationString;
withAppUpdater.patchAndroidManifestString = patchAndroidManifestString;
module.exports = withAppUpdater;
