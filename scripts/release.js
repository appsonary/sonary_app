/**
 * scripts/release.js
 *
 * Automação segura de release para o Sonary Pro:
 *   npm run release               -> bump patch (ex: 1.0.1 -> 1.0.2, versionCode +1)
 *   npm run release -- minor      -> bump minor (ex: 1.0.1 -> 1.1.0, versionCode +1)
 *   npm run release -- major      -> bump major (ex: 1.0.1 -> 2.0.0, versionCode +1)
 *   npm run release -- 1.2.3      -> versão explícita X.Y.Z (versionCode +1)
 *   npm run release -- current    -> publica a versão atual do app.json sem bump (ex: 1ª release)
 *
 * Flags opcionais:
 *   --dry-run   Simula e valida sem alterar arquivos, commitar ou enviar ao GitHub
 *   --no-push   Atualiza versão, roda validações, commita e cria tag apenas localmente
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { syncGradleVersions } = require('./patch-android');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_JSON_PATH = path.join(PROJECT_ROOT, 'app.json');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const BUILD_GRADLE_PATH = path.join(PROJECT_ROOT, 'android', 'app', 'build.gradle');

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(version) {
  const match = String(version || '').trim().replace(/^v/i, '').match(SEMVER_REGEX);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverTuple(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function computeNextVersion(currentVersion, targetArg = 'patch') {
  const currentTuple = parseSemver(currentVersion);
  if (!currentTuple) {
    throw new Error(`Versão atual inválida em app.json: "${currentVersion}"`);
  }

  const arg = String(targetArg || 'patch').trim();
  if (arg === 'current') {
    return currentTuple.join('.');
  }
  if (arg === 'patch') {
    return `${currentTuple[0]}.${currentTuple[1]}.${currentTuple[2] + 1}`;
  }
  if (arg === 'minor') {
    return `${currentTuple[0]}.${currentTuple[1] + 1}.0`;
  }
  if (arg === 'major') {
    return `${currentTuple[0] + 1}.0.0`;
  }

  const explicitTuple = parseSemver(arg);
  if (!explicitTuple) {
    throw new Error(
      `Argumento de versão inválido: "${arg}". Use patch, minor, major, current ou X.Y.Z.`
    );
  }
  if (compareSemverTuple(explicitTuple, currentTuple) <= 0) {
    throw new Error(
      `A nova versão (${explicitTuple.join('.')}) deve ser maior que a atual (${currentTuple.join('.')}).`
    );
  }
  return explicitTuple.join('.');
}

function parseReleaseArgs(argv = process.argv.slice(2)) {
  let target = 'patch';
  let dryRun = false;
  let noPush = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--no-push') {
      noPush = true;
    } else if (!arg.startsWith('-')) {
      target = arg;
    } else {
      throw new Error(`Flag desconhecida: ${arg}`);
    }
  }

  return { target, dryRun, noPush };
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
}

function ensureSafeGitState(tagName, { dryRun, noPush }) {
  const status = git(['status', '--porcelain']).trim();
  if (status) {
    throw new Error(
      'Existem alterações não commitadas no repositório. Faça commit ou stash antes de rodar npm run release.'
    );
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (!branch || branch === 'HEAD') {
    throw new Error('HEAD destacado (detached). Volte para a branch main antes de criar uma release.');
  }
  if (branch !== 'main' && branch !== 'master') {
    throw new Error(
      `Você está na branch "${branch}". Releases oficiais devem partir da branch main/master.`
    );
  }

  const localTag = git(['tag', '-l', tagName]).trim();
  if (localTag === tagName) {
    throw new Error(`A tag "${tagName}" já existe localmente.`);
  }

  if (!noPush && !dryRun) {
    const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`]).trim();
    if (remoteTag) {
      throw new Error(`A tag "${tagName}" já existe no repositório remoto (origin).`);
    }
  }

  return branch;
}

function runCommand(cmd, label) {
  console.log(`[SonaryPro] ⏳ ${label}...`);
  execSync(cmd, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
}

function runRelease(argv = process.argv.slice(2)) {
  const { target, dryRun, noPush } = parseReleaseArgs(argv);

  const originalAppRaw = fs.readFileSync(APP_JSON_PATH, 'utf8');
  const originalPkgRaw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
  const appJson = JSON.parse(originalAppRaw);
  const pkgJson = JSON.parse(originalPkgRaw);

  const currentVersion = String(appJson?.expo?.version || '1.0.0').trim();
  const currentVersionCode = Number(appJson?.expo?.android?.versionCode || 1);
  if (!Number.isInteger(currentVersionCode) || currentVersionCode <= 0) {
    throw new Error(`versionCode inválido em app.json: "${appJson?.expo?.android?.versionCode}"`);
  }

  const nextVersion = computeNextVersion(currentVersion, target);
  const nextVersionCode =
    target === 'current' ? currentVersionCode : currentVersionCode + 1;
  const tagName = `v${nextVersion}`;

  console.log('\n======================================================');
  console.log(`🚀 [SonaryPro] Release ${dryRun ? '(DRY RUN) ' : ''}${tagName}`);
  console.log('======================================================');
  console.log(`Versão atual : ${currentVersion} (versionCode ${currentVersionCode})`);
  console.log(`Nova versão  : ${nextVersion} (versionCode ${nextVersionCode})`);
  console.log(`Tag Git      : ${tagName}`);

  const branch = ensureSafeGitState(tagName, { dryRun, noPush });
  console.log(`Branch       : ${branch}\n`);

  if (dryRun) {
    console.log('[SonaryPro] ✅ Dry-run aprovado! Nenhuma alteração foi feita.\n');
    return { nextVersion, nextVersionCode, tagName, dryRun: true };
  }

  try {
    appJson.expo = appJson.expo || {};
    appJson.expo.android = appJson.expo.android || {};
    appJson.expo.version = nextVersion;
    appJson.expo.android.versionCode = nextVersionCode;
    pkgJson.version = nextVersion;

    fs.writeFileSync(APP_JSON_PATH, `${JSON.stringify(appJson, null, 2)}\n`, 'utf8');
    fs.writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8');
    syncGradleVersions(BUILD_GRADLE_PATH, appJson);

    runCommand('npx tsc --noEmit', 'Verificando tipos TypeScript');
    runCommand('npm test', 'Executando suíte de testes');

    const pendingDiff = git(['status', '--porcelain']).trim();
    if (pendingDiff) {
      git(['add', 'app.json', 'package.json'], { inherit: true });
      git(
        ['commit', '-m', `chore(release): ${tagName} (build ${nextVersionCode})`],
        { inherit: true }
      );
    }

    git(['tag', '-a', tagName, '-m', `Release ${tagName}`], { inherit: true });

    if (!noPush) {
      console.log(`[SonaryPro] ⏳ Enviando branch e tag ${tagName} para origin...`);
      git(['push', 'origin', branch], { inherit: true });
      git(['push', 'origin', tagName], { inherit: true });
    }

    console.log('\n======================================================');
    console.log(`✅ Release ${tagName} ${noPush ? 'criada localmente' : 'disparada no GitHub'}!`);
    console.log('======================================================');
    if (!noPush) {
      console.log('👉 Acompanhe o build automático na aba Actions do GitHub.\n');
    } else {
      console.log(`👉 Para publicar depois: git push origin ${branch} && git push origin ${tagName}\n`);
    }

    return { nextVersion, nextVersionCode, tagName, dryRun: false };
  } catch (err) {
    // Se falhar antes do commit, restaura app.json e package.json para não deixar sujeira
    const statusAfter = git(['status', '--porcelain']).trim();
    if (statusAfter) {
      fs.writeFileSync(APP_JSON_PATH, originalAppRaw, 'utf8');
      fs.writeFileSync(PACKAGE_JSON_PATH, originalPkgRaw, 'utf8');
      syncGradleVersions(BUILD_GRADLE_PATH, JSON.parse(originalAppRaw));
    }
    throw err;
  }
}

if (require.main === module) {
  try {
    runRelease();
  } catch (err) {
    console.error(`\n[SonaryPro] ❌ Release abortada: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  parseSemver,
  compareSemverTuple,
  computeNextVersion,
  parseReleaseArgs,
};
