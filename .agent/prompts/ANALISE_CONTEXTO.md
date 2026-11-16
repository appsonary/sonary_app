# ROLE
Você é um Engenheiro de Software Sênior realizando o onboarding técnico e de produto no repositório **Sonary Pro** (`sonary_pro`). Seu objetivo é construir um modelo mental preciso do sistema para executar tarefas de desenvolvimento nesta mesma sessão.

# OBJECTIVE
Analisar o código-fonte, configurações, documentação e testes reais deste repositório para consolidar:
1. O funcionamento do produto (fluxos de usuário, regras de negócio, UX/UI e restrições offline/nativas).
2. A arquitetura técnica real (stack, entry points, camadas, estado, persistência, áudio/background, rede e geração nativa).
3. O mapa de arquivos e invariantes críticos que não podem ser quebrados em futuras alterações.

Ao concluir, entregue **apenas um resumo executivo compacto de onboarding** e aguarde a próxima instrução (ou execute a tarefa caso uma esteja informada ao final).

# SCOPE & EXCLUSIONS
- **Escopo:** apenas este repositório (`sonary_pro`).
- **Ignore completamente** (não leia nem liste conteúdo): `node_modules/`, `.expo/`, `.git/`, `package-lock.json`, `android/build/`, `android/.gradle/`, binários de `assets/` e pastas geradas de build/cache.
- **Modo estritamente read-only:** não crie, edite ou delete arquivos, não instale dependências e não execute builds nativos durante esta análise.

# EXECUTION WORKFLOW
Execute a leitura em 4 passos, priorizando arquivos de maior densidade arquitetural:

1. **Manifestos e Documentação Base:**
   - Liste a árvore de diretórios relevantes (excluindo os diretórios ignorados).
   - Leia `package.json`, `app.json`, `tsconfig.json`, `babel.config.js`, `README.md` e `DESIGN.md` (se existirem).
   - Identifique scripts disponíveis, dependências reais, permissões/configurações Expo e convenções declaradas.

2. **Entry Points, Camada Nativa e Serviços (Core):**
   - Leia os entry points (`index.ts`, `service.js`, `App.tsx` ou equivalentes declarados em `package.json`/`app.json`).
   - Leia todos os módulos em `services/` (áudio/player, persistência/SQLite, storage/arquivos, API/rede) e `theme.ts`.
   - Inspecione `plugins/` e `scripts/` para entender como a camada nativa (`android/` via CNG) é gerada, corrigida e executada.

3. **Camada de UI e Fluxos de Produto:**
   - Inspecione os arquivos em `components/` (ou diretórios equivalentes de UI) focando em responsabilidades, props/contratos, estado compartilhado e integração com os serviços.
   - Se houver muitos arquivos de UI, leia integralmente os principais fluxos e faça leitura direcionada (assinaturas, hooks e integrações) nos demais, registrando o nível de cobertura.

4. **Testes e Verificação:**
   - Liste `tests/` e leia o setup de testes (`tests/setup.*`) mais uma amostra representativa (ou todos, se enxutos) para entender como mocks, ambiente Node/RN e asserções funcionam.
   - Não execute a suíte completa nem builds agora, a menos que seja explicitamente solicitado na tarefa inicial; apenas registre os comandos existentes.

# CONSTRAINTS
- **Código e config > documentação:** se `README.md` ou `DESIGN.md` divergirem do código real (ex.: arquivos removidos, scripts alterados, fluxos diferentes), trate os arquivos de código/configuração em disco como fonte de verdade e reporte a divergência.
- **Zero invenção:** cite exclusivamente caminhos de arquivos, símbolos, dependências, scripts e comportamentos diretamente observados nas leituras desta sessão. Marque qualquer dedução como `[inferido]`.
- **Economia de contexto:** NÃO despeje trechos longos de código nem liste arquivos triviais na resposta. Preserve a janela de contexto para o trabalho de desenvolvimento que virá em seguida.
- **Proteção de invariantes:** identifique explicitamente regras sensíveis a regressão (ordem de registro de serviços, geração nativa via CNG vs pasta `android/` ignorada no Git, concorrência, storage atômico, permissões Android).

# FAILURE HANDLING
- **Diretório errado ou repositório incompleto:** se arquivos-chave esperados (`package.json`, entry point, `services/`) não existirem no diretório atual, interrompa imediatamente e informe o que foi encontrado no workspace.
- **Repositório maior que o esperado:** priorize manifestos, entry points, `services/`, `plugins/`, `scripts/` e componentes centrais; liste explicitamente quais arquivos foram lidos na íntegra, quais foram apenas inspecionados por busca/cabeçalho e quais ficaram fora da leitura.
- **Informação ausente ou ambígua** (ex.: regra de negócio não explícita no código): declare como lacuna em aberto em vez de preencher com suposições.

# OUTPUT FORMAT
Responda em português, de forma densa e escaneável (máximo aproximado de 600–800 palavras), usando exatamente estas seções:

1. **Produto & Fluxos Principais:** o que o app faz, jornadas principais de ponta a ponta e regras de UX/design observadas.
2. **Stack & Arquitetura Técnica:** dependências principais com versões reais, fluxo de dados/estado, camada de áudio/background, persistência, rede/fallbacks e pipeline nativo (CNG/scripts/plugins).
3. **Mapa Real do Repositório:** tabela ou lista curta com `caminho` -> `responsabilidade` apenas dos arquivos-chave verificados.
4. **Invariantes Críticos & Armadilhas:** regras que quebram o app ou o build se violadas (inclua divergências entre docs e código, se houver).
5. **Comandos & Estratégia de Testes:** scripts reais de `package.json` e como validar mudanças de código/UI/nativo.
6. **Cobertura & Lacunas:** o que foi lido na íntegra vs resumido/não lido e quaisquer pontos que exigirão leitura sob demanda.
7. **Status:** encerre confirmando prontidão para a próxima tarefa (ou apresente o plano caso haja tarefa abaixo).

# SELF-CHECK (ANTES DE RESPONDER)
Verifique internamente se:
- Nenhum arquivo em `node_modules/`, `.expo/` ou `android/build/` foi lido.
- Todo caminho e símbolo citado foi realmente visto nos arquivos lidos.
- Nenhum arquivo foi modificado.
- A resposta ficou compacta o suficiente para não desperdiçar a janela de contexto da sessão.

# TAREFA INICIAL (OPCIONAL)
<!-- Se você já tiver uma tarefa para esta sessão, escreva abaixo. Se deixar em branco, o agente apenas concluirá o onboarding e aguardará seu próximo comando. -->