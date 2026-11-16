/**
 * scripts/run-android.js
 *
 * Script Integrado de Execução no Android + Metro Bundler
 *
 * 1. Executa a blindagem nativa do Android (scripts/patch-android.js)
 * 2. Garante o redirecionamento de porta ADB para o Metro (8081)
 * 3. Compila, instala e inicia o app no Android via Expo CLI
 * 4. Mantém o Metro Bundler ativo para recarregamento em tempo real
 *
 * Uso:
 *   npm run android
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PROJECT_ROOT = path.resolve(__dirname, '..');

console.log('\n======================================================');
console.log('🤖 [SonaryPro] Iniciando Android + Metro Bundler');
console.log('======================================================\n');

// 1. Executa a blindagem nativa
try {
  execSync('node scripts/patch-android.js', {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
} catch (err) {
  console.error('[SonaryPro] ❌ Falha ao aplicar patch nativo:', err.message);
  process.exit(1);
}

// 2. Garante o mapeamento reverso da porta 8081 no ADB
try {
  const devices = execSync('adb devices', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  if (devices && devices.includes('\tdevice')) {
    execSync('adb reverse tcp:8081 tcp:8081', { stdio: ['pipe', 'pipe', 'ignore'] });
    console.log('[SonaryPro] 🔌 Porta 8081 mapeada no emulador/dispositivo.');
  } else {
    console.log('[SonaryPro] ℹ️ Nenhum emulador ou dispositivo conectado no momento.');
    console.log('[SonaryPro]    O Expo tentará abrir ou listar os emuladores disponíveis a seguir...\n');
  }
} catch (_) {
  // Ignora se o adb não estiver disponível
}

// 3. Executa o expo run:android (que compila, instala e inicia o Metro Bundler interativo)
console.log('[SonaryPro] 🚀 Compilando APK e iniciando Metro Bundler...\n');

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['expo', 'run:android'],
  {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
  }
);

child.on('exit', (code) => {
  if (code !== 0) {
    console.log(`\n[SonaryPro] ℹ️ Processo encerrado com código ${code}.`);
  }
  process.exit(code || 0);
});

