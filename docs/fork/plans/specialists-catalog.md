# Paso 2.2 — Catálogo de especialistas atómicos

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **aprobado, en curso (29-09-2026)**. Parte de
`plans/task-routing.md` (2.1). Rutas: `S/` = `packages/omo-opencode/src/`.

## Nombres (decisión del usuario, 29-09-2026)
En inglés, como el código del fork. Los agentes que ya existen conservan su id (`explore`, `librarian`, `metis`, `momus`,
`oracle`, `multimodal-looker`) para no romper la compatibilidad con upstream; los implementadores son las categorías
existentes (`quick`, `deep-low`, `deep-high`, `visual-engineering`, `writing`). Nuevos: `api-lookup`, `memory`,
`dependency-check`, `test-writer`, `debugger`, `verifier`, `ui-tester`, `security-reviewer`, `test-reviewer`,
`lang-reviewer`, `architect-reviewer`, `docs-writer`, `git-committer`.

## Decisiones (registro)
| Fecha | Decisión | Motivo |
|---|---|---|
| 29-09-2026 | Catálogo aprobado tal cual; nombres en inglés, ids existentes intactos | coherencia con el código del fork y compatibilidad con upstream |
| 29-09-2026 | Lectura de código: **mejorar `explore`** (no un agente aparte) con herramientas propias (`code_outline`, `read_symbol`, `repo_map`, `callers`) y **Graphify opcional** (se usa si está instalado; nunca dependencia) | un solo especialista de lectura; funciona sin nada externo → paso 2.8 |
| 29-09-2026 | Añadir guardián de reglas y especialista `rules-checker` | las reglas se pierden en contextos largos → paso 2.7 |
| 29-09-2026 | Aplicar la investigación por especialista (`plans/specialists-research.md`) a prompts y permisos | procedimientos y guardas con evidencia; solo herramientas gratuitas, sin instalar nada |
| 29-09-2026 | Análisis regla por regla hecho: **no** copiar `@planning`/`@running` en los prompts; la mayoría ya está en el plugin (skill `ulw-plan`, evidence-gate, especialistas) y otras chocan (`/plans`, `_index.md`, `maxSteps`, informes en `/plans/*-review`). Prometheus delega todo en la skill `ulw-plan` (`packages/prompts-core/prompts/prometheus/default.md:5`): las mejoras van a `ulw-plan`/`ulw-execute` y al código compartido de Atlas | menos instrucciones y sin contradicciones (IFScale) |
| 29-09-2026 | **Alcance híbrido**: trabajo descubierto dentro del área del plan → casilla y se arregla; fuera → se anota y se presenta al usuario al final (cambia `ulw-execute/SKILL.md:55`) | combina "estado ideal" del plugin con "no ampliar el alcance" del usuario |
| 29-09-2026 | Mejoras a Atlas/ulw: citar evidencia al marcar casillas (si no, el evidence-gate la rechaza); política de fallos acotada y sin la contradicción "Retry 3x → siguiente" vs "nunca pases a la siguiente" en sus 8 variantes; un REJECT que cambie alcance/arquitectura/contrato se pregunta al usuario; tarea de CHANGELOG/docs en la plantilla del plan; `security-reviewer` opcional en planes que toquen auth/secretos | huecos y contradicciones verificados en el análisis |
| 29-09-2026 | Hook por código: los ejecutores no instalan dependencias ni ejecutan comandos destructivos sin aprobación registrada en el plan (→ 2.4) | "un plan no es consentimiento" (regla del usuario) hecha cumplir |
| 29-09-2026 | **Archivar ya** `~/.config/opencode/agents/{planning,running,*-reviewer}.md` (no borrar) y actualizar el `AGENTS.md` global para que apunte a Prometheus, Atlas y los especialistas | el usuario no quiere mantenerlos: lo útil ya está absorbido o planificado, el resto se descarta |
| 29-09-2026 | La biblioteca `ai-guidelines`: la idea es **absorber en el plugin** lo valioso, no depender de que el usuario la cargue — pendiente de concretar cómo (ver 2.9) | decisión del usuario |

