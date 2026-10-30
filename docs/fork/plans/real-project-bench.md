# Banco sobre un proyecto real del usuario (propuesta del 29-10-2026)

## Petición del usuario (29-10-2026)
"endurece más el banco de pruebas, por ejemplo usa mi proyecto de inventario y según lo que establecí en él hazlo
funcional, así servirá en una prueba real". Respuestas del mismo día:
- **Alcance:** frontend y backend.
- **Privacidad:** el proyecto es privado y este fork es público. Todo lo del proyecto (copia, tareas, pruebas de
  aceptación, resultados) vive solo en local, en `.omo/private/` (ignorado por git). Aquí solo entra el código genérico.
- **Tareas:** todo: pendientes reales de sus planes, cambios entre capas, fallos reales reproducidos. Literal: "hay que
  de principio a fin detectar fallos, corregir, comprobar cosas hechas y cosas que no funcionan aunque están, pero tú
  solo vas a arbitrar y ver que las pruebas que hace y las cosas que debe hacer están bien [...] en cualquier cosa que
  tengas dudas me las pasas a mí, por lo cual esto también debe servir de batería de pruebas para el proyecto actual".

## Por qué
Los dos bancos de 0.27 (`impact`, `impact-hard`) se saturaron: apps de juguete de 20 y 51 archivos donde `grep` y los
errores de tipos bastan. El proyecto real tiene unos 900 archivos en dos lenguajes (Spring WebFlux con arquitectura
hexagonal, Next.js 16), contratos escritos por el usuario (endpoints, DTO, esquema, UX, offline) y defectos reales sin
catalogar. Es el caso que motivó el 0.27 y varias funciones del plugin.

## Roles
- **Agente bajo prueba:** Sisyphus con el plugin, en el sandbox aislado de siempre. Hace el trabajo: auditar, escribir
  pruebas, corregir, implementar.
- **Árbitro (Claude Code):** no escribe código del proyecto. Define qué cuenta como "bien hecho" a partir de los
  documentos del usuario, comprueba que las pruebas del agente prueban la especificación (y no lo que el código ya hace),
  revisa el resultado y lleva el registro. Toda ambigüedad de la especificación va al usuario antes de usarla para puntuar.

## Diseño (código genérico en este fork)
1. **Suites locales:** `run.ts` carga además las suites de `.omo/private/*/suite.ts` si existen (nunca versionadas).
2. **Proyecto externo:** la tarea puede apuntar a un repo local fijado a un commit (`fixtureRepo` + `commit`); cada
   ejecución saca su copia con `git worktree`/`clone --shared`, sin copiar `node_modules` (store de pnpm y `~/.m2`
   compartidos).
3. **Raíz de trabajo configurable:** `OMO_BENCH_ROOT` (por defecto el tmpdir). Para este banco, en la partición del
   sistema, no en `/tmp` (está en RAM).
4. **Servicios:** sin hooks nuevos. El agente monta su propio entorno (lo pidió el usuario: "deja que opencode instale
   y haga todo eso"); los correctores que necesitan la app levantada son scripts locales de la suite que arrancan y paran
   sus servicios (PostgreSQL en Docker con puerto libre), siempre con el tope de RAM de `omo-run.sh`.
5. **Correctores por comando:** `commandGrader` (comando, carpeta, tiempo máximo, pasa si sale 0, guarda la salida):
   `mvn test`, `pnpm vitest run`, `pnpm build`, `tsc`, Playwright contra la app levantada.
6. **Arbitraje:** al terminar cada tarea, el banco deja un paquete (diff, pruebas nuevas del agente, salida de los
   correctores, resumen de la transcripción) y una entrada `arbiter:pending`. El árbitro lo revisa y escribe su veredicto
   (`arbiter:pass|fail` con motivo) con `bench arbitrate <run> <task>`; el informe muestra las dos notas, la automática
   y la del árbitro.
7. **Detección de defectos:** en tareas de auditoría, el agente entrega una lista de defectos; se puntúa contra la lista
   de referencia que confirma el árbitro (aciertos, falsos positivos y defectos que no vio).

## Fases
- **F0, entorno (local):** Java 21 (Temurin, con mise) y Maven en la carpeta personal, pnpm con corepack, Docker para
  PostgreSQL 17. Comprobar que el proyecto compila, que pasan sus pruebas actuales y que la app arranca entera.
- **F1, línea base del árbitro:** recorrer cada pantalla y cada endpoint contra los contratos del usuario y anotar qué
  funciona, qué falla y qué falta, con evidencia. Las dudas se agrupan y van al usuario. Resultado: la lista de defectos
  de referencia y la batería de aceptación (API + Playwright) que además le sirve al proyecto.
- **F2, código genérico del banco** (puntos 1 a 7, con pruebas en rojo primero).
- **F3, suites** (solo locales): auditoría por módulo, corrección de defectos confirmados, pendientes reales (subida de
  imágenes y galería, offline con IndexedDB y outbox, QR del hotspot, pruebas de integración), cambios entre capas, y
  arreglos del historial revertidos.
- **F4, medición:** humo de una tarea por suite, luego línea base del plugin actual ×3 y, si discrimina, las variantes
  del 0.27.

## Límites conocidos
- Cuota gratis de Zen: unas 25 ejecuciones al día, y estas tareas son largas; la medición durará días. `--resume` (H42)
  lo cubre.
- RAM: cada ejecución puede sumar JVM de pruebas + `next build` + Playwright + PostgreSQL (~3 GB). Los correctores
  corren uno tras otro, después del agente, dentro del tope de `omo-run.sh`.
- Lo que el agente cambie en el proyecto se queda en las copias del banco. Llevar algún arreglo al repo del usuario
  es otra decisión suya.

## Estado
- 29-10-2026: aprobado por el usuario ("perfecto avanza"). Matiz del mismo día: "deja que opencode instale y haga todo
  eso, comienza a detectar problemas y cómo resolverlo en todo el transcurso". F0 y F1 las hace el agente en una sesión
  real (TUI aislada, sandbox duradero fuera de `/tmp`, sin copia de auth.json); el árbitro vigila, anota los problemas
  del agente y del plugin con su solución, y valida el informe.
- F2 hecha: `command-grader.ts` (`commandGrader`, `defectRecall`), `local-suites.ts`, `arbiter.ts` + `arbitrate.ts`,
  `OMO_BENCH_ROOT`, resultados e informes de las suites privadas en su carpeta. Pruebas en rojo y luego en verde
  (`real-project.test.ts`, 12/12; `script/fork` + auditorías 146/146), `typecheck:script` limpio.
- 30-10-2026, S1 arbitrada (aprobada con observaciones; en local). Hallazgos del plugin H45 y H46 arreglados y
  fusionados (`1de71be16`). S2 (corregir los fallos que bloquean con pruebas de comportamiento + auditoría de interfaz
  con Playwright) en marcha.
- 30-10-2026, **decisión del usuario sobre el orden ("Hitos")**: el inventario no se repara sin fin. Tras S2 se congela
  como banco (tareas reales con respuesta conocida, desde el commit original) y se vuelve al orden del roadmap. Los
  proyectos reales se miden en hitos: línea base ahora, al cerrar las 5 ramas pendientes del 11-10 (0.22, 0.23, 0.9c,
  0.21 ×2) y en la Fase 5 (5.1/5.2). Segundo proyecto real: `codegenerator` (Python) en el primer hito. Cada hallazgo
  del plugin en esas sesiones se arregla en el momento con su test en rojo.

