# Pasos 0.3–0.5 y 0.7 — Robustez: agentes que desaparecen, escritura de Prometheus, modelos gratuitos y retirados

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **0.3, 0.4, 0.5 y 0.7 hechos (01-10-2026); 0.8 en diseño (02-10-2026)**, investigado en vivo y en el código.
Rutas: `S/` = `packages/omo-opencode/src/`, `MC/` = `packages/model-core/src/`.

## 0.3 — Ningún agente desaparece por no resolver su modelo
**Problema (verificado en la QA de 2.2 y en el código).**
- En el primer arranque no hay caché de proveedores (se escribe tras el primer `session.created`,
  `S/hooks/auto-update-checker/hook.ts:108`). Sin `model` en `opencode.json` (caso del usuario), la resolución devuelve
  nada (`MC/model-resolution-pipeline.ts:239-240,297-299`).
- **Atlas se descarta sin aviso** (`S/agents/builtin-agents/atlas-agent.ts:57-62`); el resto de agentes tiene el respaldo
  `getFirstFallbackModel`, Atlas no. Su cadena no tiene ningún modelo gratuito (`MC/agent-model-requirements.ts:142-155`),
  así que también desaparece con solo ollama/groq/openrouter.
- Los que "sobreviven" reciben el **primer** proveedor de su cadena (`anthropic/…`, `openai/…`,
  `S/agents/builtin-agents/model-resolution.ts:25-36`), inservibles sin esa credencial.
- Hephaestus se descarta en silencio si el modelo no es GPT (`hephaestus-agent.ts:83-89`); `sisyphus-junior` hereda el
  modelo de Atlas y sin él cae a `anthropic/claude-sonnet-5`.
- En la instalación real del usuario (sin `model`, sin caché, proveedores opencode/groq/openrouter/ollama): **el próximo
  arranque perderá Atlas** y Sisyphus/Hephaestus arrancarán con modelos de pago.

**Arreglo.**
1. `resolveOrDegrade()` común: override del usuario → `fallback_models` del usuario → cadena → `config.model` →
   respaldo solo si su proveedor está conectado → si nada, **registrar el agente sin `model`** (OpenCode usa el modelo
   de la sesión/UI, como ya hace Prometheus). Aplicado a Atlas, generales, Sisyphus y Hephaestus.
2. Registro de agentes degradados + **un aviso visible** (toast al arrancar) y una línea en `doctor`.
3. `opencode/big-pickle` al final de la cadena de Atlas (como Sisyphus y sisyphus-junior).
4. Tests: Atlas en primer arranque sin `config.model`; caché solo con ollama/groq → Atlas registrado sin modelo y aviso;
   el respaldo no se usa si su proveedor no está conectado.

**Resultado (01-10-2026): hecho.**
- Agentes sin modelo se registran sin `model` (usan el de la sesión).
- El respaldo solo usa proveedores conectados y modelos listados.
- Hephaestus conserva la suposición GPT en el primer arranque, avisada, o se desactiva con motivo.
- Aviso al arrancar con orquestadores primero y remisión a `/omo-models`.
- `big-pickle` al final de la cadena de Atlas.
- QA real en `.omo/evidence/20261001-model-resolution-robustness/`.
- Pendiente:
  - `doctor` no lo muestra (corre en otro proceso);
  - `sisyphus-junior` hereda `anthropic/…` cuando Atlas no tiene modelo;
  - **hallazgo**: con caché, la resolución elige modelos de pago que el proveedor lista (Zen), que fallan en cuentas
    gratuitas → propuesta de opción "solo modelos gratuitos" (decisión del usuario).

## 0.4 — Prometheus no puede escribir fuera de `.omo/*.md`
**Problema (verificado en el código).** El bloqueo solo mira `write`/`edit` (`S/hooks/prometheus-md-only/constants.ts:12`)
y, si no encuentra ruta, **deja pasar** (`hook.ts:44-47`).
- `apply_patch` (la herramienta que usan los modelos GPT) escribe cualquier archivo: sus rutas van dentro de `patchText`.
- `hashline_edit` (si está activado) con `rename` escribe fuera de `.omo`.
- `lsp_rename` puede aplicar cambios al proyecto. `bash` sí está bloqueado (`plugin-handlers/tool-config-handler.ts:134-144`).
- La delegación a trabajadores que escriben solo está frenada por texto en el prompt.

