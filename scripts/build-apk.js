/**
 * scripts/build-apk.js
 *
 * Gera APK standalone Android em dois perfis:
 *   - prod (`npm run build:apk`):     EXPO_PUBLIC_DEV_MENU desativado (menu dev oculto)
 *   - dev  (`npm run build:apk:dev`): EXPO_PUBLIC_DEV_MENU=1 (menu dev </> visível no APK)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPatchAndroid } = require('./patch-android');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveBuildEnv(mode, baseEnv = process.env) {
  const nextEnv = { ...baseEnv };
  if (mode === 'dev') {
    nextEnv.EXPO_PUBLIC_DEV_MENU = '1';
  } else {
    delete nextEnv.EXPO_PUBLIC_DEV_MENU;
  }
  return nextEnv;
}

function clearReleaseBundleCache(projectRoot = PROJECT_ROOT) {
  const cacheDirs = [
    path.join(projectRoot, 'android', 'app', 'build', 'generated', 'assets', 'createBundleReleaseJsAndAssets'),
    path.join(projectRoot, 'android', 'app', 'build', 'intermediates', 'assets', 'release'),
    path.join(projectRoot, 'android', 'app', 'build', 'intermediates', 'compressed_assets', 'release'),
  ];
  for (const dir of cacheDirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function runBuildApk(modeArg = process.argv[2]) {
  const mode = modeArg === 'dev' ? 'dev' : 'prod';
  console.log(`\n[SonaryPro] 📦 Buildando APK Android (${mode === 'dev' ? 'DEV com Menu Dev' : 'PROD'})...\n`);

  runPatchAndroid();
  // Evita que o Gradle reaproveite o bundle JS anterior ao alternar entre build:apk:dev e build:apk.
  clearReleaseBundleCache(PROJECT_ROOT);

  const buildGradlePath = path.join(PROJECT_ROOT, 'android', 'app', 'build.gradle');
  const supportsResetFlag =
    fs.existsSync(buildGradlePath) && fs.readFileSync(buildGradlePath, 'utf8').includes('sonaryResetCache');

  const cmd = supportsResetFlag
    ? 'npx react-native build-android --tasks assembleRelease --extra-params -PsonaryResetCache'
    : 'npx react-native build-android --tasks assembleRelease';

  execSync(cmd, {
    cwd: PROJECT_ROOT,
    env: resolveBuildEnv(mode),
    stdio: 'inherit',
  });

  const apkPath = path.join(PROJECT_ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  console.log(`\n[SonaryPro] ✅ APK (${mode.toUpperCase()}) gerado em: ${apkPath}\n`);
}

if (require.main === module) {
  runBuildApk();
}

module.exports = {
  resolveBuildEnv,
  clearReleaseBundleCache,
};

