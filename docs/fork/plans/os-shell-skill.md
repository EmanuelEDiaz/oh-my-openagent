# 0.24 — Skill de sistema operativo para los modelos

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **en el plan (19-10-2026)**, se hace junto a 0.11.

## Petición del usuario (19-10-2026)
"Una skill o agente o lo que sea que enseñe a usar Mermaid, a moverse en Windows o Linux también sería necesario."
(Mermaid va en 0.19: `plans/explainer-and-mermaid.md`.)

## Crítica
- **Bien:** los modelos mezclan órdenes de bash y de PowerShell, rutas con `/` y `\`, comillas que cada terminal trata
  distinto, y formas de parar procesos que no existen en el otro sistema. Cada error cuesta turnos y contexto.
- **Skill, no agente:** es conocimiento, no una tarea. Un agente añadiría una delegación por cada orden de terminal.
- **Distinto de 0.11:** 0.11 hace que el código del plugin funcione en los dos sistemas; esta skill enseña a los modelos.
- **Riesgo de contexto:** una skill de los dos sistemas a la vez duplica el coste. Por eso el código carga solo la parte
  del sistema en uso.

## Diseño
- Skill en `packages/shared-skills/skills/`, una parte por sistema: Linux/bash, Windows/PowerShell (y macOS si sale
  barato). Contenido: equivalencias de órdenes frecuentes, rutas y separadores, comillas y escapes, variables de
  entorno, finales de línea, parar procesos (enlaza con 0.21: solo los propios), gestores de paquetes, permisos.
- **El código decide** (regla 16): con `process.platform` elige la parte; se carga cuando un agente va a usar la
  terminal por primera vez en la sesión, o cuando un comando falla con un error típico de sistema equivocado.
- Se comprueba por código que la skill se cargó.

## Medición
- Tareas del banco con órdenes de terminal: acierto, turnos, errores de orden equivocada y contexto añadido, con y sin
  la skill.
- Linux se mide aquí. Windows, en el CI de Windows: no hay equipo Windows en esta máquina, y la evidencia lo dice así.

## Criterios (Gherkin)
- Dado Windows, cuando un agente va a usar la terminal, entonces se carga solo la parte de Windows.
- Dado un comando que falla con "no se reconoce como comando", entonces el agente recibe la sugerencia de cargar la
  parte de su sistema.
- Dado el banco, cuando se compara con y sin la skill, entonces el informe da errores de orden equivocada, turnos y
  contexto.
