# Pasos 4.21–4.23 y 4.4 — Sistema de adversarios (solo a petición del usuario)

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **decidido (03-10-2026)**; se diseña en detalle en cada paso.
Rutas: `S/` = `packages/omo-opencode/src/`.

## Petición del usuario (03-10-2026)
- Un sistema de adversarios en OpenCode: agentes que atacan el trabajo de otros.
- **Regla del usuario (precisada, 03-10-2026):** el agente orquestador **recomienda** un adversario cuando ve que
  ayudaría, **explicando por qué** (y qué cuesta); **la decisión es siempre del usuario**. Se obliga por código.
- **Medir la eficacia** del sistema, como todo lo que se hace en el fork.

## Evidencia (`[V]` = fuente primaria, `[S]` = resumen secundario)
- **El debate libre no compensa:** casi toda la ganancia del debate viene de votar (Choi et al., NeurIPS 2025,
  arXiv 2508.17536) `[V]`; no supera de forma fiable a la autoconsistencia y cuesta más (Smit et al., ICML 2024,
  arXiv 2311.17371) `[V]`; los agentes cambian respuestas correctas por presión del grupo (arXiv 2509.05396) `[V]`.
- **Sin señal externa no hay autocorrección** (Huang et al., ICLR 2024, arXiv 2310.01798) `[V]`; con herramientas sí
  (CRITIC, arXiv 2305.11738) `[V]`.
- **Los críticos inventan fallos** (CriticGPT, arXiv 2407.00215) `[V]`; la crítica de código de modelos medianos o
  pequeños está cerca del azar en algunas tareas (CriticBench, arXiv 2402.14809) `[S]`.
- **En software funciona el adversario ejecutable:** Meta ACH, tests guiados por mutantes, aceptados el 73 %
  (arXiv 2501.12862) `[V]`; TestGen-LLM con filtros duros (arXiv 2402.09171) `[V]`; CodeT +18,8 puntos
  (arXiv 2207.10397) `[V]`; Agentless y CodeMonkeys eligen parches con tests de reproducción (arXiv 2407.01489,
  2501.14723) `[V]`; el crítico de OpenHands sube de 60,6 % a 66,4 % pero tuvo que entrenarse `[V]`.
- **Pre-mortem:** imaginar que el plan ya fracasó mejora la identificación de causas en ~30 % `[S]`.

## Principio
El adversario **produce evidencia y nunca decide**. Solo un agente de tab lo llama, y solo con el sí del usuario.
Decide el código (ejecución, tests); lo que quede dudoso, el usuario.

## Roles (agentes de "@", atómicos, cada uno con su paso)
- **4.21 `@breaker`:** recibe el cambio, el comportamiento esperado y el comando de tests; devuelve ≤3 ataques, cada
  uno un test o script. Por código: debe ejecutarse y **fallar** sobre el código arreglado (2–3 repeticiones para
  descartar tests inestables); sin script → descartado; sus tests quedan protegidos por el guardián de 0.9a; uno se
  guarda oculto como control para que no se arregle solo el caso exacto.
- **4.22 `@mutant`:** mete 3–5 fallos pequeños en las líneas cambiadas, ejecuta los tests e informa de los que nadie
  detecta (faltan tests). Lo decide el código; los fallos se deshacen por código.
- **4.23 `@plan-attacker`:** pre-mortem de los planes de Prometheus: supone que el plan fracasó y da ≤5 causas con
  citas concretas (`archivo:línea`, paso que falta, criterio sin test), comprobadas por código. Prometheus responde a
  cada una: resuelto (con el cambio), rechazado (con motivo) o pregunta al usuario. Una ronda.
- **4.4 desafío de afirmaciones** (modo de `@verifier`, no agente nuevo): cada "hecho"/"arreglado" se reproduce con un
  comando y su salida; si no, se rechaza.

## Por código (todos)
- **Recomienda el agente, decide el usuario:** el orquestador conoce los adversarios y, cuando aplica (arreglo de un
  fallo delicado, cambio sin tests, plan grande), los recomienda con la herramienta `question`: qué adversario, **por
  qué** en este caso, qué coste aproximado, y opciones "Sí, lánzalo" / "No". El plugin rechaza un encargo a un
  adversario salvo que el usuario haya respondido que sí a esa recomendación o lo haya pedido él (comando, p. ej.
  `/adversary breaker`, o petición explícita).
- Formato fijo de hallazgo `{afirmación, archivo, comando, esperado, observado}`; sin archivo o comando, descartado.
- Topes: ataque ↔ arreglo, 2 ciclos; ataque al plan, 1 ronda. Al tope con fallos abiertos → pregunta al usuario con la
  evidencia (encaja con el freno de bucles de 0.9b). Nunca se para por "acuerdo".
- Si se puede, el adversario usa otro modelo que el generador (se mide en el banco).

## Descartado (con motivo)
- Debate libre entre agentes; revisión adversaria de opinión ("busca problemas") sin ejecución; un modelo como juez
  final; juegos de muchos personajes (equipo rojo/azul): más coste y ruido que señal con modelos gratuitos.
- Ideas de entrenamiento (juegos prover–verifier, críticos entrenados): necesitan ajuste fino.

## Medición (banco 3.0)
- **Recomendaciones:** cuántas hace el agente, cuántas acepta el usuario y cuántas de las aceptadas encontraron un
  fallo real (precisión de la recomendación); también fallos que se escaparon sin recomendación.
- **Eficacia:** con y sin cada adversario sobre las mismas tareas: fallos reales detectados, ataques válidos, falsos positivos,
tareas resueltas con tests ocultos, regresiones y coste. Se queda si mejora más por token que la alternativa barata:
2–3 soluciones elegidas con tests.
