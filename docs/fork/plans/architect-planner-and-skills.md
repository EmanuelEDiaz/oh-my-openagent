# Planificador como arquitecto, especialistas con skills y choques de skills (ideas del usuario, 07-10-2026)

Estado: **investigación hecha (07-10-2026)**; propuesta pendiente de aprobación. `S/` = `packages/omo-opencode/src/`.

## Lo que hay hoy (verificado en el código)
- Prometheus ya funciona con un skill: su prompt (`packages/prompts-core/prompts/prometheus/default.md`, ~190 palabras)
  solo dice "carga `ulw-plan`"; el flujo real está en `packages/shared-skills/skills/ulw-plan/` (SKILL.md ~2,1k
  palabras + referencias ~3,9k + plantillas `scripts/plan-templates.mjs`).
- La plantilla actual (`plan-templates.mjs:68-174`) tiene borrador (usuario afectado, estado ideal, componentes,
  supuestos, hallazgos citados, decisiones, alcance, preguntas, aprobación) y plan (TL;DR, imprescindibles / prohibidos,
  verificación, oleadas, dependencias, tareas `- [ ] N.` con aceptación, verificación final, commits, criterios de
  éxito). **Faltan:** IDs de requisitos, requisitos no funcionales, historias de usuario y la traza
  requisito → tarea → prueba.
- Prometheus solo puede delegar en explore, librarian, metis, momus y oracle (`ulw-plan/SKILL.md:85-93`): habría que
  añadir `@explainer` y `@plan-attacker`.
- **Los `skills:` de la configuración de un agente se cargan siempre** (`S/agents/agent-skill-resolution.ts:16-25` los
  antepone al prompt): para ahorrar contexto, el especialista debe llamar a la herramienta `skill` cuando lo necesite.
- Precedencia de skills por ámbito: proyecto `.opencode/skills` > config de OpenCode > usuario > integrados
  (`S/features/opencode-skill-loader/AGENTS.md`).

## Sistemas homólogos (qué tomar)
1. **spec-kit (GitHub):** marcas `[NEEDS CLARIFICATION]` en vez de suponer; "constitución" como puerta no negociable;
   `/analyze` de solo lectura que mapea tareas ↔ requisitos y marca cobertura cero como crítica.
2. **OpenSpec:** cambios como *deltas* (AÑADIDO / MODIFICADO / ELIMINADO) que se fusionan al archivar: cambiar a mitad
   sin rehacer el plan.
3. **Kiro (AWS):** requisitos EARS ("CUANDO… EL SISTEMA DEBERÁ…"), cada tarea cita sus requisitos, aprobación tras cada
   fase, volver a una fase anterior si aparecen huecos, una tarea cada vez, Mermaid en el diseño.
4. **mattpocock/skills:** entrevista "grilling" (todas las preguntas abiertas de una ronda, numeradas y cada una con
   respuesta recomendada; los hechos los buscan subagentes, las decisiones las toma el usuario); tickets "tracer
   bullet" con dependencias; glosario + ADR; mapa de decisiones para esfuerzos enormes.
5. **BMAD:** propuesta de cambio con impacto en PRD/arquitectura/épicas; documentos troceados por secciones; revisión
   de preparación antes de implementar; profundidad según tamaño. (Sus muchas personas gastan demasiados tokens: no.)
6. **Taskmaster:** análisis de complejidad → solo se detallan las tareas complejas `[nv]`.
7. **Calidad de requisitos:** EARS, ISO/IEC 25010 para los no funcionales, INVEST para historias, Gherkin para
   aceptación, ADR para decisiones, matriz de trazabilidad.
- **Prompts filtrados** (x1xhlol/system-prompts-and-models-of-ai-tools): solo técnicas de alto nivel; **no se copia
  nada** (son prompts propietarios filtrados; la licencia del repositorio no cubre los derechos de los autores).
