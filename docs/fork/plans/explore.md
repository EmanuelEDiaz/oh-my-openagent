# Paso 4.1 — `explore` + lectura de código eficiente

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **plan aprobado (01-10-2026), en curso**. Plantilla: `plans/per-agent-program.md`
(Fase 4). Base de investigación: `plans/specialists-research.md` (sección "Lectura de código") ampliada abajo.
Rutas: `S/` = `packages/omo-opencode/src/`.

## 1. Punto de partida (código, 01-10-2026)
- **Agente** (`S/agents/explore.ts`):
  - temperatura 0,1;
  - prompt con `<analysis>`, "lanza 3+ herramientas en paralelo" y salida `<results><files><answer><next_steps>`
    con rutas absolutas;
  - estrategia: LSP, ast-grep **vía un script Python de un skill** (`python3 scripts/ast_grep_helper.py`), grep,
    glob y git.
- **Permisos.** Solo deniega escribir, editar y delegar. **`bash` queda permitido sin restricciones**, a diferencia de
  los especialistas de 2.2, que tienen listas de comandos de solo lectura.
- **Herramientas reales.** `grep` (con límite), `glob` (100 resultados) y `read`, más LSP vía el MCP `lsp`
  (`symbols`, `goto_definition`, `find_references`, `diagnostics`). LSP solo funciona si el servidor del lenguaje
  está instalado.
- **Lo que no existe.** No hay mapa del repo, esquema de archivo sin LSP, lectura de un solo símbolo ni "quién llama
  a X". Hubo una integración CodeGraph y el upstream la retiró (PR #7644).
- **ast-grep.**
  - El plugin ya descarga `sg` 0.43.0 en `~/.omo/runtime/ast-grep/` (`hooks/ast-grep-sg-provision`).
  - **Probado:** una regla con `--json` devuelve funciones, clases y métodos con rango de líneas en ~60 ms sin
    dependencias nuevas.
  - **Riesgo encontrado.** En este equipo `/usr/bin/sg` es `newgrp`, un comando del sistema. Hay que llamar siempre
    al binario descargado, nunca al `sg` del `PATH`.
- **Medición base del piloto.** 9/9 con `big-pickle`, ~10,7k tokens y 6,6 turnos de media. Es un repo de 10
  archivos: demasiado fácil para distinguir mejoras.

