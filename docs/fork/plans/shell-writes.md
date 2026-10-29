# Escrituras por la shell (aprobado por el usuario el 28-10-2026: "si adelante")

## Problema medido
En la línea base del 0.27 (`impact`, 24 ejecuciones) el agente reescribió archivos con `cat > archivo <<'EOF'`,
`sed -i` o `tee` en 7 ejecuciones; en una cambió 7 archivos así y ninguno con `edit`/`write`. Esas escrituras se saltan
los controles del plugin que miran las herramientas de edición: los diagnósticos tras editar (0.9a, con el deshacer si
rompe la sintaxis) y el revisor de comentarios.

## Homólogos
- SWE-agent: su interfaz de edición pasa un linter tras cada cambio y rechaza los que rompen la sintaxis.
- Claude Code: su prompt pide no editar con `cat <<EOF` ni `sed`.
- Nuestro `bash-file-read-guard` (avisa al leer con `cat`), que resultó no llegar al modelo (H43, abajo).

## Diseño
1. `shared/shell-write-targets.ts`: de un comando de bash, los archivos ya existentes dentro del proyecto que reescribe
   (`>`/`>>` a una ruta, `sed -i`, `perl -i`, `tee`). Se ignoran los cuerpos de los heredoc, `/dev/*`, los descriptores
   (`2>&1`), lo que está fuera del proyecto (`/tmp`) y los archivos nuevos.
2. `edit-diagnostics`: en un bash con destinos, cada destino pasa por el mismo servicio que un `write` (diagnósticos
   nuevos, deshacer si rompe la sintaxis), y la salida del bash lleva un aviso pidiendo `edit`/`write`.
3. Revisor de comentarios: los destinos cambiados se revisan como un `apply_patch` (antes y después del archivo).
4. No bloquea nada: el comando se ejecuta igual.

## H43: el aviso de `bash-file-read-guard` nunca llegaba al modelo
OpenCode solo pasa `{ args }` a `tool.execute.before`; el `output.message` que ponía el guardián se perdía. El aviso
pasa a `tool.execute.after`, añadido a la salida del bash.

## Medida
Escrituras por shell (`info:edits`) en `impact` e `impact-hard` antes y después, con el aprobado sin bajar; QA real
en la TUI con una sesión que reescribe un archivo por la shell.

## H44: 44 pruebas fallaban con `hooks` y `plugin` en un mismo proceso
Encontrado al verificar este paso: sin ningún cambio, `bun test packages/omo-opencode/src/hooks packages/omo-opencode/src/plugin`
daba 44 fallos (43 de `runtime-fallback`, 1 de `directory-readme-injector`, los mismos de H40). 18 archivos de prueba
(12 del plugin y 6 de `claude-code-compat-core`) sustituían el logger compartido con `mock.module`, que `mock.restore()`
no deshace: según el orden de carga, esas dos pruebas configuraban un logger que su hook ya no usaba. Arreglo: los 18 usan
el `sink` de H40 (`_setLoggerForTesting` y `_resetLoggerForTesting` tras cada prueba), y la auditoría de `mock.module`
tiene una regla nueva que falla si alguna prueba vuelve a sustituir el logger (en rojo con los 18, en verde después).

## QA real (29-10-2026)
OpenCode 1.19.0 aislado (HOME y XDG propios, contador de sesiones de la base real 548 antes y después), plugin
compilado de esta rama, modelo gratis. Mismo encargo con y sin el cambio: reescribir `src/math.ts` con `sed -i` añadiendo
un comentario, romper `config.json` con `printf >` y leer con `cat`.

| Paso | Con el cambio | Sin el cambio (control) |
|---|---|---|
| `sed -i` en `math.ts` | aviso del revisor de comentarios (línea 2) y `[shell-write] src/math.ts rewritten through the shell...` | nada |
| `config.json` roto | `[edit-diagnostics] EDIT UNDONE ...` y `[shell-write] ...`; el archivo vuelve a su contenido | nada; el archivo queda roto |
| `cat src/math.ts` | `Prefer the Read tool over cat/head/tail ...` (H43) | solo el contenido |

También en la TUI real (tmux, el encargo escrito con el teclado): en los bloques de bash se ven `EDIT UNDONE`,
`[shell-write]` y el aviso de `cat`, y `config.json` queda restaurado. El modelo cita los tres avisos en su respuesta.
Evidencia local en `.omo/evidence/20261029-shell-writes/` (sin versionar).

Lección de la QA: sin `--dir`, `opencode run` toma la carpeta del `PWD` heredado y no la de `cwd`; la primera pasada
ejecutó los comandos en el checkout principal y dejó allí un `config.json` (borrado). El script de QA pasa `--dir`.

## Medida antes/después (pendiente de la cuota gratis)
Antes (calibración de `impact-hard`, 29-10, sin el cambio): 7 de 8 ejecuciones con escrituras por shell (8 en total).
Después: la medición con esta rama se paró por cuota agotada tras la primera tarea (`hard-delivery-date`: aprobada,
9/9, 1 escritura por shell, igual que antes); se reanuda con `--resume` cuando vuelva la cuota. El aviso llega después del
comando, así que lo esperable es que baje la segunda y siguientes escrituras de cada ejecución, no la primera.
