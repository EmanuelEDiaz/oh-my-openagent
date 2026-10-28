# 0.27 — Mapa de impacto: que un cambio arrastre a todo lo que depende de él

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **en plan (21-10-2026)**, pendiente de aprobación del diseño; va
después de 0.25 (los dos usan los servidores de lenguaje).

## Petición del usuario (21-10-2026)
"A la hora de programar o planificar sucede que un sistema tiene una cosa que depende de otra: un botón de una vista,
este de un controlador y después el backend. Cuando se le manda a OpenCode modificar algo, a veces toca solo el botón o
el controlador, ignorando sus dependencias." Idea del usuario: tener guardada la dependencia de cada cosa, bien
detallada (hecha con anterioridad o iniciada al tocar un proyecto por primera vez, y actualizada mientras se programa),
para que OpenCode sepa qué modificar; ayudaría también con el tipado. Además: principios SOLID y la arquitectura del
proyecto, preguntada al usuario, con una escalable (hexagonal) como respaldo.

## Crítica de la idea (acordada con el usuario el 21-10-2026)
- **Acierta en el objetivo.** Es un fallo medido: en SWE-bench-Live los arreglos de un archivo y menos de 5 líneas se
  resuelven en torno al 48 %; con 3 o más archivos, menos del 10 %; con 7 o más, ninguno.
- **Cambia la forma.** Un mapa detallado escrito a mano o por el modelo envejece y miente, y el agente se lo cree. El
  mapa se **deriva del código** y se recalcula al editar. Lo único escrito a mano es pequeño: los contratos entre capas
  que no se puedan detectar y las reglas de arquitectura confirmadas por el usuario.
- **La garantía no la da el mapa, sino un control por código tras editar.** Dar el mapa solo como contexto aporta poco
  (RepoGraph: unos 2 puntos en SWE-bench Lite); obligar a cubrir lo afectado es lo que funcionó en CodePlan (5 de 6
  repositorios aprobados frente a 0 de 6 sin planificación).
- **Arquitectura: seguir la del proyecto, no imponer una.** Imponer hexagonal a un proyecto pequeño o con otra
  arquitectura lo complica y mezcla estilos. Proyecto existente: detectar y seguir; nuevo: preguntar; sin respuesta:
  hexagonal para backend mediano o grande. SOLID y patrones los revisa el revisor de arquitectura (4.11c).

## Homólogos estudiados (investigación del 21-10-2026)
| Sistema | Qué hace | Lo que tomamos | Lo que evitamos |
|---|---|---|---|
| CodePlan (Microsoft, FSE 2024) | tras cada edición: dependencias incrementales, "a quién afecta", y lo afectado entra al plan como obligación; cierra con compilar sin errores | el bucle completo, por código | — |
| RepoGraph (ICLR 2025), LocAgent, CoEdPilot | grafo de definiciones y usos; vecindario de 1–2 saltos; predecir qué más debe cambiar | consulta bajo demanda a 1–2 niveles | dar el grafo solo como contexto |
| Aider repo map | etiquetas de tree-sitter, PageRank, caché por fecha de cada archivo, presupuesto de tokens | caché por archivo y presupuesto | inyectar el mapa en cada petición |
| Serena, nuestro LSP | referencias exactas desde el servidor de lenguaje, siempre al día | referencias exactas en TypeScript | varios servidores a la vez en 7,6 GB |
| SCIP / Sourcegraph | índice exacto, caro de regenerar | — | índice completo en cada edición |
| graphify | AST más aristas inferidas por un LLM, comunidades | orientarse y proponer capas | aristas inferidas como obligaciones |
| Nx affected, Bazel rdeps, `vitest related` | "qué depende de lo que cambié", determinista | el patrón y la elección de pruebas afectadas | — |
| OpenAPI / tRPC / GraphQL / esquema de ORM | el contrato entre capas son los tipos | prioridad 1 para enlazar capas | — |
| slnmap, Ariadne, graph-connect-api | enlazan llamadas del frontend con rutas del backend por patrones | prioridad 2, con su confianza | tratarlas como exactas (URLs dinámicas) |
| dependency-cruiser, eslint-plugin-boundaries, import-linter, ArchUnitTS | reglas de capas sobre el grafo de importaciones, declaradas | escribir las reglas confirmadas en su formato | inferir capas sin confirmarlas |
| Claude Code, Sourcegraph Cody | dejaron los embeddings por búsqueda exacta | — | embeddings como fuente de dependencias |

