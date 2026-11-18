/**
 * scripts/patch-android.js
 *
 * Script de Automação e Blindagem da Pasta Nativa Android (Zero-Config / CNG)
 *
 * Garante que todas as configurações críticas nativas exigidas pelo SonaryPro
 * estejam presentes na pasta android/ mesmo após clonar o repositório ou rodar
 * "npx expo prebuild --clean".
 *
 * Pode ser executado a qualquer momento:
 *   node scripts/patch-android.js
 *   npm run patch:android
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { applyBlackSplashTheme } = require('../plugins/withAndroidStartupFix');
const { patchTrackPlayerMusicService } = require('../plugins/withTrackPlayerFGS');
const { applyBackgroundDownloadPatches } = require('../plugins/withBackgroundDownloads');
const { applyReleaseSigningPatch } = require('../plugins/withReleaseSigning');
const { applyAppUpdaterPatches } = require('../plugins/withAppUpdater');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(PROJECT_ROOT, 'android');
const ASSETS_HASH_FILE = '.sonary-assets-hash';

function loadAppConfig(projectRoot = PROJECT_ROOT) {
  const appJsonPath = path.join(projectRoot, 'app.json');
  return JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
}

function computeAndroidAssetsHash(projectRoot = PROJECT_ROOT) {
  const appConfig = loadAppConfig(projectRoot);
  const expo = appConfig.expo || {};
  const hash = crypto.createHash('sha256');
  const iconConfig = {
    name: expo.name || null,
    icon: expo.icon || null,
    splash: expo.splash || null,
    adaptiveIcon: expo.android?.adaptiveIcon || null,
  };
  hash.update(JSON.stringify(iconConfig));

  const candidatePaths = [
    expo.icon,
    expo.splash?.image,
    expo.android?.adaptiveIcon?.foregroundImage,
    expo.android?.adaptiveIcon?.monochromeImage,
  ].filter(Boolean);

  for (const relPath of [...new Set(candidatePaths)].sort()) {
    const absPath = path.join(projectRoot, relPath);
    hash.update(relPath);
    if (fs.existsSync(absPath)) {
      hash.update(fs.readFileSync(absPath));
    }
  }
  return hash.digest('hex');
}

function syncGradleVersions(buildGradlePath, appConfig) {
  if (!fs.existsSync(buildGradlePath)) return false;
  const expo = appConfig?.expo || {};
  const targetVersionCode = Number(expo.android?.versionCode);
  const targetVersionName = expo.version;
  let content = fs.readFileSync(buildGradlePath, 'utf8');
  let nextContent = content;

  if (Number.isInteger(targetVersionCode) && targetVersionCode > 0) {
    nextContent = nextContent.replace(/(\bversionCode\s+)\d+/, `$1${targetVersionCode}`);
  }
  if (typeof targetVersionName === 'string' && targetVersionName.trim()) {
    nextContent = nextContent.replace(
      /(\bversionName\s+)"[^"]*"/,
      `$1"${targetVersionName.trim()}"`
    );
  }

  if (nextContent !== content) {
    fs.writeFileSync(buildGradlePath, nextContent, 'utf8');
    return true;
  }
  return false;
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function syncAndroidAppName(androidDir, appConfig) {
  const targetName = typeof appConfig?.expo?.name === 'string' ? appConfig.expo.name.trim() : '';
  if (!targetName) return false;
  let changed = false;

  const stringsPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  if (fs.existsSync(stringsPath)) {
    const strings = fs.readFileSync(stringsPath, 'utf8');
    const escaped = escapeXmlText(targetName);
    const nextStrings = strings.replace(
      /(<string name="app_name">)[^<]*(<\/string>)/,
      `$1${escaped}$2`
    );
    if (nextStrings !== strings) {
      fs.writeFileSync(stringsPath, nextStrings, 'utf8');
      changed = true;
    }
  }

  const settingsGradlePath = path.join(androidDir, 'settings.gradle');
  if (fs.existsSync(settingsGradlePath)) {
    const settingsGradle = fs.readFileSync(settingsGradlePath, 'utf8');
    const safeGradleName = targetName.replace(/['\\\r\n]/g, '');
    const nextSettings = settingsGradle.replace(
      /(rootProject\.name\s*=\s*)(['"])[^'"]*\2/,
      `$1'${safeGradleName}'`
    );
    if (nextSettings !== settingsGradle) {
      fs.writeFileSync(settingsGradlePath, nextSettings, 'utf8');
      changed = true;
    }
  }

  return changed;
}

function syncMainActivityManifestAttrs(manifestContent) {
  return manifestContent.replace(
    /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/,
    (tag) => {
      let nextTag = /android:theme="[^"]*"/.test(tag)
        ? tag.replace(/android:theme="[^"]*"/, 'android:theme="@style/AppTheme"')
        : tag.replace(/>$/, ' android:theme="@style/AppTheme">');

      nextTag = /android:windowSoftInputMode="[^"]*"/.test(nextTag)
        ? nextTag.replace(/android:windowSoftInputMode="[^"]*"/, 'android:windowSoftInputMode="adjustNothing"')
        : nextTag.replace(/>$/, ' android:windowSoftInputMode="adjustNothing">');

      return nextTag;
    }
  );
}

function runPatchAndroid() {
console.log('\n[SonaryPro] 🛡️ Verificando e aplicando blindagem nativa Android...');

const currentAssetsHash = computeAndroidAssetsHash(PROJECT_ROOT);
const assetsHashPath = path.join(ANDROID_DIR, ASSETS_HASH_FILE);
const previousAssetsHash = fs.existsSync(assetsHashPath)
  ? fs.readFileSync(assetsHashPath, 'utf8').trim()
  : null;
const needsIconResync = previousAssetsHash !== currentAssetsHash;

// 1. Se android/ não existir ou os ícones/splash de assets/ mudaram, regenera recursos nativos
if (!fs.existsSync(ANDROID_DIR) || needsIconResync) {
  const reason = !fs.existsSync(ANDROID_DIR)
    ? 'Pasta android/ não encontrada'
    : 'Ícones/splash de assets/ atualizados';
  console.log(`[SonaryPro] 📦 ${reason}. Executando expo prebuild --platform android...`);
  try {
    execSync('npx expo prebuild --platform android', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    fs.writeFileSync(assetsHashPath, currentAssetsHash, 'utf8');
  } catch (err) {
    console.error('[SonaryPro] ❌ Falha ao executar expo prebuild:', err.message);
    process.exit(1);
  }
}

let patchesApplied = 0;

// 2. Patch: MainActivity.kt
const mainActivityPath = path.join(
  ANDROID_DIR,
  'app',
  'src',
  'main',
  'java',
  'com',
  'sonarypro',
  'app',
  'MainActivity.kt'
);

if (fs.existsSync(mainActivityPath)) {
  let content = fs.readFileSync(mainActivityPath, 'utf8');
  let modified = false;

  // Import
  if (!content.includes('DefaultDevLoadingViewImplementation')) {
    content = content.replace(
      /(package\s+[\w\.]+)/,
      `$1\n\nimport com.facebook.react.devsupport.DefaultDevLoadingViewImplementation`
    );
    modified = true;
  }

  // Desativa DevLoadingView no onCreate para prevenir deadlock de janela no Android 14
  if (!content.includes('DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)')) {
    if (content.includes('super.onCreate')) {
      content = content.replace(
        /(override\s+fun\s+onCreate\s*\([^)]*\)\s*\{)/,
        `$1\n    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)`
      );
    } else {
      content = content.replace(
        /(class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{)/,
        `$1\n  override fun onCreate(savedInstanceState: android.os.Bundle?) {\n    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)\n    super.onCreate(null)\n  }\n`
      );
    }
    modified = true;
  }

  // Força formato de janela 32-bit RGBA_8888 para reduzir color banding em gradientes escuros
  if (!content.includes('PixelFormat.RGBA_8888')) {
    content = content.replace(
      /(class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{)/,
      `$1\n  override fun onAttachedToWindow() {\n    super.onAttachedToWindow()\n    window?.setFormat(android.graphics.PixelFormat.RGBA_8888)\n  }\n`
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(mainActivityPath, content, 'utf8');
    patchesApplied++;
    console.log('[SonaryPro] ✅ MainActivity.kt: Blindagem de inicialização Android 14 aplicada.');
  } else {
    console.log('[SonaryPro] ✔️ MainActivity.kt: Já está atualizado.');
  }
} else {
  console.warn(`[SonaryPro] ⚠️ Arquivo não encontrado: ${mainActivityPath}`);
}

// 3. Patch: MainApplication.kt
const mainApplicationPath = path.join(
  ANDROID_DIR,
  'app',
  'src',
  'main',
  'java',
  'com',
  'sonarypro',
  'app',
  'MainApplication.kt'
);

if (fs.existsSync(mainApplicationPath)) {
  let content = fs.readFileSync(mainApplicationPath, 'utf8');
  let modified = false;

  // Import
  if (!content.includes('DefaultDevLoadingViewImplementation')) {
    content = content.replace(
      /(package\s+[\w\.]+)/,
      `$1\n\nimport com.facebook.react.devsupport.DefaultDevLoadingViewImplementation`
    );
    modified = true;
  }

  // Chamada dentro do onCreate
  if (!content.includes('DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)')) {
    content = content.replace(
      /(super\.onCreate\(\))/,
      `$1\n    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)`
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(mainApplicationPath, content, 'utf8');
    patchesApplied++;
    console.log('[SonaryPro] ✅ MainApplication.kt: Blindagem global aplicada.');
  } else {
    console.log('[SonaryPro] ✔️ MainApplication.kt: Já está atualizado.');
  }
} else {
  console.warn(`[SonaryPro] ⚠️ Arquivo não encontrado: ${mainApplicationPath}`);
}

// 4. Patch: AndroidManifest.xml
const manifestPath = path.join(
  ANDROID_DIR,
  'app',
  'src',
  'main',
  'AndroidManifest.xml'
);

if (fs.existsSync(manifestPath)) {
  let content = fs.readFileSync(manifestPath, 'utf8');
  let modified = false;

  // Garante service MusicService com mediaPlayback e exported="true"
  if (!content.includes('com.doublesymmetry.trackplayer.service.MusicService')) {
    const serviceTag = `    <service android:name="com.doublesymmetry.trackplayer.service.MusicService" android:foregroundServiceType="mediaPlayback" android:exported="true"/>\n`;
    content = content.replace(/(<application[^>]*>)/, `$1\n${serviceTag}`);
    modified = true;
  } else {
    // Garante foregroundServiceType e exported corretos
    content = content.replace(
      /(<service[^>]*name="com\.doublesymmetry\.trackplayer\.service\.MusicService"[^>]*>)/,
      `<service android:name="com.doublesymmetry.trackplayer.service.MusicService" android:foregroundServiceType="mediaPlayback" android:exported="true"/>`
    );
  }

  // Garante android:theme="@style/AppTheme" e android:windowSoftInputMode="adjustNothing" na MainActivity
  const updatedManifest = syncMainActivityManifestAttrs(content);
  if (updatedManifest !== content) {
    content = updatedManifest;
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(manifestPath, content, 'utf8');
    patchesApplied++;
    console.log('[SonaryPro] ✅ AndroidManifest.xml: Permissões e MusicService verificados.');
  } else {
    console.log('[SonaryPro] ✔️ AndroidManifest.xml: Já está atualizado.');
  }
} else {
  console.warn(`[SonaryPro] ⚠️ Arquivo não encontrado: ${manifestPath}`);
}

// 4b. Patch: Splash Screen & Window Background (#000000 no Android <=11 e Android 12+)
const resDir = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res');
if (applyBlackSplashTheme(resDir)) {
  patchesApplied++;
  console.log('[SonaryPro] ✅ Android Splash/Theme: Fundo preto (#000000) aplicado em values e values-v31.');
} else {
  console.log('[SonaryPro] ✔️ Android Splash/Theme: Já está com fundo preto (#000000).');
}

// 4c. Patch: Sincroniza versionCode e versionName do app.json para o build.gradle
const buildGradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
const appConfig = loadAppConfig(PROJECT_ROOT);
if (syncGradleVersions(buildGradlePath, appConfig)) {
  patchesApplied++;
  console.log(
    `[SonaryPro] ✅ build.gradle: versionCode=${appConfig.expo?.android?.versionCode} e versionName="${appConfig.expo?.version}" sincronizados.`
  );
} else {
  console.log('[SonaryPro] ✔️ build.gradle: versionCode e versionName já estão sincronizados.');
}

// 4d. Patch: Sincroniza app_name (strings.xml e settings.gradle) com app.json
if (syncAndroidAppName(ANDROID_DIR, appConfig)) {
  patchesApplied++;
  console.log(`[SonaryPro] ✅ Nome do app sincronizado: "${appConfig.expo?.name}".`);
} else {
  console.log(`[SonaryPro] ✔️ Nome do app já está sincronizado: "${appConfig.expo?.name}".`);
}

// 4e. Patch: Protege MusicService.onTaskRemoved contra NotificationForwarderActivity
if (patchTrackPlayerMusicService(PROJECT_ROOT)) {
  patchesApplied++;
  console.log('[SonaryPro] ✅ MusicService.kt: Proteção contra encerramento por notificação aplicada.');
} else {
  console.log('[SonaryPro] ✔️ MusicService.kt: Já está protegido contra encerramento por notificação.');
}

// 4f. Patch: Motor nativo de downloads em segundo plano (WorkManager + FGS dataSync)
if (applyBackgroundDownloadPatches(PROJECT_ROOT)) {
  patchesApplied++;
  console.log('[SonaryPro] ✅ Background Downloads: WorkManager, FGS dataSync e módulo nativo aplicados.');
} else {
  console.log('[SonaryPro] ✔️ Background Downloads: Já está atualizado.');
}

// 4g. Patch: Assinatura oficial de Release (env vars ou release-signing.properties)
if (applyReleaseSigningPatch(PROJECT_ROOT)) {
  patchesApplied++;
  console.log('[SonaryPro] ✅ Release Signing: Configuração de assinatura aplicada ao build.gradle.');
} else {
  console.log('[SonaryPro] ✔️ Release Signing: Já está atualizado.');
}

// 4h. Patch: Auto-Updater nativo (REQUEST_INSTALL_PACKAGES, FileProvider e SonaryUpdaterModule)
if (applyAppUpdaterPatches(PROJECT_ROOT)) {
  patchesApplied++;
  console.log('[SonaryPro] ✅ App Updater: Permissão, FileProvider e módulo nativo aplicados.');
} else {
  console.log('[SonaryPro] ✔️ App Updater: Já está atualizado.');
}

// 5. Configura adb reverse para o Metro Bundler na porta 8081 se houver dispositivo conectado
try {
  const devices = execSync('adb devices', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 });
  if (devices && devices.includes('\tdevice')) {
    execSync('adb reverse tcp:8081 tcp:8081', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 });
    console.log('[SonaryPro] 🔌 Porta 8081 mapeada com sucesso (adb reverse tcp:8081 tcp:8081).');
  }
} catch (_) {
  // Ignora se o adb não estiver disponível ou não houver dispositivo
}

console.log(`[SonaryPro] 🎉 Verificação concluída. ${patchesApplied} alteração(ões) aplicada(s).\n`);
}

if (require.main === module) {
  runPatchAndroid();
}

module.exports = {
  computeAndroidAssetsHash,
  syncGradleVersions,
  syncAndroidAppName,
  syncMainActivityManifestAttrs,
  runPatchAndroid,
};

