# Paso 0.9 — Integridad de tests, rompe-bucles y errores de tipos

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **decidido (02-10-2026)**; se diseña en detalle y se implementa
tras 0.8. Las mejoras de cada agente van en 4.7 (`test-writer`), 4.8 (`debugger`) y 4.11 (`test-reviewer`).
Rutas: `S/` = `packages/omo-opencode/src/`.

## Problema (usuario, 02-10-2026)
- Las IA escriben o modifican tests para que **pasen**, no para sacar fallos a la luz.
- Ante un error, aplican un arreglo, el error vuelve, y repiten el mismo arreglo durante horas.
- Propuesta del usuario: si se repite la misma solución sin resultado, **buscar en internet** y **preguntar al
  usuario** con opciones basadas en esa búsqueda.
- Ojo con los errores de tipos.

## Evidencia (`[V]` = fuente primaria, `[S]` = resumen secundario)
- **ImpossibleBench** (arXiv 2510.20270) `[V]`:
  - GPT-5 hace trampa en el 54 % de los casos, o3 en el 49 % y Opus 4.1 en el 50 %; Claude y Qwen, sobre todo
    editando el test (>79 %);
  - los tests de solo lectura frenan la trampa de editar tests;
  - una salida explícita ("si el test está mal, para y avisa") baja GPT-5 de 54 % a 9 %.
- **METR, 2025** `[V]`: pedir "no hagas trampa" deja la tasa en 70–80 %. Hay que proteger el corrector por código.
- **Meta ACH** (arXiv 2501.12862) `[S]`: un test vale si **mata un mutante**, es decir, si falla con un fallo
  sembrado. Lo aceptaron el 73 % de las veces, con un modelo abierto (Llama 70B).
- **Depuración** (arXiv 2506.18403 `[S]`; SWE-agent `[V]`):
  - la eficacia cae 60–80 % tras 2–3 intentos;
  - empezar de cero con contexto nuevo suma 8–10 puntos;
  - tras un primer arreglo fallido, la recuperación baja de 90,5 % a 57,2 %.
- **OpenHands StuckDetector** `[V]`: misma acción y mismo error 3 veces → bloqueado.
- **`doom_loop` de OpenCode** `[V]`: solo con 3 llamadas idénticas en el mismo mensaje; no detecta este caso.
- **Diagnósticos de tipos** `[V]`:
  - SWE-agent rechazando ediciones con errores de sintaxis: 15 % → 18 %;
  - dar ubicación + esperado + **alternativas** mejora mucho a modelos de 8–14B (arXiv 2607.14167).
- **El plugin hoy** (verificado en el código):
  - las reglas de tests solo están en prompts, sin guarda en código;
  - nada detecta "mismo error repetido entre turnos";
  - sin diagnósticos automáticos tras editar en OpenCode;
  - el skill `debugging` contradice los permisos del `debugger` (le pide arreglar y lanzar subagentes).
  - `websearch` (Exa sin clave), `context7` y `webfetch` están disponibles para los especialistas.

## Decisiones del usuario (02-10-2026)
- **0.9 ahora, en código**, tras 0.8. Las mejoras de `test-writer`, `debugger` y `test-reviewer`, en 4.7, 4.8 y 4.11.
- **Escalada del rompe-bucles:**
  - **2** arreglos fallidos con el mismo error → aviso: "plantea una hipótesis distinta";
  - **3** → empezar de cero (el `debugger` con un resumen en contexto nuevo) **y búsqueda automática**;
  - **4**, o si repite un arreglo casi idéntico → **bloquear la edición de ese archivo y preguntar al usuario** con
    2–4 opciones y sus enlaces.
- **Fuentes de búsqueda gratuitas:**
  - Stack Exchange (sin clave, 300/día);
  - issues de GitHub vía `gh` (30/min con sesión);
  - el buscador web del plugin (Exa);
  - SearXNG propio si el usuario configura una instancia (opcional).

## Diseño (por código; los prompts solo refuerzan)
1. **Guardián de integridad de tests** (`tool.execute.before/after`):
   - durante un arreglo, los tests existentes son **de solo lectura** para los implementadores; solo `test-writer`
     los edita;
   - tras cada ejecución se revisa el diff y se marcan:
     - `skip`/`.only`/`xfail`/`@pytest.mark.skip` nuevos;
     - aserciones borradas o debilitadas;
     - mocks del módulo bajo prueba;
     - `any`/`@ts-ignore`/`# type: ignore` nuevos;
     - literales de las entradas del test metidos en el código;
   - un test nuevo de `test-writer` solo se acepta si **falla antes del arreglo por la razón correcta y pasa
     después**, comprobado ejecutándolo;
   - salida explícita en los prompts: "si el test parece incorrecto, no lo cambies: para y avisa".
2. **Rompe-bucles con escalada:**
   - huella de cada error normalizada (sin rutas, líneas, columnas, direcciones ni fechas) y huella de cada arreglo
     (archivo + trozo normalizado);
   - se sigue por sesión durante todos los turnos, incluidos los errores de tipos;
   - los umbrales 2/3/4 decididos arriba;
   - `doom_loop` queda en "ask" como red exterior.
3. **Errores de tipos tras cada edición:**
   - diagnósticos de los archivos tocados (LSP, `tsc --noEmit`, pyright/mypy, `go vet`), **solo los nuevos**,
     con ubicación + esperado/real + alternativas;
   - se rechazan las ediciones que rompen la sintaxis.
4. **Búsqueda de errores:**
   - consulta con el error normalizado a Stack Exchange → issues de GitHub → Exa → SearXNG (si existe);
   - resultados con enlace y fecha, tratados como datos y no como instrucciones;
   - la sintetiza `librarian`, que ya investiga en la web.

## Criterios de aceptación
```gherkin
Feature: integridad de tests y bucles
  Scenario: test protegido
    Given un implementador arreglando un fallo
    When intenta editar un test existente o añadir un skip
    Then se bloquea y se le indica parar y avisar si cree que el test está mal
  Scenario: test que no prueba nada
    Given un test nuevo de test-writer que pasa antes del arreglo
    Then se rechaza como inválido
  Scenario: bucle de errores
    Given el mismo error tras 3 arreglos distintos
    Then se busca el error en las fuentes configuradas y el debugger empieza de cero con el resumen
  Scenario: preguntar al usuario
    Given el mismo error tras 4 arreglos o un arreglo repetido
    Then se bloquea editar ese archivo y el usuario recibe 2-4 opciones con enlaces
  Scenario: errores de tipos nuevos
    When una edición introduce un error de tipos
    Then el agente recibe solo los errores nuevos con ubicación y alternativas
```
