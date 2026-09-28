# Paso 1.1 — Diseño del índice, citas de chat y ciclo de vida

Parte del roadmap: `docs/fork/roadmap.md` (pasos 1.1 → 1.2 y 1.3). Estado: **plan aprobado 27-09-2026**; 1.2 y 1.3 hechos (28-09-2026). Rutas: `S/` = `packages/omo-opencode/src/`.

## 1. Mediciones reales (27-09-2026, tu máquina, solo lectura)

### Base de OpenCode (`~/.local/share/opencode/opencode.db`)
| Dato | Valor |
|---|---|
| Tamaño del archivo | 1,26 GB |
| Páginas vacías (nunca compactadas, `auto_vacuum=0`) | **~755 MB (63 %)** — un `VACUUM` con OpenCode cerrado la dejaría en ~500 MB |
| Tablas | `part` 249 MB · `message` 90 MB · `event` 86 MB |
| Sesiones | 522 (405 de subagentes), 15 proyectos, desde 2026-05-09 |
| Mensajes | 2.156 de usuario · 14.717 de asistente |
| Texto de conversación (usuario + asistente, sin sintéticos) | **13,1 MB** (~3 MB/mes) |
| Razonamiento (`reasoning`) | 15,2 MB |
| Salidas de herramientas | 178 MB |
| Entradas de herramientas (rutas, comandos) | ~13 MB (read 1,1 · bash 2,9 · edit 2,4 · write 5,2) |
| Compactaciones / mensajes resumen | 240 / 161 |

### Prueba de concepto (desechable, ya borrada)
Índice FTS5 construido leyendo `opencode.db` en **solo lectura**: texto de usuario/asistente + metadatos de
herramientas (ruta/comando, sin salidas).

| Métrica | Resultado |
|---|---|
| Construcción completa (522 sesiones, 30.079 fragmentos, 12,1 MB) | **4,2 s** |
| Tamaño del índice | 30 MB (+27 MB de WAL si no se hace checkpoint) |
| Búsquedas | **0,2 – 12 ms** |

Hallazgos de la prueba:
- **Consultas con guiones rompen FTS5** (`planning-log` → "no such column: log"). Hay que sanear cada término.
- **Los metadatos de herramientas dominan el ranking.** Hace falta ponderar por tipo de documento.
- El WAL crece tanto como el índice si no se hace `wal_checkpoint(TRUNCATE)` tras cada lote.

## 2. Decisiones de diseño

Formato de tu `planning-log.md`.

### D1: Dos índices, no uno
- **Context:** los documentos (planes, decisiones, AGENTS.md, commits) son de cada proyecto; las sesiones viven en
  una base global de OpenCode que mezcla 15 proyectos.
- **Options considered:** (a) un índice por proyecto con todo; (b) un índice global con todo; (c) índice de proyecto
  para documentos + índice global de sesiones filtrado por proyecto.
- **Decision:** (c). `<proyecto>/.omo/knowledge.db` para documentos y commits; `~/.local/share/opencode/omo/sessions-index.db`
  para sesiones, con `project_id`/`directory` en cada fila. `knowledge_search` consulta ambos, por defecto solo el
  proyecto actual.
- **Reason:** no duplica las sesiones en cada proyecto y permite buscar "en todos mis proyectos" cuando se pida.
- **Reversibility:** easy.

### D2: Leer sesiones de forma incremental, en solo lectura
- **Context:** tu script copia la base de 1,2 GB y reconstruye todo (~10 s). La prueba reconstruye en 4,2 s sin copiar.
- **Options considered:** copia + rebuild; triggers en `opencode.db` (requiere escribir en ella); lectura incremental.
- **Decision:** conexión de solo lectura. Marca de agua por `session.time_updated`: solo se releen las partes de las
  sesiones que cambiaron (por el índice `part_session_idx`). Rebuild completo solo si cambia la versión del esquema.
- **Reason:** nunca escribe en la base de OpenCode, no copia 1,2 GB y cada sincronización toca solo lo nuevo.
- **Reversibility:** easy.

