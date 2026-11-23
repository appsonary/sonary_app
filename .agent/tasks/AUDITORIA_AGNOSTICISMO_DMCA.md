# Auditoria Completa de Agnosticismo, Desacoplamento e Risco DMCA — Sonary Pro

**Data da varredura:** 2026-11-22  
**Escopo:** Repositório completo (`sonary_app`), excluindo `node_modules/`, `.git/`, `.expo/`, `android/build/`, `android/.gradle/`, `android/app/build/`, `package-lock.json` e binários.  
**Objetivo:** Mapear todas as referências a serviços de terceiros (YouTube, YouTube Music, InnerTube, Invidious, Piped, Spotify), domínios hardcoded, acoplamentos fora da camada de extração e pontos de risco relacionados a DMCA e distribuição.

---

## 1. Resumo Executivo

- **Interface visível ao usuário (`<Text>`):** **100% agnóstica.** Nenhuma tela, placeholder ou mensagem de erro amigável exibe as marcas "YouTube", "YouTube Music" ou "Spotify" (inclusive existem testes automatizados garantindo isso).
- **Código-fonte e documentação do repositório:** **NÃO estão 100% agnósticos fora da extração.** Há referências explícitas e acoplamentos hardcoded em:
  1. Documentação (`README.md`);
  2. Infraestrutura de áudio e armazenamento (`services/player.ts`, `services/storage.ts`, `plugins/withBackgroundDownloads.js`);
  3. Componentes de UI, `App.tsx` e testes (nomes de arquivos, componentes, constantes, `testID`, estilos `spotify*` e comentários citando marcas registradas `YouTube` e `Spotify`);
  4. Toda a camada de catálogo em `services/api.ts` (não apenas extração de stream, mas também busca, artistas, álbuns, perfil, rádio e links diretos).
- **Ressalva crítica sobre DMCA:** Higienizar nomes, comentários e documentação torna o repositório limpo e pronto para desacoplamento, mas **não garante blindagem jurídica automática contra DMCA** enquanto:
  1. O código de extração (`services/api.ts` + `SonaryInnerTubeClient.kt`) permanecer dentro deste repositório; e/ou
  2. Os APKs compilados contendo o extrator forem distribuídos diretamente nas *GitHub Releases* deste repositório (`appsonary/sonary_app`).

---

## 2. O que JÁ está 100% limpo (0 ocorrências)

Os arquivos e diretórios abaixo passaram pela varredura sem nenhuma menção a `youtube`, `youtu.be`, `ytimg`, `ytmusic`, `googlevideo`, `innertube`, `invidious`, `piped` ou `spotify`:

- Textos visíveis na interface do usuário (`<Text>`, `placeholder`, `accessibilityLabel`);
- `app.json` e `package.json`;
- `DESIGN.md` e `RELEASE_GUIDE.md`;
- `theme.ts`, `index.ts` e `service.js`;
- `scripts/` (`build-apk.js`, `clean.js`, `generate-release-manifest.js`, `init-keystore.js`, `patch-android.js`, `release.js`, `run-android.js`, `setup.js`);
- `.github/workflows/release.yml`;
- Nomes de arquivos em `assets/` (`adaptive-icon.png`, `brand-logo-header.png`, `icon.png`, `splash.png`).

---

## 3. Inventário Detalhado de Ocorrências

### 3.1. Documentação

| Arquivo | Linhas | O que foi encontrado | Impacto |
| :--- | :--- | :--- | :--- |
| `README.md` | L67, L74, L97, L110, L219, L230–231, L447 | Menciona explicitamente `YouTube InnerTube`, `googlevideo.com`, `Referer: 'https://www.youtube.com/'`, `Origin: 'https://www.youtube.com'`, `Piped`, `Invidious`, `YouTubeMusicSidebar.tsx` e a seção *"O Desafio do CDN do YouTube (HTTP 403 Forbidden)"*. | **Alto** — primeira superfície pública lida no GitHub por usuários, buscadores e bots de DMCA. |

---

### 3.2. Camada de Player, Storage e Downloads Nativos (Fora de `api.ts`)

