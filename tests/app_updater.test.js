// tests/app_updater.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const { AppState, Linking, NativeEventEmitter, NativeModules } = require('react-native');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
  supportsBackgroundUpdateDownload,
  startBackgroundUpdateDownload,
  cancelBackgroundUpdateDownload,
  getUpdateDownloadState,
  subscribeUpdateDownload,
  releaseFromDownloadState,
  UPDATER_DOWNLOAD_EVENT,
} = require('../services/updater');
const { UpdateModal } = require('../components/UpdateModal');
const { SideDrawerMenu } = require('../components/SideDrawerMenu');
const { patchBuildGradleSigning } = require('../plugins/withReleaseSigning');
const {
  patchBuildGradleString,
  patchMainApplicationString,
  patchAndroidManifestString,
} = require('../plugins/withAppUpdater');
const { patchTrackPlayerMusicService } = require('../plugins/withTrackPlayerFGS');
const { computeNextVersion, parseReleaseArgs } = require('../scripts/release');

test.beforeEach(async () => {
  resetAllMocks();
  delete NativeModules.SonaryAppUpdater;
  NativeEventEmitter.__reset();
  Linking.__reset();
  AppState.currentState = 'active';
  await initDatabase();
});

test.afterEach(() => {
  delete NativeModules.SonaryAppUpdater;
  NativeEventEmitter.__reset();
  Linking.__reset();
  AppState.currentState = 'active';
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
  NativeModules.SonaryAppUpdater = {
    getInstalledVersion: async () => ({ versionName: '1.0.1', versionCode: 3 }),
  };
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
  NativeModules.SonaryAppUpdater = {
    getInstalledVersion: async () => ({ versionName: '1.0.1', versionCode: 3 }),
  };
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
  assert.ok(modalText.includes('Atualização disponível'));
  assert.ok(modalText.includes('v1.0.1 →'));
  assert.ok(modalText.includes('v1.2.0'));
  assert.ok(modalText.includes('NOVIDADES DA VERSÃO'));
  assert.ok(modalText.includes('Ver no GitHub ↗'));
  assert.ok(modalText.includes('Melhorias de estabilidade.'));
  assert.ok(modalText.includes('Atualizar agora (40.0 MB)'));
  assert.ok(modalText.includes('Lembrar mais tarde'));
  assert.ok(modalText.includes('Pular esta versão'));

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

test('Updater UI: UpdateModal parseia lista de novidades e omite opcionais quando ausentes', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: null,
        release: {
          versionName: '1.3.0',
          versionCode: 6,
          apkName: 'sonary-pro-v1.3.0.apk',
          apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.3.0/sonary-pro-v1.3.0.apk',
          sha256: null,
          sizeBytes: null,
          releaseNotes: '- Áudio: Correções de estabilidade\n* Desempenho: Mais rápido\n• Interface: Ajustes',
          releaseUrl: '',
        },
        onClose: () => {},
      })
    );
  });

  const modalText = getAllText(tree.root);
  assert.ok(modalText.includes('v1.3.0'));
  assert.ok(!modalText.includes('→'));
  assert.ok(!modalText.includes('Ver no GitHub'));
  assert.ok(!modalText.includes('Pular esta versão'));
  assert.ok(modalText.includes('Áudio: Correções de estabilidade'));
  assert.ok(modalText.includes('Desempenho: Mais rápido'));
  assert.ok(modalText.includes('Interface: Ajustes'));
  assert.ok(modalText.includes('Atualizar agora'));
  assert.ok(
    tree.root.find((n) => n.type === 'LucideIcon' && n.props.name === 'AudioLines')
  );
  assert.ok(
    tree.root.find((n) => n.type === 'LucideIcon' && n.props.name === 'Zap')
  );
});

test('Updater UI: UpdateModal exibe estado atualizado e verificando quando release é null', async () => {
  let checkNowCalls = 0;
  let tree;

  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: { versionName: '1.0.4', versionCode: 6 },
        release: null,
        isChecking: true,
        onClose: () => {},
      })
    );
  });
  assert.ok(getAllText(tree.root).includes('Verificando atualizações...'));

  await actAsync(async () => {
    tree.update(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: { versionName: '1.0.4', versionCode: 6 },
        release: null,
        isChecking: false,
        onCheckNow: () => {
          checkNowCalls += 1;
        },
        onClose: () => {},
      })
    );
  });

  const upToDateText = getAllText(tree.root);
  assert.ok(upToDateText.includes('App atualizado'));
  assert.ok(upToDateText.includes('v1.0.4'));
  assert.ok(upToDateText.includes('Você já está na versão mais recente'));

  const recheckBtn = tree.root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props.accessibilityLabel === 'Verificar atualizações novamente'
  );
  assert.ok(recheckBtn);
  await actAsync(async () => {
    recheckBtn.props.onPress();
  });
  assert.strictEqual(checkNowCalls, 1);
});