## Principios
- **Un especialista = una tarea atómica.** Hace una sola cosa, con las herramientas mínimas para hacerla y una salida fija.
  Si una tarea necesita dos especialidades, el orquestador la parte en dos llamadas.
- **Eficiencia**: cada especialista tiene un nivel de modelo (`rápido` / `medio` / `fuerte`) que se elige en `/omo-models`;
  lo mecánico (buscar, verificar, commitear) usa modelos rápidos/gratuitos; lo que razona (implementar lo complejo,
  aconsejar) usa fuertes.
- **Obligatorio vs opcional**:
  - *Obligatorio*: cuando se da el **disparador**, el código exige ese especialista (2.4 bloquea la acción si no se ha
    usado; 2.6 comprueba su salida).
  - *Opcional*: el orquestador lo elige según la matriz; nada lo fuerza.
- **Solo lectura por defecto.** Solo los implementadores, el escritor de tests, el de docs y el de commits escriben, y cada
  uno solo lo suyo.
- **Contrato de salida**: todo especialista devuelve `Resumen` + su bloque fijo + `Fuentes` (locators `archivo:línea`,
  URL, `ses_…`, `D-…`). Sin fuentes, la respuesta se devuelve al especialista (2.6).

## Catálogo

Origen: **P** = agente del plugin reutilizado · **U** = agente tuyo absorbido · **N** = nuevo.

### Información
| Especialista | Tarea atómica | Cuándo | Herramientas obligatorias | Escribe | Modelo | Salida | Origen |
|---|---|---|---|---|---|---|---|
| `explore` | Localizar dónde está algo en el repo y cómo se conecta | **Obligatorio** antes de editar código que la sesión no ha leído | `knowledge_search`, grep/glob, LSP | no | rápido | respuesta + `archivo:línea` por afirmación | P (explore) |
| `api-lookup` | Responder una pregunta concreta de una librería (firma, opción, versión) | **Obligatorio** al usar una API externa que la sesión no ha consultado | context7; si no está, `webfetch` de la doc oficial | no | rápido | respuesta + URL/versión | N |
| `librarian` | Investigación amplia: buenas prácticas, comparar opciones, errores conocidos | Opcional; **obligatorio** en planes grandes con decisiones externas | `websearch` → `webfetch` (fuentes oficiales primero), context7, grep_app | no | medio | hallazgos con "fuente — por qué importa" y URL | P (librarian) + U (investigación acotada de @planning) |
| `memory` | Recuperar decisiones y conversaciones previas (el porqué) | **Obligatorio** si el usuario pregunta por algo ya decidido o hablado | `decision_search`, `knowledge_search`, `knowledge_open` | no | rápido | respuesta + locators `D-…` / `ses_…/msg_…` | N (sobre 1.3–1.4) |
| `multimodal-looker` | Extraer información de imágenes y PDFs | **Obligatorio** con imágenes/PDF adjuntos | `read` | no | medio (multimodal) | lo extraído, sin interpretar | P (multimodal-looker) |
| `dependency-check` | Comprobar que un paquete existe, versión, licencia, mantenimiento y avisos de seguridad | **Obligatorio** antes de añadir o subir una dependencia | registro del paquete (`webfetch`), `websearch` | no | rápido | veredicto + datos con URL | N (regla de seguridad base/05) |

### Planificación
| Especialista | Tarea atómica | Cuándo | Herramientas obligatorias | Escribe | Modelo | Salida | Origen |
|---|---|---|---|---|---|---|---|
| `metis` | Detectar ambigüedades y preguntas antes de planear | Opcional; **obligatorio** en planes grandes | lectura | no | fuerte | intención, supuestos, preguntas | P (Metis) |
| `momus` | Aprobar o rechazar un plan (criterios falsables, huecos) | **Obligatorio** antes de ejecutar un plan | lectura del plan y del código | no | fuerte | `[OKAY]`/`[REJECT]` + ≤3 bloqueos | P (Momus) + U (criterios de @test-reviewer en modo plan) |

