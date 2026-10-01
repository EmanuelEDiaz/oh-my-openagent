# Paso 4.5 (antes 2.7 y 2.9) — Guardián de reglas (que las reglas no se pierdan)

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **plan aprobado; ampliado el 01-10-2026** (creación interactiva, obligatoriedad por código, preguntar antes de actuar). Rutas: `S/` =
`packages/omo-opencode/src/`, `RE/` = `packages/rules-engine/src/`.

## El problema
En sesiones largas el agente deja de respetar reglas del proyecto o de una carpeta ("en `src/api` nunca…"). No es mala
suerte, está medido:
- Los modelos rinden peor con la información situada en medio del contexto que al principio o al final
  (Lost in the Middle, https://arxiv.org/abs/2307.03172).
- Con muchas instrucciones a la vez fallan incluso los mejores: 68 % de acierto con 500 instrucciones, y sesgo hacia las
  primeras (IFScale, https://arxiv.org/abs/2507.11538).
- El rendimiento cae al crecer la entrada, incluso en tareas simples (Context Rot,
  https://www.trychroma.com/research/context-rot), y un 39 % de media en conversaciones de varios turnos
  (https://arxiv.org/abs/2505.06120).
- Anthropic y OpenAI recomiendan poner lo importante al final o repetirlo al principio y al final
  (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices,
  https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide).

Conclusión: **pocas reglas a la vez, las relevantes para lo que se toca, repetidas cerca del momento de actuar, y lo que
tenga que cumplirse sí o sí, comprobado por código**. Claude Code lo dice explícitamente: sus archivos de reglas son
"context, not enforced configuration" y para garantizar algo remite a los hooks (https://code.claude.com/docs/en/memory).
"Never send an LLM to do a linter's job" (https://www.humanlayer.dev/blog/writing-a-good-claude-md).

## Cómo lo hacen otros
| Herramienta | Dónde | Ámbito | Cuándo se cargan | Límite recomendado |
|---|---|---|---|---|
| Cursor | `.cursor/rules/*.mdc` | `alwaysApply`, `globs`, `description` | siempre / al tocar un archivo / cuando el agente lo pide | < 500 líneas por regla |
| Claude Code | `CLAUDE.md` por carpeta, `.claude/rules` con `paths:` | por ruta | al leer archivos que coinciden; tras compactar solo vuelven las de la raíz | < 200 líneas por archivo |
| Copilot | `.github/instructions/*.instructions.md` con `applyTo` | por ruta | al coincidir la ruta | "no más de 2 páginas" |
| Windsurf | `.windsurf/rules` con `trigger: glob` | por ruta | al leer **o editar** | 12 000 caracteres |
| Cline | `.clinerules` con `paths:` | por ruta, mensaje, pestañas | al coincidir | reglas cortas |
| OpenCode | `AGENTS.md`, `instructions` | todo el proyecto | al empezar | — (sin reglas por ruta nativas) |

Fuentes: https://cursor.com/docs/context/rules · https://code.claude.com/docs/en/memory ·
https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions ·
https://docs.devin.ai/desktop/cascade/memories · https://docs.cline.bot/features/cline-rules ·
https://raw.githubusercontent.com/sst/opencode/dev/packages/web/src/content/docs/rules.mdx

## Qué hace hoy el plugin (verificado)
- Busca reglas en `.omo/rules`, `.claude/rules`, `.cursor/rules`, `.github/instructions` y `.github/copilot-instructions.md`
  (y las globales en `~/.omo/rules`…) subiendo desde el archivo tocado (`RE/constants.ts:5-15`, `RE/finder.ts:71-148`).
  Entiende `globs`/`paths`/`applyTo`/`alwaysApply` (`RE/types.ts:1-7`).
- `rules-injector` añade el texto de la regla **a la salida** de `read`/`write`/`edit`/`multiedit`, una vez por sesión
  (`S/hooks/rules-injector/hook.ts:36,68-80`, `injection-processor.ts:131-152`).

Huecos:
1. **Nada antes de editar**: `tool.execute.before` no hace nada (`hook.ts:82-88`); el primer cambio a un archivo se
   escribe sin conocer su regla.
2. **Tras compactar, probablemente no vuelven**: se borra la caché, pero al rehidratar desde el historial encuentra las
   marcas `[Rule: …]` antiguas y las da por mostradas (`transcript-hydration.ts:117-141`, `injection-processor.ts:137-142`).
   La tarjeta de compactación (1.6) además descarta el texto `[Rule:` (`S/features/knowledge/compaction-snapshot.ts:27-29`).
3. **Quedan lejos**: se muestran una vez y luego quedan enterradas en salidas viejas, que la poda de contexto puede borrar
   (`S/hooks/anthropic-context-window-limit-recovery/pruning-tool-output-truncation.ts:53`).
4. **Una regla sin frontmatter se ignora** (`RE/matcher.ts:21`): una regla de carpeta escrita "a mano" no hace nada.
5. **Los subagentes no reciben nada de entrada** sobre los archivos que van a tocar.
6. **Nada se comprueba**: ninguna regla bloquea ni avisa por código.
7. **Tamaño sin control por regla**: hasta 50k tokens por regla (`S/shared/dynamic-truncator.ts:49-61`).

## Propuesta: tres capas
No es un agente que "recuerda" las reglas —un agente también las pierde en su contexto— sino **código que las pone en el
momento justo, comprobaciones que no dependen del modelo, y un especialista que revisa lo que no se puede automatizar**.

### Capa 1 — Llevar la regla al momento de actuar (código)
- **Formato** (compatible con lo actual; campos nuevos opcionales):
  ```yaml
  ---
  id: api-auth            # corto y estable; se cita en recordatorios, bloqueos e informes
  description: "Toda ruta de src/api valida el token con requireAuth()"
  paths: ["src/api/**"]   # o globs / applyTo; sin paths = todo el proyecto
  exclude: ["**/*.gen.ts"]
  severity: block         # block | warn | info (por defecto info)
  forbid:                 # opcional: patrones prohibidos en el contenido nuevo
    - pattern: "from ['\"]lodash"
      message: "Usa las utilidades nativas"
  ---
  Texto corto de la regla (objetivo: < 40 líneas).
  ```
  En `.omo/rules/`, un archivo **sin frontmatter** se aplica a su carpeta (hoy se ignora).
- **Antes de editar** (`tool.execute.before` en `write`/`edit`/`multiedit`/`apply_patch`/`hashline_edit`): si hay reglas
  de esa ruta que el agente no ha visto desde la última compactación, se **bloquea una vez** con el texto de esas reglas y
  "aplícalas y reintenta". Coste: un reintento por regla y sesión; garantiza que ninguna edición se hace sin conocerlas.
- **Recordatorio breve junto a cada edición**: una línea con los ids y títulos activos para ese archivo
  (`Rules: api-auth — valida token; api-errors — …`), al final de la salida: lo último que lee el modelo.
- **Tras compactar**: arreglar la rehidratación para que ignore marcas anteriores a la compactación, y añadir a la
  tarjeta de 1.6 los ids + títulos de las reglas activas (las completas se vuelven a mostrar al tocar el archivo).
- **Subagentes**: al delegar (`task`), añadir al prompt del hijo los ids + títulos de las reglas de las rutas que menciona
  la tarea.

### Capa 2 — Comprobar lo comprobable (código)
- `forbid` se evalúa sobre el contenido **nuevo** antes de escribir: `severity: block` bloquea citando id, patrón y línea;
  `warn` deja escribir y añade el aviso a la salida.
- Solo expresiones regulares (sin ejecutar comandos), con límite de tiempo, para que una regla nunca sea un riesgo.
- Contador de incumplimientos por id: una regla que se incumple a menudo y es mecánica se propone pasar a un linter
  (ESLint/Semgrep/CI), dejando en la regla solo el puntero.

### Capa 3 — Revisar lo que no se puede automatizar (especialista)
- Nuevo especialista **`rules-checker`** (se suma al catálogo de 2.2): recibe el diff y las reglas que aplican a esos
  archivos (las resuelve el código, no el modelo) y devuelve cada incumplimiento con `id`, `archivo:línea` y cómo
  arreglarlo. **Obligatorio** antes de commitear y al cerrar un plan. Solo lectura, modelo medio.

### Mantenimiento de las reglas
- CLI `oh-my-openagent rules check`: lista las reglas que aplican a una ruta, avisa de reglas sin `id`, demasiado largas
  (> 40 líneas por regla, > 200 líneas siempre activas en total), sin frontmatter fuera de `.omo/rules`, o duplicadas.
- CLI `oh-my-openagent rules for <ruta>`: qué reglas verá el agente al tocar esa ruta (para depurar).

## Ampliación (01-10-2026, decisiones del usuario)

### Crear reglas cuando el proyecto no tiene (`rules init`), interactivo con respaldo
Cómo lo hacen otros:
- Claude Code `/init` lee el repo y propone, y su modo nuevo pregunta antes de escribir
  (https://code.claude.com/docs/en/memory).
- Cursor tiene `/create-rule` (https://cursor.com/docs/context/rules).
- VS Code analiza el repo y genera instrucciones para revisar
  (https://code.visualstudio.com/docs/agent-customization/custom-instructions).

Evidencia: los archivos de contexto largos o genéricos **no mejoran** las tareas y encarecen un 20 %; solo ayudan con
prácticas no estándar (https://arxiv.org/abs/2602.11988). Por eso, pocas reglas y con evidencia.

Flujo:
1. Leer fuentes deterministas: configuraciones de linter y formateador, `tsconfig` (flags estrictos), CI, scripts del
   manifiesto, `CONTRIBUTING`, decisiones/ADR, reglas de otras herramientas (`.cursor/rules`, `AGENTS.md`,
   `copilot-instructions`), convención de commits.
2. Muestrear el código buscando invariantes con evidencia ("0 SQL directo fuera de `repo/` en 48 archivos").
3. Descartar lo que ya hace un linter; si tiene forma de regla de linter, proponer cambiar el linter.
4. Ordenar por impacto × confianza y quedarse con **≤ 7**.
5. **Una sola pregunta** agrupada (herramienta `question`): aceptar las obligatorias, elegir una a una, dejarlas todas
   como recomendables u omitir.
6. Escribir el archivo y recordar que se pueden añadir más (`rules add`).

Sin interfaz (ejecución automática), las reglas quedan como `status: proposed` hasta confirmarlas. Una regla rechazada
no se vuelve a proponer salvo que su evidencia cambie.

**Cuándo una regla puede ser obligatoria** (pauta para el agente). Solo si se cumplen las cuatro condiciones:
1. incumplirla rompe la corrección, la seguridad, los datos o una frontera de arquitectura;
2. es comprobable, con `forbid` o con un revisor capaz de señalar la línea;
3. tiene evidencia fuerte (documento, ADR o CI explícito, o ~100 % de coherencia en el código);
4. ningún linter la cubre.

Si no, es `should` o no es una regla. Nunca son reglas obligatorias las preferencias de estilo, lo que el modelo ya
hace por defecto ni los datos puntuales.

### Formato ampliado
```yaml
id: api-no-raw-sql
severity: must | should | info
paths: ["src/api/**"]
rule: "Never build SQL strings in handlers; use repo/* query builders."
why: "SQL injection; ADR-004"
source: { kind: adr | lint-config | ci | code-pattern | user, ref: "docs/adr/004.md" }
evidence: "0 violations / 48 files"
confidence: high | med | low
forbid: { pattern: "\\b(SELECT|INSERT)\\b.*\\+", glob: "src/api/**" }   # opcional
status: active | proposed | rejected
exceptions: [{ date, reason, scope: once }]
```

### Obligatoriedad por código (no por llamadas extra a un agente)
| Agente | Recibe reglas | Cómo |
|---|---|---|
| Implementadores, `test-writer`, `docs-writer` (todo el que edita) | sí, obligatorio | inyección por ruta al editar; `forbid` bloquea |
| Prometheus | sí | ids de las reglas de las rutas del plan; los conflictos se plantean en el plan |
| `rules-checker` | sí, completas | revisa el diff **antes del `verifier` y antes de cada commit** |
| Revisores de seguridad/tests/lenguaje/arquitectura | solo las de su categoría | en su contexto |
| `verifier` | ligero | confirma que pasan los `forbid` |
| `git-committer` | sí | barrido de `forbid` + convención de commits |
| Solo lectura (`explore`, `librarian`, `oracle`…) | no | gastaría tokens; como mucho un puntero |

Todo informe de quien escribe o revisa lista los ids de las reglas aplicadas.

### Si una regla impide algo pedido o viable: preguntar antes de actuar
Los agentes preguntan muy poco: Claude Code pide aclaración solo en el 1–3 % de los casos
(https://arxiv.org/html/2604.20779v1). Pero interrumpir también cuesta, así que solo se pregunta ante **conflictos
reales**. Nunca se salta en silencio lo pedido ni se incumple la regla en silencio. Formato:

> "La regla `api-no-raw-sql` (obligatoria, `src/api/**`, de ADR-004) prohíbe X. Lo que pides necesita X porque Y.
> Opciones: (1) seguir la regla con la alternativa Z [por defecto], (2) excepción solo esta vez (queda anotada),
> (3) cambiar o relajar la regla, (4) cancelar."

Los conflictos detectados al **planear** se agrupan en la aprobación del plan para no interrumpir a mitad de trabajo.

## Subtareas
- [ ] 1. Tests RED de cada comportamiento (antes de editar, tras compactar, `forbid`, subagentes, reglas sin frontmatter).
- [ ] 2. Formato: `id`, `severity`, `exclude`, `forbid`; reglas de carpeta sin frontmatter en `.omo/rules`.
- [ ] 3. Bloqueo-una-vez antes de editar + recordatorio breve tras editar.
- [ ] 4. Arreglo de rehidratación tras compactar + reglas activas en la tarjeta de 1.6.
- [ ] 5. `forbid` con `block`/`warn` y contador de incumplimientos.
- [ ] 6. Reglas en el prompt de los subagentes.
- [ ] 7. Especialista `rules-checker`.
- [ ] 8. CLI `rules check` / `rules for`.
- [ ] 9. Medición: escenario en el banco de compactación (sesión larga con una regla de carpeta) — antes/después.
- [ ] 10. `rules init` interactivo (con respaldo sin interfaz), formato ampliado, matriz de obligatoriedad y pregunta ante conflicto.
- [ ] 11. Absorción de la biblioteca `ai-guidelines` (antes 2.9) con criterio "solo lo mejor" y reglas por stack.
- [ ] 12. Docs, evidencia, merge y push.

## Criterios de aceptación
```gherkin
Feature: guardián de reglas

  Scenario: ninguna edición sin conocer la regla
    Given una regla "api-auth" con paths "src/api/**" que el agente no ha visto
    When el agente edita src/api/users.ts
    Then la edición se bloquea una vez mostrando la regla "api-auth"
    And al reintentar se permite y la salida termina con "Rules: api-auth"

  Scenario: la regla vuelve tras compactar
    Given la regla "api-auth" ya mostrada y la sesión compactada
    When el agente vuelve a editar src/api/users.ts
    Then la regla se muestra de nuevo

  Scenario: regla comprobable
    Given una regla con severity block y forbid "from ['\"]lodash"
    When el agente escribe un import de lodash en un archivo afectado
    Then la escritura se rechaza citando la regla y la línea

  Scenario: el subagente recibe las reglas
    When el orquestador delega una tarea sobre src/api
    Then el prompt del subagente incluye "api-auth"
```
