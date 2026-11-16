/**
 * scripts/setup.js
 *
 * Script de Inicialização e Setup do Zero (Bootstrap)
 *
 * 1. Instala todas as dependências (npm install)
 * 2. Executa o prebuild limpo (npx expo prebuild --clean)
 * 3. Aplica a blindagem do Android (node scripts/patch-android.js)
 *
 * Uso:
 *   node scripts/setup.js
 *   npm run setup
 */

const { execSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

console.log('\n======================================================');
console.log('🚀 [SonaryPro] Iniciando Setup Completo do Projeto');
console.log('======================================================\n');

function run(command, description) {
  console.log(`[SonaryPro] ⏳ ${description}...`);
  try {
    execSync(command, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    console.log(`[SonaryPro] ✅ ${description} concluído com sucesso.\n`);
  } catch (err) {
    console.error(`\n[SonaryPro] ❌ Falha em: ${description}`);
    console.error(`Erro: ${err.message}\n`);
    process.exit(1);
  }
}

// 1. Instalação das dependências
run('npm install', 'Instalando dependências via npm');

// 2. Prebuild limpo do Expo
run('npx expo prebuild --clean --platform android', 'Gerando pasta nativa android/ limpa (expo prebuild)');

// 3. Blindagem de código nativo
run('node scripts/patch-android.js', 'Aplicando blindagem nativa do Android 14');

console.log('======================================================');
console.log('🎉 [SonaryPro] Ambiente 100% configurado e pronto!');
console.log('======================================================');
console.log('\n👉 Para rodar o app no Android com o Metro Bundler:');
console.log('   npm run android\n');

