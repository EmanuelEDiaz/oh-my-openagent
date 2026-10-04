# Fase 7 — Laboratorio visual de agentes (última fase)

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **decidido (04-10-2026)**, última fase. Rutas: `S/` = `packages/omo-opencode/src/`.

## Petición del usuario
Ver qué hace cada agente de forma interactiva: un desplegable en la barra lateral (donde está la lista de tareas) con un
laboratorio en pixel art; cada agente es un personaje en su puesto, el orquestador es el "jefe"; al tocar un personaje,
un bocadillo dice qué está haciendo y otros datos. **Sin carga para los agentes, sin coste de rendimiento, alimentado por
señales de OpenCode, casi nulo cuando está plegado.**

## Investigación (04-10-2026; `[V]` verificado en código, `[S]` secundario)
- **Se puede hoy:** la API de plugins de la TUI (OpenCode 1.18, opentui + Solid) permite un `sidebar_content` con clics
  (`onMouseDown`), pliegue y diálogos; la propia lista de tareas es un plugin así `[V]`.
- **Sin sondeo:** la TUI recibe los eventos de OpenCode (`session.status`, `session.created` con `parentID`,
  `message.updated` con agente/modelo/tokens, `message.part.updated` con la herramienta en curso, `permission.asked`,
  `question.asked`, `session.error`) `[V]`.
- **Sin imágenes en la terminal:** OpenCode fija opentui 0.4.5, sin `<image>`; se dibuja con medios bloques (`▀`,
  color arriba y abajo), que funciona también en Windows Terminal `[V]`.
- **Espacio:** la barra lateral tiene ~38 columnas útiles y solo aparece con más de 120 columnas de terminal `[V]`; caben
  2 personajes de 16×16 por fila (16 columnas × 8 filas cada uno).
- **La app de escritorio no admite paneles de plugins** `[V]`: solo terminal.
- **Proyectos de referencia:** `campy` (mascota en la barra lateral de OpenCode, solo eventos, MIT), `pixel-agents`
  (oficina de agentes en VS Code, MIT), `term-pet` (medios bloques, MIT); `clawd-on-desk` es AGPL: solo ideas.

## Diseño
- **Modo visual del panel "Jobs" de 0.10**, no un panel aparte.
- **Estado:** un objeto pequeño por sesión hija (agente, modelo, tarea, herramienta y argumentos resumidos, inicio,
  tokens, estado), actualizado por los eventos con escrituras O(1); máximo 12 agentes; el jefe es el agente de la sesión
  principal.
- **Animaciones:** reposo, pensando, escribiendo (edit/write), leyendo (read/grep/glob), ejecutando (bash), delegando
  (jefe con `task`), esperando permiso o pregunta ("!"), error (rojo), terminado (3 s y reposo).
- **Interacción:** cabecera `▶/▼ Lab (3 trabajando)`; estado guardado en `api.kv`; clic en un personaje → bocadillo
  (agente · modelo / tarea / herramienta + argumentos / tiempo · tokens, calculados al dibujar); doble clic → diálogo
  con detalle y "abrir sesión".
- **Coste:** plegado, nada montado ni temporizadores ni sprites en memoria; abierto, 2–4 fps **solo mientras algún agente
  trabaja**, sin temporizadores con todo en reposo; sprites pre-convertidos a texto en la compilación (sin decodificar
  PNG), cargados al primer despliegue. Estimación < 0,5 % CPU y < 1 MB (se mide antes de cerrar).
- **Assets (CC0):** principal **MurphysDad Robot Lab** (16×16, pocos colores, ordenador de laboratorio, 4 personajes);
  opcional **Sci-Fi Facility** (mismo autor y estilo). Hay que dibujar 2–3 fotogramas de "teclear". Descartados Foozle
  (32–48 px de perfil, hasta 62 colores) y Pixel Office (estático, tamaño sin confirmar). Comprobar la licencia dentro de
  cada zip y añadir crédito.
- **Alternativa si algo falla:** lista de texto con emojis, con el mismo clic para el detalle.

## Medición
CPU y memoria con el panel plegado, abierto en reposo y abierto con 3–12 agentes trabajando; respuesta al clic.
