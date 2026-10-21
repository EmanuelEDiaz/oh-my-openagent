# 0.25 — Herramientas externas: avisar al instalar y comprobar que conectan

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **aprobado (19-10-2026)**; en curso desde el 21-10-2026 en la rama `feat/external-tools-check`.

## Petición del usuario (19-10-2026)
"Si el plugin necesita algo como eso de TypeScript, al ser instalado debe avisarlo y decir las implicaciones de mal
funcionamiento en caso de no tenerlo; además debe revisar que estas herramientas que usa se conecten correctamente."

## Por qué (hallazgo H15)
Tras reinstalar el sistema faltaba `typescript-language-server`. El plugin no avisó: cogió `deno lsp` para un proyecto
Bun (diagnósticos engañosos) y, una vez arreglado eso, los agentes se quedaban sin diagnósticos de tipos sin que nadie lo
supiera. Encima, `npm install typescript` instala hoy TypeScript 7 (nativo, sin `tsserver.js`), con el que
`typescript-language-server` no arranca: tener el binario instalado no basta, hay que comprobar que conecta.

`oh-my-openagent doctor` ya existe, pero su comprobación de LSP solo mira que el MCP de LSP esté activo (`tools-lsp.ts`).

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
   - **`oh-my-openagent doctor`:** la lista completa con el resultado de cada prueba de conexión.
4. **Cómo instalar o reinstalar, de forma duradera** (usuario, 19-10-2026: "si falla la herramienta, decir cómo
   reinstalar"): cada aviso y `oh-my-openagent doctor` dan el comando exacto y la forma que sobrevive a actualizar Node o reinstalar
   el sistema. Con mise, un `postinstall` de la herramienta `node` (ver "Decisión del usuario 1" abajo); un
   `npm install -g` suelto se pierde al cambiar de versión de Node.
5. **Ruta de `tsserver` resuelta por el plugin:** para no depender de dónde quedó instalado TypeScript, el plugin busca
   un TypeScript 6 válido (proyecto, npm global, mise) y lo pasa al servidor (`initializationOptions.tsserver.path`).
6. **Skill de instalación del plugin** (usuario, 19-10-2026): una skill que el agente carga cuando el usuario pregunta
   cómo instalar lo que necesita el plugin, o cuando falla una herramienta. Se genera desde el mismo inventario que los
   avisos, para que nunca se desactualicen entre sí. El agente propone los comandos y **pregunta antes de ejecutarlos**
   (es un cambio en el sistema del usuario).
7. **Medición:** milisegundos que añade al arranque (objetivo: nada en primer plano), contexto añadido (objetivo: cero)
   y, con una herramienta quitada a propósito en el entorno aislado, que el aviso aparece en la interfaz real.

## Investigación de homólogos y decisiones (21-10-2026)
Investigados: OpenCode (sst/opencode v1.19.3), typescript-language-server, TypeScript 7, VS Code, Neovim `:checkhealth`
y mason.nvim, Helix `hx --health`, Zed, `flutter doctor`, `brew doctor`, rustup, Claude Code `/doctor` y mise.

- **OpenCode** ya pasa a typescript-language-server la ruta de `tsserver.js` del proyecto y hace un `initialize` real con
  plazo, pero con TypeScript 7 (sin `tsserver.js`) no arranca y **no avisa**; un servidor que falla queda "roto" toda la
  sesión sin decirlo. Es justo lo que este paso corrige.
- **typescript-language-server 6.0** exige Node ≥ 22.22.2; `tsserver.path` acepta `tsserver.js` o la carpeta `lib`, nunca
  `.bin/tsserver`. Su issue #1110: con TypeScript 7 en el proyecto caía en silencio a un TypeScript 6 global ajeno y
  respondía "OK" con resultados de otra versión. Por eso la prueba de conexión también comprueba **qué TypeScript cargó**.
- **TypeScript 7** (estable desde el 08-07-2026) no trae `lib/tsserver.js`, y `npm i -g typescript` instala hoy la 7. Trae
  su propio servidor (`tsc --lsp --stdio`), todavía "casi completo"; Vue, Svelte, Astro y MDX siguen en TypeScript 6.
- **Formato de avisos**: tabla por lenguaje con conecta / no conecta / no instalado y la ruta resuelta (Helix), con
  `-v` para el detalle y el comando exacto de arreglo (flutter doctor); la comprobación completa solo bajo demanda
  (`:checkhealth`), el arranque solo mira los lenguajes del proyecto, en segundo plano y con caché (por ruta, fecha y
  versión del binario); propone el arreglo y lo aplica solo tras confirmar (Claude Code `/doctor`). Evitar: el verde por
  `which` sin conectar (Helix, mason) y el fallo silencioso (OpenCode).
- **Hallado en nuestro código**: las sugerencias de instalación del plugin (`LSP_INSTALL_HINTS`,
  `AUTO_INSTALLABLE_SERVERS` en `packages/lsp-core/src/lsp/server-definitions.ts`, y la tabla de la skill `lsp-setup`)
  dicen `npm install -g typescript-language-server typescript`, que hoy instala TypeScript 7 y deja el servidor sin
  arrancar: hay que fijar `typescript@6`. La skill del punto 6 no se crea de cero: se amplía la skill `lsp-setup`, que ya
  existe en `shared-skills`.
- **Decisión del usuario 1 — instalación duradera**: mise deja de leer `~/.default-npm-packages` (avisa desde la versión
  2026.11.0 y lo ignora desde la 2027.11.0, según su documentación). Se usa un `postinstall` de la herramienta `node` en
  la configuración de mise, que instala `typescript-language-server@6` y `typescript@6` en cada Node nuevo: los dos quedan
  juntos (el servidor encuentra TypeScript solo) y sirve para cualquier editor. Se aplica en el equipo del usuario y se
  guarda en su repositorio de configuración (`cachyos-lenovo`); es lo que el plugin recomendará. Se descartó el backend
  `npm:` de mise: instala cada paquete aparte y el servidor no encuentra TypeScript (medido el 19-10).
- **Decisión del usuario 2 — servidor nativo de TypeScript 7**: no por ahora. El plugin sigue con
  typescript-language-server y TypeScript 6; en un proyecto con TypeScript 7 usa un TypeScript 6 conocido (punto 5) y lo
  dice claro. Queda anotado para más adelante, con medición antes de adoptarlo.

## Criterios (Gherkin)
- Dado un proyecto TypeScript sin `typescript-language-server`, cuando arranca OpenCode, entonces aparece un aviso que
  dice que no habrá diagnósticos de tipos ni herramientas LSP, y el comando para instalarlo.
- Dado TypeScript 7 sin `tsserver.js`, cuando se comprueba el servidor, entonces el aviso dice que no conecta y que hace
  falta TypeScript 6.
- Dado todo instalado y conectando, cuando arranca OpenCode, entonces no aparece ningún aviso.
- Dado una herramienta que falla, entonces el aviso incluye el comando para reinstalarla de forma duradera.
- Dado que el usuario pregunta cómo instalar lo que necesita el plugin, entonces el agente carga la skill de
  instalación, lista lo que falta y pregunta antes de instalar nada.
- Dado `oh-my-openagent doctor`, entonces lista cada herramienta con "conecta / no conecta / no instalada" y qué deja de funcionar.