| Arquivo | Linhas | O que foi encontrado | Impacto |
| :--- | :--- | :--- | :--- |
| `services/player.ts` | L117–118, L218–219, L248–249, L438–439, L462–463, L690–691 | Injeta hardcoded `Referer: 'https://www.youtube.com/'` e `Origin: 'https://www.youtube.com'` em 6 funções (`buildNormalizedTrack`, `playTrackList`, `addTracksToQueue`, `playNextTrack`, `addTrackToEndOfQueue`, `replaceUpcomingQueue`). | **Alto** — acopla o player genérico diretamente a headers do YouTube em vez de consumir os headers fornecidos pelo provedor. |
| `services/storage.ts` | L230–234 | `DEFAULT_STREAM_DOWNLOAD_HEADERS` define hardcoded `User-Agent: api.INNERTUBE_USER_AGENT`, `Referer: 'https://www.youtube.com/'` e `Origin: 'https://www.youtube.com'`. | **Alto** — acopla o gerenciador de downloads locais ao provedor YouTube/InnerTube. |
| `plugins/withBackgroundDownloads.js` | L136–285, L798–829 | Gera `SonaryInnerTubeClient.kt` (client `VISIONOS` + `youtube.com/youtubei/v1/visitor_id` e `player`) e injeta fallback hardcoded `Referer`/`Origin` do YouTube no `SonaryDownloadWorker.kt` (L828–829). *(Refletido em `android/app/src/main/java/com/sonarypro/app/downloads/SonaryInnerTubeClient.kt` e `SonaryDownloadWorker.kt`.)* | **Crítico** — duplica a lógica de extração InnerTube na camada nativa Android e mantém URLs do YouTube dentro do plugin CNG. |

---

### 3.3. Componentes de UI e `App.tsx` (Marcas `YouTube` e `Spotify` + Heurísticas)

| Arquivo | Linhas | O que foi encontrado | Impacto |
| :--- | :--- | :--- | :--- |
| `components/YouTubeMusicSidebar.tsx` | Nome do arquivo, L26, L37, L471 | Arquivo, interface (`YouTubeMusicSidebarProps`) e componente (`YouTubeMusicSidebar`) carregam marca registrada de terceiro. | **Alto** — visível diretamente na árvore de arquivos do repositório. |
| `App.tsx` | L45, L89, L1947, L2468, L2706, L2708, L2724, L2802, L2838, L3216, L3265 | Importa `YouTubeMusicSidebar` e `extractYouTubeUrlVideoId`; contém comentários citando "Padrão YouTube Music", "YouTube Music Deep Dark Glow", "estilo Spotify". | **Médio** — acoplamento nominal no entry point da UI. |
| `components/PlaylistCover.tsx` | L25–27, L79, L93, L113 | Exporta `hasYouTubeLetterbox` com regex `/(?:hqdefault\|sddefault)\.jpg/i`. | **Médio** — nome de função e heurística específica de thumbnail 4:3 do YouTube. |
| `components/PlaylistDetailModal.tsx` | L61, L189 | Importa e usa `hasYouTubeLetterbox`. | **Baixo** — consumidor de `PlaylistCover.tsx`. |
| `components/AmbientGlowBackground.tsx` | L431 | Regex `/(?:hqdefault\|sddefault)\.jpg/i` para crop de letterbox. | **Baixo** — heurística visual implícita de thumbnail do YouTube. |
| `components/PersistentMiniPlayer.tsx` | L61, L64, L80, L103–104, L219, L245, L284, L392 | Exporta `SPOTIFY_DARK_PALETTES` e contém 6 comentários citando "Spotify". | **Médio** — referência nominal à marca registrada Spotify. |
| `components/NavigationTabBar.tsx` | L36, L41, L50, L61 | `testID="spotify-nav-fade"`, `<LinearGradient id="spotifyNavFade">` e comentário "estilo Spotify". | **Médio** — referência nominal à marca registrada Spotify. |
| `components/LyricsViewer.tsx` | L93, L359, L394–438, L461–544, L617 | 22 ocorrências de estilos `spotify*` (`spotifyLyricsCard`, `spotifyCardHeader`, etc.) e comentários "estilo Spotify". *(L93 cita `'lrclib'`, API aberta de letras.)* | **Baixo** — interno de código, mas cita marca de terceiro. |
| `components/NowPlayingModal.tsx` | L2379, L2535, L2607–3731, L4097–4356 | 83 ocorrências de estilos `spotify*`, comentários citando "Spotify" e "YouTube Music", além da regex `hqdefault\|sddefault` (L2379, L2535). | **Baixo/Médio** — interno de código, mas alto volume de referências nominais. |
| `components/QuickPicksSection.tsx` | L152 | Comentário citando "YouTube Music". | **Baixo** |
| `components/TrackCard.tsx` | L238 | Comentário citando "YouTube Music Tiles". | **Baixo** |

---

### 3.4. Camada de Provedor, Catálogo e Extração (`services/api.ts`)

`services/api.ts` (3.136 linhas, **145+ linhas** com referências diretas) concentra **todo** o acoplamento com YouTube, YouTube Music e instâncias alternativas — indo muito além da extração de áudio:

| Funcionalidade em `services/api.ts` | Linhas | Acoplamento atual |
| :--- | :--- | :--- |
| Pool de fallback | L12–144, L799–937, L1491–1575 | Tipos `PipedStreamAudio`/`PipedSearchItem`, `PIPED_INSTANCES` e `API_INSTANCES` (3 instâncias Invidious: `invidious.projectsegfau.lt`, `invidious.f5.si`, `inv.nadeko.net`). |
| Parsing de link direto | L243–302, L369–518, L1169–1171 | `extractYouTubeUrlVideoId` e `resolveYouTubeUrlSearch` com allowlist `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, `www.youtu.be`. |
| Busca de músicas | L664–797, L1151–1260 | `POST https://www.youtube.com/youtubei/v1/search` (client `VISIONOS`). |
| Busca de artistas | L531–628 | `POST https://music.youtube.com/youtubei/v1/search` (client `WEB_REMIX`). |
| Extração de stream de áudio | L1283–1487 | `POST https://www.youtube.com/youtubei/v1/visitor_id` e `/youtubei/v1/player` (client `VISIONOS`), `INNERTUBE_USER_AGENT`, `Referer`/`Origin` `https://www.youtube.com`, mensagens de erro contendo `"InnerTube"`. |
| Relacionados e Rádio infinita | L1647–2180 | `POST https://music.youtube.com/youtubei/v1/next` (`WEB_REMIX`, `playlistId: RDAMVM...`), filtro de YouTube Shorts. |
| Perfil de artista e Álbuns | L2182–2939 | `POST https://music.youtube.com/youtubei/v1/browse` (`WEB_REMIX`, `MPREb_`, `VLOLAK`, `UC...`). |
| Thumbnails fallback | L401, L643, L817, L843, L1440, L1526, L1539, L1571, L1824, L2397 | URLs `https://i.ytimg.com/vi/${id}/hqdefault.jpg`. |
| Letras | L2940–3136 | `https://lrclib.net/api/get` (API aberta, sem problema) + tipo `provider: 'lrclib' \| 'innertube' \| 'none'`. |

---

### 3.5. Suíte de Testes (`tests/`)

| Arquivo | Ocorrências | Observação |
| :--- | :--- | :--- |
| `tests/flow3_player_ytmusic.test.js` | Nome do arquivo + 14 linhas | Nome do arquivo e títulos de testes citam `YouTube Music` / `Spotify`; L510 valida ausência de branding na UI; L1397/L1537 usam `spotify-nav-fade`. |
| `tests/spotify_mini_player.test.js` | Nome do arquivo + 15 linhas | Nome do arquivo, `SPOTIFY_DARK_PALETTES`, `i.ytimg.com`, descrições Spotify/YouTube. |
| `tests/flow2_search.test.js` | 48 linhas | Mocks de `youtube.com/youtubei/v1/*`, `extractYouTubeUrlVideoId`, URLs `youtu.be`/`youtube.com`/`open.spotify.com`, `i.ytimg.com`, `Referer`/`Origin`. (L1718 valida que erro não menciona YouTube.) |
| `tests/artist_profile.test.js` | 27 linhas | Fixtures com `VLOLAK`, `MPREb_`, `lh3.googleusercontent.com`. |
| `tests/lyrics_radio_related_artist.test.js` | 9 linhas | Mocks de `/youtubei/v1/next`, `RDAMVM`, verificação anti-branding (L418). |
| `tests/deep_dark_atmospheric_design.test.js` | 6 linhas | Descrições "YouTube Music Palette", `i.ytimg.com`, `hqdefault`. |
| `tests/services_database.test.js` | 6 linhas | Asserções de headers `Referer`/`Origin` `https://www.youtube.com`. |
| `tests/flow1_navigation.test.js` | 5 linhas | Importa `YouTubeMusicSidebar`, verifica `spotify-nav-fade`. |
| `tests/flow4_playlists_favorites.test.js` | 4 linhas | Fixtures `i.ytimg.com/.../hqdefault.jpg`. |
| `tests/android_icon_and_perf_fixes.test.js` | 3 linhas | Verifica `spotify-nav-fade` e existência de `SonaryInnerTubeClient.kt`. |
| `tests/visual_responsive_diff.test.js` | 3 linhas | Descrições citando "YouTube Music". |
| `tests/flow3_player.test.js` | 2 linhas | Comentário/descrição citando "Spotify". |
| `tests/search_ui_enhancements.test.js` | 1 linha | Descrição citando "YouTube Music". |

---

### 3.6. Distribuição, Auto-Updater e Pontos Únicos de Falha (Risco Operacional DMCA)

