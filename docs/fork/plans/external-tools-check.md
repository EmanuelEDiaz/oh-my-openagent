# 0.25 — Herramientas externas: avisar al instalar y comprobar que conectan

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **aprobado (19-10-2026)**; se hace justo después de cerrar la rama de incidentes, en su propia rama.

## Petición del usuario (19-10-2026)
"Si el plugin necesita algo como eso de TypeScript, al ser instalado debe avisarlo y decir las implicaciones de mal
funcionamiento en caso de no tenerlo; además debe revisar que estas herramientas que usa se conecten correctamente."

## Por qué (hallazgo H15)
Tras reinstalar el sistema faltaba `typescript-language-server`. El plugin no avisó: cogió `deno lsp` para un proyecto
Bun (diagnósticos engañosos) y, una vez arreglado eso, los agentes se quedaban sin diagnósticos de tipos sin que nadie lo
supiera. Encima, `npm install typescript` instala hoy TypeScript 7 (nativo, sin `tsserver.js`), con el que
`typescript-language-server` no arranca: tener el binario instalado no basta, hay que comprobar que conecta.

`omo doctor` ya existe, pero su comprobación de LSP solo mira que el MCP de LSP esté activo (`tools-lsp.ts`).

## Diseño
1. **Inventario por función** (un solo sitio en el código, usado por todo lo demás): cada herramienta con lo que deja de
   funcionar sin ella y cómo instalarla en Linux y Windows. Primera lista, a confirmar leyendo el código:
   - `typescript-language-server` + `typescript` 6 (no 7): herramientas `lsp_*`, diagnósticos tras cada edición,
     guardián de tipos (0.9c), en proyectos TS/JS.
   - Servidores de otros lenguajes solo si el proyecto los usa (`basedpyright`/`pyright` en Python, `gopls` en Go…).
   - `sg` (ast-grep): skill de búsqueda estructural.
   - binario de `comment-checker`.
   - `git`: worktrees, reanudación, protección de tests.
   - `tmux`: `interactive_bash`.
   - `node`: ejecuta `lsp-daemon`.
2. **Comprobar que conecta, no solo que existe:** por cada herramienta, una prueba corta y real (para el servidor de
   TypeScript: arrancarlo y hacer el saludo LSP `initialize`, que falla con TypeScript 7; para `sg`: una búsqueda mínima;
   para el daemon: una petición). Con límite de tiempo y sin tocar los proyectos del usuario.
3. **Dónde se avisa:**
   - **Al instalar** (`oh-my-openagent install`): lista de lo que falta, qué deja de funcionar y el comando para
     instalarlo.
   - **Al arrancar OpenCode:** solo para los lenguajes del proyecto abierto, un aviso (toast) si falta o no conecta algo
     que ese proyecto necesita. En segundo plano y guardado en caché, para no retrasar el arranque; nunca en el prompt
     (cero contexto).
   - **`omo doctor`:** la lista completa con el resultado de cada prueba de conexión.
4. **Cómo instalar o reinstalar, de forma duradera** (usuario, 19-10-2026: "si falla la herramienta, decir cómo
   reinstalar"): cada aviso y `omo doctor` dan el comando exacto y la forma que sobrevive a actualizar Node o reinstalar
   el sistema. Ejemplo comprobado en esta máquina: con `mise`, `~/.default-npm-packages` con
   `typescript-language-server@6` y `typescript@6` se instala solo en cada Node nuevo (un `npm install -g` se pierde al
   cambiar de versión de Node, y el backend `npm:` de mise instala cada paquete aparte, así que el servidor no encuentra
   TypeScript; medido el 19-10-2026).
5. **Ruta de `tsserver` resuelta por el plugin:** para no depender de dónde quedó instalado TypeScript, el plugin busca
   un TypeScript 6 válido (proyecto, npm global, mise) y lo pasa al servidor (`initializationOptions.tsserver.path`).
6. **Skill de instalación del plugin** (usuario, 19-10-2026): una skill que el agente carga cuando el usuario pregunta
   cómo instalar lo que necesita el plugin, o cuando falla una herramienta. Se genera desde el mismo inventario que los
   avisos, para que nunca se desactualicen entre sí. El agente propone los comandos y **pregunta antes de ejecutarlos**
   (es un cambio en el sistema del usuario).
7. **Medición:** milisegundos que añade al arranque (objetivo: nada en primer plano), contexto añadido (objetivo: cero)
   y, con una herramienta quitada a propósito en el entorno aislado, que el aviso aparece en la interfaz real.

## Criterios (Gherkin)
- Dado un proyecto TypeScript sin `typescript-language-server`, cuando arranca OpenCode, entonces aparece un aviso que
  dice que no habrá diagnósticos de tipos ni herramientas LSP, y el comando para instalarlo.
- Dado TypeScript 7 sin `tsserver.js`, cuando se comprueba el servidor, entonces el aviso dice que no conecta y que hace
  falta TypeScript 6.
- Dado todo instalado y conectando, cuando arranca OpenCode, entonces no aparece ningún aviso.
- Dado una herramienta que falla, entonces el aviso incluye el comando para reinstalarla de forma duradera.
- Dado que el usuario pregunta cómo instalar lo que necesita el plugin, entonces el agente carga la skill de
  instalación, lista lo que falta y pregunta antes de instalar nada.
- Dado `omo doctor`, entonces lista cada herramienta con "conecta / no conecta / no instalada" y qué deja de funcionar.