### D3: Qué se indexa de las sesiones
| Contenido | ¿Indexar? | Motivo |
|---|---|---|
| Texto del usuario | **Sí, literal** | Peticiones y restricciones: lo más valioso y lo que más se pierde al compactar |
| Texto final del asistente | Sí | Respuestas, conclusiones, planes |
| Resúmenes de compactación | Sí, marcados | Continuidad; puente al paso 1.6 |
| Sesiones de subagentes | Sí, con menor peso | Traen investigación con fuentes |
| Metadatos de herramientas (herramienta + ruta/comando) | Sí, con menor peso | Responde "¿en qué sesión se editó X?" |
| Razonamiento interno | **No** (opcional) | 15 MB con pensamientos intermedios, a veces erróneos; citarlos como verdad invita a alucinar |
| Salidas de herramientas | **No** | 178 MB, ruido, posibles secretos |
| Partes sintéticas (inyectadas por plugins) | No | No las escribió nadie de la conversación |

### D4: Locator citable
`ses_…/msg_…/prt_…` + título de la sesión + fecha, y el comando de re-auditoría
`opencode run --session <ses_…> --fork`. Es el mismo formato de *Evidence session* de tu biblioteca.

### D5: Ranking
BM25 con pesos por columna (título ×2) y por tipo de documento:
decisión > plan/ADR > texto del usuario > texto del asistente > commit > subagente > metadatos de herramienta.
Pequeño empujón a lo reciente. Consultas saneadas: cada término entre comillas. Si todos los términos juntos no dan
resultados, se reintenta con OR.

### D6: Crecimiento y poda (tus 3 capas)
- **Resume (siempre, nunca se poda):** planes, decisiones, ADR, CHANGELOG y cualquier sesión **referenciada** por ellos
  (regla de tu biblioteca: "una sesión vive porque un plan la referencia").
- **Cold (índice de sesiones):** sesiones no referenciadas y con más de **180 días** (configurable) salen del índice.
  Solo del índice: `opencode.db` no se toca.
- **Orphan:** sesiones borradas en OpenCode → sus filas se eliminan en la siguiente sincronización.
- **Presupuesto:** 200 MB por defecto (hoy se usarían ~30 MB). Si se supera, se podan primero las sesiones cold más antiguas.
- **Mantenimiento automático del índice propio:** `wal_checkpoint(TRUNCATE)` tras cada lote; `optimize` + `VACUUM`
  del índice semanalmente, en reposo (segundos, porque es pequeño).
- **`opencode.db` (755 MB recuperables):** el plugin **nunca** la modifica. Un comando `oh-my-opencode knowledge report`
  dirá cuánto se recuperaría y qué sesiones no están referenciadas; borrarlas o hacer `VACUUM` queda a tu decisión
  (con OpenCode cerrado).

### D7: Privacidad
Todo local. Antes de indexar se redactan patrones de secretos (claves de API, tokens, `Bearer …`, claves privadas).
Archivos de índice con permisos `600`.

### D8: Objetivos de rendimiento (medidos, no estimados)
Construcción inicial < 30 s en segundo plano (hoy 4,2 s) · sincronización incremental típica < 1 s ·
búsqueda p95 < 20 ms (hoy ≤ 12 ms) · nunca bloquea el arranque de OpenCode.

## 3. Subtareas

### Paso 1.2 — Índice del proyecto + `knowledge_search`
- [x] 1. `S/shared/bun-sqlite-shim.ts` (el repo exige pasar `bun:sqlite` por un shim aprobado) + test.
- [x] 2. Almacén `S/features/knowledge/store.ts`: esquema (tabla `documents` + FTS5 + triggers), migraciones versionadas, checkpoint, `optimize`/`VACUUM` programados.
- [x] 3. Saneado de consultas y ranking con pesos por tipo (`query.ts`).
- [x] 4. Indexador de archivos del proyecto: `AGENTS.md`, `/plans/**`, `.omo/plans|drafts|notepads/**`, `docs/adr`, `docs/decisions`, `CHANGELOG.md`; troceado por encabezados guardando línea; incremental por hash.
- [x] 5. Indexador de git: últimos 500 commits (sha, asunto, cuerpo, archivos).
- [x] 6. Herramienta `knowledge_search(query, kinds?, limit)` (el parámetro `scope: project|all` llega en 1.3, junto con las sesiones) registrada en `S/plugin/tool-registry-core-tools.ts`.
- [x] 7. Disparadores: arranque del plugin (en segundo plano), `session.idle`, tras `write`/`edit` de archivos indexados.
- [x] 8. Config `knowledge` (activada por defecto) + regenerar `assets/omo.schema.json`.
- [x] 9. QA real en sandbox: una pregunta que solo se responde con un plan o commit → el agente usa la herramienta y cita el locator.

