/**
 * scripts/clean.js
 *
 * Script de Limpeza Completa (Deep Clean)
 *
 * Remove com segurança:
 * - node_modules/
 * - android/
 * - .expo/
 *
 * Trata bloqueios de arquivos no Windows (como travas do Gradle daemon).
 * Uso:
 *   node scripts/clean.js
 *   npm run clean
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const TARGET_DIRS = [
  { name: '.expo', path: path.join(PROJECT_ROOT, '.expo') },
  { name: 'android', path: path.join(PROJECT_ROOT, 'android') },
  { name: 'node_modules', path: path.join(PROJECT_ROOT, 'node_modules') },
];

console.log('\n[SonaryPro] 🧹 Iniciando limpeza completa do ambiente...');

// 1. Para o Gradle Daemon no Windows se existir para evitar EPERM / Resource Busy
const gradlewBat = path.join(PROJECT_ROOT, 'android', 'gradlew.bat');
if (fs.existsSync(gradlewBat)) {
  try {
    console.log('[SonaryPro] 🛑 Encerrando daemons ativos do Gradle...');
    execSync('cmd /c gradlew.bat --stop', {
      cwd: path.join(PROJECT_ROOT, 'android'),
      stdio: 'ignore',
      timeout: 10000,
    });
  } catch (_) {
    // Ignora se não houver daemon rodando
  }
}

// 2. Remove cada diretório alvo
for (const target of TARGET_DIRS) {
  if (fs.existsSync(target.path)) {
    console.log(`[SonaryPro] 🗑️ Removendo ${target.name}/ ...`);
    try {
      fs.rmSync(target.path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 1000,
      });
      console.log(`[SonaryPro] ✅ ${target.name}/ removido com sucesso.`);
    } catch (err) {
      console.warn(`[SonaryPro] ⚠️ Não foi possível remover ${target.name}/ diretamente: ${err.message}`);
      // Fallback para Windows rd /s /q
      if (process.platform === 'win32') {
        try {
          execSync(`cmd /c "rd /s /q \"${target.path}\""`, { stdio: 'ignore' });
          console.log(`[SonaryPro] ✅ ${target.name}/ removido via fallback nativo.`);
        } catch (fbErr) {
          console.error(`[SonaryPro] ❌ Erro ao remover ${target.name}/: ${fbErr.message}`);
        }
      }
    }
  } else {
    console.log(`[SonaryPro] ⚪ ${target.name}/ já não existe.`);
  }
}

console.log('[SonaryPro] ✨ Limpeza concluída! O projeto está 100% limpo.\n');
console.log('👉 Próximo passo recomendado: npm run setup\n');

