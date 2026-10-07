# `@explainer` y Mermaid dibujado en el chat (ideas del usuario, 07-10-2026)

Estado: **investigación hecha (07-10-2026)**; propuesta pendiente de aprobación. `S/` = `packages/omo-opencode/src/`.

## Mermaid en la interfaz de OpenCode (v1.18)
- **Ya existe un plugin de 81 líneas que lo hace:** `opencode-mermaid-renderer@0.0.3` (MIT): en el hook
  `experimental.text.complete` cambia cada bloque ```` ```mermaid ```` por su dibujo con caracteres (librería
  `beautiful-mermaid`). OpenCode llama a ese hook al terminar cada texto (`session/processor.ts:526-544`).
  - Efectos: el usuario ve el código mientras se escribe y el dibujo al terminar; **el mensaje guardado (y el contexto
    del modelo) se queda con el dibujo y pierde el código**, que además gasta muchos más tokens. Arreglo: guardar
    `parte → código` y devolver el código al modelo en `experimental.chat.messages.transform` (el fork ya usa ese hook).
- **Renderizadores de texto:** `beautiful-mermaid` 1.1.3 (MIT, 2,1 MB, sin navegador, Unicode o ASCII; flujo, estados,
  secuencia, clases, ER, gráficos XY) es el mejor; `mermaid-ascii` (Go, binario aparte), `termaid` (OCaml) y
  `mermaid`/`mmdc` (122 MB + Chromium) descartados.
- **Imágenes en la terminal:** Konsole tiene sixel y kitty parcial; Windows Terminal sixel desde 1.22; pero **OpenCode
  cerró como "no planeado" las imágenes en el chat** (#24769, #36630): en v1.18 un plugin no puede poner imágenes. El
  dibujo con caracteres funciona igual en Linux y Windows.
- **Upstream:** un renderizador nativo (`@opencode/merman`) vive en una rama V2 separada, no en 1.18.26/1.18.35.
- **Seguridad:** issue #48573 — diagramas de estados anidados provocaron un bucle infinito, OOM y la caída de la
  máquina. Cualquier renderizado en el proceso necesita topes (≤60 líneas, ≤30 nodos, ancho ≤ columnas/120, try/catch;
  si salta un tope, se muestra el código).
- **Validación:** `@mermaid-js/parser` no cubre flujo/secuencia/clases/estados/ER; el validador barato es
  `beautiful-mermaid`: si dibuja, es válido.
- Los modelos dejan a menudo el bloque sin etiquetar (#43304: 50 sin etiqueta frente a 22 con `mermaid`): detectar
  también bloques sin etiqueta que se puedan dibujar.

## Homólogos para `@explainer`
- **mattpocock/skills:** `improve-codebase-architecture` genera un HTML autocontenido (Mermaid + Tailwind) en la carpeta
  temporal y lo abre con `xdg-open`/`start`; Mermaid solo "cuando las relaciones tienen forma de grafo"; `teach`
  (hojas de referencia), `wait-what` (reexplicar en sencillo con el glosario).
- **Diátaxis:** la "explicación" es comprender (por qué, alternativas, contexto), distinta de guía, tutorial y
  referencia; **C4**: niveles de zoom (contexto, contenedor, componente).
- Buenas prácticas: un concepto por diagrama, ≤ ~12 nodos, 80–120 columnas, bloque etiquetado `mermaid`, validar antes
  de mostrar, alternativa en texto.

## Propuesta
1. **Funcionalidad `mermaid-render`** (en el fork, no el plugin de terceros): dibuja con `beautiful-mermaid` los bloques
   Mermaid (y los sin etiquetar que se puedan dibujar) en `experimental.text.complete`, con topes de seguridad;
   devuelve el código al modelo en `experimental.chat.messages.transform`; Unicode (ASCII en la consola clásica de
   Windows). Sirve para todos los agentes, no solo `@explainer`.
2. **Especialista `@explainer`** ("@", atómico, solo lectura): entrada `{pregunta, alcance (archivos/símbolos u
   opciones), público, formato: auto|chat|html}`; salida en el chat ≤ ~400 palabras y ≤ 2 diagramas (Mermaid, cajas o
   tabla), cada afirmación con `archivo:línea`; para opciones, tabla criterios × variantes + recomendación. Valida sus
   diagramas dibujándolos. Las reglas detalladas en skills que carga cuando las necesita (`diagram-mermaid`,
   `options-table`).
   - **Quién lo llama:** el planificador cuando hay ≥2 variantes o el usuario pide "explica/compara"; los orquestadores
     ante "cómo funciona X" que abarca ≥3 archivos. Nunca hace cambios.
3. **Cadena de respaldo:** dibujo en el chat → código Mermaid si no se puede dibujar → HTML en la carpeta temporal
   (abierto en el navegador) si hacen falta >3 diagramas, interacción o >120 columnas; reutiliza `plan_render` de 4.16
   y el SVG de `beautiful-mermaid` sin CDN.
4. **Medición en el banco:** comprobaciones deterministas (cada diagrama se dibuja, ancho ≤120, ≤2 diagramas, nombra los
   componentes preguntados, las citas `archivo:línea` existen, una tarea de opciones da una tabla con todas las
   variantes) + juez con modelo gratuito y rúbrica 1–5 (exactitud, ajuste a la pregunta, el diagrama aporta, brevedad,
   postura de "explicación"), calibrado con ~10 respuestas puntuadas por el usuario. Casos difíciles: estados anidados
   (#48573), bloque mal etiquetado, módulo inexistente (debe decirlo), >15 componentes (dividir o pasar a HTML).
5. **RAM:** medir el coste real de `beautiful-mermaid` (usa `elkjs` en el proceso) antes de activarlo por defecto.
