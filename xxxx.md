# Tarefa: Inferência de Artista Dominante para Busca de Artistas com Erros de Digitação (Sonary Pro)

## Contexto e Problema Verificado
No Sonary Pro (`services/api.ts`), `searchTracksPage` já executa em paralelo:
1. A busca de faixas (`searchInnerTubeBatch` / `fetchFallbackBatch` em `www.youtube.com/youtubei/v1/search`), que possui autocorreção semântica completa.
2. A busca de artistas (`searchArtists` em `music.youtube.com/youtubei/v1/search` com filtro `params: 'EgWKAQIgAWoKEAkQChADEAUQBA%3D%3D'`).

Em testes empíricos reais contra a API, o filtro de artistas corrige typos simples (`charlie brow jr`, `lincon park`), mas falha em **substituições por palavras reais do dicionário** (comuns em autocorretor de teclado / voz):
- **Caso A (retorno vazio):** `"avenged stanford"` retorna `artists = []`, embora as faixas retornadas sejam ~92% de `"Avenged Sevenfold"`.
- **Caso B (divergência forte):** `"three days grape"` retorna `["Big Moochie Grape", "Moby Grape"]`, embora ~58% das faixas retornadas sejam de `"Three Days Grace"`.

## Objetivo
Implementar em `services/api.ts` um mecanismo determinístico, Zero-Backend e anti-alucinação que infere o artista dominante a partir das faixas já retornadas na 1ª página de `searchTracksPage`, acionando um fallback condicional de `searchArtists(inferredArtist)` sem impacto de latência no caminho feliz.

## Escopo Estrito (Arquivos Permitidos)
Modifique **apenas**:
1. `services/api.ts`
2. `tests/flow2_search.test.js`

Não altere componentes de UI (`App.tsx`, `ArtistResultsSection.tsx`, `SearchBarSection.tsx`, etc.) nem arquivos não relacionados no working tree (`components/SupportSection.tsx`, `tests/app_updater.test.js`).

## Especificação Técnica

### 1. Helper `inferDominantArtistFromTracks` em `services/api.ts`
Crie uma função auxiliar pura (pode exportar apenas se útil para teste unitário direto, mantendo a superfície enxuta):
```ts
interface DominantArtistInference {
  name: string;
  count: number;
  total: number;
  ratio: number;
}
```
Regras obrigatórias:
- Inspecionar no máximo as primeiras `12` faixas de `tracks` (`tracks.slice(0, 12)`). Se `tracks.length === 0`, retornar `null`.
- Para cada faixa, extrair o artista real reutilizando a função **já existente** `extractTrackMetadata(track.title, track.artist)` em `services/api.ts` (linha ~1192) — isso já remove sufixos `- Topic` / `VEVO` e extrai o artista verdadeiro em títulos `"Artista - Música"` mesmo em canais de fãs (ex.: `"Avenged Sevenfold - Live In The LBC"` no canal `"TSTS"`).
- Ignorar candidatos vazios ou genéricos (`/^(?:artista(?:\s+desconhecido)?|various artists|v[aá]rios artistas)$/i`).
- Agrupar por chave normalizada (lowercase + trim + espaços colapsados; preservar a grafia original mais frequente ou primeira vista para `name`).
- Retornar `{ name, count, total, ratio }` do artista mais frequente **somente** se passar no limiar mínimo anti-alucinação:
  - `count >= 3` **E** `ratio >= 0.35` (onde `ratio = count / sample.length`).
- Caso contrário, retornar `null` (nunca inferir artista em buscas aleatórias/heterogêneas como `"xyzqwertyuiop12345"` onde o máximo é `1/12 = 8%`).

### 2. Fallback condicional em `searchTracksPage` (`services/api.ts`)
Aplique **somente na 1ª página** (`!options.continuationToken`), **somente quando `tracks.length > 0`**, e **sempre** respeitando `mockedArtists` (usando a mesma função `resolveArtists = hasMockedArtists ? mockedArtists : searchArtists` com `.catch(() => [])`):

Crie um helper curto `enrichArtistsFromTracks(query, tracks, primaryArtists, fetchArtists)` usado tanto no retorno de `searchInnerTubeBatch` quanto no de `fetchFallbackBatch` (e, se aplicável, mantendo compatibilidade total com o atalho de mock legado `mockedSearch` sem quebrar testes existentes que mockam apenas `api.searchTracks`):