test('Updater App: aba Apoiar acessível pelo menu lateral abre UpdateModal mesmo sem atualização disponível', async () => {
  const App = require('../App').default;
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      versionName: '1.0.4',
      versionCode: 6,
      apkName: 'sonary-pro-v1.0.4.apk',
      apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.0.4/sonary-pro-v1.0.4.apk',
    }),
  });
  NativeModules.SonaryAppUpdater = {
    getInstalledVersion: async () => ({ versionName: '1.0.4', versionCode: 6 }),
  };

  let appTree;
  try {
    await actAsync(async () => {
      appTree = renderer.create(React.createElement(App));
    });
    const menuBtn = appTree.root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Abrir menu'
    );
    await actAsync(async () => {
      menuBtn.props.onPress();
    });
    const supportBtn = appTree.root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Apoiar o Sonary'
    );
    await actAsync(async () => {
      supportBtn.props.onPress();
    });
    const checkUpdatesBtn = appTree.root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Verificar atualizações do aplicativo'
    );
    await actAsync(async () => {
      checkUpdatesBtn.props.onPress();
    });
    const text = getAllText(appTree.root);
    assert.ok(text.includes('App atualizado'));
    assert.ok(text.includes('v1.0.4'));
  } finally {
    if (appTree) {
      await actAsync(async () => {
        appTree.unmount();
      });
    }
    global.fetch = originalFetch;
  }
});

