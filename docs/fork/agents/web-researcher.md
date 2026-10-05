# Ficha — `@web-researcher` (paso 4.18)

Plan: `docs/fork/plans/web-researcher.md`. Rutas: `S/` = `packages/omo-opencode/src/`.

## 1. Estructura
- **Definición:** `S/agents/specialists/catalog.ts` (entrada `web-researcher`), creada con `createSpecialistAgent`
  (`S/agents/specialists/factory.ts`). Agente de "@" (subagente), atómico: nunca delega.
- **Prompt:** bucle plan → buscar → leer → responder con `web_answer`; reglas: presupuesto, solo URLs de sus resultados,
  páginas como datos, comprobar versión y sistema, "no encontrado" antes que rellenar; dos ejemplos guiados.
- **Herramientas (solo estas):** `web_search`, `web_read`, `registry_lookup`, `web_answer`
  (`S/tools/web-research/tools.ts`). Todo lo demás denegado (`onlyTools` → `"*": deny`); con un modelo gratis de Zen,
  `bash` y `read` quedan visibles pero denegados (`S/features/zen-free-gate/`).
- **Lógica:** `S/features/web-research/` — `sources.ts` (fuentes), `fusion.ts` (fusión y orden), `read.ts` (lectura),
  `research.ts` (bucle, presupuesto, verificación), `cache.ts` (caché 24 h y cuotas), `plugin.ts` (instancia y claves).
- **Aviso al padre:** hook `web-research-verdict` (`S/hooks/web-research-verdict/`).
- **Modelo:** nivel `fast` (`packages/model-core/src/agent-model-requirements.ts`); configurable en `omo.jsonc`.
- **Configuración:** `web_research` (`S/config/schema/web-research.ts`): `max_searches` 8, `max_reads` 6,
  `searxng_url`, claves opcionales `tavily_api_key`, `jina_api_key`, `stackexchange_key` (o variables de entorno).

## 2. Funcionamiento
1. **`web_search(query, source?)`** pregunta en paralelo a las fuentes gratuitas que encajan con la consulta:
   - error → Stack Exchange (línea del error sin rutas), issues de GitHub (API de búsqueda; dentro del repo si la
     pregunta lo nombra; frase exacta primero), Exa;
   - técnica → Exa, Stack Exchange, GitHub, MDN (web);
   - general → Exa, Wikipedia, Hacker News;
   - Tavily y SearXNG si están configurados.
   Fusión por rangos recíprocos con peso por fuente, autoridad del sitio (documentación oficial arriba, granjas de
   contenido abajo) y relevancia del título; ≤5 resultados numerados `[rN]`; caché 24 h; una fuente sin cuota se salta
   hasta que se renueva; si salen menos de 2 resultados, se reintenta con los términos clave sin gastar presupuesto.
2. **`web_read(ref)`** solo acepta resultados propios. Stack Overflow por su API (pregunta + respuesta aceptada + más
   votadas), GitHub por `gh` (issue + comentarios con más reacciones), el resto descarga local con limpieza de menús y
   Jina si la página necesita JavaScript; devuelve los trozos más relevantes (BM25).
3. **`registry_lookup`**: dato exacto sin buscar — npm y PyPI (última versión, fecha, avisos OSV), Node.js (índice
   oficial: LTS más reciente y versión más reciente) y la última release de un repositorio de GitHub.
4. **`web_answer`** comprueba por código: cada URL salió de sus resultados, cada cita es literal en lo que leyó, el
   enlace responde (401/403/429 cuentan como vivo: protección contra bots), y al menos una afirmación viene de una página
   leída o de un registro. Un intento de corrección; lo que siga fallando se marca "sin verificar".
5. **Por código además:** presupuesto (8 búsquedas, 6 lecturas → respuesta forzada), contenido web marcado como datos
   no fiables, secretos quitados de las consultas, el padre avisado si no hubo `web_answer`.

