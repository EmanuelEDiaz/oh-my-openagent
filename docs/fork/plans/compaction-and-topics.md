# Paso 0.17 — Compactación sin bucles (0.17a) y varios temas por conversación (0.17b)

Parte del roadmap: `docs/fork/roadmap.md` (fila 0.17). Estado: **investigación hecha y dirección aprobada (05-10-2026)**;
el plan detallado se escribe al llegar el paso (0.17a tras 0.16 y antes de 0.13; 0.17b después de 0.13).
Rutas: `S/` = `packages/omo-opencode/src/`. `[nv]` = sin verificar.

## Causa de los bucles (OpenCode v1.18.26)
- Umbral: `usable = limit.input − min(20k, salida máx.)` contra tokens **totales** (`session/overflow.ts:10-33`).
- Tras compactar queda: base fija (~79k sistema + herramientas en este entorno) + cola reciente `min(15k, 25 % usable)`
  + resumen + "Continue…" (`compaction.ts:32-33,115-119,519-547`). Si eso supera `usable`, vuelve a compactar sin
  contador ni comprobación (`prompt.ts:1161-1167`, `processor.ts:491-496`). Issues #48827, #27924, #48847 (abiertas),
  #52697; PR #50233 (abierta): guarda los tokens que dispararon la compactación y, si el primer paso medido después
  sigue igual o por encima, lanza `ContextOverflowError` en vez de compactar otra vez.
- Poda de salidas viejas apagada por defecto (`compaction.ts:275`); constantes fijas `PRUNE_PROTECT` 40k y
  `PRUNE_MINIMUM` 20k, inasumibles en ventanas de 64k.
- La petición de resumen no tiene presupuesto ("Session too large to compact", #48844).
- **Nuestro plugin:** segundo disparador al 78 % de entrada+caché (otra medida), se rearma en cada paso, solo marca
  compactado si el resumen acaba en 60 s (`S/hooks/preemptive-compaction*.ts`); el monitor de degradación añade hasta
  3 resúmenes; los inyectores de reglas/AGENTS.md/README se reinician tras compactar y vuelven a inflar.

## Sistemas homólogos (verificados en fuente, 05-10-2026)
- **Gemini CLI** (`chatCompressionService.ts`): umbral 0,5; conserva el 30 % más nuevo; salidas viejas con
  presupuesto de 50k, recortadas a sus últimas 30 líneas y **guardadas en archivo**; protege los 3 últimos turnos y las
  herramientas de lectura; **bandera pegajosa**: si un resumen infla, desde entonces solo recorta; el resumen nuevo
  **fusiona** el anterior (`<state_snapshot>`). `/chat save|resume <tag>`: puntos de guardado con nombre.
- **Codex CLI:** límite `min(config, 90 % ventana)`; conserva los mensajes del usuario literales hasta 20k; si el
  propio resumen desborda, quita el elemento más viejo y reintenta; **sin guardia de bucle**; salidas cortadas por el
  medio (cabeza + cola, 10 kB).
- **Claude Code:** tras compactar relee ≤5 archivos recientes (≤5k cada uno) y skills ≤5k; salidas de bash >30k
  caracteres a archivo + vista previa de 2k. API: `clear_tool_uses` (`trigger` 100k, `keep` 3, `clear_at_least`,
  `exclude_tools`).
- **Cline:** primero quita lecturas duplicadas de archivos; si eso ahorra ≥30 %, no recorta más; si no, descarta la
  mitad (o ¾). `/newtask` traspasa a una tarea nueva; Memory Bank (`activeContext.md`, `progress.md`).
- **Roo Code:** si condensar falla, oculta (no borra) el 50 % de los mensajes; no condensa si no hubo nada nuevo.
- **Goose:** umbral 0,8; estrategias resumir/recortar/limpiar/preguntar; comprobar solo entre turnos dejó desbordar un
  bucle de 30 herramientas (#11072, arreglado en #12444).
- **Aider:** resumen recursivo de la cabeza, profundidad máx. 3.
- **Investigación:** JetBrains "The Complexity Trap" (arXiv 2508.21433): **ocultar salidas viejas** (últimos 10 turnos
  intactos) cuesta la mitad e iguala o mejora al resumen con LLM; el resumen alarga las ejecuciones un 15 %; el híbrido
  ahorra otro 7–11 %. OpenHands: resumir 54 % vs 53 % sin, hasta 2× más barato por turno.

## Mejoras a tomar (0.17a, por valor/coste, todo gratis)
1. Comprobar el **resultado real** en el primer paso medido tras compactar (como #50233) + bandera pegajosa (Gemini):
   una compactación que no reduce o infla pasa la sesión a solo recortar.
2. **Ocultar salidas viejas antes de resumir** (Cline + JetBrains): si libera ≥30 % de lo necesario, no se resume.
   Se ocultan con puntero recuperable (archivo + vista previa cabeza/cola), nunca se borran; exentas las de lectura y
   búsqueda; mínimo liberado por limpieza para no romper la caché por poco.
3. **Suelo calculado:** sistema + herramientas + tope de resumen + cola mínima + reinyecciones > usable → no compactar,
   ir directo a la escalera.
4. Escalar al tamaño de ventana las constantes fijas (cola, protección de poda); **presupuesto de reinyección** tras
   compactar (reglas, AGENTS.md, skills con tope cada una, como Claude Code).
5. Presupuesto para la petición de resumen (historia recortada o quitar lo más viejo y reintentar).
6. Resumen anclado que fusiona el anterior; sin llamada extra de comprobación (gasta cuota gratis).
7. Comprobar también a mitad de turno tras resultados de herramientas (Goose #11072).
8. Un solo umbral alineado con `usable()`; tope de 2 compactaciones por mensaje y 3 cada 10 min; después parar,
   preguntar y ofrecer traspaso a una sesión nueva.

## Varios temas (0.17b)
Ningún homólogo detecta temas solo; lo más cercano: puntos de guardado con nombre (Gemini), `/rename`+`/resume`
(Claude Code), Memory Bank y `/newtask` (Cline), bloques de memoria con límite (Letta), hilos con `thread_id` (LangGraph).
Mem0 (cifras del propio vendedor) y Graphiti (necesita Neo4j + OpenAI) descartados por peso/coste. Embeddings
all-MiniLM ONNX: 23 MB cuantizado; RAM en uso `[nv]` → solo si la medición lo justifica.

**Diseño elegido (usuario, 05-10-2026): automático + `/tema`**, con estas mejoras:
1. Ficha por tema como bloque con límite de caracteres; índice de una línea solo de los N temas recientes.
2. Detección por capas: `/tema` y frases ("volvamos a", "otra cosa") → BM25 (FTS5) contra las fichas + archivos en
   común → preguntar solo si es ambiguo. Un mensaje puede tocar varios temas.
3. Mensajes del usuario de cada tema literales hasta un tope; "volvamos a X" los recupera por puntero.
4. Al cambiar de tema, ocultar las salidas de herramientas del tema anterior (enlaza con 0.17a).
5. Secciones por tema en el resumen anclado.
6. La ficha del tema activo va **al final** (no en el prefijo del sistema) para no romper la caché.
7. Comprobar antes que OpenCode conserva en su base los mensajes compactados (si no, los punteros se rompen) `[nv]`.

## Medición
Compactaciones por mensaje, recorte por compactación, entrada del primer paso tras compactar frente a `usable`, pasos
hasta la siguiente compactación, recuerdo de restricciones (banco de 1.6), acierto de asignación de temas y recuerdo
al volver a un tema. Casos difíciles: modelo de 64k, una salida de 40k, resumen que desborda, 4 temas mezclados.