test('Updater UI: botão de simular atualização aparece apenas em desenvolvimento e simula tela de update', async () => {
  const prevDev = global.__DEV__;
  const envKey = 'EXPO_PUBLIC_DEV_MENU';
  const prevEnv = process.env[envKey];

  try {
    // 1. Produção: botão de simular NÃO deve existir
    global.__DEV__ = false;
    delete process.env[envKey];

    let prodTree;
    await actAsync(async () => {
      prodTree = renderer.create(
        React.createElement(UpdateModal, {
          visible: true,
          installedVersion: { versionName: '1.0.4', versionCode: 6 },
          release: null,
          isChecking: false,
          onClose: () => {},
        })
      );
    });
    const prodSimButtons = prodTree.root.findAll(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Simular atualização disponível'
    );
    assert.strictEqual(prodSimButtons.length, 0);

    // 2. Desenvolvimento: botão aparece e simula atualização disponível
    global.__DEV__ = true;
    let devTree;
    await actAsync(async () => {
      devTree = renderer.create(
        React.createElement(UpdateModal, {
          visible: true,
          installedVersion: { versionName: '1.0.4', versionCode: 6 },
          release: null,
          isChecking: false,
          onClose: () => {},
          onSkipVersion: () => {},
        })
      );
    });
    const simBtn = devTree.root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Simular atualização disponível'
    );
    assert.ok(simBtn);

    await actAsync(async () => {
      simBtn.props.onPress();
    });

    const simText = getAllText(devTree.root);
    assert.ok(simText.includes('Atualização disponível'));
    assert.ok(simText.includes('v1.0.4 →'));
    assert.ok(simText.includes('v1.0.5'));
    assert.ok(simText.includes('124.3 MB'));
    assert.ok(simText.includes('Atualizar agora (124.3 MB)'));
  } finally {
    if (prevDev === undefined) delete global.__DEV__;
    else global.__DEV__ = prevDev;
    if (prevEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = prevEnv;
  }
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


test('Updater Background: start/cancel/state/events e proteção do cleanupCachedUpdateApks', async () => {
  assert.strictEqual(supportsBackgroundUpdateDownload(), false);

  let startedPayload = null;
  let cancelCalls = 0;
  let clearCalls = 0;
  let nativeState = { status: 'idle', progress: 0 };

  NativeModules.SonaryAppUpdater = {
    getInstalledVersion: async () => ({ versionName: '1.0.4', versionCode: 6 }),
    startBackgroundDownload: async (params) => {
      startedPayload = params;
      nativeState = {
        status: 'downloading',
        versionName: params.versionName,
        versionCode: params.versionCode,
        apkName: params.apkName,
        apkUrl: params.apkUrl,
        sha256: params.sha256,
        sizeBytes: params.sizeBytes,
        releaseNotes: params.releaseNotes,
        releaseUrl: params.releaseUrl,
        progress: 0.25,
        updatedAt: Date.now(),
      };
    },
    cancelBackgroundDownload: async () => {
      cancelCalls += 1;
      nativeState = { status: 'idle', progress: 0 };
    },
    getDownloadState: async () => nativeState,
    clearDownloadState: async () => {
      clearCalls += 1;
      nativeState = { status: 'idle', progress: 0 };
    },
  };

  assert.strictEqual(supportsBackgroundUpdateDownload(), true);

  const release = {
    versionName: '1.1.0',
    versionCode: 7,
    apkName: 'sonary-pro-v1.1.0.apk',
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.1.0/sonary-pro-v1.1.0.apk',
    sha256: 'd'.repeat(64),
    sizeBytes: 48 * 1024 * 1024,
    releaseNotes: 'Download em background',
    releaseUrl: 'https://github.com/appsonary/sonary_app/releases/tag/v1.1.0',
  };

  const received = [];
  const unsub = subscribeUpdateDownload((s) => received.push(s));

  await startBackgroundUpdateDownload(release);
  assert.strictEqual(startedPayload.versionName, '1.1.0');

  const current = await getUpdateDownloadState();
  assert.strictEqual(current.status, 'downloading');
  assert.strictEqual(current.progress, 0.25);

  const reconstructed = releaseFromDownloadState(current);
  assert.strictEqual(reconstructed.versionName, '1.1.0');
  assert.strictEqual(reconstructed.apkUrl, release.apkUrl);

  // Arquivo .part deve ser preservado durante download ativo
  const updatesDir = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}updates/`;
  await FileSystem.makeDirectoryAsync(updatesDir, { intermediates: true });
  const partUri = `${updatesDir}sonary-pro-v1.1.0.apk.part`;
  FileSystem.files.set(partUri, { size: 500000 });
  await cleanupCachedUpdateApks();
  assert.strictEqual(FileSystem.files.has(partUri), true);

  // Quando pronto (ready) para versão mais nova, preserva o APK pronto e limpa obsoletos
  const readyUri = `${updatesDir}sonary-pro-v1.1.0.apk`;
  const staleUri = `${updatesDir}sonary-pro-v1.0.3.apk`;
  FileSystem.files.set(readyUri, { size: 2_500_000 });
  FileSystem.files.set(staleUri, { size: 2_500_000 });
  nativeState = { ...nativeState, status: 'ready', localUri: readyUri, progress: 1 };
  await cleanupCachedUpdateApks();
  assert.strictEqual(FileSystem.files.has(readyUri), true);
  assert.strictEqual(FileSystem.files.has(staleUri), false);

  // Quando a versão instalada já alcançou a baixada, limpa estado e arquivo
  NativeModules.SonaryAppUpdater.getInstalledVersion = async () => ({
    versionName: '1.1.0',
    versionCode: 7,
  });
  await cleanupCachedUpdateApks();
  assert.strictEqual(clearCalls, 1);
  assert.strictEqual(FileSystem.files.has(readyUri), false);

  // Evento nativo chega aos subscribers
  NativeEventEmitter.__emit(UPDATER_DOWNLOAD_EVENT, {
    status: 'downloading',
    versionName: '1.1.0',
    progress: 0.62,
  });
  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0].progress, 0.62);

  await cancelBackgroundUpdateDownload();
  assert.strictEqual(cancelCalls, 1);
  unsub();
});

test('Updater Background UI: UpdateModal hidrata progresso, permite minimizar sem cancelar e instala ao concluir', async () => {
  let startCalls = 0;
  let cancelCalls = 0;
  let installedUri = null;
  let closedCount = 0;
  let nativeState = { status: 'idle', progress: 0 };

  NativeModules.SonaryAppUpdater = {
    canRequestPackageInstalls: async () => true,
    installApk: async (uri) => {
      installedUri = uri;
    },
    startBackgroundDownload: async (params) => {
      startCalls += 1;
      nativeState = {
        status: 'downloading',
        versionName: params.versionName,
        apkName: params.apkName,
        apkUrl: params.apkUrl,
        progress: 0.1,
      };
    },
    cancelBackgroundDownload: async () => {
      cancelCalls += 1;
      nativeState = { status: 'idle', progress: 0 };
    },
    getDownloadState: async () => nativeState,
  };

  const release = {
    versionName: '1.2.0',
    versionCode: 8,
    apkName: 'sonary-pro-v1.2.0.apk',
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
    sha256: null,
    sizeBytes: 30 * 1024 * 1024,
    releaseNotes: 'Suporte a download em 2º plano.',
    releaseUrl: 'https://github.com/appsonary/sonary_app/releases/tag/v1.2.0',
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: { versionName: '1.0.4', versionCode: 6 },
        release,
        onClose: () => {
          closedCount += 1;
        },
      })
    );
  });

  const updateBtn = tree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Atualizar agora'
  );
  await actAsync(async () => {
    await updateBtn.props.onPress();
  });
  assert.strictEqual(startCalls, 1);

  // Recebe progresso em tempo real sem botão extra de "baixar em segundo plano"
  await actAsync(async () => {
    NativeEventEmitter.__emit(UPDATER_DOWNLOAD_EVENT, {
      status: 'downloading',
      versionName: '1.2.0',
      progress: 0.45,
    });
  });
  const downloadingText = getAllText(tree.root);
  assert.ok(downloadingText.includes('45%'));
  assert.ok(!downloadingText.includes('Baixar em segundo plano'));

  // Tocar no backdrop durante download em background fecha o modal SEM cancelar
  const backdrop = tree.root.find(
    (n) => n.type === 'TouchableOpacity' && n.props.activeOpacity === 1
  );
  await actAsync(async () => {
    backdrop.props.onPress();
  });
  assert.strictEqual(closedCount, 1);
  assert.strictEqual(cancelCalls, 0);

  // Evento ready com app em foreground aciona installApk
  await actAsync(async () => {
    NativeEventEmitter.__emit(UPDATER_DOWNLOAD_EVENT, {
      status: 'ready',
      versionName: '1.2.0',
      localUri: 'file:///cache/updates/sonary-pro-v1.2.0.apk',
      progress: 1,
    });
  });
  assert.strictEqual(installedUri, 'file:///cache/updates/sonary-pro-v1.2.0.apk');
});

test('Updater Background UI: SideDrawerMenu exibe progresso e estado pronto no rodapé', async () => {
  const baseProps = {
    visible: true,
    onClose: () => {},
    installedVersion: { versionName: '1.0.4', versionCode: 6 },
    availableUpdate: {
      versionName: '1.2.0',
      versionCode: 8,
      apkName: 'sonary-pro-v1.2.0.apk',
      apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
      sha256: null,
      sizeBytes: null,
      releaseNotes: '',
      releaseUrl: 'https://github.com/appsonary/sonary_app/releases/latest',
    },
    onOpenDownloadQueue: () => {},
    onOpenRecentHistory: () => {},
    onOpenStats: () => {},
    onOpenUpdates: () => {},
    onOpenSettings: () => {},
    onOpenSupport: () => {},
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SideDrawerMenu, {
        ...baseProps,
        updateDownloadState: {
          status: 'downloading',
          versionName: '1.2.0',
          progress: 0.68,
        },
      })
    );
  });
  const downloadingText = getAllText(tree.root);
  assert.ok(downloadingText.includes('Baixando v1.2.0... 68%'));
  assert.ok(downloadingText.includes('68%'));

  await actAsync(async () => {
    tree.update(
      React.createElement(SideDrawerMenu, {
        ...baseProps,
        updateDownloadState: {
          status: 'ready',
          versionName: '1.2.0',
          progress: 1,
        },
      })
    );
  });
  const readyText = getAllText(tree.root);
  assert.ok(readyText.includes('v1.2.0 pronta para instalar'));
  assert.ok(readyText.includes('Instalar'));
});

test('Updater CNG Plugins: manifest/gradle WorkManager e MusicService.kt protegem sonary.updater.running', () => {
  const sampleManifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:name=".MainApplication">
  </application>
</manifest>`;
  const patchedManifest = patchAndroidManifestString(sampleManifest);
  assert.ok(patchedManifest.includes('android.permission.FOREGROUND_SERVICE_DATA_SYNC'));
  assert.ok(patchedManifest.includes('androidx.work.impl.foreground.SystemForegroundService'));
  assert.ok(patchedManifest.includes('com.sonarypro.app.updater.SonaryUpdaterCancelReceiver'));
  assert.strictEqual(patchAndroidManifestString(patchedManifest), patchedManifest);

  const sampleGradle = `dependencies {\n    implementation("com.facebook.react:react-android")\n}`;
  const patchedGradle = patchBuildGradleString(sampleGradle);
  assert.ok(patchedGradle.includes('androidx.work:work-runtime-ktx:2.9.0'));
  assert.strictEqual(patchBuildGradleString(patchedGradle), patchedGradle);

  // Verifica migração do MusicService.kt já patcheado com guarda legada -> dupla guarda
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonary-fgs-'));
  try {
    const musicServiceDir = path.join(
      tmpRoot,
      'node_modules',
      'react-native-track-player',
      'android',
      'src',
      'main',
      'java',
      'com',
      'doublesymmetry',
      'trackplayer',
      'service'
    );
    fs.mkdirSync(musicServiceDir, { recursive: true });
    const musicServiceFile = path.join(musicServiceDir, 'MusicService.kt');
    fs.writeFileSync(
      musicServiceFile,
      `class MusicService {
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (System.getProperty("sonary.downloads.running") != "true") {
            exitProcess(0)
        }
    }
}`,
      'utf8'
    );

    assert.strictEqual(patchTrackPlayerMusicService(tmpRoot), true);
    const updated = fs.readFileSync(musicServiceFile, 'utf8');
    assert.ok(updated.includes('System.getProperty("sonary.downloads.running") != "true"'));
    assert.ok(updated.includes('System.getProperty("sonary.updater.running") != "true"'));
    assert.strictEqual(patchTrackPlayerMusicService(tmpRoot), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Updater Background UI: UpdateModal hidrata estado downloading/ready ao reabrir e auto-instala via autoInstallOnOpen', async () => {
  let installedUri = null;
  let nativeState = {
    status: 'downloading',
    versionName: '1.2.0',
    versionCode: 8,
    apkName: 'sonary-pro-v1.2.0.apk',
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
    progress: 0.72,
  };

  NativeModules.SonaryAppUpdater = {
    startBackgroundDownload: async () => {},
    getDownloadState: async () => nativeState,
    canRequestPackageInstalls: async () => true,
    installApk: async (uri) => {
      installedUri = uri;
    },
  };

  const release = {
    versionName: '1.2.0',
    versionCode: 8,
    apkName: 'sonary-pro-v1.2.0.apk',
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
    sha256: null,
    sizeBytes: 30 * 1024 * 1024,
    releaseNotes: 'Notas v1.2.0',
    releaseUrl: 'https://github.com/appsonary/sonary_app/releases/tag/v1.2.0',
  };

  // 1. Reabre modal com download já em andamento -> hidrata 72%
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: { versionName: '1.0.5', versionCode: 7 },
        release,
        onClose: () => {},
      })
    );
  });
  assert.ok(getAllText(tree.root).includes('72%'));
  assert.strictEqual(installedUri, null);

  // 2. Reabre modal com APK já pronto sem autoInstallOnOpen -> mostra CTA "Instalar atualização" sem instalar sozinho
  nativeState = {
    ...nativeState,
    status: 'ready',
    progress: 1,
    localUri: 'file:///cache/updates/sonary-pro-v1.2.0.apk',
  };
  await actAsync(async () => {
    tree.update(
      React.createElement(UpdateModal, {
        visible: false,
        installedVersion: { versionName: '1.0.5', versionCode: 7 },
        release,
        onClose: () => {},
      })
    );
  });
  await actAsync(async () => {
    tree.update(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: { versionName: '1.0.5', versionCode: 7 },
        release,
        onClose: () => {},
      })
    );
  });
  assert.ok(getAllText(tree.root).includes('Instalar atualização'));
  assert.strictEqual(installedUri, null);

  // 3. Reabre com autoInstallOnOpen=true (deep link da notificação) -> dispara installApk automaticamente
  await actAsync(async () => {
    tree.update(
      React.createElement(UpdateModal, {
        visible: true,
        installedVersion: { versionName: '1.0.5', versionCode: 7 },
        release,
        autoInstallOnOpen: true,
        onClose: () => {},
      })
    );
  });
  assert.strictEqual(installedUri, 'file:///cache/updates/sonary-pro-v1.2.0.apk');
});

