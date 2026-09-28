# Pasos 1.4b y 1.4c — Decisiones que escalan: almacenamiento, vistas y decisiones que encuentran al agente

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **plan aprobado 28-09-2026**; 1.4b hecho (28-09-2026), 1.4c pendiente.
Rutas: `S/` = `packages/omo-opencode/src/`.

## 1. Pregunta de partida
¿Es Markdown la mejor forma de guardar decisiones y el `Decisions log` de los planes, o se vuelve incómodo al crecer?

## 2. Opciones evaluadas como fuente de verdad

| Opción | A favor | En contra |
|---|---|---|
| **Un `.md` por decisión** (`docs/decisions/`, lo implementado en 1.4) | Diffs y revisión en PR; legible sin herramientas; casi sin conflictos de merge (un archivo por decisión); estándar de la comunidad (ADR) | Navegar a mano se vuelve incómodo a partir de ~30 decisiones |
| SQLite como verdad | Consultas estructuradas y rápidas | Binario en git: sin diffs ni revisión; conflictos de merge irresolubles; opaco sin la herramienta |
| Un solo JSONL/YAML | Estructurado y diffable | Un archivo que crece; conflictos constantes cuando dos ramas añaden decisiones |
| Herramienta externa (Notion, issues) | Buena interfaz | Separada del código; los agentes no la ven offline; la verdad se desalinea del repo |

