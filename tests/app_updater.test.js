// tests/app_updater.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const { NativeModules } = require('react-native');
const FileSystem = require('expo-file-system');
const {
  actAsync,
  findButtonByText,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const { initDatabase } = require('../services/database');
const {
  compareSemver,
  isNewerRelease,
  isTrustedGitHubUrl,
  checkForAppUpdate,
  skipAppUpdateVersion,
  downloadUpdateApk,
  installUpdateApk,
  cleanupCachedUpdateApks,
} = require('../services/updater');
const { UpdateModal } = require('../components/UpdateModal');
const { patchBuildGradleSigning } = require('../plugins/withReleaseSigning');
const {
  patchMainApplicationString,
  patchAndroidManifestString,
} = require('../plugins/withAppUpdater');
const { computeNextVersion, parseReleaseArgs } = require('../scripts/release');

test.beforeEach(async () => {
  resetAllMocks();
  delete NativeModules.SonaryAppUpdater;
  await initDatabase();
});

test.afterEach(() => {
  delete NativeModules.SonaryAppUpdater;
});

test('Updater: compareSemver, isNewerRelease e isTrustedGitHubUrl', () => {
  assert.strictEqual(compareSemver('1.0.2', '1.0.1'), 1);
  assert.strictEqual(compareSemver('v1.1.0', '1.0.9'), 1);
  assert.strictEqual(compareSemver('1.0.1', '1.0.1'), 0);
  assert.strictEqual(compareSemver('1.0.0', '1.0.1'), -1);

  assert.strictEqual(
    isNewerRelease(
      { versionName: '1.0.1', versionCode: 3 },
      { versionName: '1.0.1', versionCode: 4 }
    ),
    true
  );
  assert.strictEqual(
    isNewerRelease(
      { versionName: '1.0.1', versionCode: 3 },
      { versionName: '1.0.2', versionCode: null }
    ),
    true
  );
  assert.strictEqual(
    isNewerRelease(
      { versionName: '1.0.2', versionCode: 4 },
      { versionName: '1.0.1', versionCode: 3 }
    ),
    false
  );

  assert.strictEqual(
    isTrustedGitHubUrl('https://github.com/appsonary/sonary_app/releases/download/v1.0.2/sonary.apk'),
    true
  );
  assert.strictEqual(
    isTrustedGitHubUrl('https://objects.githubusercontent.com/github-production-release-asset/foo.apk'),
    true
  );
  assert.strictEqual(
    isTrustedGitHubUrl('http://github.com/appsonary/sonary_app/releases/download/v1.0.2/sonary.apk'),
    false
  );
  assert.strictEqual(
    isTrustedGitHubUrl('https://evil.example.com/sonary.apk'),
    false
  );
});

test('Updater: checkForAppUpdate lê latest.json, aplica throttle de 24h e respeita versão ignorada', async () => {
  let calls = 0;
  const fetchMock = async (url) => {
    calls += 1;
    assert.ok(url.endsWith('/releases/latest/download/latest.json'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        versionName: '1.2.0',
        versionCode: 5,
        apkName: 'sonary-pro-v1.2.0.apk',
        apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
        sha256: 'a'.repeat(64),
        sizeBytes: 42000000,
        releaseNotes: 'Auto-updater nativo adicionado.',
      }),
    };
  };

  const t0 = 1_700_000_000_000;
  const first = await checkForAppUpdate({ fetchImpl: fetchMock, nowMs: t0 });
  assert.strictEqual(first.status, 'update_available');
  assert.strictEqual(first.release.versionName, '1.2.0');
  assert.strictEqual(calls, 1);

  // Segunda chamada dentro de 24h sem force deve respeitar throttle
  const throttled = await checkForAppUpdate({ fetchImpl: fetchMock, nowMs: t0 + 60_000 });
  assert.strictEqual(throttled.status, 'throttled');
  assert.strictEqual(calls, 1);

  // Usuário pula a versão 1.2.0
  await skipAppUpdateVersion('1.2.0');
  const afterSkip = await checkForAppUpdate({
    fetchImpl: fetchMock,
    nowMs: t0 + 25 * 60 * 60 * 1000,
  });
  assert.strictEqual(afterSkip.status, 'up_to_date');

  // Checagem manual (force: true) continua exibindo a atualização
  const forced = await checkForAppUpdate({
    force: true,
    fetchImpl: fetchMock,
    nowMs: t0 + 25 * 60 * 60 * 1000,
  });
  assert.strictEqual(forced.status, 'update_available');
});