test('Updater App: deep link com.sonarypro.app://update abre UpdateModal pronto e dispara installApk; versão já instalada ou pulada limpa estado', async () => {
  const App = require('../App').default;
  let installedUri = null;
  let clearCalls = 0;
  let nativeState = {
    status: 'ready',
    versionName: '1.2.0',
    versionCode: 8,
    apkName: 'sonary-pro-v1.2.0.apk',
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
    localUri: 'file:///cache/updates/sonary-pro-v1.2.0.apk',
    progress: 1,
  };

  NativeModules.SonaryAppUpdater = {
    getInstalledVersion: async () => ({ versionName: '1.0.5', versionCode: 7 }),
    startBackgroundDownload: async () => {},
    getDownloadState: async () => nativeState,
    clearDownloadState: async () => {
      clearCalls += 1;
      nativeState = { status: 'idle', progress: 0 };
    },
    canRequestPackageInstalls: async () => true,
    installApk: async (uri) => {
      installedUri = uri;
    },
  };

  // 1. Deep link via evento URL com APK pronto -> reconstrói release, abre modal e aciona installApk
  let appTree;
  try {
    await actAsync(async () => {
      appTree = renderer.create(React.createElement(App));
    });
    await actAsync(async () => {
      Linking.__emitUrl('com.sonarypro.app://update');
    });
    assert.strictEqual(installedUri, 'file:///cache/updates/sonary-pro-v1.2.0.apk');
  } finally {
    if (appTree) {
      await actAsync(async () => {
        appTree.unmount();
      });
    }
  }

  // 2. Versão já instalada (>= ready) não deve exibir badge obsoleto e deve limpar estado persistido
  installedUri = null;
  clearCalls = 0;
  nativeState = {
    status: 'ready',
    versionName: '1.2.0',
    versionCode: 8,
    apkName: 'sonary-pro-v1.2.0.apk',
    apkUrl: 'https://github.com/appsonary/sonary_app/releases/download/v1.2.0/sonary-pro-v1.2.0.apk',
    localUri: 'file:///cache/updates/sonary-pro-v1.2.0.apk',
    progress: 1,
  };
  NativeModules.SonaryAppUpdater.getInstalledVersion = async () => ({
    versionName: '1.2.0',
    versionCode: 8,
  });

  let updatedTree;
  try {
    await actAsync(async () => {
      updatedTree = renderer.create(React.createElement(App));
    });
    assert.strictEqual(clearCalls, 1);

    const menuBtn = updatedTree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir menu'
    );
    await actAsync(async () => {
      menuBtn.props.onPress();
    });
    const drawerText = getAllText(updatedTree.root);
    assert.ok(drawerText.includes('Atualizado'));
    assert.ok(!drawerText.includes('pronta para instalar'));
  } finally {
    if (updatedTree) {
      await actAsync(async () => {
        updatedTree.unmount();
      });
    }
  }
});

