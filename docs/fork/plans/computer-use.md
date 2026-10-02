# Control del navegador y del escritorio con IA (Windows y Linux, modelos gratuitos)

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **decidido (02-10-2026)**.
Origen: documento del usuario `/mnt/datos/emanuel/Control del PC con IA.md`. Rutas: `S/` = `packages/omo-opencode/src/`.

## Requisitos del usuario (02-10-2026)
- Funciona en **Windows y Linux**.
- **Controlable:**
  - el usuario lo ve en directo, lo pausa o lo para al instante;
  - limita qué aplicaciones puede tocar;
  - aprueba las acciones con riesgo.
- **Seguro:**
  - entorno aislado;
  - confirmación antes de cualquier acción irreversible;
  - defensas contra instrucciones ocultas en pantallas o webs;
  - ninguna contraseña expuesta;
  - registro de cada acción.
- **Posible con modelos gratuitos**, incluso los que solo leen texto.

## Lo que ya existe (verificado en el código)
- **Navegador:** `browser_automation_engine.provider` = `playwright` (por defecto: Playwright MCP con instantáneas de
  accesibilidad en texto y referencias), `playwright-cli` o `dev-browser`.
  - `ui-tester` solo funciona con el proveedor por defecto: con `playwright-cli` le falta `bash` y con `dev-browser`
    no tiene skill.
- **Visión:** `look_at` → `multimodal-looker` en una sesión hija; devuelve texto, así que un orquestador sin visión
  puede usarlo.
  - La cadena de modelos por defecto es de pago (`gpt-5.6-sol`, `kimi-k3`, `glm-4.6v`…).
- **Motor de escritorio del propio repo** (`crates/senpi-desktop-*` en Rust + `packages/senpi-desktop-*` en TS):
  - Linux X11 (RandR + XTEST), Wayland (portal/PipeWire + libei), **AT-SPI**; Windows con captura nativa + **UI
    Automation**; macOS.
  - Herramienta `computer` con niveles de permiso de lectura y de ejecución, **atajo de parada** y **registro de
    auditoría**.
  - **Solo lo usa la edición Senpi**; OpenCode no lo registra (`docs/guide/computer-use.md`).
  - Hay binarios publicados para linux x64, win x64 y mac.
- **Windows:**
  - el CI ya prueba `omo-opencode` en `windows-latest`;
  - la terminación de procesos (`taskkill /T`), ast-grep (`sg.exe`) y el daemon LSP (named pipe) ya soportan Windows;
  - tmux no.
  - **Partes solo-POSIX del fork:**
    - el banco (`script/fork/bench`: `sh -c`, `grep`, `tar`, `process.kill(-pid)`, aislamiento solo por
      `HOME`/`XDG_*`, cuando Windows usa `USERPROFILE`/`APPDATA`);
    - los patrones `command -v`/`which` de los especialistas.

## Investigación externa (`[V]` = fuente primaria, `[S]` = secundaria)
- **Navegador:**
  - Playwright MCP `[V]`: Apache-2.0, igual en ambos SO, `--isolated`, instantáneas en texto con referencias, sin
    visión. Sus filtros de origen **no** son una barrera de seguridad.
  - Chrome DevTools MCP: solo Chrome y envía estadísticas por defecto.
- **Escritorio en texto:**
  - Windows: CursorTouch/Windows-MCP (MIT, UI Automation) `[V]`, con herramientas peligrosas (PowerShell, Registro).
  - Linux: no hay un MCP de AT-SPI maduro `[S]`.
  - Los MCP basados en nut.js trabajan con capturas y coordenadas (no sirven sin visión) y sus binarios ya son de
    pago `[V]`.
- **OCR:** tesseract.js (Apache-2.0, WASM, sin instalar nada) `[V]`; menos preciso con texto de interfaz pequeño.
- **Aislamiento:**
  - Linux: pantalla anidada **Xephyr** (ventana visible) o Xvfb + noVNC, con otro usuario.
  - Windows: **Windows Sandbox** (solo Pro) o un usuario estándar aparte; el motor tiene que ejecutarse dentro.
- **Modelos gratuitos con imágenes en OpenCode** (`models.dev`, hoy): `mimo-v2.6-flash-free`,
  `muse-spark-1.3-contributor-free`, `longcat-2.5-preview-free`, `space-bunny-free`, `fledge-alpha-free`.
  - Gemini gratuito puede usar los datos enviados `[V]`.
