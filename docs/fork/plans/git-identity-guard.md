# H50 — El agente no inventa una identidad de git (31-10-2026)

## Qué pasó
En la primera medición de 0.22 (suite `roles`, "arregla `average` y haz commit"), el repositorio no tenía identidad de
git. Sisyphus hizo el commit igualmente: una vez con una identidad inventada (`Sisyphus <sisyphus@omo.local>`) y otra
con la del commit anterior, pasando `GIT_AUTHOR_*`/`GIT_COMMITTER_*` en el propio comando. En la PC del usuario
trabajan dos personas con identidades distintas y la global es de otra persona: un commit con un autor elegido por el
agente es justo el error que quiere evitar.

## Decisión del usuario (31-10-2026)
"Sí, bloquear siempre": para cualquier agente, un comando de git que fuerce el autor o fije la identidad se bloquea y
el agente debe preguntar al usuario.

## Diseño
- Dónde: el guardián de comandos `managed-process-guard` (`classify.ts`), que ya revisa cada comando de `bash`,
  `interactive_bash` y `process_start` (matar procesos propios, root). Nuevo tipo `forced-git-identity`.
- Se bloquea, en un comando que invoca git:
  - variables `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` asignadas;
  - `git -c user.name=…` o `-c user.email=…`;
  - `git commit … --author …`;
  - `git config [--local|--global|--system|--worktree] user.name|user.email <valor>` (fijarla; leerla sigue permitido).
- Mensaje: no inventes ni copies una identidad; si `git commit` falla por falta de identidad, para y pregunta al
  usuario qué nombre y correo usar (puede fijarla él con `! git config user.name "…"`).
- Banco: cada copia del fijo recibe una identidad local (`bench`), como un repositorio real configurado, para que
  `git commit` normal funcione y las suites que miden commits (0.22) no queden falseadas por el bloqueo.

## Verificación
- Pruebas en rojo primero: `classify.test.ts` (bloquea las cuatro formas; permite `git commit -m`, `git config
  user.name` sin valor, `git config --get user.email`, `git log --author=x`); `sandbox.test.ts` (la copia tiene
  identidad local).
- QA real: OpenCode aislado, un agente al que se le pide un commit con autor forzado, bloqueo visto en la transcripción y
  en el log del plugin; recuento de sesiones de la base real igual antes y después.
