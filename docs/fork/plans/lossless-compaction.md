# Paso 1.6 — Compactación sin pérdida

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **en curso (28-09-2026)**. Rutas: `S/` = `packages/omo-opencode/src/`.

## Cómo compacta hoy (verificado en el código)
- El resumen lo escribe el modelo con la plantilla de 8 secciones `S/hooks/compaction-context-injector/compaction-context-prompt.ts`,
  que pide citar al usuario "solo cuando haga falta" y no guarda punteros a los mensajes originales.
- Enganches disponibles:
  - **antes de compactar** — `experimental.session.compacting` (`S/plugin/session-compacting.ts`): los pasos `capture` guardan
    estado y `output.context.push(texto)` añade texto al prompt con el que el modelo escribe el resumen;
  - **después** — pasos `restore` y el `contextCollector` (`S/features/context-injector/`), que inyecta texto de forma
    determinista en el siguiente mensaje enviado al modelo.
- OpenCode conserva toda la conversación original en `opencode.db` (los ids sobreviven a la compactación), y el índice de 1.3
  ya permite citarla y abrirla (`knowledge_open`).

## Subtareas
- [ ] 1. **Banco de medición** (`script/fork/compaction-probe.ts`): en un OpenCode aislado crea una sesión, siembra hechos
  concretos (peticiones y restricciones literales del usuario, una decisión con su motivo, un `archivo:línea`, un error visto,
  una pregunta abierta, trabajo pendiente), hace algo de trabajo, **fuerza la compactación** (`session.summarize`) y luego
  pregunta por cada hecho. Puntúa cuántos sobreviven (literal / parafraseado / perdido) y guarda un JSON.
- [ ] 2. **Línea base**: medir con el plugin actual (varias repeticiones por la variabilidad del modelo).
- [ ] 3. **Instantánea antes de compactar** (por código, no por el modelo): de `opencode.db` en solo lectura se extraen las
  peticiones y restricciones del usuario **literales** con su locator `ses_…/msg_…/prt_…`, los archivos tocados, los errores de
  herramientas, las decisiones registradas en la sesión y los todos abiertos.
- [ ] 4. **Guía al resumen**: esa instantánea se añade al prompt de compactación (`output.context`) pidiendo conservar las
  peticiones y restricciones textualmente con su locator.
- [ ] 5. **Tarjeta de estado tras compactar** (determinista, vía `contextCollector`): peticiones/restricciones literales con
  locator, decisiones, archivos y pendientes, más "usa `knowledge_open` para el detalle". Compacta (presupuesto de tamaño) y sin
  duplicar lo que el resumen ya contiene literal.
- [ ] 6. **Medir de nuevo** con el mismo banco y comparar con la línea base. El paso solo se da por bueno si mejora.
- [ ] 7. Config `knowledge.lossless_compaction` (activado por defecto) y hook desactivable.

## Implementación
- `S/features/knowledge/compaction-snapshot.ts` — instantánea por código (mensajes del usuario literales con locator, filtrando
  texto inyectado/sintético; archivos escritos; errores de herramientas; decisiones con `session:` de la sesión), guía para el
  prompt y tarjeta `<compaction-state>` (presupuesto 4000 caracteres; omite lo que el resumen ya cita).
- `S/hooks/lossless-compaction/` — `capture` e `inject` en `experimental.session.compacting`; en `session.compacted` registra la
  tarjeta en el `contextCollector` (id `lossless-compaction`).
- `SessionReader.latestSummaryText` lee el último mensaje `summary` de la sesión.
- Config: hook `lossless-compaction` desactivable y `knowledge.lossless_compaction` (true por defecto).

## Notas del banco
- El tier gratuito de OpenCode Zen rechaza con 403 ("can only be used from within OpenCode") una petición **sin ninguna
  herramienta**; el sondeo solo desactiva las herramientas que podrían recuperar el chat (`task`, `knowledge_*`, `session_*`,
  `decision_search`, `call_omo_agent`, `background_output`) y registra las que el modelo use igualmente. La primera línea base
  (0/7 por ese 403) se descartó.
- La línea base se mide con el mismo build y el modo desactivado en `.omo/omo.jsonc` del proyecto sandbox. **Los ajustes del
  plugin van dentro de `"[opencode]"`**: `{ "[opencode]": { "knowledge": { "lossless_compaction": false } } }`. Un `knowledge` en la
  raíz lo descarta `omo-config-core` (`Unrecognized key`) y el plugin sigue con los valores por defecto; así se invalidaron dos
  mediciones "off" que en realidad corrieron con el modo activo.
- El escenario `easy` (7 hechos en un mensaje) llega al techo sin el hook (7/7); se añadió `hard` (10 hechos repartidos en 12
  turnos con trabajo ruidoso, una corrección y valores exactos).

## Resultados (28-09-2026, opencode/big-pickle, 3 corridas por variante; evidencia en `.omo/evidence/1.6-lossless-compaction/`)
| Variante | Recuerdo | Hechos en el resumen | Locators en el resumen | Tamaño del resumen |
|---|---|---|---|---|
| desactivado | 10/10 ×3 | 10/10 ×3 | 0 | 2.3–3.6 k caracteres |
| activado | 10/10 ×3 | 10/10 ×3 | 12 (todos los mensajes del usuario) | 5.0–5.7 k caracteres |

- Recuerdo: **empate en el techo**; con este modelo y esta longitud de sesión la plantilla actual no pierde hechos.
- Trazabilidad: con el modo activo cada mensaje del usuario queda citado literal con `ses_…/msg_…/prt_…` (abrible con
  `knowledge_open`); sin él, ninguno.
- Coste: el resumen crece ~2× (unos 650 tokens más por compactación). La tarjeta se inyectó en vivo (417 caracteres) solo cuando
  el resumen omitía algo.

## Criterios de aceptación
```gherkin
Feature: compactación sin pérdida

  Scenario: restricciones literales
    Given una sesión donde el usuario escribió "nunca uses lodash"
    When la sesión se compacta
    Then el contexto tras compactar contiene "nunca uses lodash" literal con su locator ses_…/msg_…

  Scenario: detalle recuperable
    Given un hecho resumido de forma incompleta
    When el agente necesita el detalle
    Then la tarjeta indica el locator y knowledge_open devuelve el mensaje original

  Scenario: mejora medida
    Given el banco de medición
    When se compara con la línea base
    Then la proporción de hechos conservados es mayor, sin superar el presupuesto de tamaño de la tarjeta
```