**Arreglo.** Bloquear `write, edit, multiedit, apply_patch, patch, hashline_edit, lsp_rename, ast_grep_replace` (sin
distinguir mayúsculas); extraer **todas** las rutas (incluidas las cabeceras `*** Add/Update/Delete File:` / `*** Move to:`
de `apply_patch` y `rename`); **fallar cerrado** si no hay ruta; `lsp_rename: deny` en los permisos de Prometheus. Tests
de cada vía y del permiso.

**Resultado 0.4 (01-10-2026): hecho.**
- Nombres de herramienta sin distinguir mayúsculas.
- Se extraen **todas** las rutas destino (cabeceras de `apply_patch` add/update/delete/move, `rename`, entradas de
  `multiedit`).
- `lsp_rename` y `ast_grep_rewrite/replace` siempre bloqueados.
- **Falla cerrado** sin ruta.
- Permisos de Prometheus deniegan además `lsp_rename` y `ast_grep_rewrite`.
- Un test del upstream que comprobaba "sin ruta → permitir" se invirtió a propósito.
- QA en vivo no concluyente por el proveedor gratuito (403 intermitente "free tier can only be used from within
  OpenCode"; ver evidencia en `.omo/evidence/20261001-prometheus-write-guard/`); la guarda queda demostrada por tests
  deterministas con las formas reales de las llamadas.
- **Hallazgo abierto**: el 403 del plan gratuito de Zen es intermitente y afectó a varios agentes; a vigilar en el banco
  de pruebas (Fase 3) y en 0.5.

## 0.5 — Preferir modelos gratuitos sin imponerlos
**Problema (QA de 0.3).** Con la caché de proveedores, la resolución automática asigna modelos de pago que el proveedor
lista (Sisyphus `opencode/claude-opus-5-5`, Atlas `opencode/claude-sonnet-5`, explore/verifier `openai/…`); en una
cuenta gratuita fallan ("Insufficient account funds").

**Decisión del usuario (01-10-2026).** Preferir gratuitos **sin imponerlo**: lo elegido en `/omo-models` manda.
- Opción `prefer_free_models` (true en la config del usuario).
- Afecta solo a la resolución **automática**: cadena de respaldo, respaldo por proveedor conectado y modelo por defecto
  del sistema. Salta los modelos con coste y, si en la cadena no queda ninguno gratuito, usa el modelo de la sesión
  (degradado de 0.3) en vez de uno de pago.
- **Nunca** toca `agents.<x>.model`, `fallback_models` ni categorías elegidas por el usuario (lo que escribe
  `/omo-models`), aunque sean de pago.
- "Gratuito" = coste de entrada y salida 0 en la caché de modelos de OpenCode, o sufijo `-free` / modelo de un proveedor
  local (ollama). Si no hay datos de coste, no se descarta.
- `/omo-models` muestra qué modelos son gratuitos (ya lo hace) y qué agentes usan la preferencia automática.
- Tests:
  - con la preferencia activa, Sisyphus/Atlas no reciben `opencode/claude-*` de la cadena;
  - un modelo de pago elegido en `/omo-models` se respeta;
  - sin datos de coste no se descarta nada.

**Resultado 0.5 (01-10-2026): hecho.**
- Opción `prefer_free_models`, que filtra solo las elecciones automáticas:
  - la cadena de `model-core`;
  - los modelos por defecto de categorías integradas y su cadena en `delegate-core`;
  - el respaldo por proveedor conectado.
- Lo elegido por el usuario nunca se filtra.
- "De pago" = precio distinto de 0 en la caché de OpenCode, o sin precio pero de un proveedor sin ningún modelo gratuito
  (p. ej. openai). Locales (ollama) y `*-free` nunca.
- QA real: ningún agente recibe un modelo de pago automáticamente y la elección de pago del usuario se respeta.
- Activado en `~/.omo/omo.jsonc` del usuario, con copia de seguridad.
- Evidencia: `.omo/evidence/20261001-prefer-free-models/`.

## 0.7 — Modelos retirados

### Qué pasó (piloto de 3.0, 01-10-2026)
- models.dev marcó como `deprecated` cuatro modelos gratuitos configurados (`deepseek-v4-flash-free`, `mimo-v2.5-free`,
  `north-mini-code-free`, `laguna-s-2.1-free`), y OpenCode v1.18.26 los borra de su lista (`provider/provider.ts:1360`,
  `:1690`).
- El agente `explore`, con ese modelo y respaldos también retirados, falló con "Model not found".
- Ni el plugin ni el aviso de 0.3 lo detectaron.

### Causas (en el código, `S/` = `packages/omo-opencode/src/`, `DC/` = `packages/delegate-core/src/`)
1. **Registro.**
   - `MC/model-resolution-pipeline.ts:146-159`: el modelo del usuario solo se descarta si hay `fallback_models` y el
     proveedor aparece en la lista; si no, se devuelve **sin comprobar**.
   - `S/agents/builtin-agents/general-agents.ts:89-97`: si no se resuelve, se usa "tal cual", sin registrar ningún
     aviso. Lo mismo en Sisyphus, Atlas y Hephaestus.
2. **Lista de modelos.**
   - `S/shared/model-availability.ts:215-251`: si falta la caché de OpenCode, se usa `models.json` **sin filtrar los
     `deprecated`**.
   - En el registro se lee la caché de la ejecución anterior (`connected-providers-status.ts` la refresca después).
     Así, el primer arranque tras una retirada todavía cree el modelo disponible.
3. **Delegación.**
   - `DC/model-selection.ts:130` devuelve el modelo configurado aunque no exista.
   - El reintento síncrono (`S/tools/delegate-task/sync-task-fallback.ts`, `hooks/model-fallback/next-fallback.ts`)
     solo comprueba que el proveedor esté conectado, no que el modelo exista. Cuando se agotan los respaldos no cae
     al modelo de la sesión.
4. **Aviso.** El aviso de 0.3 (`agent-registration-warning.ts`) solo informa de agentes que se quedaron **sin**
   modelo, nunca de un modelo configurado que no existe.
5. **`/omo-models` ya cubre su parte.**
   - Lista los modelos que OpenCode ofrece en vivo, y OpenCode ya quitó los retirados.
   - Marca "model gone"/"broken" en la cadena de cada agente y avisa "Marked deprecated" en el detalle.
   - El punto (c) del roadmap queda **sin código nuevo**: solo se verifica en la QA.

### Decisión del usuario (01-10-2026)
Aprobado tal cual. Lo que el usuario elige manda (0.5), salvo que OpenCode ya no ofrezca ese modelo. Entonces se sustituye
por: respaldo → cadena gratuita → modelo de la sesión, siempre con aviso. Si no se conoce la lista, no se toca.

### Diseño
- **Una sola regla: "¿lo ofrece OpenCode?".**
  - Se apoya en la lista de OpenCode, que ya excluye los retirados.
  - Si solo hay `models.json`, se excluyen los `deprecated` (y los `alpha` sin el modo experimental), igual que
    OpenCode.
  - Si no se conoce ninguna lista, no se descarta nada (comportamiento actual).
- **Registro.** Si el modelo configurado no se ofrece, se recorre esta cadena:
  1. el primer `fallback_models` que sí se ofrezca;
  2. la cadena automática (respetando `prefer_free_models` de 0.5);
  3. el modelo de la sesión, como en 0.3.

  Nunca "tal cual". Se registra el aviso con el agente, el modelo retirado y el que se usa en su lugar.
- **Delegación.**
  - Misma regla en `DC/model-selection.ts`: un modelo configurado que no se ofrece se salta aunque no haya
    `fallback_models`.
  - El reintento síncrono y el de segundo plano saltan los respaldos que no se ofrecen.
  - Si no queda ninguno, se usa el modelo registrado o el de la sesión, en vez de fallar la tarea.
- **Caché anticuada en el registro.** Tras refrescar la caché en la primera sesión, se vuelven a comprobar los modelos
  configurados. Si alguno ya no se ofrece, avisa en ese momento. La delegación ya lo resuelve en ejecución.
- **Aviso.** Ejemplo: "Modelos retirados por el proveedor: explore (deepseek-v4-flash-free → big-pickle), … —
  cámbialos en /omo-models". Va junto al aviso de 0.3.
- **Fuera de alcance.** `runtime_fallback` y `model_fallback` siguen desactivados por defecto, porque son opciones del
  usuario.

### Resultado (01-10-2026)
- **Hecho:**
  - `isKnownMissingModel` en model-core, usado por el registro, la cadena automática y `delegate-core`;
  - `models.json` sin `deprecated` (ni `alpha` sin `OPENCODE_ENABLE_EXPERIMENTAL_MODELS`);
  - aviso "Retired by their provider: agente (retirado → nuevo)" y nueva comprobación cuando se refresca la caché.
- **Descartado:** filtrar los retirados también de la cadena de reintentos de la delegación.
  - Rompía dos tests del upstream con razón: no entiende sufijos de variante (`openai/gpt-5.4 high`) y descartaría
    modelos válidos.
  - Esa cadena solo actúa si el modelo inicial falla por otra causa, y el modelo inicial ya es válido con 0.7.
- **Límite conocido:** en el **primer arranque**, sin caché de proveedores del plugin, el registro no puede verificar
  nada y deja el modelo configurado, como antes.
  - Lo cubren la delegación del plugin (consulta la lista en vivo), la segunda comprobación del aviso y el
    siguiente directorio que se abra.
  - El usuario no abre OpenCode desde el 29-09, así que su caché aún no existe.
- **El aviso sale una vez por directorio abierto** (cada instancia registra sus agentes).
- **QA real** (sandbox con el `omo.jsonc` real; evidencia en `.omo/evidence/0.7/`):
  - 7 agentes con modelo retirado pasan a `big-pickle`; `explore` y `librarian` (sin respaldo válido) usan el modelo
    de la sesión;
  - el piloto de 3.0 ejecuta `explore` con `big-pickle` y pasa todos los correctores;
  - `opencode.db` y `auth.json` reales sin cambios.
- **Tests:**
  - model-core 433/433, delegate-core 17/17;
  - omo-opencode 8788 en verde; 108 fallan solo en la ejecución conjunta (contaminación de mocks entre archivos, ya
    vista en 0.6) y los 14 archivos afectados pasan uno a uno;
  - tipado limpio.

### Nota para 3.0
La parte `subtask` del banco usa el `task` **nativo** de OpenCode (`handleSubtask`), no el `task` del plugin. Ese
`task` usa el modelo con el que se **registró** el agente. Con 0.7, ese modelo ya será uno que exista.

### Criterios de aceptación
```gherkin
Feature: modelos retirados
  Scenario: registro con un modelo retirado y respaldo válido
    Given explore configurado con un modelo que OpenCode ya no ofrece y big-pickle como respaldo
    Then explore se registra con big-pickle y el aviso nombra explore, el modelo retirado y /omo-models
  Scenario: sin respaldos válidos
    Given todos los modelos configurados de explore están retirados
    Then explore usa la cadena automática o el modelo de la sesión, nunca el retirado
  Scenario: delegación
    When un orquestador delega en un agente cuyo modelo configurado no existe
    Then la tarea se ejecuta con el siguiente modelo que sí existe en vez de fallar con "Model not found"
  Scenario: lista desconocida
    Given no hay ninguna lista de modelos disponible
    Then el modelo configurado se usa como hasta ahora
  Scenario: QA real
    Given el omo.jsonc real del usuario con los modelos retirados, en un sandbox
    Then el piloto de 3.0 ejecuta explore sin "Model not found"
```

## 0.8 — Cuelgues silenciosos del modelo + procesos largos en segundo plano con aviso

### Hechos (investigado 02-10-2026)
- **OpenCode 1.18.26 no limita el streaming por defecto.**
  - `provider.<id>.options.chunkTimeout`/`timeout`/`headerTimeout` existen pero son opcionales
    (`provider/provider.ts:37-83,1795-1825`); `headerTimeout` solo tiene valor por defecto para openai.
  - `chunkTimeout` falla como `APIError` reintentable y OpenCode lo reintenta hasta 5 veces (`session/retry.ts`).
  - La 1.18.27 pone 5 min por defecto.
- **Abortar un streaming colgado puede no terminar nunca:** `Fiber.interrupt` espera finalizadores no
  interrumpibles (`iter.return()` → `reader.cancel()`). Con una recarga de instancia, eso puede bloquear todo el
  servidor (deducido del código, no reproducido). Es mejor que falle la descarga que abortar.
- **Incidencias abiertas:** #43519 (los keepalive reinician `chunkTimeout`), #47605 (sin `Content-Type` no hay
  corte), #48675, #46030 (big-pickle narrando en bucle).