### Implementación
| Especialista | Tarea atómica | Cuándo | Herramientas obligatorias | Escribe | Modelo | Salida | Origen |
|---|---|---|---|---|---|---|---|
| `test-writer` | Escribir el test que falla **antes** del arreglo o la función | **Obligatorio** en arreglos de bugs y en lógica nueva con criterio Gherkin | edición de tests + ejecutar ese test | solo tests | medio | test + salida en rojo | U (@running: test en rojo) |
| categoría `quick` | Cambio pequeño y claro | Opcional (categoría `quick`) | edición + el test del cambio | código | rápido | archivos tocados + comandos con su salida | P (categoría) |
| categoría `deep-low` | Cambio normal | Opcional (categoría `deep-low`) | edición + tests; skills de la categoría (2.5) | código | medio | ídem | P (categoría) |
| categoría `deep-high` | Cambio difícil, lógica delicada | Opcional (categorías `deep-high` / `ultrabrain`) | ídem | código | fuerte | ídem | P (categorías) |
| categoría `visual-engineering` | Interfaz y estilos | **Obligatorio** en cambios de UI | ídem + skill `ui-ux-pro-max` | código | medio | ídem + captura | P (categoría `visual-engineering`) |
| `debugger` | Reproducir un fallo y encontrar la causa raíz (sin arreglarlo) | **Obligatorio** ante un test o comando que falla sin causa clara | lectura, `bash` para reproducir | no | fuerte | causa raíz con `archivo:línea` + cómo reproducir | N |
| `oracle` | Opinar sobre arquitectura o un bloqueo tras varios intentos | Opcional; **obligatorio** tras 2 intentos fallidos sobre lo mismo | lectura | no | fuerte | conclusión, plan, riesgos | P (oracle) |

### Verificación y revisión
| Especialista | Tarea atómica | Cuándo | Herramientas obligatorias | Escribe | Modelo | Salida | Origen |
|---|---|---|---|---|---|---|---|
| `verifier` | Ejecutar tests, lint y typecheck y devolver la salida real | **Obligatorio** antes de dar algo por hecho o marcar una casilla | `bash` (solo comandos de verificación) | no | rápido | cada comando con su código de salida y extracto | U (@running: evidencia) |
| `ui-tester` | Comprobar la UI en un navegador real | **Obligatorio** tras cambios de UI | navegador (Playwright) | no | medio | pasos + capturas + errores de consola | N (sobre `browser_automation`) |
| `security-reviewer` | Revisar el diff: secretos, permisos, entradas, dependencias, contenido web como dato | **Obligatorio** si el diff toca auth, secretos, entradas externas o dependencias, y al cerrar un plan | `git diff`, skill de seguridad | solo su informe | fuerte | Issue / Ubicación / Severidad / Recomendación | U (@security-reviewer) |
| `test-reviewer` | ¿Los tests fallarían si el código se rompe? ¿cubren el riesgo? | **Obligatorio** al cerrar un plan | `git diff`, `bash` de solo tests, skill de testing | solo su informe | medio | ídem | U (@test-reviewer) |
| `lang-reviewer` | Idiomático para el lenguaje/framework y coherente con el repo | Opcional; **obligatorio** al cerrar un plan | `git diff`, skill del lenguaje | solo su informe | medio | ídem | U (@lang-reviewer) |
| `architect-reviewer` | Separación de responsabilidades, alcance, abstracciones de más | Opcional; **obligatorio** al cerrar planes con decisiones `hard` | `git diff`, lectura | solo su informe | fuerte | ídem | U (@architect-reviewer) |

