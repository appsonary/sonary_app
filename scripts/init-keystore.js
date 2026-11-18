/**
 * scripts/init-keystore.js
 *
 * Gera a keystore oficial de produção (PKCS12) para assinatura de APKs do Sonary Pro
 * sem depender de serviços externos. Idempotente: não sobrescreve uma keystore existente.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const KEYSTORE_FILENAME = 'sonary-release.keystore';
const KEYSTORE_PATH = path.join(PROJECT_ROOT, KEYSTORE_FILENAME);
const PROPS_PATH = path.join(PROJECT_ROOT, 'release-signing.properties');
const KEY_ALIAS = 'sonary-release';

function randomSecret() {
  return crypto.randomBytes(18).toString('base64url');
}

function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      execFileSync('clip', [], { input: text });
      return true;
    }
    if (process.platform === 'darwin') {
      execFileSync('pbcopy', [], { input: text });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function initKeystore(argv = process.argv.slice(2)) {
  const shouldCopyB64 = argv.includes('--copy-b64');

  if (fs.existsSync(KEYSTORE_PATH) || fs.existsSync(PROPS_PATH)) {
    console.log('\n[SonaryPro] ℹ️ Keystore ou release-signing.properties já existem.');
    console.log('   Nenhuma alteração foi feita para proteger sua chave de assinatura atual.');
    if (fs.existsSync(KEYSTORE_PATH)) {
      const b64 = fs.readFileSync(KEYSTORE_PATH).toString('base64');
      console.log(`   Keystore: ${KEYSTORE_PATH}`);
      console.log(`   Base64 length: ${b64.length} caracteres`);
      if (shouldCopyB64) {
        if (copyToClipboard(b64)) {
          console.log('   ✅ Base64 limpo (sem quebras de linha) copiado para a área de transferência!');
        } else {
          console.log('   ⚠️ Não foi possível copiar automaticamente. Base64:\n' + b64);
        }
      } else {
        console.log('   👉 Para copiar o Base64 limpo sem quebra de linha: npm run init:keystore -- --copy-b64');
      }
      console.log('');
    }
    return;
  }

  const storePassword = randomSecret();
  // PKCS12 usa a mesma senha para o keystore e para a chave privada no JDK 17+
  const keyPassword = storePassword;

  console.log('\n[SonaryPro] 🔐 Gerando keystore oficial de release via keytool...');
  execFileSync(
    'keytool',
    [
      '-genkeypair',
      '-v',
      '-storetype',
      'PKCS12',
      '-keystore',
      KEYSTORE_PATH,
      '-alias',
      KEY_ALIAS,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass',
      storePassword,
      '-keypass',
      keyPassword,
      '-dname',
      'CN=Sonary Pro, O=Sonary Open Source, C=BR',
    ],
    { stdio: 'inherit' }
  );

  const propsContent = [
    '# Gerado automaticamente por npm run init:keystore (NÃO COMMITAR)',
    `storeFile=${KEYSTORE_FILENAME}`,
    `storePassword=${storePassword}`,
    `keyAlias=${KEY_ALIAS}`,
    `keyPassword=${keyPassword}`,
    '',
  ].join('\n');

  fs.writeFileSync(PROPS_PATH, propsContent, 'utf8');

  const keystoreBase64 = fs.readFileSync(KEYSTORE_PATH).toString('base64');

  console.log('\n======================================================');
  console.log('✅ Keystore criada e configurada localmente!');
  console.log('======================================================');
  console.log(`Arquivo: ${KEYSTORE_FILENAME} (ignorado no Git)`);
  console.log('Config : release-signing.properties (ignorado no Git)');
  console.log('\n⚠️  FAÇA BACKUP destes arquivos em local seguro!');
  console.log('   Se perdê-los, os usuários não conseguirão atualizar por cima.');
  console.log('\n📌 Para automatizar releases no GitHub Actions, adicione estes 4 Secrets');
  console.log('   em Settings -> Secrets and variables -> Actions do seu repositório:\n');
  console.log(`   SONARY_STORE_PASSWORD   = ${storePassword}`);
  console.log(`   SONARY_KEY_ALIAS        = ${KEY_ALIAS}`);
  console.log(`   SONARY_KEY_PASSWORD     = ${keyPassword}`);
  console.log(`   SONARY_KEYSTORE_BASE64  = ${keystoreBase64}`);
  console.log('');
}

if (require.main === module) {
  initKeystore();
}

module.exports = { initKeystore };
