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

## Paso 1 hecho: QA real (11-11-2026)
Fixture nuevo `team-repo` (dos utilidades independientes sin implementar, con sus tests). Con Team Mode encendido solo en
el sandbox, a Sisyphus: crea un equipo de dos, uno por utilidad, cada uno en su worktree, y une el trabajo.
- Sisyphus creó el equipo (`utilities-implementers`: `duration-dev`, `roman-dev`); los miembros (Sisyphus-Junior)
  trabajaron en paralelo en su worktree e hicieron commit en su rama; Sisyphus recogió los resultados, unió las ramas,
  verificó (`bun test` 6/6) y borró worktrees, ramas y equipo. 5 minutos. Sesiones reales 551 → 551.
- Convivencia con 0.22: la unión fue un `git merge` de Sisyphus, un commit que la regla no cubría → **H56** (decisión del
  usuario: bloquear todo lo que crea commits; los commits de los miembros en sus ramas se aceptan). Con H56, la misma
  prueba deja las ramas listas y Sisyphus manda a Atlas a unirlas.
- Evidencia `.omo/evidence/20261111-team-mode-qa/`.
- Siguiente: el banco encendido/apagado va en la tanda 1 (decisión del usuario de trabajar por tandas, 11-11).

## Decisión del usuario (12-11-2026): miembros en la carpeta compartida
Con H56, Sisyphus no puede unir las ramas de los miembros, así que un equipo suyo con worktrees nunca terminaba (la QA
lo dejó en "cambia a Atlas para unir"). Elegido: **si dirige un agente de tab sin git-committer (Sisyphus, Hephaestus,
Prometheus), los miembros trabajan en la carpeta compartida**, cada uno en sus archivos, sin worktrees, ramas ni
commits; el commit va a Atlas. Los equipos de Atlas conservan worktrees, ramas y commits.
- El registro de sesiones de equipo guarda el agente que dirige; el prompt del miembro lo indica; el guardián rechaza
  a esos miembros `git worktree add`, ramas nuevas y los comandos que escriben commits (`teamMemberGitError`);
  `team_create` rechaza `worktreePath` con esos agentes.
- Pruebas en rojo y luego en verde (agents, managed-process-guard, team-mode, plugin: 1.502/1.502), typecheck limpio.
- QA real pendiente (usa la cuota de modelo que ahora gasta la prueba del inventario en el ASUS).

## Nueva decisión del usuario (12-11-2026, sustituye a la de la carpeta compartida)
"Team mode debe poder usar worktrees de GitHub; si lo autorizo la primera vez deberían trabajar solos". Crítica dada
(permiso guardado y revocable; no volver a meter commits en la rama del usuario sin su decisión) y elegido
**rama de integración + permiso único**:
1. Los miembros trabajan en sus worktrees, cada uno en su rama, con commits allí.
2. El jefe (Sisyphus, Hephaestus, Prometheus) une solo las ramas de su equipo en una rama nueva `team/<nombre>` y
   pasa allí los tests; `git merge` se le permite únicamente estando en esa rama de integración.
3. Al terminar avisa de que `team/<nombre>` está lista; unirla a la rama del usuario lo hace el usuario o Atlas…
4. …salvo que el usuario lo haya autorizado una vez: la primera vez se le pregunta y, si acepta, queda guardado en
   su `~/.omo/omo.jsonc` (p. ej. `team_mode.lead_merges_to_branch: true`, solo capa de usuario, revocable); desde
   entonces el jefe une `team/<nombre>` él mismo.
Pendiente de implementar: deshacer la regla de carpeta compartida (commit 0715b2da9) salvo el registro del jefe;
regla de merge del jefe en el guardián; ajuste protegido + comando para concederlo (modelo: `/omo-models`); pruebas
en rojo primero y QA real. Trabajo parado a petición del usuario ("espera cierra por ahora el trabajo").

## Implementado (12-11-2026): rama de integración + permiso único
- Deshecha la carpeta compartida (0715b2da9); se conserva el registro del agente que dirige el equipo, y ahora la
  sesión que crea el equipo queda siempre registrada como jefe.
- Miembros de un equipo de Sisyphus/Hephaestus/Prometheus: su prompt les pide trabajar en su worktree y rama y
  hacer commit solo ahí; el guardián les rechaza commits en la carpeta principal y push/pull (`teamMemberGitError`,
  `git-context.ts` mira si el directorio es un worktree enlazado, también tras `cd …` o `git -C …`).
- Jefe: en `team/<nombre>` puede `merge` y `commit` (resolver conflictos); fuera, solo `merge` de una rama `team/…`
  y solo con el permiso; push, pull, rebase y lo demás siguen con Atlas (`teamLeadGitError`).
- Permiso: `team_mode.lead_merges_to_branch` (solo capa de usuario: `guard-protection` ignora el del proyecto),
  concedido o retirado por el usuario con `/omo-team-merge on|off`, que se aplica al momento y se guarda en
  `~/.omo/omo.jsonc`; el agente no puede dárselo (la herramienta `skill` solo devuelve el texto de la plantilla).
- Pruebas en rojo y luego en verde (agents, managed-process-guard, team-mode, plugin, config, builtin-commands,
  team-core, tests/: 2.007/2.007 tras regenerar los esquemas); QA real del comando con modelo falso: ausente → on →
  off guardado en el `omo.jsonc` del sandbox y en el log; sesiones reales 557 → 557.
- Queda: QA real de un equipo completo con modelo (tras la prueba del inventario, por la cuota compartida) y el banco
  encendido/apagado de 0.28.