### Paso 1.3 — Índice de sesiones y citas de chat
- [x] 1. Lector de solo lectura de `opencode.db` con marca de agua por sesión (D2), tolerante a cambios de esquema (si faltan columnas, desactiva el indexado de sesiones con un aviso, sin romper nada).
- [x] 2. Extracción según D3 + redacción de secretos (D7).
- [x] 3. Poda D6: sesiones borradas, retención de 180 días salvo referenciadas, presupuesto de tamaño.
- [x] 4. `knowledge_search` añade `scope: project|all` y devuelve locators de chat con título, fecha y comando de re-auditoría.
- [x] 5. `oh-my-opencode knowledge report`: tamaño del índice, sesiones podadas, espacio recuperable en `opencode.db`.
- [x] 6. QA real: buscar una frase dicha en una sesión antigua → locator correcto y re-auditoría que abre ese mensaje.
- [x] 7. `knowledge_open(locator, around=N)`: texto original exacto del mensaje citado (con su razonamiento si lo hay) y N mensajes vecinos, solo lectura.
- [x] 8. `knowledge report --vacuum`: ofrece `VACUUM` de `opencode.db` con confirmación, OpenCode cerrado y copia previa.

## 4. Criterios de aceptación

```gherkin
Feature: índice de sesiones

  Scenario: cita de chat exacta
    Given una sesión donde el usuario escribió "usa worktrees para cada tarea"
    When se busca "worktrees tarea"
    Then el primer resultado de tipo user tiene locator ses_…/msg_…/prt_… de ese mensaje
    And incluye el comando opencode run --session <id> --fork

  Scenario: nunca escribe en la base de OpenCode
    Given el índice sincronizando
    When termina la sincronización
    Then opencode.db tiene el mismo número de sesiones y su mtime no cambió por el plugin

  Scenario: poda de sesiones borradas
    Given una sesión indexada que luego se borra en OpenCode
    When corre la siguiente sincronización
    Then ninguna fila del índice apunta a esa sesión

  Scenario: sesiones referenciadas no se podan
    Given una sesión de hace 200 días citada en docs/decisions/D-….md
    When corre la poda por antigüedad
    Then la sesión sigue en el índice

  Scenario: consultas con símbolos
    When se busca "planning-log" o "C++"
    Then no hay error de sintaxis y se devuelven resultados
```

```gherkin
Feature: índice del proyecto

  Scenario: cita de documento con línea
    Given .omo/plans/x.md con "usamos Redis por la latencia" en la línea 40
    When se busca "por qué redis"
    Then el primer resultado es .omo/plans/x.md:40

  Scenario: sin bloquear el arranque
    When OpenCode arranca en un proyecto con 500 commits y 50 planes
    Then el primer prompt se puede enviar sin esperar al indexado
```

## 5. Respuestas (27-09-2026)
1. Retención de 180 días para sesiones no referenciadas: **sí**.
2. Razonamiento fuera del índice: **sí**, pero toda información indexada y todo resumen debe **citar la sesión y el
   mensaje exactos** donde se vio en OpenCode, y debe poder abrirse el original si el resumen no basta →
   nueva herramienta `knowledge_open(locator, around=N)` que devuelve el texto original de ese mensaje (incluido su
   razonamiento si lo tiene) y los N mensajes vecinos, leyendo `opencode.db` en solo lectura. (Subtarea 1.3.7.)
3. `knowledge report` **ofrece** el `VACUUM` de `opencode.db`: solo con confirmación explícita y con OpenCode cerrado
   (comprueba que no hay procesos `opencode` usando la base; hace copia de seguridad antes).
