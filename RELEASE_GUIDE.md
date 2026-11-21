# Guia de Deploy, Releases e Auto-Update — Sonary

Este documento é o guia definitivo para gerar builds de produção assinados, publicar releases no GitHub e manter o **Auto-Updater nativo in-app** funcionando — tanto no dia a dia quanto em uma recuperação completa do zero.

---

## 1. Como o sistema funciona (Visão Geral)

O fluxo de publicação e atualização do Sonary não depende de lojas nem de servidores de terceiros:

1. **Assinatura CNG ([`plugins/withReleaseSigning.js`](./plugins/withReleaseSigning.js)):** injeta no `android/app/build.gradle` a configuração de assinatura de release lendo `release-signing.properties` (local) ou variáveis de ambiente `SONARY_UPLOAD_*` (GitHub Actions).
2. **Automação de versão ([`scripts/release.js`](./scripts/release.js)):** `npm run release` valida o Git, atualiza `app.json` (`expo.version` e `expo.android.versionCode`) e `package.json`, roda `tsc` e `npm test`, cria o commit, gera a tag `vX.Y.Z` e envia para o GitHub.
3. **Build na nuvem ([`.github/workflows/release.yml`](./.github/workflows/release.yml)):** ao receber qualquer tag `v*` (ou disparo manual via `workflow_dispatch`), o GitHub Actions roda os testes, gera a pasta `android/`, compila o APK de produção assinado, verifica a assinatura com `apksigner`, gera `latest.json` + `checksums.txt` via [`scripts/generate-release-manifest.js`](./scripts/generate-release-manifest.js) e publica os 3 arquivos na aba **Releases**.
4. **Atualização no celular ([`services/updater.ts`](./services/updater.ts) + [`plugins/withAppUpdater.js`](./plugins/withAppUpdater.js) + [`components/UpdateModal.tsx`](./components/UpdateModal.tsx)):** o app consulta `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` (com fallback para a GitHub Releases API), baixa o APK, valida o SHA-256 e abre o instalador nativo do Android via `FileProvider`.

---

## 2. Configuração do Zero (Computador Novo ou Repositório Novo)

### 2.1. Pré-requisitos locais
- **Node.js** 18+ (recomendado 20/22)
- **JDK 17** configurado em `JAVA_HOME` (inclui a ferramenta `keytool`)
- **Git** configurado com acesso ao repositório

Após clonar o repositório:
```bash
npm install
```
*(Se também for compilar localmente no Android Studio/Gradle, use `npm run setup` após configurar `ANDROID_HOME` com SDK 34.)*

---

### 2.2. Configurar a Keystore de Assinatura (Passo mais crítico)

> **Por que isso importa?** No Android, uma atualização só instala **por cima** da versão anterior (preservando `sonary.db`, playlists e músicas baixadas) se tiver o mesmo `applicationId` (`com.sonarypro.app`), `versionCode` maior e **exatamente a mesma assinatura (`.keystore`)**.

Escolha o cenário que se aplica a você:

#### Cenário A — Você já tem o backup da keystore antiga (Recuperação / PC Novo)
1. Coloque seu arquivo `sonary-release.keystore` na raiz do projeto.
2. Crie o arquivo `release-signing.properties` na raiz do projeto com:
   ```properties
   storeFile=sonary-release.keystore
   storePassword=SUA_SENHA_DA_STORE
   keyAlias=sonary-release
   keyPassword=SUA_SENHA_DA_CHAVE
   ```
3. Confirme que ambos estão listados no [`.gitignore`](./.gitignore) (`*.keystore` e `release-signing.properties`) — **nunca envie esses arquivos para o Git**.

#### Cenário B — Começando do zero absoluto (Novo projeto / Sem keystore ainda)
1. Rode o gerador automático:
   ```bash
   npm run init:keystore
   ```
   O script [`scripts/init-keystore.js`](./scripts/init-keystore.js) cria `sonary-release.keystore` (RSA 2048, PKCS12, validade 10.000 dias) e `release-signing.properties` com senhas aleatórias fortes.
2. **Faça backup imediato** de `sonary-release.keystore` e `release-signing.properties` em local seguro fora do projeto (gerenciador de senhas, cofre em nuvem privado ou mídia externa).

---

### 2.3. Cadastrar os 4 Secrets no GitHub

No repositório do GitHub, acesse **Settings → Secrets and variables → Actions → New repository secret** e crie exatamente estes 4 segredos:

| Secret | De onde copiar |
| :--- | :--- |
| `SONARY_STORE_PASSWORD` | Campo `storePassword` de `release-signing.properties` |
| `SONARY_KEY_ALIAS` | Campo `keyAlias` de `release-signing.properties` (padrão: `sonary-release`) |
| `SONARY_KEY_PASSWORD` | Campo `keyPassword` de `release-signing.properties` |
| `SONARY_KEYSTORE_BASE64` | Saída de `npm run init:keystore -- --copy-b64` (copia sem quebras de linha) |

