# Pasos 4.13b y 4.24 — Percepción para modelos sin visión

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **decidido (04-10-2026)**. Rutas: `S/` = `packages/omo-opencode/src/`.

## Objetivo
Que un modelo **solo de texto** (la mayoría de los gratuitos) "vea" interfaces web, de escritorio, Android y Flutter lo
bastante bien para construir, probar y arreglar UI, con el mejor equilibrio entre **rendimiento** (tiempo, RAM, CPU,
tokens) y **resultados** (qué fallos detecta y cuáles no). Equipo de referencia: 7,6 GB, sin GPU, earlyoom; Windows y
Linux.

## Investigación (04-10-2026; `[V]` fuente primaria, `[S]` secundaria)
- **Playwright aria snapshots** `[V]`: YAML con roles y nombres; `ref` desde 1.52; **`boxes` (x,y,w,h) desde 1.60**;
  `ariaSnapshotJSON()` con `mode`/`depth`/`boxes` en 1.63. Paquete npm, sin Python, milisegundos.
- **Playwright MCP** `[V]`: su propio README dice que la CLI gasta menos tokens que el MCP; un árbol completo suele ocupar
  2–15k tokens `[S]`.
- **DOM + estilos calculados + cajas** (`page.evaluate`): único modo de obtener colores, fuentes, espaciado, recortes y
  solapes como texto. **axe-core** `[S]`: contraste WCAG, etiquetas, roles.
- **Escritorio:** ya cubierto por `senpi-desktop` (4.17). **Android:** `adb shell uiautomator dump` (XML con posiciones;
  `mobile-mcp`, Apache-2.0, TS) `[S]`. **Flutter:** árbol de widgets y semántica por el VM service / Dart MCP `[S]`,
  `debugDumpSemanticsTree` `[V]`; dibuja en un canvas: **sin `Semantics` no hay árbol**.
- **Píxeles:** pixelmatch (ISC, JS) y odiff (MIT, binario; 2–6× más rápido según su autor) `[S]`.
- **OCR:** tesseract.js (ya aprobado; flojo con texto de UI pequeño: recortar y ampliar ×2); RapidOCR (ONNX) como
  candidato si la medición lo pide `[S]`.
- **Diseño:** el MCP de Pencil da las medidas calculadas de cada nodo (`snapshot_layout`) y las variables `[S]`; el MCP
  oficial de Figma da 6 llamadas al mes en planes gratuitos `[S]`.
- **Descartado en este equipo:** OmniParser, UI-TARS, Ferret-UI, ScreenAI (GPU o no publicados); Moondream 2B local
  (≈2,6 GB `[V]`, riesgo de earlyoom junto al navegador); Surya (GPL, pesos restringidos), PaddleOCR y docTR (Python
  pesado), Florence-2 (torch, lento en CPU); BackstopJS y Lost Pixel (frameworks enteros); Chrome DevTools MCP para
  percepción (telemetría por defecto, solo Chrome).

## Escalera (solo se sube si el peldaño anterior no basta)
1. **Estructura** (siempre): árbol de accesibilidad con refs y cajas + errores de consola y red. ≤1,5k tokens podado
   (solo nodos interactivos y de referencia; `e12 button "Save" [disabled] @(840,612 96x36)`; listas repetidas "×N";
   tras una acción, solo el cambio).
2. **Hechos de maquetación** (bajo demanda): estilos y medidas del DOM → **solo infracciones** (solape, recorte, fuera
   de pantalla, desalineación, contraste, tamaño táctil, desviación de tokens del diseño) con ref y `archivo:línea` del
   `ui-map`; + axe-core. ≤600 tokens.
3. **Píxeles y OCR:** pixelmatch/odiff frente a una referencia, resumido por zonas y refs; OCR solo en zonas sin árbol
   (canvas) o para comprobar que el texto pintado coincide con el DOM. ≈200 tokens.
4. **Comparación con el diseño:** Pencil (`snapshot_layout` + variables) cruzado con los hechos del peldaño 2 por el
   `ui-map` → diferencias en texto (`título: diseño 24px/600 → impl 20px/500 (Card.tsx:41)`). ≤400 tokens.
5. **Visión** (último recurso): `look_at` con un modelo de visión gratuito en la nube, recorte con refs dibujados y una
   sola pregunta; responde en refs. Sin modelo local por defecto.
- **Presupuesto:** ~3k tokens por comprobación, frente a 10–15k del árbol en bruto.

## Capa común `S/features/perception/`
- Un esquema `PerceptionSnapshot {source: web|desktop|android|flutter, nodes[{ref, role, name, state, box, file?}],
  facts[], diff?, ocr?}`.
- Adaptadores: Playwright (árbol JSON + hechos del DOM), senpi-desktop (UIA/AT-SPI), Android (uiautomator), Flutter
  (semántica/widgets).
- Motores comunes: poda y diferencias, reglas de hechos, diferencia de píxeles, OCR de respaldo, cruce con `ui-map`.
- Consumidores: `@ui-tester` (4.13), la herramienta `computer` (4.17) y `@multimodal-looker` (4.15a, que pasa a ser el
  peldaño 5).
- Todo texto de pantalla entra como datos, nunca como instrucciones.

## Fases y medición (rendimiento y resultados juntos; cifras estimadas, se miden en el banco)
| Fase | Tiempo / RAM / tokens | Detecta | No detecta |
|---|---|---|---|
| P1 árbol + consola | <300 ms, ~0 RAM extra, ≤1,5k | elementos que faltan o sobran, etiquetas, estados, flujos rotos, errores JS, textos | todo lo visual |
| P2 hechos + axe | 0,3–1 s, ~0, ≤600 | solapes, recortes, fuera de pantalla, desalineación, contraste, tamaños táctiles, desviación de tokens | iconos o imágenes rotos, contenido de canvas/SVG, "se ve feo" |
| P3 píxeles + OCR | diff 0,1–1 s; OCR 2–10 s pantalla, <1 s recortes; 150–300 MB | cualquier cambio visual frente a la referencia, texto en canvas | el porqué; sin referencia no hay diff; ruido de fuentes/animaciones |
| P4 diseño (Pencil) | 1–3 s, ≤400 | tamaño, posición, color, tipografía y nodos que faltan frente al diseño | intención no reflejada en nodos; Figma gratis |
| P5 visión en la nube | 5–30 s, red, ≤300 devueltos | iconos/imágenes rotos, jerarquía visual | precisión en píxeles; límites de uso; privacidad |
| P6 Android/Flutter | volcado 1–3 s; emulador 2–4 GB | lo de P1/P2 vía posiciones | canvas sin semántica (solo P3) |

## Decisión del usuario (04-10-2026)
- Aprobado tal como se propuso: **4.13b capa de percepción** (antes de 4.15a y 4.17), ampliar 4.13, 4.15a y 4.17, y
  **4.24 Android/Flutter** (mejor con dispositivo real que con emulador).