### Qué dice la comunidad
- Una decisión por documento. — [TechTarget, ADR best practices](https://www.techtarget.com/searchapparchitecture/tip/4-best-practices-for-creating-architecture-decision-records)
- Plantilla con opciones y motivos explícitos (MADR). — [MADR](https://adr.github.io/madr/)
- Al pasar de unas decenas, se añaden **vistas generadas** encima de los archivos: log4brains (sitio navegable con línea de
  temporal), adr-tools (numeración y reemplazos), adr-log (vista cronológica). —
  [ADR tooling](https://adr.github.io/adr-tooling/), [CODERCOPS 2026](https://blog.codercops.com/blog/architecture-decision-records-2026)

## 3. Conclusión
- **Se mantiene** un `.md` por decisión en `docs/decisions/` como fuente de verdad. Es lo que se considera mejor práctica.
  El índice FTS5 (1.2) ya es la capa de consulta.
- **Se corrige** lo que sí escala mal: 1.4 copia la decisión **entera** en el `Decisions log` del plan.
  1. **Crece:** un plan con 10 decisiones se vuelve ilegible.
  2. **Se desalinea:** si la decisión se reemplaza, la copia del plan sigue diciendo lo antiguo y un agente puede citar la versión vieja.
- La comodidad al crecer no viene de cambiar de formato, sino de **mecanismos**: vistas generadas, validación del esquema y
  que las decisiones lleguen solas al agente cuando toca el código afectado.

Estimación de tamaño: 5 decisiones/semana ≈ 250/año de archivos pequeños; git y el índice lo manejan sin problema. El único
problema real es navegarlas a mano, y eso lo resuelven las vistas.

## 4. Paso 1.4b — Enlaces en vez de copias, vistas y esquema

### Subtareas
- [x] 1. **Bloque generado en el plan.** El `## Decisions log` del plan contiene un bloque entre marcadores
  `<!-- omo:decisions:start (generado, no editar) -->` … `<!-- omo:decisions:end -->` con una línea por decisión:
  `- D-… — título · estado · reversibilidad` (tachado y "superseded by D-…" si fue reemplazada). El plugin lo regenera al
  registrar o reemplazar una decisión y en cada sincronización del índice. El texto del plan fuera de los marcadores no se toca.
- [x] 2. **Campo `plans` en la decisión.** El registro guarda qué planes la referencian, para poder regenerar sus bloques.
- [x] 3. **Migración.** Las entradas completas ya escritas por 1.4 en planes (`### D-…:` con campos) se sustituyen por el
  bloque de enlaces, sin perder información (el detalle ya está en `docs/decisions/`).
- [x] 4. **Vista generada:** `oh-my-opencode knowledge decisions [--status active|superseded|all] [--area X] [--file path] [--json]`
  → tabla (id, fecha, título, estado, reversibilidad, área), línea temporal y cadena de reemplazos. No se escribe ningún archivo.
- [x] 5. **Campo `area`** (opcional, p. ej. `cache`, `auth`) en `decision_record` y filtro en `decision_search`.
- [x] 6. **Validación del esquema.** Al indexar, un encabezado mal formado o sin campos obligatorios (`id`, `title`, `status`,
  `date`, `reversibility`, `evidence`) se reporta en `knowledge report` y en `decision_search` en vez de indexarse como si fuera válido.
- [x] 7. **Escalado.** Con más de ~200 decisiones, las nuevas se guardan en `docs/decisions/<año>/`; lectura y búsqueda
  soportan ambos esquemas. Las reemplazadas se conservan como historia y se ocultan por defecto.
- [x] 8. Tests + QA real: registrar, reemplazar y ver el bloque del plan actualizado; ejecutar la vista.

### Criterios de aceptación
```gherkin
Feature: Decisions log generado

  Scenario: el plan muestra enlaces, no copias
    Given un plan con "## Decisions log" y una decisión registrada con plan_path
    When se registra la decisión
    Then el plan contiene una sola línea "- D-… — título · active · easy" dentro de los marcadores
    And el detalle completo solo existe en docs/decisions/

  Scenario: el reemplazo se refleja en el plan
    Given D-1 enlazada en el plan
    When se registra D-2 con supersedes D-1
    Then la línea de D-1 en el plan aparece tachada con "superseded by D-2"
    And D-2 aparece como active

  Scenario: el texto del usuario no se toca
    Given un plan con notas escritas a mano antes y después del bloque
    When se regenera el bloque
    Then todo el contenido fuera de los marcadores queda idéntico

  Scenario: esquema inválido
    Given una decisión con el encabezado roto o sin "evidence"
    When se sincroniza el índice
    Then knowledge report la lista como inválida con el motivo
```

## 5. Paso 1.4c — Las decisiones encuentran al agente

### Idea
Cada decisión cita archivos como evidencia (`src/cache.ts:2-3`). Cuando un agente **lee o edita** un archivo citado por una
decisión **activa**, el plugin le inyecta una línea breve:
`[Decision D-20260928-1 (active) applies to src/cache.ts: switch cache to Valkey (license). Details: knowledge_open/decision file]`.
Así no depende de que el modelo recuerde buscar. Mecanismo análogo al `rules-injector` existente, que inyecta reglas al leer archivos.

### Subtareas
- [ ] 1. Mapa archivo → decisiones activas, construido desde las evidencias `file` del índice (se actualiza en cada sincronización).
- [ ] 2. Hook `tool.execute.after` sobre `read`, `edit`, `write` y `multiedit`: añade las líneas de decisiones activas que citan ese
  archivo (o la carpeta que lo contiene, si la evidencia cita un directorio).
- [ ] 3. **Sin repetir:** cada decisión se inyecta una vez por sesión (se reinicia tras compactar, como las reglas); máximo 3 por
  archivo, priorizando las más recientes y `hard`.
- [ ] 4. **Aviso de deriva:** si las líneas citadas cambiaron desde que se registró (la huella no coincide), la línea lo dice:
  "evidence changed since recorded — re-check before relying on it".
- [ ] 5. Config: `knowledge.inject_decisions` (activado por defecto) y el hook desactivable desde `disabled_hooks`.
- [ ] 6. Tests + QA real: registrar una decisión que cita `src/cache.ts`; en otra sesión, pedir una edición de ese archivo y
  comprobar que el agente recibe y respeta la decisión.

### Criterios de aceptación
```gherkin
Feature: decisiones inyectadas al tocar archivos

  Scenario: leer un archivo citado
    Given D-1 activa con evidencia src/cache.ts:2-3
    When el agente lee src/cache.ts
    Then el resultado de la lectura incluye la línea de D-1 una sola vez en la sesión

  Scenario: las reemplazadas no se inyectan
    Given D-1 reemplazada por D-2, ambas citando src/cache.ts
    When el agente lee src/cache.ts
    Then solo se inyecta D-2

  Scenario: evidencia cambiada
    Given D-1 cuya línea citada cambió después de registrarse
    When el agente lee el archivo
    Then la línea inyectada avisa de que la evidencia cambió
```

## 6. Decisión registrada
Esta decisión de diseño está registrada con el propio sistema en `docs/decisions/` (primera decisión del fork).