> **Se você mudou o dono/nome do repositório no GitHub:** atualize a constante `GITHUB_REPO` em [`services/updater.ts`](./services/updater.ts) (atualmente `'appsonary/sonary_app'`), faça commit na `main` e só então gere a release.

---

## 3. Como Publicar uma Nova Versão (Dia a Dia)

1. Certifique-se de estar na branch `main` (ou `master`) e com **todas as alterações já commitadas** (`git status` limpo).
2. *(Opcional)* Simule antes sem alterar nada:
   ```bash
   npm run release -- --dry-run
   ```
3. Execute o comando correspondente ao tipo de atualização:

| Comando | O que faz | Quando usar |
| :--- | :--- | :--- |
| `npm run release` | Sobe `patch` (`1.0.1` → `1.0.2`) e `versionCode` `+1` | Correções e melhorias pequenas |
| `npm run release -- minor` | Sobe `minor` (`1.0.1` → `1.1.0`) e `versionCode` `+1` | Novos recursos |
| `npm run release -- major` | Sobe `major` (`1.0.1` → `2.0.0`) e `versionCode` `+1` | Grandes mudanças |
| `npm run release -- 1.5.0` | Define versão exata `1.5.0` e `versionCode` `+1` | Versão específica |
| `npm run release -- current` | Mantém `version` e `versionCode` atuais do `app.json` | 1ª publicação ou republicação da versão atual |

Flags extras:
- `--dry-run`: valida Git e exibe próxima versão/tag sem modificar arquivos.
- `--no-push`: atualiza arquivos, roda testes, commita e cria a tag apenas localmente (para revisar antes de dar `git push`).

### O que acontece automaticamente depois do comando
1. O [`scripts/release.js`](./scripts/release.js) atualiza [`app.json`](./app.json), [`package.json`](./package.json) e `android/app/build.gradle` (se `android/` existir).
2. Roda `npx tsc --noEmit` e `npm test`. Se algum falhar, reverte os arquivos automaticamente e aborta.
3. Cria o commit `chore(release): vX.Y.Z (build N)`, cria a tag anotada `vX.Y.Z` e envia para o GitHub.
4. O GitHub Actions executa [`.github/workflows/release.yml`](./.github/workflows/release.yml), gera e assina o APK e cria a **GitHub Release** com os 3 arquivos anexados:
   - `sonary-pro-vX.Y.Z.apk`
   - `latest.json`
   - `checksums.txt`

Você só precisa acompanhar na aba **Actions** até ficar verde e depois conferir na aba **Releases**.

---

## 4. Build Local de Produção (Opcional)

Se quiser gerar o APK de produção no seu próprio PC (para testar via cabo USB antes de publicar, por exemplo):

```bash
npm run patch:android
npm run build:apk
```
O arquivo assinado com `release-signing.properties` será gerado em:
`android/app/build/outputs/apk/release/app-release.apk`

Para conferir qual certificado assinou o APK:
```bash
"%ANDROID_HOME%\build-tools\34.0.0\apksigner" verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk
```

---

## 5. Como Inspecionar a Keystore

O `.keystore` é um binário criptografado (PKCS12), não um arquivo de texto.
- **Ver senhas e alias locais:** abra `release-signing.properties`.
- **Ver dados do certificado (dono, validade e fingerprints SHA-1/SHA-256):**
  ```bash
  keytool -list -v -keystore sonary-release.keystore
  ```
- **Copiar o Base64 limpo novamente:**
  ```bash
  npm run init:keystore -- --copy-b64
  ```

---

## 6. Troubleshooting Rápido

### `base64: error: invalid input` ou keystore inválida no GitHub Actions
- Copiar Base64 direto do terminal do Windows pode inserir quebras de linha ou cortar caracteres.
- Rode `npm run init:keystore -- --copy-b64` e cole novamente no Secret **`SONARY_KEYSTORE_BASE64`** do GitHub.

### Preciso corrigir e re-rodar uma tag que falhou (ex.: `v1.0.1`)
Tags no Git apontam para o commit em que foram criadas. Se você corrigiu algo na `main` e quer usar a mesma tag:
```bash
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
npm run release -- current
```
*(Ou, se `app.json` já estiver na versão certa na `main` e quiser só rodar o build sem recriar tag, abra **Actions → Build & Publish Android Release → Run workflow**.)*

### Android mostra "O app não foi instalado" ao tentar atualizar
Causas possíveis:
1. O APK instalado no aparelho foi assinado com outra chave (ex.: `debug.keystore` de build de desenvolvimento) e o novo foi assinado com `sonary-release.keystore` → desinstale a versão de debug uma única vez e instale o APK oficial da Release.
2. O `versionCode` do APK novo não é maior que o do APK já instalado → use `npm run release` (que sempre incrementa `versionCode`).

### App não abre o instalador na atualização in-app
Na primeira atualização pelo próprio Sonary, o Android exige ativar **"Instalar apps desconhecidos"** para o app. O [`UpdateModal`](./components/UpdateModal.tsx) direciona automaticamente para essa tela de configuração e retoma a instalação assim que o usuário volta ao app.
