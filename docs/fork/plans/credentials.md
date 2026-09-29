# Paso 2.11 — Credenciales: guardarlas, no filtrarlas y preguntar antes de destruir

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **plan (29-09-2026)**. Rutas: `S/` = `packages/omo-opencode/src/`.

## El problema
El agente crea contraseñas (usuario de base de datos, admin local, tokens, claves) y después no sabe cuáles eran; su
reacción es destructiva (desinstalar, borrar la base de datos, recrear la cuenta) en vez de preguntar o haberla guardado.
Caso real: en julio de 2025 un agente borró una base de datos de producción durante un "code freeze"; la lección fue que
las reglas escritas en el prompt no bastan (https://incidentdatabase.ai/cite/1152/).

## Qué hay hoy (verificado)
- OpenCode deniega por defecto **leer** `*.env` / `*.env.*` (https://opencode.ai/docs/permissions/), pero no impide
  `cat .env` por bash ni que un secreto aparezca en la salida de una herramienta.
- El índice de sesiones (1.3) oculta algunos secretos (`S/features/knowledge/session-reader.ts:50-67`), pero se le escapan:
  - SQL `PASSWORD '…'` / `IDENTIFIED BY`;
  - `mysql -pX`, `--password x`;
  - `postgres://user:pass@host`;
  - variables `*_SECRET`/`*_TOKEN`/`*_KEY` (por `\b` tras `_`);
  - `APP_KEY=base64:…`;
  - contraseñas cortas;
  - frases en español ("la contraseña es …").

  **`knowledge_open` los mostraba sin ocultar: corregido el 29-09-2026.**
- El log del plugin (`/tmp/oh-my-opencode.log`) no oculta nada (`packages/utils/src/logging/logger.ts:34,79,97`).
- No hay almacén de credenciales ni guarda contra acciones destructivas.
- Error: un hook compatible con Claude Code que responde "ask" se trata como "allow"
  (`S/hooks/claude-code-hooks/handlers/tool-execute-before-handler.ts:110-129`).

## Propuesta
1. **Almacén local de credenciales creadas por el agente**, gratis y sin servicios externos:
   - `<proyecto>/.omo/secrets/credentials.json`, con permisos 0600 en una carpeta 0700 y `.gitignore` propio;
   - llavero del sistema opcional (`secret-tool` / `security`), usado si está instalado;
   - cada entrada: nombre, servicio, tipo, usuario, host/puerto/bd, dónde se usa (`docker-compose.yml:12`), sesión que la
     creó, fecha e historial (nunca se borra en silencio).
   - Herramientas:
     - `secret_save` (guardar o actualizar);
     - `secret_list` (solo metadatos);
     - `secret_get` (por defecto devuelve una referencia `${OMO_SECRET:nombre}`, que el plugin sustituye al ejecutar el
       comando para que el valor no pase por el modelo; el valor solo con `reveal: true`).
2. **Política** (en el plugin, junto a las guardas; no en la biblioteca global):
   - antes de crear una credencial, mira `secret_list` y reutiliza;
   - guárdala con `secret_save` **en el mismo paso** en que la creas;
   - nunca imprimas valores ni los commitees; refiérete a ellos por nombre;
   - **nunca** desinstales, borres datos, recrees cuentas ni cambies contraseñas para "recuperar" una credencial perdida:
     pregunta al usuario;
   - pregunta antes de cualquier operación irreversible sobre datos, aunque sea desarrollo;
   - si el usuario te da una credencial, ofrece guardarla.
3. **Ocultación ampliada**:
   - los patrones de arriba, más una pasada con los **valores conocidos** del almacén, que es lo único que atrapa
     contraseñas arbitrarias;
   - se aplica en el índice, en `knowledge_open`, en el log y en la salida de `bash`/`read`;
   - se vuelve a indexar lo ya guardado cuando cambian las reglas de ocultación.
4. **Guarda de destrucción** (dos capas):
   - `permission.bash: "ask"` inyectado por el plugin (el diálogo nativo "permitir una vez") para `dropdb`,
     `DROP DATABASE/USER`, `ALTER USER … PASSWORD`, `docker volume rm`, `docker compose down -v`, `docker system prune`,
     `rm -rf` de carpetas de datos, `npm/pnpm uninstall`, `apt remove/purge`, `brew uninstall`, `migrate:fresh`,
     `db:reset`, `git clean -fdx`; la configuración del usuario manda;
   - `tool.execute.before` que normaliza el comando (`sudo`, `sh -c`, mayúsculas) y bloquea citando la política cuando
     no hay aprobación reciente.

   Arreglar además el "ask → allow" de los hooks compatibles con Claude Code.

## Criterios de aceptación
```gherkin
Feature: credenciales
  Scenario: se guarda al crearla
    When el agente crea un usuario de base de datos con contraseña
    Then la credencial queda en el almacén con dónde se usa, y el valor no aparece en el chat
  Scenario: no se destruye para recuperar
    Given una credencial desconocida
    When el agente intenta "DROP DATABASE" o reinstalar
    Then se bloquea y el agente pregunta al usuario
  Scenario: nunca se filtra
    Given una contraseña guardada en el almacén
    Then no aparece en knowledge_search, knowledge_open ni en el log del plugin
```
