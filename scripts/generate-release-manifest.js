/**
 * scripts/generate-release-manifest.js
 *
 * Gera `latest.json` e `checksums.txt` para publicação no GitHub Releases
 * a partir do APK compilado e dos metadados de `app.json`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_APK_PATH = path.join(
  PROJECT_ROOT,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk'
);
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, 'dist-release');

function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function generateReleaseArtifacts({
  apkPath = DEFAULT_APK_PATH,
  outDir = DEFAULT_OUT_DIR,
  repo = process.env.GITHUB_REPOSITORY || 'appsonary/sonary_app',
  releaseBaseUrl = process.env.RELEASE_BASE_URL || '',
  releaseNotes = process.env.RELEASE_NOTES || '',
} = {}) {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`APK de release não encontrado em: ${apkPath}`);
  }

  const appJson = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')
  );
  const versionName = String(appJson?.expo?.version || '1.0.0').trim();
  const versionCode = Number(appJson?.expo?.android?.versionCode || 1);
  const apkName = `sonary-pro-v${versionName}.apk`;

  fs.mkdirSync(outDir, { recursive: true });
  const targetApkPath = path.join(outDir, apkName);
  fs.copyFileSync(apkPath, targetApkPath);

  const sha256 = computeFileSha256(targetApkPath);
  const sizeBytes = fs.statSync(targetApkPath).size;
  const tag = `v${versionName}`;

  const cleanBaseUrl = String(releaseBaseUrl || '').trim().replace(/\/+$/, '');
  const manifest = {
    versionName,
    versionCode,
    apkName,
    apkUrl: cleanBaseUrl
      ? `${cleanBaseUrl}/${apkName}`
      : `https://github.com/${repo}/releases/download/${tag}/${apkName}`,
    releaseUrl: cleanBaseUrl
      ? `${cleanBaseUrl}/`
      : `https://github.com/${repo}/releases/tag/${tag}`,
    sha256,
    sizeBytes,
    releaseNotes: releaseNotes.trim(),
    publishedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(outDir, 'latest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const checksumsPath = path.join(outDir, 'checksums.txt');
  fs.writeFileSync(checksumsPath, `${sha256}  ${apkName}\n`, 'utf8');

  return {
    manifest,
    targetApkPath,
    manifestPath,
    checksumsPath,
  };
}

if (require.main === module) {
  const result = generateReleaseArtifacts({
    apkPath: process.argv[2] || DEFAULT_APK_PATH,
    outDir: process.argv[3] || DEFAULT_OUT_DIR,
  });
  console.log('[SonaryPro] ✅ Artefatos de release gerados em:', path.dirname(result.manifestPath));
  console.log('  APK     :', result.targetApkPath);
  console.log('  Manifest:', result.manifestPath);
  console.log('  SHA-256 :', result.manifest.sha256);
}

module.exports = {
  computeFileSha256,
  generateReleaseArtifacts,
};