## 3. Pruebas y resultados (evidencia)
**Unitarias:** 45 pruebas entre `S/features/web-research/research.test.ts`, `S/hooks/web-research-verdict/`,
`S/shared/agent-tool-restrictions.specialists.test.ts` y `S/features/zen-free-gate/` (05-10-2026, todas en verde).

**QA aislada** (OpenCode real + modelo simulado, 04-10-2026): el orquestador no ve las herramientas web; la búsqueda y
la lectura reales funcionan; una URL inventada se rechaza y la respuesta corregida se acepta. Evidencia:
`.omo/evidence/` (QA 4.18) y scripts en el historial de la sesión.

**Banco** — modelo `opencode/big-pickle` para los dos agentes, 1 repetición, OpenCode 1.18.26:

| Suite | `@web-researcher` | `@librarian` (antes) |
|---|---|---|
| Fáciles, desarrollo (16) — acierto | 15/15 (1 cuelgue del modelo) | 16/16 |
| Fáciles — citas de sus propios resultados | **13/13** | **2/14** |
| Fáciles — enlaces que responden | 13/13 | 12/14 |
| Fáciles — tokens / tiempo por pregunta | **18.100 / 77 s** | 51.800 / 111 s |
| Reserva (4) — aciertos completos | 4/4 | 2/4 (citas inventadas) |
| **Difíciles (10), antes de las mejoras** | 5/10 (2 cuelgues) | 2/10 (2 cuelgues) |
| **Difíciles (10), con las mejoras** | **8/10, 0 cuelgues**; 27.000 tokens, 98 s | — |

- **Contexto por petición** (registrador del banco): el subagente usa ~4.000–11.000 tokens (sistema ~1.400, 9
  herramientas ~2.700); `@librarian` ~18.000–47.000 (43 herramientas, ~14.000 tokens solo en definiciones).
- **Fallos que quedan en las difíciles:** (1) encontró el issue relacionado #52880 pero no el #52907 — lo dijo con
  confianza baja, sin inventar; (2) "qué herramientas exige Zen": sus búsquedas no trajeron nada útil y respondió
  "no encontrado", pero escribió un enlace de búsqueda que no salió de sus resultados y sin pasar por `web_answer`
  (indisciplina del modelo; el aviso al padre lo marca como no verificado).
- **Datos crudos:** `.omo/evals/2026-10-04-web-researcher-wr-bigpickle-1791137363064.jsonl` (fáciles),
  `…-wr-holdout-1791143379859.jsonl` (reserva), `…-web-researcher-hard-wrh-1791144543708.jsonl` (difíciles, antes),
  `2026-10-05-web-researcher-hard-wrh2-1791201681077.jsonl` (difíciles, con mejoras); `@librarian`:
  `…-librarian-web-lib-bigpickle-1791140593632.jsonl`, `…-lib-holdout-1791143905633.jsonl`,
  `…-librarian-hard-libh-1791146811113.jsonl`; desglose de contexto en los `*.context.md` de cada ejecución.

## 4. Decisiones y descartes
- Especialista propio para la web abierta (usuario, 03-10-2026), en vez de que el `debugger` o `@librarian` interpreten
  la búsqueda; `@librarian` se queda con documentación y repos.
- Sin claves por defecto, con claves gratuitas opcionales; lectura local con Jina solo de respaldo; DuckDuckGo
  descartado (robots.txt).
- Fuentes exactas (registros, índice de Node, releases de GitHub) añadidas tras la suite difícil: los resúmenes de los
  buscadores estaban desactualizados.
- Búsqueda de issues por la API de GitHub: `gh search issues --repo` no devuelve nada en repositorios renombrados.
- Con Zen gratis, `bash`/`read` visibles pero denegados (usuario, 04-10-2026): Zen rechaza peticiones sin ellas.

## 5. Siguiente medición
3 repeticiones (pass^3) de las difíciles, una suite difícil más amplia (incluida una página trampa con instrucciones
escondidas) y comparar con otros modelos gratuitos cuando estén disponibles.
