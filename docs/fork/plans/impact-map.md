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