| Arquivo | Linhas | O que foi encontrado | Risco |
| :--- | :--- | :--- | :--- |
| `services/updater.ts` | L10, L152–165, L247, L284, L318, L325, L456 | `GITHUB_REPO = 'appsonary/sonary_app'` e `isTrustedGitHubUrl()` travam o auto-updater **exclusivamente** em `github.com` / `*.githubusercontent.com`. | **Crítico (Resiliência)** — se o repo sofrer DMCA no GitHub, 100% da base instalada perde capacidade de receber atualizações. |
| `components/UpdateModal.tsx` | L126, L134 | Links diretos para `https://github.com/appsonary/sonary_app/releases`. | **Médio** — acoplado ao host único. |
| `components/SupportSection.tsx` | L28–29 | `SHOW_PIX_SUPPORT = false` (bom: monetização desativada) e `SONARY_OFFICIAL_SITE_URL = 'https://appsonary.com/'`. | **Baixo hoje** — evitar ativar Pix com CPF/CNPJ pessoal em repo público. |

---

## 4. Plano de Ação Recomendado (Em 3 Fases)

### Fase 1 — Higienização do Repositório Principal (sem quebrar nada)
1. **Reescrever `README.md`** com linguagem 100% agnóstica (player de áudio local-first e streaming modular, sem citar YouTube, InnerTube, `googlevideo.com`, Piped ou Invidious).
2. **Desacoplar headers do player e storage:**
   - Remover `Referer`/`Origin` hardcoded de `services/player.ts` e `services/storage.ts` — ambos devem apenas repassar `headers` e `userAgent` recebidos do objeto de stream retornado pelo provedor.
   - Remover fallback hardcoded de `https://www.youtube.com` em `SonaryDownloadWorker.kt` dentro de `plugins/withBackgroundDownloads.js`.
3. **Remover marcas de terceiros (`YouTube` / `Spotify`) de UI e testes:**
   - Renomear `components/YouTubeMusicSidebar.tsx` → `components/DesktopSidebar.tsx` (e props/imports).
   - Renomear `hasYouTubeLetterbox` → `hasLetterboxArtwork` (usando verificação genérica ou flag do provedor).
   - Renomear `SPOTIFY_DARK_PALETTES` → `AMBIENT_DARK_PALETTES`, `spotify-nav-fade` → `bottom-nav-fade`, `spotifyNavFade` → `bottomNavFade`, e estilos `spotify*` em `NowPlayingModal.tsx` e `LyricsViewer.tsx`.
   - Renomear `extractYouTubeUrlVideoId` → `extractDirectMediaId` na interface pública consumida por `App.tsx`.
   - Renomear `tests/flow3_player_ytmusic.test.js` → `tests/flow3_player_drawer.test.js` e `tests/spotify_mini_player.test.js` → `tests/persistent_mini_player.test.js`, atualizando referências/asserções.

### Fase 2 — Extração do Provedor para Biblioteca Externa Própria
1. Definir uma interface genérica `MediaProvider` no `sonary_app` (`searchTracksPage`, `searchArtists`, `getAudioStream`, `getRelatedTracks`, `getTrackRadio`, `getArtistRadio`, `getArtistProfile`, `getAlbumDetail`, `extractDirectMediaId`).
2. Mover toda a implementação específica (`services/api.ts` atual, exceto talvez LRCLIB que é aberto) para um **pacote/repositório separado** (ex.: hospedado em Codeberg/Forgejo ou org separada), com **cascata de múltiplos clients** + fallback configurável.
3. Eliminar a duplicação de `SonaryInnerTubeClient.kt`:
   - Pré-resolver `streamUrl` + `headersJson` (colunas já existentes em `download_queue` em `services/database.ts`) antes de disparar o `WorkManager`, **ou** fornecer a implementação nativa dentro do próprio pacote do provedor.

### Fase 3 — Resiliência de Distribuição e Auto-Updater
1. Adaptar `services/updater.ts` para aceitar **múltiplas URLs/mirrors de manifest (`latest.json`)** (ex.: domínio próprio / Codeberg / mirror configurável) com validação forte (SHA-256 + assinatura de manifest), removendo a dependência exclusiva de `github.com`.
2. Avaliar distribuição de APKs fora das *GitHub Releases* (F-Droid / IzzyOnDroid / Codeberg / site próprio) caso o projeto ganhe grande escala, preservando o repositório no GitHub focado em código-fonte agnóstico.

---

## 5. Critérios de Verificação (Quando Executar as Fases)

- [ ] `npx tsc --noEmit` sem erros;
- [ ] `npm test` com 100% da suíte passando;
- [ ] Nova varredura regex em todo o repositório (fora do pacote provedor externo) retornando **0 ocorrências** de `youtube`, `youtu.be`, `ytimg`, `ytmusic`, `googlevideo`, `innertube`, `invidious`, `piped` e `spotify`;
- [ ] Rebuild nativo (`npm run patch:android` / `npm run android`) validando playback, fila e download em background.
