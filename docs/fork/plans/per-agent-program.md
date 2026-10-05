# Fases 3–5 — Banco de pruebas, especialistas uno a uno y evaluación conjunta

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **plan aprobado (01-10-2026)**. Rutas: `S/` = `packages/omo-opencode/src/`.

## Por qué así
- Mejorar un agente sin medirlo es adivinar. Anthropic recomienda empezar con 20–50 tareas sacadas de fallos reales,
  corregir primero con comprobaciones por código y mirar el **resultado en el entorno**, no lo que el agente dice que hizo
  (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
- Herramientas y prompts se mejoran iterando con evaluaciones y un conjunto **reservado** para no sobreajustar
  (https://www.anthropic.com/engineering/writing-tools-for-agents).
- Primero el análisis de errores: leer trazas, anotar fallos y agruparlos en categorías; evaluaciones binarias
  (pasa/no pasa); validar los jueces LLM contra etiquetas humanas (https://hamelhusain.substack.com/p/evals-faq).
- En sistemas con varios agentes hay que medir si se delega en el agente correcto
  (https://developers.openai.com/api/docs/guides/evaluation-best-practices).
- Los subagentes se usan dentro de flujos largos: importa la fiabilidad (`pass^k`: todas las repeticiones bien), no solo
  `pass@k`.

## Fase 3 — Banco de pruebas (3.0)
> **Actualizado 01-10-2026:** se construye un banco **propio en Bun** en vez de promptfoo, con los modelos de
> `/omo-models` (cualquier proveedor). Diseño y motivo: `plans/test-bench.md`. Lo de abajo es el planteamiento original.

- **promptfoo** (MIT, TypeScript; https://www.promptfoo.dev/docs/providers/custom-api/) con un proveedor propio que:
  - levanta un OpenCode aislado por ejecución (XDG propio, como en las QA de este fork);
  - prepara un repo de prueba;
  - envía la tarea por el SDK y devuelve salida, tokens y la transcripción.

  No se usa `opencode run`: no ejecuta subagentes como agente principal y tiene fallos en modo sin interfaz.
- **Correctores deterministas comunes:**
  - contrato de salida (`<report>` con Resumen/Resultado/Fuentes);
  - herramienta obligatoria usada y herramienta prohibida no usada (desde los mensajes de la sesión);
  - **citas que existen**: `archivo:línea` contra el disco, URL contra la red y versión contra el registro;
  - tokens, latencia, llamadas y turnos.

  Juez LLM binario solo para lo que el código no puede comprobar, validado con 30–50 casos etiquetados a mano.
- Repeticiones: 3–5 por tarea (`--repeat --no-cache`), informando `pass@1` y `pass^3`.
- Registro de resultados en `docs/fork/evals/<agente>.md` (resumen) + datos locales en `.omo/evals/`.
- Modelos: Ollama para iterar; el plan gratuito de OpenCode para las mediciones finales; límites de tokens y turnos por
  tarea. Coste: 0 €; el límite real es el tiempo y los límites de uso de los modelos gratuitos.
- Inspect AI (con su agente `opencode()` en Docker) queda como opción para la Fase 5 si promptfoo se queda corto.

## Fase 4 — Plantilla para cada especialista
- **Ficha obligatoria** (usuario, 05-10-2026): `docs/fork/agents/<agente>.md` con estructura, funcionamiento y pruebas
  con resultados como evidencia (plantilla en `docs/fork/agents/README.md`).
**Regla de arquitectura (usuario, 03-10-2026):**
- solo los agentes de tab (Sisyphus, Hephaestus, Atlas, Prometheus) orquestan;
- los de "@" son atómicos: resuelven un problema concreto y **nunca delegan**;
- cada agente de "@" tiene **su propio paso** (4.2a … 4.18) con esta plantilla;
- el último paso, 4.19, fija por código qué agentes de "@" debe usar cada agente de tab, con lo medido en cada paso.

1. **Investigar:** prompt y herramientas actuales, cómo lo hacen agentes comparables. Ya hay base en
   `plans/specialists-research.md`.
2. **Contrato:** qué hace, entradas, salida, herramientas obligatorias y prohibidas, cuándo para.
3. **Tareas:** 15–30, variando el tipo de tarea, el tamaño del repo y el lenguaje; 30 % reservado que nunca se mira
   al ajustar.
4. **Medición base:** 3–5 repeticiones en el modelo gratuito objetivo.
5. **Análisis de fallos:** leer las transcripciones, anotar y agrupar, y localizar dónde se tuerce cada una.
6. **Mejoras:** una por iteración (prompt, descripción de herramientas, permisos, contexto que recibe), de 2 a 4.
7. **Nueva medición** en el conjunto de trabajo y en el reservado.
8. **Evidencia** antes/después en el plan del paso; los casos que pasan entran en la suite de regresión.

Orden (impacto × riesgo): 4.1 `explore` → 4.2 `librarian` + `api-lookup` → 4.3 `memory` → 4.4 `verifier` →
4.5 `rules-checker` (+ guardián de reglas) → 4.6 `security-reviewer` (+ credenciales) → 4.7 `test-writer` →
4.8 `debugger` → 4.9 `git-committer` → 4.10 `dependency-check` → 4.11 revisores de tests/lenguaje/arquitectura →
4.12 `docs-writer` → 4.13 `ui-tester` → 4.14 implementadores (+ skills por categoría, procesos gestionados) →
4.15 `multimodal-looker`, `metis`, `momus`, `oracle` → 4.16 orquestadores (+ enrutamiento obligatorio por código).

Estimación: 1,5–3 días por paso; 7–10 semanas a tiempo parcial en total.

## Fase 5 — Evaluación conjunta (5.1)
> **Requisito del usuario (02-10-2026):** la prueba final usa el proyecto real
> `/mnt/datos/emanuel/Programacion/codegenerator/`. Es un generador de código en Python, hexagonal y con plugins
> (pluggy), que a partir de un JSON crea un backend o un frontend sin IA.
> - Las pruebas las hace **OpenCode con este plugin a partir de prompts**, como un usuario que pide una
>   funcionalidad; nunca código escrito por el asistente.
> - Cada agente y cada función del fork debe quedar cubierto por al menos un prompt (matriz de cobertura).
> - **Decisiones del usuario (02-10-2026):**
>   - **Copia aislada** fijada en el último commit (`649fcd7`). El repo del usuario no se toca y sus cambios sin
>     commitear no entran. Lo que salga bien se le ofrece como rama para revisar.
>   - **También por agente:** cada paso de la Fase 4 añade a su banco 2–3 prompts reales sobre esa copia.
>   - **Agentes que falten:** si en la prueba (final o por agente) se ve que en la vida real hace falta un
>     especialista que no existe, se registra con su evidencia (qué prompt, qué falló o qué hizo a mano el
>     orquestador) y **se propone al usuario para diseñarlo juntos**. Nunca se crea sin su aprobación.
>   - **Correctores ocultos** que el agente no ve:
>     - generar con un JSON de prueba y comprobar el proyecto generado;
>     - `pytest` y `ruff`;
>     - la regla de dependencias hexagonal comprobada por código;
>     - en qué especialistas delegó y con qué identidad hizo commit.

- 15–30 tareas completas, en tres tipos:
  - repos pequeños con tests que fallan (estilo SWE-bench, o 10–20 de SWE-bench Verified-mini);
  - investigación;
  - documentación y commits.
- Métricas:
  - éxito por tests ocultos;
  - `pass^3`;
  - enrutamiento correcto: precisión y cobertura de "delegó en el especialista esperado";
  - tokens totales;
  - datos perdidos tras compactar;
  - dónde falla cada tarea.
- **Ablación**: cambiar cada especialista mejorado por su versión base para ver qué aportó cada cambio.

## Criterios de aceptación
```gherkin
Feature: programa por agente
  Scenario: banco de pruebas reproducible
    Given el banco de pruebas y un repo de prueba
    When se ejecuta la suite de un especialista con --repeat 3
    Then se obtienen pass@1, pass^3, tokens y citas verificadas por código, sin tocar la configuración real del usuario
  Scenario: mejora demostrada
    Given un especialista estudiado
    Then su plan registra la medición base y la final en el conjunto reservado
  Scenario: enrutamiento medido
    When se ejecuta la evaluación conjunta
    Then se informa la precisión y cobertura de delegación por especialista
```
