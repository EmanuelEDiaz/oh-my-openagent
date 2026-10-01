# Pasos 0.3 y 0.4 — Robustez: agentes que desaparecen y escritura de Prometheus

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **0.3 hecho (01-10-2026); 0.4 plan**, investigado en vivo y en el código.
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

## Otros hallazgos (sin paso propio)
- Tests del upstream no aislados de la máquina (`codex-components.test.ts` asume que `sg` no está instalado;
  `zauc-mocks-mcp-index` asume `node` sin resolver; el cargador de agentes leía `~/.config/opencode/agents`). No afectan al
  plugin; baja prioridad.
- Corregido ya (29-09-2026): `knowledge_open` mostraba secretos sin ocultar (`S/features/knowledge/session-open.ts`).