test('Updater: checkForAppUpdate faz fallback para API do GitHub quando latest.json não existe', async () => {
  const fetchMock = async (url) => {
    if (url.endsWith('latest.json')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v1.3.0',
        body: 'Notas via API',
        html_url: 'https://github.com/appsonary/sonary_app/releases/tag/v1.3.0',
        assets: [
          {
            name: 'sonary-pro-v1.3.0-release.apk',
            size: 51200000,
            browser_download_url:
              'https://github.com/appsonary/sonary_app/releases/download/v1.3.0/sonary-pro-v1.3.0-release.apk',
          },
        ],
      }),
    };
  };

  const res = await checkForAppUpdate({ force: true, fetchImpl: fetchMock });
  assert.strictEqual(res.status, 'update_available');
  assert.strictEqual(res.release.versionName, '1.3.0');
  assert.strictEqual(res.release.releaseNotes, 'Notas via API');
});

test('Updater: downloadUpdateApk valida URL, SHA-256 e delega instalação ao módulo nativo', async () => {
  let installedUri = null;
  let canInstall = false;

  NativeModules.SonaryAppUpdater = {
    verifySha256: async (_uri, expected) => expected === 'b'.repeat(64),
    canRequestPackageInstalls: async () => canInstall,
    installApk: async (uri) => {
      installedUri = uri;
    },
  };

  await assert.rejects(
    () =>
      downloadUpdateApk({
        versionName: '2.0.0',
        versionCode: 9,
        apkName: 'evil.apk',
        apkUrl: 'https://evil.example.com/evil.apk',
        sha256: null,
        sizeBytes: null,
        releaseNotes: '',
        releaseUrl: 'https://github.com/appsonary/sonary_app/releases',
      }),
    /não pertence ao GitHub/
  );

  // Hash inválido deve apagar arquivo e falhar
  await assert.rejects(
    () =>
      downloadUpdateApk({
        versionName: '2.0.0',
        versionCode: 9,
        apkName: 'sonary-pro-v2.0.0.apk',
        apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v2.0.0/sonary-pro-v2.0.0.apk',
        sha256: 'c'.repeat(64),
        sizeBytes: 3145728,
        releaseNotes: '',
        releaseUrl: 'https://github.com/appsonary/sonary_app/releases',
      }),
    /SHA-256/
  );

  // Hash válido baixa e persiste
  const dl = await downloadUpdateApk({
    versionName: '2.0.0',
    versionCode: 9,
    apkName: 'sonary-pro-v2.0.0.apk',
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v2.0.0/sonary-pro-v2.0.0.apk',
    sha256: 'b'.repeat(64),
    sizeBytes: 3145728,
    releaseNotes: '',
    releaseUrl: 'https://github.com/appsonary/sonary_app/releases',
  });
  assert.strictEqual(dl.sha256Verified, true);
  assert.ok(FileSystem.files.has(dl.localUri));

  // Sem permissão de fontes desconhecidas retorna permission_required
  assert.strictEqual(await installUpdateApk(dl.localUri), 'permission_required');
  assert.strictEqual(installedUri, null);

  // Com permissão concedida abre instalador nativo
  canInstall = true;
  assert.strictEqual(await installUpdateApk(dl.localUri), 'installed');
  assert.strictEqual(installedUri, dl.localUri);

  await cleanupCachedUpdateApks();
  assert.strictEqual(FileSystem.files.has(dl.localUri), false);
});

