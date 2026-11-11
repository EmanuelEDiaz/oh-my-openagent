# H53 — Una instancia cerrada del plugin no vuelve a abrir su carpeta (03-11-2026)

## Qué pasó
La medición ×3 de 0.22 se cortó a las 13 de 17 ejecuciones: el `opencode serve` del banco llegó a 868 MB y el tope de
memoria (1,5 GB con su swap) lo mató (`oom-kill`, 15:07). El banco ya cierra la instancia de OpenCode de cada carpeta al
terminar la tarea (H4), así que la memoria no debería crecer.

## Diagnóstico (sin gastar cuota: abrir y cerrar carpetas en un `opencode serve` aislado, sin llamar al modelo)
- Sin plugin: el servidor se queda en ~300 MB en 15 ciclos. Con el plugin: de 775 a 1.209 MB (~30 MB por carpeta).
- El plugin se evalúa una vez; `server()` corre una vez por carpeta y OpenCode llama a `dispose`. La memoria JavaScript del
  plugin no crece (probado en proceso con un OpenCode real).
- Lo que crece: tras `dispose`, el plugin sigue usando el cliente de esa carpeta. Cada llamada (`tui.showToast`,
  `provider.list`, ...) hace que OpenCode **vuelva a crear la instancia** de la carpeta, con un plugin nuevo que nadie
  cierra. En la prueba, el aviso de arranque de `auto-update-checker` (programado a los 5 s del primer
  `session.created`) disparó después del cierre: segunda instancia de cada carpeta y 50 avisos. Con ese hook apagado, el
  servidor se queda en ~440 MB.
- En el banco real pasó lo mismo con 3 carpetas (Prometheus cortado por tiempo: 1,4 s y 6,5 min después del cierre).
- Además, dos registros por carpeta no se liberan al cerrar: la ruta del servidor vivo (`live-server-route`, guarda el
  cliente) y el índice de conocimiento (`getKnowledgeService`, base SQLite abierta por carpeta).

## Arreglo
1. `shared/disposable-client.ts`: al arrancar, el cliente de la instancia recibe una valla en su `fetch`
   (`setConfig`). Tras `dispose`, toda petición falla con `PluginInstanceDisposedError` sin llegar a OpenCode (como un
   servidor caído, camino que el código ya maneja), y se registra la primera ruta bloqueada para saber quién llamaba. Si el
   cliente interno lo comparte otra instancia viva, no se pone valla (no se puede cortar a la otra) y se registra.
2. `dispose` en `create-plugin-module.ts`: primero el cierre normal (que aún puede usar el cliente), después liberar la
   ruta viva (`unregisterLiveServerRoute`) y el índice de conocimiento (`releaseKnowledgeService`), y al final cerrar la
   valla.
3. Banco (`run.ts`/`sandbox.ts`): entre tareas, si el servidor pasa de `OMO_BENCH_SERVER_RSS_MB` (900 por defecto), se
   reinicia, para que una fuga futura no corte una medición larga.

## Verificación
- Pruebas en rojo primero: valla (antes del cierre pasa, después rechaza sin llamar a `fetch`, cliente compartido sin
  valla), `dispose` del módulo (cierra la valla, libera ruta e índice), `live-server-route` (baja del registro),
  conocimiento (cerrar y olvidar), banco (lectura de RSS, decisión de reinicio).
- QA real: la sonda de abrir/cerrar 15 carpetas con el plugin arreglado; esperado: una sola instancia por carpeta en el
  log de OpenCode y memoria plana como sin plugin. Recuento de sesiones de la base real igual antes y después.

## Resultado (03-11-2026)
- Pruebas en rojo primero y luego en verde: 71/71 en los cinco archivos; carpetas afectadas (shared, testing,
  knowledge, plugin-dispose, perf, banco) 1.390/1.390 con `dist` construido; typecheck de raíz, scripts y paquetes en
  verde (los 4 errores de `omo-senpi` vienen de la doble ruta de `senpi-task` en la carpeta de trabajo, no del cambio).
- Sonda real (abrir y cerrar 15 carpetas en un `opencode serve` aislado, sin modelo):
  - plugin antiguo: 763 → 1.061 MB, 14 carpetas creadas dos veces;
  - plugin arreglado: 532 → 420 MB (plano), ninguna carpeta recreada, 15 peticiones bloqueadas (`/provider`, del
    aviso de arranque).
- Base real de sesiones: 550 antes y después.
- Segunda vuelta: el comprobador de actualizaciones (`auto-update-checker`) ya no ejecuta su comprobación diferida si la
  instancia se cerró (`dispose` cancela el temporizador y corta los pasos pendientes; `disposeCreatedHooks` lo llama).
  Prueba en rojo y luego en verde; 196/196 en los archivos tocados. Sonda real con la build final: 494 → 345 MB,
  ninguna carpeta recreada, 0 peticiones bloqueadas. Sesiones reales 550 → 550.
