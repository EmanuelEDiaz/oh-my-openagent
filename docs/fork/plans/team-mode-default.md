# 0.28 — Team Mode: comprobarlo y decidir si viene encendido (11-11-2026)

## Petición del usuario
"Comprueba el team mode y que esté activo por defecto y desactivable a decisión del usuario."
Decisión del usuario (11-11): **medir primero y decidir** el valor por defecto con datos.

## Estado actual (código)
- `team_mode.enabled` (`packages/team-core/src/config.ts`) vale `false` por defecto; el usuario ya puede
  encenderlo o apagarlo en `~/.omo/omo.jsonc` (`[opencode]` → `team_mode.enabled`). El del usuario no lo menciona.
- Encendido añade 12 herramientas `team_*`, ganchos de estado y buzón (`team-mode-status-injector`,
  `team-mailbox-injector`, `team-tool-gating`), comprobación de git/tmux al arrancar y 4 manejadores de eventos.
- Miembros: Sisyphus, Atlas, Sisyphus-Junior (por categoría); Hephaestus con permiso extra. Copia en rama aparte por
  miembro opcional (`worktreePath`); la unión final la hace el agente principal (no es automática).
- Homólogo directo: Agent Teams de Claude Code, experimental y apagado por defecto.

## Crítica (dada al usuario)
- A favor: si funciona, los agentes pueden repartir trabajo sin que el usuario tenga que saber que existe.
- En contra: las 12 herramientas viajan en cada petición aunque no se use ningún equipo (estimado, sin medir:
  2.000-3.000 tokens sobre ~25.000); un equipo multiplica llamadas al modelo (cuota de Zen) y RAM.
- Vía intermedia si sale caro: encendido, pero `team_*` solo para los orquestadores (Sisyphus, Atlas).

## Pasos
1. **QA real** (sandbox aislado, TUI en tmux, Team Mode encendido solo en el sandbox): una tarea divisible en dos
   partes independientes; se espera que el agente principal cree un equipo de 2, cada miembro haga su parte (con
   `worktreePath` si el agente lo usa), y el principal una y verifique. Comprobar convivencia con 0.22 (el principal
   no hace commit y manda a Atlas; ¿puede Sisyphus crear equipos con su conjunto fijo?).
2. **Banco encendido/apagado** (suite nueva `team`, local en el fork): tareas normales (¿cuánto cuestan las
   herramientas de más?: tokens por petición, que el banco ya registra) y tareas divisibles (¿aporta?: aprobadas,
   tiempo, tokens totales). ×3 por modo, `--plugin-settings '{"team_mode":{"enabled":true|false}}'`.
3. Informe al usuario con los datos y decisión: por defecto encendido, apagado o vía intermedia.
4. Implementar la decisión con pruebas primero (esquema, `assets/omo.schema.json`, guía), QA, documentar, fusión
   con permiso.

## Límites de la ejecución
- Solo en esta PC (el ASUS no se usa ahora), cediendo la RAM a Code Quest (`omo-run.sh`, suelo 1 GB).
- Cuota gratis de Zen: un equipo gasta varias sesiones a la vez; las tandas se cortan y se reanudan.