test('Updater UI: UpdateModal exibe notas, fluxo de atualização e botão de pular versão', async () => {
  let skippedVersion = null;
  let closed = false;
  let installCalled = false;

  NativeModules.SonaryAppUpdater = {
    verifySha256: async () => true,
    canRequestPackageInstalls: async () => true,
    installApk: async () => {
      installCalled = true;
    },
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: { versionName: '1.0.1', versionCode: 3 },
        release: {
          versionName: '1.2.0',
          versionCode: 5,
          apkName: 'sonary-pro-v1.2.0.apk',
          apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
          sha256: 'a'.repeat(64),
          sizeBytes: 40 * 1024 * 1024,
          releaseNotes: 'Melhorias de estabilidade.',
          releaseUrl: 'https://github.com/appsonary/sonary_app/releases/tag/v1.2.0',
        },
        onClose: () => {
          closed = true;
        },
        onSkipVersion: (v) => {
          skippedVersion = v;
        },
      })
    );
  });

  const modalText = getAllText(tree.root);
  assert.ok(modalText.includes('Nova versão disponível'));
  assert.ok(modalText.includes('v1.2.0'));
  assert.ok(modalText.includes('Melhorias de estabilidade.'));

  const skipBtn = tree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ignorar esta versão'
  );
  assert.ok(skipBtn);
  await actAsync(async () => {
    skipBtn.props.onPress();
  });
  assert.strictEqual(skippedVersion, '1.2.0');
  assert.strictEqual(closed, true);

  const updateBtn = tree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Atualizar agora'
  );
  assert.ok(updateBtn);
  await actAsync(async () => {
    await updateBtn.props.onPress();
  });
  assert.strictEqual(installCalled, true);
});

test('Updater CNG Plugins: patchBuildGradleSigning e withAppUpdater são idempotentes', () => {
  const sampleGradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}`;
  const patchedGradle = patchBuildGradleSigning(sampleGradle);
  assert.ok(patchedGradle.includes('sonaryReleaseSigningConfig'));
  assert.ok(patchedGradle.includes('SONARY_REQUIRE_RELEASE_SIGNING'));
  assert.strictEqual(patchBuildGradleSigning(patchedGradle), patchedGradle);

  const sampleAppKt = `package com.sonarypro.app

class MainApplication {
  override fun getPackages() = PackageList(this).packages.apply {
  }
}`;
  const patchedAppKt = patchMainApplicationString(sampleAppKt);
  assert.ok(patchedAppKt.includes('import com.sonarypro.app.updater.SonaryUpdaterPackage'));
  assert.ok(patchedAppKt.includes('add(SonaryUpdaterPackage())'));
  assert.strictEqual(patchMainApplicationString(patchedAppKt), patchedAppKt);

  const sampleManifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:name=".MainApplication">
  </application>
</manifest>`;
  const patchedManifest = patchAndroidManifestString(sampleManifest);
  assert.ok(patchedManifest.includes('android.permission.REQUEST_INSTALL_PACKAGES'));
  assert.ok(patchedManifest.includes('${applicationId}.updater.fileprovider'));
  assert.strictEqual(patchAndroidManifestString(patchedManifest), patchedManifest);
});

test('Release script: computeNextVersion e parseReleaseArgs validam bumps e flags', () => {
  assert.strictEqual(computeNextVersion('1.0.1', 'patch'), '1.0.2');
  assert.strictEqual(computeNextVersion('1.0.1', 'minor'), '1.1.0');
  assert.strictEqual(computeNextVersion('1.0.1', 'major'), '2.0.0');
  assert.strictEqual(computeNextVersion('1.0.1', 'current'), '1.0.1');
  assert.strictEqual(computeNextVersion('1.0.1', '1.4.0'), '1.4.0');

  assert.throws(() => computeNextVersion('1.0.2', '1.0.1'), /deve ser maior/);
  assert.throws(() => computeNextVersion('1.0.2', 'invalid'), /inválido/);

  assert.deepStrictEqual(parseReleaseArgs([]), {
    target: 'patch',
    dryRun: false,
    noPush: false,
  });
  assert.deepStrictEqual(parseReleaseArgs(['minor', '--dry-run', '--no-push']), {
    target: 'minor',
    dryRun: true,
    noPush: true,
  });
});