## 2. Investigación (fuentes primarias; `[S]` = vista solo en resumen secundario)
- **Lo que funciona por defecto es buscar con grep/glob/read**, y conviene acotar las salidas.
  - SWE-agent: ventana de 100 líneas mejor que 30 o el archivo entero; búsqueda resumida +6 pp; límite de 50
    resultados `[S]` (https://swe-agent.com/latest/background/aci/).
  - Claude Code descartó la RAG vectorial porque la búsqueda agéntica funciona mejor (práctica, no benchmark).
- **Esquema de archivo, o "esqueleto".** Agentless localiza con el árbol de archivos más las firmas de cada
  archivo: ~77,7 % de acierto a nivel de archivo en SWE-bench Lite `[S]`
  (https://dl.acm.org/doi/full/10.1145/3715754).
- **Herramientas de entidad y grafo** (LocAgent, ACL 2025, https://arxiv.org/abs/2503.09089):
  - con un Qwen 7B ajustado, quitar la búsqueda de entidades baja de 71,5 % a 53,3 % y quitar el recorrido del grafo,
    a 66,1 %;
  - **el 7B base sin ajustar apenas sabe usar las herramientas.**
- **"Quién llama a X"** (https://arxiv.org/html/2608.13568, estudio pequeño, solo Claude):
  - LSP sube el F1 de 0,706 a 0,778 con +19 % de tokens;
  - ayuda mucho cuando el nombre choca con otros textos (F1 +0,55);
  - devolver solo ubicaciones sin código empeora;
  - **obligar a usar herramientas semánticas primero bajó el éxito del 100 % al 89 %.**
- **Grafos de conocimiento.**
  - Codebase-Memory (https://arxiv.org/abs/2603.27277): ~10× menos tokens pero **peor calidad (83 % frente a
    92 %)**.
  - CodeCompass `[S]`: mucho mejor en dependencias ocultas, **pero el 58 % de las veces el agente no llamó al grafo**
    si no se le indicaba.
- **Graphify.** Su "71,5×" es propio, mide tokens y no acierto, y se hizo sobre un corpus mixto. Una prueba
  independiente en 140 archivos dio ~7× y un 52 % de aristas inferidas: "un boceto, no la verdad".
  - https://github.com/Graphify-Labs/graphify/blob/v8/docs/how-it-works.md
  - https://exchangepedia.com/articles/graphify-honest-benchmark-real-codebase.html
- **Mapa del repo (Aider).** Tree-sitter más PageRank sobre referencias entre archivos, personalizado por los
  identificadores de la tarea. Presupuesto por defecto: 1.024 tokens. Se cachea por fecha de modificación.
  - https://aider.chat/docs/repomap.html
  - `aider/repomap.py`
- **Número de herramientas y modelos débiles.**
  - El acierto eligiendo herramienta cae de ~85 % con 5 a ~45 % con 20 `[S]` (https://arxiv.org/abs/2505.03275).
  - Anthropic recomienda consolidar herramientas, dar un modo conciso y dejar en los errores qué hacer después
    (https://www.anthropic.com/engineering/writing-tools-for-agents).
  - **Conclusión:** pocas herramientas, con un procedimiento fijo indicado en el prompt (mapa → símbolos → leer),
    en vez de dejar que el modelo elija.

## 3. Diseño propuesto
Se añaden 3 herramientas del plugin, y no 4 ni 6, para no saturar a modelos pequeños.

1. **`code_map`**, el mapa del repo:
   - funciones y clases de cada archivo, ordenadas por importancia (PageRank sobre "quién usa a quién"), dentro de
     ~1.000 tokens;
   - personalizado por los nombres y rutas que aparecen en la petición;
   - se cachea por hash de archivo en el índice de 1.2 (`.omo/cache/knowledge.db`, tabla nueva de símbolos);
   - es lo primero que usa `explore`.
2. **`code_symbols`**, que une esquema y lectura:
   - `{file}`: esquema del archivo con el rango de líneas de cada símbolo;
   - `{file, symbol}`: el código de ese símbolo solamente, con tope de líneas;
   - `{name}`: dónde se define ese nombre en todo el repo.
3. **`code_callers`**: quién usa un símbolo, como mucho a 2 niveles, **con el fragmento de código** de cada uso.
   - Usa LSP si hay servidor instalado (resultado `EXTRACTED`).
   - Si no, ast-grep por nombre, marcado como `INFERRED`.

**Motor común.** El `sg` descargado por el plugin, con reglas de definiciones por lenguaje al estilo de los
`tags.scm` de Aider, y LSP cuando esté disponible. Sin `sg` todavía (primer arranque), las herramientas lo dicen y
`explore` sigue con grep/glob/read.

**Graphify** sigue siendo opcional. Si existe `graphify-out/graph.json`, `code_map` añade sus relaciones como
**pistas** `INFERRED`. Si el grafo es más viejo que el último commit, `graphify update .`, que no usa modelo. Nunca
es una dependencia.

**Prompt de `explore`:**
- procedimiento fijo:
  1. `code_map`;
  2. `code_symbols` o `grep` según la pregunta;
  3. leer solo rangos;
  4. `code_callers` si la pregunta es "quién usa o llama";
- quitar "lanza 3+ herramientas en paralelo" si la medición confirma que gasta sin ayudar;
- cada afirmación con su `archivo:línea` leído de verdad, marcado `EXTRACTED` o `INFERRED`;
- se mantiene su formato `<results>`, que ya conocen los orquestadores.

**Permisos.** `bash` pasa a una lista de solo lectura como los especialistas de 2.2 (`git log/show/blame`, `ls`,
`wc`…), sin escribir ni instalar.

## 4. Banco de tareas (plantilla de la Fase 4)
- **24 tareas, 30 % reservadas** (7 que no se miran al ajustar).
- **Tipos:** dónde se define o configura algo; quién usa o llama a X (con nombres que chocan); flujo entre módulos;
  "¿existe X?" (respuesta: no existe); responder con rangos exactos.
- **Repos:**
  - este fork fijado en un commit (grande, TypeScript, sin red);
  - un repo pequeño de Python y uno de Go, públicos y fijados por commit, que se clonan una vez a una caché local y
    no se versionan;
  - el `ts-service` actual;
  - **2–3 prompts reales sobre la copia de `codegenerator`** (decisión del usuario, 02-10-2026), p. ej. "¿qué pasa
    desde que el CLI recibe un JSON hasta que se escriben los archivos?".
- **Métricas:**
  - acierto (respuesta y citas comprobadas por código);
  - **tokens de entrada**, turnos y tiempo;
  - pass^3.
- **Objetivo:** ≥ 50 % menos tokens sin perder acierto en el conjunto reservado.

## 5. Iteraciones (una mejora por medición)
1. **Medición base:** `explore` actual con el banco nuevo.
2. **+ herramientas:** `code_symbols` y `code_callers`.
3. **+ `code_map`** y el procedimiento fijo en el prompt.
4. **+ `bash` de solo lectura** y ajustes del prompt.
5. **Con y sin Graphify**, en el repo que tenga grafo.

Cada iteración se mide en el conjunto de trabajo. La mejor configuración se mide una sola vez en el reservado.

## 6. Decisiones del usuario (01-10-2026)
- **D1 — Motor de símbolos: `sg` ya descargado + LSP.**
  - Sin dependencias nuevas, ya probado, ~25 lenguajes.
  - El motor queda detrás de una interfaz interna. Si la medición muestra que se queda corto (un lenguaje, la
    precisión de los usos), se puede cambiar a `web-tree-sitter` sin tocar las herramientas ni el prompt. Eso sería
    una decisión nueva, porque añade una dependencia.
  - Descartado por ahora `web-tree-sitter`: dependencia y gramáticas de varios MB, compatibilidad con Bun sin
    documentar, más mantenimiento. Su única ventaja real, reutilizar los `tags.scm` de Aider, cuesta poco de
    replicar con reglas de ast-grep.
- **D2 — Repos de prueba:** el fork fijado en un commit, `ts-service` y dos repos públicos pequeños (Python y Go),
  clonados una vez a una caché local y sin versionar.

## Criterios de aceptación
```gherkin
Feature: explore eficiente
  Scenario: menos tokens sin perder acierto
    Given el banco de 24 tareas con 7 reservadas
    When se mide explore mejorado frente a la medición base con los mismos modelos
    Then los tokens de entrada bajan al menos un 50 % y el acierto en el reservado no baja
  Scenario: leer solo lo necesario
    When explore necesita una función de un archivo grande
    Then usa code_symbols para leer solo su rango, no el archivo entero
  Scenario: sin dependencias obligatorias
    Given que no hay sg, LSP ni Graphify
    Then las herramientas lo dicen claramente y explore responde con grep/glob/read
  Scenario: nunca el sg equivocado
    Given /usr/bin/sg es newgrp
    Then las herramientas usan el binario de ast-grep del plugin, nunca el sg del PATH
```