- **El plugin ya tiene piezas, con umbrales de 30–60 min:**
  - tareas en segundo plano: inactividad a los 45 min, cancela sin reintentar;
  - delegación síncrona: 30 min, reintenta con el siguiente modelo;
  - `runtime_fallback`: apagado, solo vigila la primera respuesta.
- **La herramienta `monitor` existe pero está apagada:** procesos con salida que despierta a la sesión.
  Los procesos gestionados estaban planeados en `plans/process-lifecycle.md` (antes en 4.14).

### Decisiones del usuario (02-10-2026)
- **Variante A + B:**
  - A: el plugin pone `chunkTimeout` (90 s) a los proveedores que no lo tengan, sin pisar lo configurado por el
    usuario.
  - B: un vigilante que actúa tras 4 min sin ningún token **y sin herramienta ni proceso gestionado en marcha**.
    Avisa al usuario y al orquestador y reintenta con el siguiente modelo de respaldo. Aborta con tiempo límite, sin
    bloquear al plugin, y si el servidor no responde avisa en vez de insistir.
  - Umbrales configurables.
- **Procesos largos en segundo plano con aviso:** se adelantan aquí desde 4.14.
  - `process_start` con `wait_for` (termina / aparece un texto / abre un puerto) y aviso al agente con el resultado
    y las últimas líneas del log, sin gastar turnos mientras espera.
  - Tiempo máximo por proceso, generoso y configurable; si se excede, **se avisa al usuario**, no se mata a ciegas.
  - Aviso al terminar la sesión de los procesos que siguen vivos.
- **Obligatorio, no opcional (petición explícita):** el agente debe saber que para procesos largos usar
  `process_start` **es obligatorio**.
  - Se hace cumplir **por código**: `tool.execute.before` bloquea en `bash` las instalaciones, descargas, builds,
    servidores y watchers conocidos (`npm/pnpm/bun/pip/uv install`, `docker build/pull`, `curl/wget` de descargas,
    `dev`/`serve`/`watch`…). El mensaje dice qué usar en su lugar.
  - Además, una regla explícita en el prompt de todos los agentes que ejecutan comandos.
  - Lo mismo para las demás herramientas del fork que sustituyen a una práctica peligrosa: el prompt las presenta
    como obligatorias y el código bloquea la alternativa.
- El resto de 4.14 (skills por categoría de implementador) sigue en su sitio.

## Otros hallazgos (sin paso propio)
- Tests del upstream no aislados de la máquina (`codex-components.test.ts` asume que `sg` no está instalado;
  `zauc-mocks-mcp-index` asume `node` sin resolver; el cargador de agentes leía `~/.config/opencode/agents`). No afectan al
  plugin; baja prioridad.
- Corregido ya (29-09-2026): `knowledge_open` mostraba secretos sin ocultar (`S/features/knowledge/session-open.ts`).