test('Updater UI Dev: clicar em "Atualizar agora" na tela simulada executa download de 5s + instalação com sucesso', async (t) => {
  const prevDev = global.__DEV__;
  const envKey = 'EXPO_PUBLIC_DEV_MENU';
  const prevEnv = process.env[envKey];

  try {
    global.__DEV__ = true;
    delete process.env[envKey];
    t.mock.timers.enable({ apis: ['setInterval'] });

    let devTree;
    await actAsync(async () => {
      devTree = renderer.create(
        React.createElement(UpdateModal, {
          visible: true,
          installedVersion: { versionName: '1.0.5', versionCode: 7 },
          release: null,
          isChecking: false,
          onClose: () => {},
        })
      );
    });

    const simBtn = devTree.root.find(
      (n) =>
        n.type === 'TouchableOpacity' &&
        n.props.accessibilityLabel === 'Simular atualização disponível'
    );
    await actAsync(async () => {
      simBtn.props.onPress();
    });

    // Não exibe botão extra duplicado de simulação na tela de atualização
    assert.ok(!getAllText(devTree.root).includes('Simular download e instalação'));

    const updateBtn = devTree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Atualizar agora'
    );
    await actAsync(async () => {
      await updateBtn.props.onPress();
    });
    assert.ok(getAllText(devTree.root).includes('0%'));

    await actAsync(async () => {
      t.mock.timers.tick(2500);
    });
    assert.ok(getAllText(devTree.root).includes('50%'));

    await actAsync(async () => {
      t.mock.timers.tick(2500);
    });
    const finalText = getAllText(devTree.root);
    assert.ok(finalText.includes('Atualização v1.0.6 instalada com sucesso (simulação dev).'));
    assert.ok(finalText.includes('Fechar'));

    await actAsync(async () => {
      devTree.unmount();
    });
  } finally {
    if (prevDev === undefined) delete global.__DEV__;
    else global.__DEV__ = prevDev;
    if (prevEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = prevEnv;
  }
});
