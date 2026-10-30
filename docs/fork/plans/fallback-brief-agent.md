# 4.26 — Agente de respaldo con encargo concreto (`@generalist`, nombre provisional)

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **aprobado para el plan (19-10-2026)**, se hace en la Fase 4 después
de 4.20 y antes de 4.19. Rutas: `S/` = `packages/omo-opencode/src/`.

## Petición del usuario (19-10-2026)
"Un agente fallback que tenga una estructura de prompt genérica: si pregunto algo, lo que reciba la IA es 'eres un
ingeniero con n años de experiencia en esa tarea', para que la resuelva más eficiente, si no hay un agente específico
para esa tarea."

## Crítica (dada al usuario antes de integrarla)
- **Bien:** hoy una tarea sin especialista cae en un prompt pensado para nada en concreto. Darle un sitio propio tiene
  sentido, y cada uso es una señal de que falta un especialista (regla transversal 7).
- **Lo que no funcionaría como se espera:** según los estudios recientes sobre roles en el prompt, decirle al modelo
  "eres un experto con N años" apenas cambia el resultado en los modelos actuales. El efecto es pequeño e inconsistente,
  y cuesta tokens en cada petición. Hay que confirmarlo en nuestro banco.
- **Versión mejorada (la que eligió el usuario):** en lugar de un personaje, un **encargo concreto** generado para la
  tarea:
  1. el área de la tarea (SQL, interfaz, infraestructura…), para cargar con `skill` la skill o la lista de trampas de
     esa área si existe;
  2. criterios de aceptación: qué tiene que ser verdad al terminar;
  3. cómo verificarlo: la prueba o el comando que lo confirma;
  4. trampas conocidas del área (dinero → redondeo, fechas → zonas horarias…);
  5. formato de la respuesta.
  La línea del rol puede quedarse porque es barata, pero lo que se espera que mejore el resultado son los puntos 2 a 4.

El usuario eligió las recomendaciones en lugar de "medir primero" como condición para empezar. Aun así, **cada fase de
este agente se mide** en el banco: qué tan bueno es y cuánto contexto añade.

## Cómo encaja
- Es un agente **"@"**: atómico y sin delegar. Solo lo llama un agente de tab cuando el enrutado (4.19) no encuentra
  especialista.
- **Reutiliza 4.20:** el encargo estructurado validado por código (opción b de 4.20) es la misma pieza. Este paso la
  aplica al caso "sin especialista" y le añade la detección del área y la lista de trampas.
- **Parte de lo que ya existe:** `sisyphus-junior` con categorías (4.14a–h) ya da un prompt por tipo de tarea. Primero se
  investiga si conviene ampliar eso en vez de crear un agente nuevo.
- **Registro de usos:** cada vez que se usa se guarda el tipo de tarea. Si un área se repite, el agente propone al
  usuario un especialista nuevo con esos datos (regla 7: nunca se crea sin su aprobación).
- **Prompt base corto + skills bajo demanda** (regla 16): el encargo lo arma el código, y las listas de trampas viven en
  skills que solo se cargan si el área coincide.

## Fases y medición (cada una se mide antes de pasar a la siguiente)
1. **Base:** tareas sin especialista del banco (fáciles, difíciles y extremas, regla 13), resueltas por el camino de hoy.
   Se mide acierto, turnos, tokens y contexto por petición.
2. **Encargo concreto** (puntos 2, 3 y 5): misma medición. Se compara con la base y con la variante "solo rol de
   experto", para comprobar con datos la crítica de arriba.
3. **Área + trampas** (puntos 1 y 4, por skills): misma medición, con el coste de contexto separado.
4. **Enrutado y registro:** el agente de tab lo usa solo cuando no hay especialista, y se mide que no robe tareas a los
   especialistas.

Criterio para quedarse con cada fase: **igual o más acierto con igual o menos contexto**, o una mejora de acierto que
compense el contexto extra, decidida con el usuario con los números delante.

## Criterios (Gherkin)
- Dado una tarea sin especialista, cuando el agente de tab la enruta, entonces la recibe `@generalist` con un encargo
  que tiene criterios de aceptación y una verificación, y el registro de usos guarda su área.
- Dado una tarea con especialista, cuando el agente de tab la enruta, entonces nunca la recibe `@generalist`.
- Dado un área con skill de trampas, cuando llega una tarea de esa área, entonces la skill se carga (comprobado por
  código) y no se carga ninguna otra.
- Dado el banco, cuando se compara con la base, entonces el informe da acierto, turnos, tokens y contexto por petición
  de cada fase.