## Diseño
1. **Índice derivado del código, en caché.** Referencias exactas por el servidor de lenguaje (TypeScript); ast-grep o
   tree-sitter para lo barato y lenguajes sin servidor. Granularidad de símbolo con resumen por archivo. Caché por hash
   del contenido de cada archivo: solo se recalcula lo editado y sus vecinos. Sin vigilante permanente (RAM). Reutiliza
   las herramientas de `explore` (4.1: `code_map`, `code_symbols`, `code_callers`) y `lsp_find_references`.
2. **Contratos entre capas, por prioridad.**
   1. Si hay OpenAPI, tRPC, GraphQL o esquema de ORM (Prisma, Drizzle): el contrato son los tipos; la comprobación de
      tipos encuentra a los dependientes.
   2. Si no: detectores por patrones (rutas de Express, Fastify, Next o NestJS frente a `fetch` o axios), cada enlace con
      su confianza; los de baja confianza son avisos, no obligaciones.
   3. Lo que no se pueda detectar: un archivo pequeño de contratos en `.omo/`, aprobado por el usuario y comprobado por
      el plugin (si un contrato deja de ser cierto, avisa).
3. **El planificador** (Prometheus, 4.16) recibe una **lista de impacto calculada**, no el mapa entero: cada tarea del plan
   cubre o justifica cada dependiente.
4. **El implementador** recibe al empezar "tocas X; dependientes directos: …" y puede consultar a 1–2 niveles.
5. **Control por código (el bucle de CodePlan).** Tras cada edición: recalcular las referencias del símbolo cambiado y los
   errores de tipos nuevos (reutilizando `edit-diagnostics`). Antes de dar la tarea por terminada: si quedan dependientes
   sin tocar y sin justificar, o la comprobación de tipos o el build fallan, no se cierra y se le dice al agente qué falta.
   Enlaza con el guardián de tipos (0.9c).
6. **Arquitectura.** Detectar por carpetas e importaciones (y comunidades de graphify si existen); el usuario confirma;
   se escribe como configuración de dependency-cruiser o eslint-plugin-boundaries (TypeScript) o import-linter (Python) y
   se comprueba por código solo sobre las violaciones nuevas. Proyecto nuevo: preguntar; por defecto, hexagonal para
   backend mediano o grande. El revisor de arquitectura (4.11c) revisa SOLID y patrones.
7. **Presupuesto.** Nunca el mapa entero en el prompt: listas cortas y consultas bajo demanda (los modelos pequeños se
   degradan con contexto largo). Medir los tokens añadidos.

## Primera versión medible
- **Banco nuevo:** el repositorio `ts-service` y una aplicación de pila completa pequeña (React → cliente → ruta Express →
  handler → Prisma).
- **Tareas (simples, difíciles y extremas):** añadir o renombrar un campo de punta a punta; cambiar la firma de una
  función con N llamadores; añadir un parámetro a un endpoint; eliminar un campo; extremo: una URL construida
  dinámicamente.
- **Tres variantes:** sin nada; con la herramienta de impacto solo informativa; con la herramienta y el control de cierre.
- **Métricas:** cobertura de dependientes frente al parche de referencia; dependientes omitidos en silencio; build y
  comprobación de tipos en verde; pruebas en verde; pass@1 y pass^3; falsas obligaciones; tokens, tiempo y RAM máxima.
- Se adopta por defecto solo si la variante con control mejora sin disparar las falsas obligaciones ni la RAM.

### Banco construido (22-10-2026, rama `feat/impact-map`)
- **Suite `impact`** (`script/fork/bench/tasks/impact/`), 8 tareas, todas con solución comprobada con un parche de
  referencia (tests visibles, ocultos y tipos en verde) y que la app sin tocar falla:
  | Tarea | App | Nivel | Archivos del parche de referencia |
  |---|---|---|---|
  | status-filter | orders-app | simple | 2 (ruta y cliente) |
  | validate-email | ts-service | simple | 3 (firma con 2 llamadores) |
  | delivery-date | orders-app | difícil | 5 (fila, datos, handler, tipo del cliente, vista) |
  | rename-total | orders-app | difícil | 4 (incluye el recibo del servidor, que nadie nombra) |
  | remove-discount | orders-app | difícil | 5 (prompt de 5 palabras) |
  | token-from-config | ts-service | difícil | 3 (solo la comprobación de tipos encuentra `index.ts`) |
  | currency | orders-app | extrema | 7 (firma de `formatMoney` con llamadores en los dos lados) |
  | rename-route | orders-app | extrema | 2 (el cliente arma la URL con una constante: buscar "/api/orders" no la encuentra) |