- **Dato medido por terceros:** Vercel vio que un skill no se invocó en el 56 % de sus pruebas; un índice de 8 KB en
  AGENTS.md acertó el 100 % y los skills como mucho el 79 % (vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
  → hay que medirlo con nuestros modelos gratuitos.

## Propuesta
### (a) Plan de arquitecto (amplía `ulw-plan`, no lo sustituye)
- **Dos tamaños decididos por código:** *ligero* (≈1 archivo, sin comportamiento nuevo para el usuario: objetivo,
  requisitos, tareas, QA) y *completo*.
- **Completo, troceado en `.omo/plans/<slug>/`** (los agentes leen solo la parte que necesitan):
  1. `study.md` — contexto, estado ideal, hallazgos citados, restricciones, **opciones** (las presenta `@explainer`:
     2–3 variantes con diagrama, pros/contras y recomendación; la elegida se vuelve ADR).
  2. `requirements.md` — `FR-n` en EARS; `NFR-n` con su característica ISO 25010 y un umbral medible; historias `US-n`
     ("Como… quiero… para…", INVEST) con criterios `AC-n.m` en Gherkin; `[NEEDS CLARIFICATION: …]` en vez de suponer.
  3. `design.md` — componentes, datos, contratos y `ADR-n` (cada uno cita los FR/NFR que cumple).
  4. `tasks.md` — la gramática actual `- [ ] N.` más `Covers: FR-2, NFR-1, AC-2.1`, `Verify: <comando>`,
     `Depends: 3`; orden por cortes verticales ("tracer bullet"), refactor previo primero.
  5. **Matriz de trazabilidad generada por código** y validador `plan_check`: falla si un requisito no tiene tarea, una
     tarea no tiene requisito, un AC no tiene `Verify`, un NFR no tiene umbral o queda un `[NEEDS CLARIFICATION]`.
- **Cambiar a mitad:** todo tiene ID estable ("no me gusta US-3") → `changes/CR-n.md` con delta (AÑADIDO / MODIFICADO /
  ELIMINADO); **el impacto lo calcula el código** desde la matriz (historias, tareas, pruebas, ADR y tareas hechas que
  hay que reabrir); `@explainer` muestra las opciones del cambio; el usuario aprueba; se revalida la matriz. La
  fidelidad al plan (4.16) se mide contra los IDs.
### (b) Todos los agentes con skills bajo demanda (regla 16)
Aplica a los agentes de tab (en 0.13) y a cada especialista (en su paso de la Fase 4), siempre medido antes y después.
Prompt base corto (identidad, permisos, formato de salida, reglas NUNCA; ≤ ~300 palabras) + skills que el especialista
carga con la herramienta `skill` cuando los necesita: Prometheus (referencias EARS / 25010 / cambios solo en planes
completos), `@explainer` (reglas de diagramas), `@plan-attacker` (pre-mortem), `test-writer`/`verifier` (TDD,
Gherkin → prueba), revisor de arquitectura (ADR + 25010), revisor de seguridad (OWASP por stack).
### (c) Contra skills ignorados o en choque (por valor)
1. **Enrutado por código:** el plugin decide qué skill aplica (agente + tamaño del plan + archivos + palabras clave) e
   inyecta "carga el skill X ahora" o lo precarga; los skills de flujo no se dejan a la elección del modelo.
2. **Precedencia en una línea al cargar:** reglas del proyecto / AGENTS.md > skill del proyecto > skill del plugin >
   prompt base.
3. **Detector de choques al cargar** (4.20): compara lo que pide el skill (editar, bash, delegar) con los permisos y
   las reglas NUNCA del agente; avisa al agente y al usuario; también skills con descripciones solapadas.
4. **Medir el disparo** (método del skill-creator de Anthropic: 20 consultas, 8–10 que deben disparar y 8–10 casi
   iguales que no, 3 repeticiones, 60/40 entrenamiento/reserva) y la **obediencia** (reglas seguidas con y sin el skill).
5. **Recibos:** `@verifier` comprueba en el registro que los skills "obligatorios" se cargaron; si no, es una desviación.