### Cierre
| Especialista | Tarea atómica | Cuándo | Herramientas obligatorias | Escribe | Modelo | Salida | Origen |
|---|---|---|---|---|---|---|---|
| `docs-writer` | README, CHANGELOG, ADR, comentarios de uso | Opcional; **obligatorio** al cerrar un plan con cambios visibles para el usuario | lectura de lo que documenta | solo docs | medio | texto + fuentes | P (categoría `writing`) |
| `git-committer` | Commits atómicos por tema con mensajes convencionales; nunca `push` ni reescritura sin permiso | **Obligatorio** para commitear | git (sin `push`), skill `git-master` | solo git | rápido | commits creados + resumen | P (skill `git-master`) |

### Orquestadores (primarios, Tab)
| Orquestador | Para qué | No puede (2.4) |
|---|---|---|
| Sisyphus | Trabajo general: reparte a los especialistas | editar código, buscar en la web, ejecutar tests él mismo |
| Prometheus | Planear en `.omo/plans/` con Gherkin, Decisions log y fuentes | escribir fuera de `.omo/*.md` (cerrando `apply_patch`/`multiedit`/`hashline_edit`) |
| Atlas | Ejecutar un plan casilla a casilla con evidencia | ídem Sisyphus |

Hephaestus (orquestador pensado para modelos GPT) se mantiene oculto salvo que lo actives; no aporta un papel distinto.

## Qué se hace en 2.2 (y qué queda para después)
- **2.2 (este paso)**: definir los especialistas (prompt, permisos, herramientas, nivel de modelo, contrato de salida),
  empaquetar los revisores, pasar las reglas de @planning a Prometheus y las de @running a Atlas, y que los orquestadores
  vean en su tabla de delegación **todos** los especialistas con su marca obligatorio/opcional y su disparador, incluidos tus
  agentes personalizados (arreglo de `_customAgentSummaries`).
- **2.3** afina `librarian` y `api-lookup`.
- **2.4** hace que los disparadores **obligatorios bloqueen** por código.
- **2.5** skills obligatorias por categoría.
- **2.6** verifica cada contrato de salida y devuelve al especialista lo incompleto.

## Subtareas de 2.2
- [ ] 1. Tests RED: el orquestador anuncia cada especialista con su marca y disparador; los agentes personalizados
  aparecen; permisos de cada especialista (p. ej. `verifier` no edita, `git-committer` no hace `push`).
- [ ] 2. Registro de especialistas: los nuevos como agentes builtin con su prompt, permisos y nivel de modelo; los
  existentes reutilizados sin romper sus ids internos (compatibilidad con upstream).
- [ ] 3. Tabla de delegación con obligatorio/opcional y disparadores, generada desde el registro (una sola fuente).
- [ ] 4. Mejoras a `ulw-plan`/`ulw-execute`/Atlas del registro de decisiones (alcance híbrido, evidencia al marcar, fallos acotados, REJECT → usuario, CHANGELOG).
- [ ] 4b. Archivar los agentes del usuario y actualizar su `AGENTS.md` global.
- [ ] 5. Agentes personalizados visibles para el orquestador.
- [ ] 6. QA real: en un OpenCode aislado, cada orquestador delega una tarea de cada tipo al especialista correcto.
- [ ] 7. Docs, evidencia, merge y push.

## Criterios de aceptación
```gherkin
Feature: catálogo de especialistas

  Scenario: el orquestador conoce el catálogo
    When se construye el prompt de Sisyphus, Prometheus o Atlas
    Then contiene cada especialista con su tarea, "obligatorio"/"opcional" y su disparador

  Scenario: permisos mínimos
    Then "verifier", "explore", "api-lookup", "librarian", "memory" y los revisores no pueden editar código
    And "git-committer" no puede hacer push

  Scenario: agentes personalizados visibles
    Given un agente personalizado con descripción
    Then aparece en la tabla de delegación del orquestador

  Scenario: delegación real
    Given un OpenCode aislado
    When se pide "dónde se valida el token" a Sisyphus
    Then delega en explore y la respuesta trae archivo:línea
```
