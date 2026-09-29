# Investigación por especialista (base de 2.2, 2.3, 2.7 y 2.8)

Estado: **investigado (29-09-2026)**, pendiente de aprobación junto con `plans/specialists-catalog.md` y
`plans/rules-guardian.md`. Restricción del usuario: **solo herramientas gratuitas**; el plugin no depende de ninguna
herramienta externa (se usan si están instaladas; si no, hay alternativa). `[U]` = no verificado en fuente primaria.

## Principios comunes (con evidencia)
- **El entorno decide "hecho", no el agente**: resultados de tests/ejecución en cada paso; "show evidence rather than
  asserting success" (https://www.anthropic.com/research/building-effective-agents, https://code.claude.com/docs/en/best-practices).
- **Los agentes hacen trampa con los tests**: modifican tests o hacen casos especiales, y los modelos más fuertes más
  (https://metr.org/blog/2025-06-05-recent-reward-hacking/, https://arxiv.org/abs/2510.20270). Guarda común: comprobar
  por código el diff de los archivos de test y prohibir casos especiales de entradas de test.
- **Un revisor al que se le pide encontrar fallos los encuentra aunque no los haya** (Claude Code best practices). La
  revisión automática tiene precisión < 10 % en SWR-Bench, y agregar varias revisiones mejora el F1 hasta un 43,67 %
  (https://arxiv.org/abs/2509.01494). Guarda: solo hallazgos con `archivo:línea` + resultado de herramienta o traza
  concreta; el LLM **clasifica** avisos de herramientas en vez de inventarlos (https://arxiv.org/abs/2411.03079).
- **Cada afirmación con su fuente**, y lo no verificado se marca como tal (ya es el contrato común del catálogo).

## Lectura de código — `explore` mejorado (decisión: mejorar `explore`, Graphify opcional)
- **Hoy**: `explore` tiene LSP (`lsp_symbols`, definiciones, referencias) y grep; ast-grep solo vía un script de skill
  (`packages/omo-opencode/src/agents/explore.ts:29-32,112`). El índice de 1.2 no indexa símbolos de código. Falta: mapa
  del proyecto, leer solo un símbolo, "quién llama a X" en cadena, esquema de archivo sin servidor LSP.
- **Cómo se hace fuera**: recuperación "just in time" en vez de índices vectoriales
  (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); mapa del repo con tree-sitter +
  ranking en ~1k tokens (https://aider.chat/docs/repomap.html); herramientas por símbolo vía LSP (Serena, GPL, solo como
  MCP opcional, https://github.com/oraios/serena).
- **Graphify** (Apache-2.0/MIT, https://github.com/Graphify-Labs/graphify; instalado localmente v0.8.39): grafo por AST
  sin LLM para código (`graphify update`), consultas `query --budget`, `path`, `explain`, `affected`. Afirma 71,5× menos
  tokens (benchmark propio). Límites: se queda viejo sin actualizar, responde por nodos (luego hay que leer), Python 3.10+.
- **Diseño**:
  1. Graphify si está instalado y hay `graphify-out/graph.json`; si el grafo es más viejo que el último commit,
     `graphify update .` (nunca `extract`/`label`, que usan LLM).
  2. `code_outline` (esquema de símbolos por LSP, con respaldo ast-grep sin servidor).
  3. Definición/referencias LSP y `callers` (referencias recursivas).
  4. ast-grep (herramientas MCP directas) y grep/glob.
  5. `read_symbol` (solo el rango del símbolo).
  6. `repo_map` (estilo Aider, cacheado en el índice de 1.2 por hash de archivo) para orientarse.
- **Contrato**: respuesta + `archivo:rango` leído de verdad en la sesión por afirmación; `EXTRACTED` (visto) o `INFERRED`
  (grafo/heurística).
- **Medición**: 20-30 preguntas con respuesta conocida; `explore` actual vs mejorado sin Graphify vs con Graphify;
  tokens de entrada, llamadas y acierto. Objetivo: ≥ 50 % menos tokens sin perder acierto.

## Información
### `api-lookup`
- **Herramientas gratis**: context7 (MIT; clave opcional; con clave gratuita 1000 llamadas/mes, sin clave pool compartido
  con 429 frecuentes — https://context7.com/plans), docs oficiales (`webfetch`), API de pkg.go.dev (`/v1beta/`,
  https://go.dev/blog/pkgsite-api), proxy de Go.
- **Procedimiento**: 1) versión instalada desde el lockfile (sin red); 2) en paralelo context7 y la doc oficial de esa
  versión; 3) parar con un fragmento autoritativo; 4) ejemplos reales (grep.app) solo si la doc es ambigua.
- **Guardas**: la versión detectada debe figurar en la respuesta; contrastar context7 con la doc oficial; un 429 se
  informa como `degraded`, nunca en silencio.

### `librarian` (investigación web)
- **Búsqueda sin pagar**: `websearch` nativo de OpenCode (MCP alojado, sin clave, con proveedor OpenCode o
  `OPENCODE_ENABLE_EXA`, https://opencode.ai/docs/tools); Exa con clave gratuita sin tarjeta
  (https://exa.ai/docs/reference/pricing); SearXNG propio (https://docs.searxng.org/dev/search_api.html); lectura con Jina
  Reader sin clave a 20 peticiones/min (https://jina.ai/reader/); grep.app MCP gratis (https://mcp.grep.app). Brave queda
  fuera (pide tarjeta).
- **Procedimiento**: 2-4 subconsultas en paralelo → deduplicar y ordenar fuentes (doc oficial > mantenedores/RFC >
  issues > blogs serios > agregadores) → leer solo 3-5 páginas → parar cuando dos fuentes de primer nivel coinciden.
- **Guardas**: cada afirmación con URL **y cita literal**; 2.6 vuelve a descargar la página y comprueba que la cita
  existe; fecha de publicación; afirmaciones de una sola fuente marcadas como no verificadas.

### `dependency-check`
- **Por qué**: el 19,7 % de 2,23 M muestras de código generado citaba paquetes inexistentes y el 43 % se repetía siempre
  ("slopsquatting") [U, fuente secundaria:
  https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419-csa/]: que el
  paquete exista no basta.
- **APIs gratis**: OSV.dev (`/v1/querybatch`, sin límites ni clave, https://google.github.io/osv.dev/api/), deps.dev v3
  (licencia, avisos, Scorecard; no cubre Packagist, https://docs.deps.dev/api/v3/), registros (npm, PyPI JSON con
  `vulnerabilities`, crates.io con User-Agent, pkg.go.dev `vulns`), Socket `depscore` sin clave.
- **Procedimiento** (una sola ronda en paralelo): registro (existe, primera publicación, mantenedores, descargas, repo) +
  OSV + deps.dev. Señales de alarma: < 90 días, pocas descargas, sin repo, nombre parecido a uno popular, scripts de
  instalación.
- **Guardas**: nunca decir que existe sin un HTTP 200 del registro; comprobar que el repo apunta de vuelta al paquete.

### `memory`
- **Estado del arte**: recencia + relevancia + importancia (https://arxiv.org/pdf/2304.03442); búsqueda híbrida FTS +
  vectores fusionada con RRF (https://simonwillison.net/2024/Oct/4/hybrid-full-text-search-and-vector-search-with-sqlite/).
- **Decisión**: FTS5 primero (ya existe, exacto para identificadores y decisiones); vectores quedan fuera por ahora (sin
  modelo de embeddings gratuito integrado); factor de recencia sobre el ranking.
- **Guardas**: cada hecho recordado cita el mensaje original literal con su id; si una decisión posterior lo contradice,
  se marca como sustituido.

### `multimodal-looker`
- **Hoy**: un PDF enviado entero a un modelo de visión cuesta ~1500-3000 tokens de texto por página más imagen
  (https://platform.claude.com/docs/en/build-with-claude/pdf-support).
- **Procedimiento**: ¿tiene capa de texto? → extraer texto (`pdftotext`) y leer solo las páginas relevantes; si no, OCR;
  visión solo para páginas con gráficos/tablas complejas o si el OCR duda; imágenes: reducir antes.
- **Guardas**: número de página por dato; zonas ilegibles marcadas como `illegible`; cifras clave revisadas con visión.

## Calidad
### `verifier`
- **Fuera**: Aider ejecuta lint tras cada edición y tests con `--auto-test` (https://aider.chat/docs/usage/lint-test.html);
  SWE-agent solo bloquea errores **nuevos**, no los que ya existían (https://github.com/princeton-nlp/SWE-agent/issues/560).
- **Procedimiento**: comandos del proyecto (instrucciones del proyecto → CI → scripts del manifiesto; nunca inventados);
  de lo más estrecho a lo más amplio; código de salida y final de la salida; un test que parece inestable se repite hasta
  3 veces y se marca `FLAKY`, nunca `PASS` (https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html).
- **Guardas**: comparar con una ejecución base para no culpar al cambio de fallos previos; informar tests saltados.
- **Contrato**: `status pass|fail|flaky|blocked`, comandos con salida, fallos previos vs nuevos, saltados, inestables.

### `test-writer`
- **Fuera**: un test de reproducción solo vale si falla antes del arreglo y pasa después; filtrar parches así duplica la
  precisión (https://arxiv.org/abs/2406.12952); Meta escribe tests contra fallos inyectados que los tests actuales no
  detectan (73 % aceptados, https://arxiv.org/abs/2501.12862).
- **Procedimiento**: test mínimo desde la especificación, no desde la implementación → rojo **por la razón esperada** →
  entregar al implementador → tras el arreglo, verde sin regresiones.
- **Guardas**: los valores esperados salen de la especificación, nunca de ejecutar el código (los LLM capturan el
  comportamiento actual, https://arxiv.org/abs/2410.21136); rechazar asserts debilitados, `skip` o mocks demasiado amplios.

### `debugger`
- **Fuera**: depuración científica — hipótesis → experimento → conclusión, en bucle (https://arxiv.org/abs/2304.02195).
- **Procedimiento**: reproducir (el test de `test-writer`); si es una regresión con un commit bueno conocido,
  `git bisect run` con ese test (https://git-scm.com/docs/git-bisect); si no, hasta ~5 iteraciones hipótesis/experimento;
  parar cuando un experimento confirma la hipótesis.
- **Guardas**: ninguna hipótesis sin experimento; no arreglar síntomas; sin logs de depuración olvidados.

### `ui-tester`
- **Fuera**: Playwright MCP trabaja con el árbol de accesibilidad, no con píxeles, y recomienda su CLI para agentes por
  gastar menos tokens (https://github.com/microsoft/playwright-mcp); Chrome DevTools MCP añade consola, red y rendimiento
  (https://github.com/ChromeDevTools/chrome-devtools-mcp).
- **Procedimiento**: navegar → instantánea de accesibilidad a archivo y leer solo lo necesario → interactuar por roles →
  comprobar con instantáneas ARIA (https://playwright.dev/docs/aria-snapshots) + errores de consola/red → captura solo
  para afirmaciones visuales → parar cuando cada criterio tiene su evidencia.

### Revisores (`security-reviewer`, `test-reviewer`, `lang-reviewer`, `architect-reviewer`)
- **Procedimiento común**: ejecutar las herramientas sobre el diff → el LLM clasifica cada aviso con el fragmento de
  código → hallazgos propios solo con traza concreta → parar. Hallazgos críticos/altos solo con herramienta o traza
  reproducible.
- **Herramientas gratuitas (si están instaladas)**:
  - Seguridad: Opengrep (fork abierto de Semgrep; las reglas oficiales de Semgrep tienen licencia restrictiva desde 2024,
    https://semgrep.dev/blog/2024/important-updates-to-semgrep-oss/), gitleaks, TruffleHog `--results=verified`,
    OSV-Scanner, govulncheck (solo vulnerabilidades alcanzables, https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck),
    bandit, gosec.
  - Calidad de tests: mutación incremental — Stryker `--incremental`, mutmut, gremlins (Go), Infection (PHP).
  - Lenguaje: los linters de cada lenguaje; el revisor solo informa lo que el linter no puede expresar.
  - Arquitectura: import-linter, deptrac, dependency-cruiser, arch-go.
- **Contrato**: herramientas ejecutadas (comando, salida), hallazgos con `origen: herramienta|llm`, confianza, y lista de
  avisos descartados como falsos positivos con su motivo.

### `docs-writer`
- **Fuera**: Diátaxis — tutorial, guía, referencia y explicación, separados (https://diataxis.fr/); CHANGELOG generado
  desde Conventional Commits con git-cliff (https://git-cliff.org/).
- **Procedimiento**: diff → superficies públicas cambiadas (CLI, API, config) → solo esas secciones → changelog desde los
  commits → lint de docs y enlaces.
- **Guardas**: cada afirmación de la doc apunta a un símbolo o archivo; no reescribir lo que no toca el diff.

### `git-committer`
- **Fuera**: Aider escribe los mensajes con un modelo barato pero mete cambios ajenos en sus commits
  (https://aider.chat/docs/git.html); las reglas en el prompt son orientativas y se imponen con hooks
  (https://code.claude.com/docs/en/best-practices).
- **Procedimiento**: `git status` + `git diff --stat` → agrupar por cambio lógico → `git add <rutas>` explícito (nunca
  `-A`) → escaneo de secretos del diff preparado → `tipo(ámbito): asunto` + cuerpo con el porqué → commit con hooks; si
  un hook falla, arreglar y commit **nuevo** → parar.
- **Guardas (por código)**: denegar `push`, `--amend`, `--force`, `--no-verify`, `reset --hard`, `add -A`/`add .`.

## Cambios que esto introduce en el catálogo
- `explore` mejorado (lectura eficiente) + herramientas nuevas `code_outline`, `read_symbol`, `repo_map`, `callers`;
  Graphify opcional → **paso 2.8**.
- Nuevo especialista `rules-checker` → **paso 2.7** (guardián de reglas).
- `git-committer`: además deniega `--no-verify`, `--force` y `git add -A`/`git add .`.
- `verifier`: ejecución base para distinguir fallos previos, y estado `flaky`.
- Revisores: usan las herramientas gratuitas **si están instaladas** (detección, nunca instalación sin permiso) y
  clasifican sus avisos; el contrato separa hallazgos de herramienta y de LLM.
- `librarian`: citas literales verificables; `api-lookup`: versión del lockfile obligatoria en la respuesta.
