# Incidentes del uso real (07-10-2026)

Estado: **arreglos aprobados (07-10-2026), en curso** en `fix/user-session-incidents`. `S/` = `packages/omo-opencode/src/`.
Sesión real: `ses_ee7fddc21ffee0KX6v5DYfkf7Z` (registros `/tmp/oh-my-opencode.log`, `~/.local/share/opencode/log/opencode.log`).

## A. Modelos
1. **`/omo-models` se aplica sin reiniciar** — nuevo `S/plugin/chat-message/live-agent-model.ts`: en cada mensaje del
   usuario comprueba la fecha de `~/.omo/omo.jsonc`; si cambió, relee la cadena del agente y cambia
   `output.message.model` **solo si** el primario configurado difiere del cargado al arrancar **y** el modelo del mensaje
   es el de arranque (una elección manual con `/models` nunca se pisa). En `S/features/omo-models/tui.ts`: el aviso
   pasa de "Reinicia OpenCode" a "se aplica desde tu próximo mensaje"; aviso si la cadena queda sin respaldo (1 modelo).
2. **Modelo listado pero no atendido** — clasificar 404 "Cannot find any route" / "model … not found|served|exist" como
   `model_not_found` (`packages/model-core/src/runtime-fallback-error-classifier.ts`), nunca como red; caché de modelos
   rotos (`~/.omo/cache/…`) que alimenta el selector ("no atendido") y la resolución de modelos; aviso "X no responde →
   cambiado a Y". Sondeo barato opcional: lista de modelos servidos de Zen si existe el endpoint, si no una petición de 1
   token al elegir un modelo gratuito en el selector (caché 24 h; sin red → "desconocido", nunca "roto").
3. **Respaldo encendido por defecto** (decisión del usuario): `runtime_fallback` y `model_fallback` activos por defecto
   para modelo no atendido, sin cuota o retirado; los cortes de red siguen el camino de 0.15 (esperar en el mismo modelo).
4. **Modelos retirados:** la sustitución al cargar ya existe; además `librarian`/`explore` deben recorrer sus
   `fallback_models` antes de caer al modelo de la sesión; las sustituciones pasan por la caché de rotos; acción para
   limpiar del `omo.jsonc` los modelos muertos (con copia).
5. **Modelo pequeño (títulos):** si `small_model` no está fijado y `prefer_free_models` está activo, se fija el primer
   modelo gratuito, atendido y no obsoleto; nunca se pisa un `small_model` explícito (si es de pago o roto, solo aviso).
   Adelanta 0.14 en lo que toca al modelo.

## B. Contexto (adelanta 0.13)
1. **Hecho (configuración del usuario):** reglas acotadas, 98k → 49k caracteres (~12k tokens por petición).
2. **Filtro de herramientas que no funcionaba** (`S/plugin-handlers/tool-config-handler.ts:68-80`: `config.tools` se
   convierte en permisos antes de los plugins) → pasar a `permission` deny.
3. **Orquestadores (Sisyphus, Atlas, Prometheus, Hephaestus) sin MCP** (`chrome-devtools_*`, `supabase_*`, `pencil_*`,
   `context7_*`, `grep_app_*`, `websearch_*`) ni `ctx_*` (decisión del usuario); los conservan los especialistas que
   los usan. Herramientas que no usan porque delegan: `lsp_*`, `ast_grep_*`, `process_*`, `monitor_*`,
   `session_list/read/info`, `interactive_bash`, `look_at`, `skill_mcp` (se miden antes de dejarlo).
4. **Skills listados una sola vez** (`S/tools/skill/description-formatter.ts` repite la lista que OpenCode ya inyecta).
5. **Descripciones largas recortadas** (`task` 2,7k, `decision_record`).
6. **Registrador de contexto honesto:** todas las herramientas (no solo 8), agrupadas por origen, secciones partidas
   también por `## ` y etiquetas en mayúsculas.
7. **Medición:** sonda de contexto con la configuración real (sin coste de modelo) antes y después; banco
   (fix-integrity, loops-hard, explore, web-research-hard) antes y después: acierto y pass^k no pueden bajar.
   Objetivo del "hola": 38–45k con estos cortes; ~20–25k cuando las reglas y Sisyphus pasen a skills (regla 16).