- Calcule `inferred = inferDominantArtistFromTracks(tracks)`.
- Se `!inferred`, retorne `primaryArtists`.
- Se `inferred.name.toLowerCase() === query.trim().toLowerCase()`, retorne `primaryArtists` (evita chamada redundante idêntica à query original).
- **Caso A — `primaryArtists.length === 0`:**
  - Com `inferred` válido (`count >= 3 && ratio >= 0.35`), chame `fetchArtists(inferred.name, DEFAULT_ARTIST_SEARCH_LIMIT)` com `.catch(() => [])` e retorne o resultado.
- **Caso B — Divergência forte (`primaryArtists.length > 0`):**
  - Se `inferred.count >= 4 && inferred.ratio >= 0.50` **E** nenhum item em `primaryArtists` corresponder ao artista inferido (comparação case-insensitive / sem acentos simples ou inclusão exata do nome normalizado):
    - Chame `fetchArtists(inferred.name, DEFAULT_ARTIST_SEARCH_LIMIT)` com `.catch(() => [])`.
    - Se retornar artistas, **mescle** colocando os resultados inferidos primeiro e depois os `primaryArtists`, deduplicando por `id` e por `name.toLowerCase()`, limitado a `DEFAULT_ARTIST_SEARCH_LIMIT` (`12`).
- **Resiliência:** qualquer erro no fallback deve cair silenciosamente para `primaryArtists` — nunca bloquear nem falhar a busca de músicas.
- **Importante sobre o atalho de mock legado (`mockedSearch`):** só dispare `enrichArtistsFromTracks` quando `hasMockedArtists` for verdadeiro (ou no fluxo normal sem `mockedSearch`), para nunca fazer chamadas HTTP reais durante testes legados que mockam apenas `api.searchTracks`.

### 3. O que NÃO fazer
- NÃO usar `music/get_search_suggestions` (falha em `"avenged stanford"`, `"gustavo lima"` e `"sistem of a down"`).
- NÃO usar busca YTM sem `params` como fallback (alucina artistas em strings aleatórias como `"xyzqwertyuiop12345"`).
- NÃO disparar fallback quando `options.continuationToken` estiver presente (paginação).
- NÃO adicionar novas dependências nem criar abstrações desnecessárias.

## Testes Obrigatórios (`tests/flow2_search.test.js`)
Adicione testes automatizados cobrindo todos os cenários abaixo (usando mocks, sem depender de rede externa):
1. **Caso A (`artists = []` + typo como `"avenged stanford"`):** busca primária retorna `[]` para `"avenged stanford"`, faixas têm maioria de `"Avenged Sevenfold"` (incluindo upload de fã `"Avenged Sevenfold - Live In The LBC"` com canal `"TSTS"`), fallback chama `searchArtists` com `"Avenged Sevenfold"` e retorna o artista real.
2. **Caso B (divergência forte como `"three days grape"`):** busca primária retorna `["Big Moochie Grape", "Moby Grape"]`, faixas têm ≥50% (≥4) de `"Three Days Grace"`, fallback chama `searchArtists("Three Days Grace")` e promove `"Three Days Grace"` ao topo deduplicado.
3. **Anti-alucinação (controle negativo):** busca primária retorna `[]`, faixas têm artistas variados/distintos (ex.: `1/12` por artista, sem consenso) → fallback **NÃO** é chamado e `artists` permanece `[]`.
4. **Caminho feliz (zero chamada extra):** quando a busca primária já retorna o artista correspondente (ex.: `"Charlie Brown Jr."`), `searchArtists` é chamado **apenas 1 vez** (nenhuma chamada extra de fallback).
5. **Paginação (`continuationToken`):** não dispara busca nem fallback de artistas.

## Verificação Obrigatória Antes de Concluir
Execute e confirme 100% de sucesso (exit code 0):
```bash
node --test --test-concurrency=1 --require ./tests/setup.js tests/flow2_search.test.js tests/search_ui_enhancements.test.js tests/lyrics_radio_related_artist.test.js tests/android_back_navigation.test.js
npx tsc --noEmit
```

Ao finalizar, reporte de forma concisa: arquivos alterados, o comportamento dos Casos A e B, resultado dos testes e eventuais limitações/riscos conhecidos.