- **Cambio frente al diseño:** la app de pila completa no usa React, Express ni Prisma, sino las mismas capas en
  TypeScript sin dependencias (fila → almacén → handler → ruta → cliente → vista). Así no hay `npm install` por tarea
  (RAM y red) y el cliente no comparte tipos con el servidor, que es el caso difícil: la comprobación de tipos no
  encuentra a los dependientes del otro lado.
- **Métrica nueva `info:impact`** (`graders.ts`): archivos del parche de referencia tocados, omitidos y omitidos en
  silencio (el resumen final no los nombra), y archivos cambiados fuera de la lista. No decide el aprobado.
- Holdout: status-filter y token-from-config.

### Línea base (22–28-10-2026)
Agente `sisyphus` sin nada del 0.27, modelos gratis del sandbox (`deepseek-v4.1-flash-free` hace el trabajo;
`big-pickle` aparece en dev solo por el título de sesión). Informe: `docs/fork/evals/impact.md`; datos en `.omo/evals/`.

| Conjunto | Ejecuciones | pass@1 | pass^3 | Cobertura de impacto | Omitidos en silencio | Tokens medios | Tiempo medio |
|---|---|---|---|---|---|---|---|
| dev (6 tareas × 3) | 18 | 100 % | 100 % | 18/18 completa | 0 | 40 116 | 92 s |
| holdout (2 tareas × 3) | 6 | 100 % | 100 % | 6/6 completa | 0 | 39 538 | 75 s |

- **El banco está saturado:** el agente sin ayuda ya encuentra a todos los dependientes, incluso en las tareas
  extremas (la constante `RESOURCE` de rename-route, los 7 archivos de currency, el `index.ts` que solo ve la
  comprobación de tipos). Con esta línea base ninguna variante del 0.27 puede mostrar mejora, así que **no sirve
  todavía para decidir si se construye**. Las apps son pequeñas (10–15 archivos) y el agente lee todo el código en
  una o dos llamadas (`for f in …; do cat -n "$f"; done`): con todo en contexto, no hace falta mapa.
- **Hallazgo aparte: escrituras por la shell.** En 7 de las 24 ejecuciones el agente escribió archivos con
  `cat > archivo <<'EOF'`, `sed -i` o similares; en currency #1 cambió los 7 archivos así y ninguno con `edit`/`write`.
  Esas escrituras se saltan los guardias del plugin que miran las herramientas de edición (sobrescritura de archivos
  existentes, hashline, revisor de comentarios, diagnósticos tras editar). `info:edits` ahora las cuenta aparte
  (`97e893815`).
- **Hallazgo aparte: alcance de más.** En status-filter (simple, 2 archivos en el parche de referencia) las 3 ejecuciones
  bajaron el filtro hasta el almacén y tocaron 3–4 archivos más (`schema.ts`, `store.ts`, `handlers.ts`). Pasa los
  tests, pero es el contrario del problema del 0.27: cambiar de más, no de menos.
- **Incidencia del banco durante la medición:** H42 (cuota gratis de Zen agotada leída como "sin salida").

### Decisiones pendientes del usuario (28-10-2026)
1. **Endurecer el banco antes de medir variantes** (recomendado). Propuesta: una app de 40–60 archivos para que no quepa
   entera en contexto; dependientes que no se ven con `grep` del nombre (rutas armadas por partes, claves en
   configuración o JSON, nombres de columna en SQL en texto, un script o un documento que usa el campo, una segunda
   vista); y prompts del tamaño que usa el usuario ("añade la fecha de entrega"). Primero se comprueba que la línea base
   baje de verdad (por ejemplo, por debajo del 70 % de cobertura) y solo entonces se miden las tres variantes.
2. **O replantear el 0.27** si ni con el banco endurecido el agente omite dependientes: en ese caso el problema que viste
   (21-10) vendría de otra cosa (prompts, modelo o contexto largo de sesiones reales) y habría que medir eso.
3. **Escrituras por la shell:** decidir si el plugin debe hacer algo (avisar, pasar esas escrituras por los mismos
   guardias o pedir al agente que use `edit`). Es independiente del 0.27.

### Propuesta para las decisiones pendientes (28-10-2026, aprobada por el usuario: "si adelante")
**A. Banco `impact-hard` (solo `script/fork/bench`, no toca el plugin).**
1. App nueva `shop-platform`, 45–60 archivos sin dependencias, para que no quepa entera en una lectura: migraciones SQL
   en texto, repositorios que mapean `delivery_date` ↔ `deliveryDate`, servicios, rutas armadas por partes
   (`${API}/${RESOURCE}/${id}`), SDK del cliente, dos vistas (cliente y administración), exportación CSV, plantilla de
   correo con `{{campo}}`, serializador de webhooks, tarea programada, claves en `config.json` y tabla de la API en el
   README.
