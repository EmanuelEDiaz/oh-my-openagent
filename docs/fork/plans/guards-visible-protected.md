# Paso 0.18 — Guardianes visibles y protegidos

Parte del roadmap (fila 0.18). Estado: **investigación hecha (05-10-2026)**; plan detallado tras 0.16.
`S/` = `packages/omo-opencode/src/`.

## Hallazgo importante en el código (hueco abierto hoy)
`S/plugin-config/config-merger.ts:17` une `disabled_hooks` de la configuración del usuario **y la del proyecto**
(`mergeUniqueStrings`). La del proyecto vive dentro del repositorio, donde el agente puede escribir: **hoy un agente
podría apagar el guardián de tests escribiendo un `omo.jsonc` de proyecto.** Claude Code lo evita: los hooks
gestionados no se pueden apagar desde un nivel inferior.

**Cerrado antes de 0.18 (usuario, 05-10-2026), rama `fix/guards-user-only`:** `S/config/guard-protection.ts` — los
hooks guardianes en `disabled_hooks` y las secciones de los guardianes (`test_integrity`, `edit_diagnostics`,
`loop_breaker`, `retry_budget`, `resilience`, `stall`, `zen_free_gate`, `knowledge.evidence_gate`) se toman **solo de la
configuración del usuario**; lo que intente el proyecto se ignora, se registra en el log y aparece en `doctor`. El banco
apaga guardianes en el `omo.jsonc` de usuario del entorno aislado, así que sigue funcionando. Queda para 0.18 que el
agente tampoco pueda escribir el `~/.omo/omo.jsonc` del usuario (protección por ruta y huella).

## Sistemas homólogos
- **Claude Code:** rutas protegidas (`.git`, `.claude`, `.husky`…) siempre preguntan; editar sus ajustes siempre
  pregunta para que el modelo no cambie sus hooks; hook `ConfigChange` que puede bloquear cambios de ajustes.
- **Codex CLI:** `.git`, `.codex`, `.agents` montados en solo lectura (bubblewrap) aunque estén en zona escribible.
- **Incidente real** (techmefr/forge-ops#403): el agente reescribió su archivo de ajustes y la sesión siguiente arrancó
  sin guardarraíles; propuesta: denegar escrituras a esos archivos e inyectar los hooks al arrancar.
- **andreybuilt/agent-guardrails:** lista pública de cómo se saltan los patrones de bash (`sh -c`, flags que escriben,
  comillas) → los patrones nunca son completos.

## Diseño (a detallar)
1. **Apagar un guardián solo desde la configuración del usuario** (fuera del repo): `disabled_hooks` y
   `*.enabled: false` de guardianes que vengan del proyecto se ignoran (con aviso). Cierra el hueco con poco código.
2. **Protección por ruta:** herramientas de edición sobre `omo.jsonc` y `.omo/**` bloqueadas salvo permiso del usuario;
   en `bash`, cualquier comando que nombre esas rutas con un operador de escritura (`>`, `tee`, `sed -i`, `cp`, `mv`,
   `python -c`, `jq … >`, `ln -s`).
3. **Red de seguridad por huella:** hash de cada archivo de configuración de la cadena, comprobado tras cada
   herramienta y con `fs.watch` del directorio (los editores reemplazan por renombrado); si un guardián se apagó sin
   permiso → se restaura y se avisa. Cubre lo que se escape a los patrones.
4. **Barra lateral:** estado de cada guardián con su origen (archivo y clave) en el espejo existente (`S/tui.ts` ya
   vigila con `fs.watch`); línea roja si cambia.
5. **Banco:** su vía para apagar guardianes es una variable de entorno que pone el arnés, que el agente no puede fijar.
6. Recordar: la configuración se lee al arrancar → una edición surte efecto en la **sesión siguiente** (el objetivo real
   del ataque); la comprobación de huella también corre al arrancar.