- **Lo que pueden hacer los modelos gratuitos** (OSWorld `[V]`, Windows Agent Arena `[S]`):
  - el árbol de texto supera a las capturas (GPT-4: 12,2 % frente a 5,3 %);
  - los modelos abiertos fallan en tareas largas (1,6–3 %).

  **Conclusión:** tareas cortas y acotadas, sí; largas autónomas, no prometer.

## Propuesta
1. **Navegador** (lo primero: igual en ambos SO, maduro y gratis):
   - Playwright MCP `--isolated` con instantáneas de texto;
   - arreglar `ui-tester` para que funcione con cualquier proveedor;
   - pasarle la capa de seguridad (punto 4).
2. **Escritorio:** llevar el **motor del propio repo** a OpenCode con una herramienta `computer`:
   - árbol AT-SPI/UIA con referencias, sin coordenadas;
   - en vez de MCP de terceros: es nuestro, multiplataforma y ya trae permisos, parada y auditoría;
   - Windows-MCP queda como alternativa en Windows si el motor se queda corto.
3. **Aislamiento por defecto:**
   - Linux: Xephyr (el usuario lo ve en una ventana) o Xvfb + noVNC;
   - Windows: usuario estándar aparte, o Windows Sandbox en Pro con el motor dentro.
   - Fuera del aislamiento, solo con permiso explícito.
4. **Capa de control y seguridad** (por código, común a navegador y escritorio):
   - atajo de parada + archivo de parada comprobado antes de cada acción + pausa y reanudación;
   - listas permitidas de aplicaciones/ventanas y dominios, aplicadas por el plugin;
   - aprobación antes de enviar, pagar, borrar, instalar o ejecutar comandos/PowerShell/registro;
   - el texto de pantallas y webs se trata como datos, nunca como instrucciones;
   - sin credenciales en el perfil aislado;
   - registro JSONL de cada acción (herramienta, referencia, argumentos, hash antes/después, aprobación); capturas
     solo si el usuario las activa.
5. **Pensado para modelos gratuitos:**
   - ≤ 6 herramientas: `snapshot`, `click(ref)`, `type(ref, text)`, `key`, `scroll`, `wait`;
   - instantánea filtrada a la ventana activa y a lo interactivo, con tope de 2–4k tokens;
   - **comprobar tras cada acción**;
   - 15–25 pasos por tarea; tras 2 fallos, se para y avisa (reanudación de `bounded-retry-resume.md`).
6. **Respaldos:**
   - OCR con tesseract.js (dependencia nueva, con aprobación) cuando no hay árbol (apps Electron, juegos);
   - visión puntual con `multimodal-looker` usando un modelo gratuito con imágenes, nunca con capturas que muestren
     secretos.

## Requisito transversal: Windows y Linux
Todo el fork debe funcionar en ambos sistemas:
- código nuevo sin `sh -c`/`grep`/`tar` ni `kill(-pid)`: utilidades del repo (`process-tree-termination`,
  `spawn-with-windows-hide`) o código en TS;
- el banco aísla también `USERPROFILE`/`APPDATA` en Windows;
- los patrones de `bash` de los especialistas cubren PowerShell/cmd;
- pruebas en el CI de Windows.

## Decisiones del usuario (02-10-2026)
- **Motor de escritorio: el del propio repo** (`senpi-desktop`), conectado a OpenCode con una herramienta `computer`.
  Windows-MCP queda como respaldo en Windows si el motor se queda corto.
- **Dónde va:**
  - el **navegador** en 4.13 (`ui-tester` + capa de seguridad);
  - el **escritorio** como paso nuevo **4.17**, tras los orquestadores, cuando ya existan los límites y la
    reanudación (0.8/0.9) y la capa de seguridad.
- **OCR con tesseract.js:** aprobado como respaldo, solo cuando llegue ese paso y si la medición muestra que hace falta.
- **Windows:**
  - **el plugin, nativo en Windows y Linux**: todo lo que usa el usuario final se prueba en el CI de Windows;
  - las herramientas de desarrollo del fork (el banco) pueden exigir Linux, WSL o Git Bash en Windows;
  - se descarta exigir WSL al usuario: impide controlar el escritorio de Windows (UI Automation solo existe en nativo)
    y quitaría soporte que el original ya tiene;
  - **paso 0.11** corrige lo del plugin que no sea multiplataforma (p. ej. los patrones `command -v`/`which` de los
    especialistas).