2. 8–10 tareas con prompts cortos como los del usuario ("añade la fecha de entrega", "quita el descuento"), donde al
   menos un dependiente no sale buscando el nombre del símbolo (cadena SQL, clave de configuración, marcador de
   plantilla, columna CSV, ruta partida). Parche de referencia, tests visibles y ocultos, como en `impact`.
3. **Calibración antes de dar el banco por bueno:** una ejecución de línea base por tarea; se acepta si en al menos la
   mitad de las tareas la cobertura baja del 70 % o fallan los tests ocultos. Si no, se endurece más. Se informa la parte
   difícil por separado.
4. La suite `impact` actual se queda como regresión ("lo fácil no debe empeorar").
5. Con el banco calibrado: línea base ×3 y propuesta de la variante más barata del 0.27 (solo la lista de impacto
   informativa) para que la apruebes antes de construir nada del plugin.

**B. Escrituras por la shell (paso nuevo del plugin, rama propia).** Homólogos: SWE-agent (su interfaz de edición
pasa un linter tras cada cambio y rechaza los que rompen la sintaxis; mejoró la tasa de resolución), el prompt de
Claude Code (pide no usar `cat <<EOF` ni `sed` para editar) y nuestro propio `bash-file-read-guard`.
1. Hook `bash-file-write-guard` en `tool.execute.before`: si un comando de bash reescribe un archivo de código que ya
   existe (`cat >`, `>`/`>>` a una ruta, `sed -i`, `tee`), añade un aviso pidiendo `edit`/`write`. No bloquea: los
   archivos nuevos, los generados y los de `/tmp` siguen libres.
2. En `tool.execute.after`: los archivos de código que ese bash cambió pasan por lo mismo que una edición normal
   (diagnósticos de `edit-diagnostics` y revisor de comentarios), para que la escritura por shell no se salte los
   controles aunque el agente ignore el aviso.
3. Medida: escrituras por shell en `impact` + `loops` antes y después (hoy 7 de 24 ejecuciones), con el aprobado sin
   bajar. QA real en la TUI.

**C. Cambios de más.** Sin cambio en el plugin por ahora: `info:impact` ya cuenta los archivos "fuera" y el banco nuevo
lo informará por tarea. Si el banco endurecido confirma el patrón, se propone que el control de cierre del 0.27 pida
también justificar los archivos tocados fuera de la lista.

**Orden:** A (calibración incluida) y después B. A no necesita aprobaciones nuevas del plugin; B y cualquier variante
del 0.27 sí, cuando estén medidas.

## Criterios (Gherkin)
- Dado un cambio en un campo del backend que usa una vista, cuando el agente termina sin tocar la vista, entonces el
  plugin no da la tarea por cerrada y le dice qué dependiente falta.
- Dado un dependiente que no necesita cambio, cuando el agente lo justifica, entonces la tarea se cierra y la
  justificación queda registrada.
- Dado un proyecto con OpenAPI, cuando cambia un esquema, entonces los dependientes salen de la comprobación de tipos.
- Dado un enlace detectado por patrón con baja confianza, entonces se muestra como aviso, no como obligación.
- Dado un proyecto existente, cuando el plugin detecta su arquitectura, entonces pregunta antes de escribir reglas, y
  después solo bloquea violaciones nuevas.
- Dado un proyecto nuevo sin arquitectura elegida, entonces el agente pregunta; sin respuesta, propone hexagonal para un
  backend mediano o grande.

## Fuentes
CodePlan https://arxiv.org/abs/2309.12499 · RepoGraph https://arxiv.org/abs/2410.14684 · LocAgent
https://arxiv.org/abs/2503.09089 · CoEdPilot https://arxiv.org/abs/2408.01733 · SWE-bench-Live
https://arxiv.org/pdf/2505.23419 · Aider repo map https://aider.chat/2023/10/22/repomap.html · Serena
https://github.com/oraios/serena · Nx https://nx.dev/features/enforce-module-boundaries · import-linter
https://import-linter.readthedocs.io/en/stable/contract_types/independence/ · eslint-plugin-boundaries
https://github.com/javierbrea/eslint-plugin-boundaries · dependency-cruiser
https://technology.lastminute.com/how-we-enforce-architecture-boundaries-at-scale-on-our-app/
