# Paso 1.5 — Verificador activo de citas y "hecho exige evidencia"

Parte del roadmap: `docs/fork/roadmap.md`. Detalla la Pieza 3 de `plans/knowledge-base-and-worktrees.md`.
Estado: **hecho (28-09-2026)**; revisión de citas de subagentes confirmada en vivo el 28-09-2026 (`[citation check] … src/cache.ts:120: line range out of bounds`). Rutas: `S/` = `packages/omo-opencode/src/`.

## Definiciones mecánicas (lo que el código comprueba)

### Qué es una cita comprobable en un texto
| Forma | Ejemplo | Se comprueba |
|---|---|---|
| Archivo con línea | `src/cache.ts:12`, `src/cache.ts:10-20`, `src/cache.ts#L10-L20` | existe dentro del proyecto y el rango está dentro del archivo |
| Commit | `commit:9b8f63f8e`, `commit 9b8f63f8e` | existe en el repositorio |
| Chat | `ses_…/msg_…/prt_…` | la sesión/mensaje/parte existen en OpenCode |
| Evidencia en disco | `.omo/evidence/…/summary.md`, `tests/cache.test.ts` (ruta con `/` y extensión) | el archivo existe |

Para no dar falsas alarmas, las rutas sin `/` (`cache.ts:2`) y las URLs no se marcan como inválidas.

### Qué significa "marcar como hecho con evidencia"
Una casilla que pasa de `- [ ]` a `- [x]` (o se escribe ya marcada) en un plan (`plans/**/*.md`, `.omo/plans/**/*.md`)
debe llevar **al menos una cita comprobable y válida** en su propia línea o en las líneas indentadas justo debajo, por ejemplo:
```markdown
- [x] 3. Cache con Valkey — evidencia: `tests/cache.test.ts:12-30`, `commit:9b8f63f8e`
```
Es tu regla de `@running` y `04-verification` ("marcar solo cuando el criterio pasó, con evidencia"), hecha mecánica.

## Subtareas
- [x] 1. **Extractor de citas en texto libre** (`citation-scan.ts`) según la tabla anterior.
- [x] 2. **Revisión de informes de subagentes:** tras `task`, `call_omo_agent` y `background_output`, se verifican las citas del
  resultado; si alguna no existe se añade `[citation check] 2 of 9 citations could not be verified: src/a.ts:500 (file has 120 lines) …`
  para que el orquestador no las dé por buenas. Si todas son válidas no se añade nada (cero tokens extra).
- [x] 3. **Puerta de "hecho":** en `tool.execute.before` de `write`/`edit`/`multiedit`/`apply_patch` sobre un plan, se calcula el
  contenido resultante y cada casilla recién marcada debe cumplir la definición. Modo `block` (por defecto, tu decisión): la edición
  se rechaza con un mensaje que explica qué falta y el formato. Modo `warn`: se permite y se avisa. Modo `off`.
- [x] 4. **Evidencia circular:** `decision_record` rechaza evidencias que apunten a la propia sección `## Decisions log` del plan
  que se enlaza (visto en la QA de 1.4).
- [x] 5. **Informe de deriva:** `oh-my-opencode knowledge check` lista las decisiones activas cuya evidencia cambió o desapareció
  (líneas, archivos, commits) y termina con código 1 si hay alguna; `knowledge report` muestra el resumen.
- [x] 6. Config `knowledge.evidence_gate: "block" | "warn" | "off"` (por defecto `block`) y nombres de hook desactivables.
- [x] 7. Tests + QA real: subagente con cita falsa → aviso; marcar casilla sin evidencia → bloqueada; con evidencia → permitida.

## Criterios de aceptación
```gherkin
Feature: hecho exige evidencia

  Scenario: casilla sin evidencia
    Given plans/cache.md con "- [ ] 1. Cache con Valkey"
    When un agente la cambia a "- [x] 1. Cache con Valkey"
    Then la edición se rechaza explicando que falta una cita comprobable

  Scenario: casilla con evidencia válida
    When la cambia a "- [x] 1. Cache con Valkey — evidencia: `src/cache.ts:2`"
    Then la edición se permite

  Scenario: evidencia inventada
    When la cambia a "- [x] 1. Cache con Valkey — evidencia: `src/cache.ts:500`"
    Then la edición se rechaza indicando que el archivo tiene 3 líneas

Feature: citas de subagentes
  Scenario: cita inventada
    Given un subagente que responde "ver src/cache.ts:500"
    When el resultado vuelve al orquestador
    Then incluye "[citation check]" con esa cita y el motivo
```
