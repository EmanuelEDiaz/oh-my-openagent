# UI fiel al código (dentro de 4.13 `ui-tester`)

Parte del roadmap: `docs/fork/roadmap.md`, paso 4.13. Estado: **idea aprobada (01-10-2026)**; se diseña en detalle y se mide
con la plantilla de la Fase 4.

## Problema real (usuario)
Se pidió dibujar en Pencil toda la UI de una app que ya existía, con el skill cargado. El resultado se parecía, pero no
era la UI real.

Causa: el agente reconstruyó la interfaz **leyendo código e imaginando** cómo se ve. Los estilos heredados, los datos
reales y los tamaños calculados solo existen con la app en marcha, y nadie comprobó que el dibujo fuera fiel.

## Decisión del usuario (01-10-2026)
Ampliar **4.13 `ui-tester`** y añadir un skill **"diseño desde la UI real"** que sirva para cualquier herramienta de
diseño (Pencil, Figma, HTML). No se crea un agente específico de Pencil.

## Diseño
1. **La app real es la fuente.** Se arranca la app con un proceso gestionado (4.14) y, por pantalla o ruta, se captura:
   - una imagen de la pantalla;
   - el árbol de accesibilidad y el DOM;
   - los textos exactos;
   - colores, tamaños y posiciones medidos en la página.
2. **Mapa de ids** en `.omo/ui-map.json`, con la forma *ruta → componente → `archivo:línea` → id del nodo en el diseño*.
   - La relación entre componente y archivo se obtiene automáticamente con un plugin de desarrollo que marca el HTML
     con el archivo de origen (candidato: `code-inspector-plugin`; **verificar** licencia, soporte y alternativas en
     la investigación de 4.13).
   - Si no hay plugin, se usa `data-testid` o el nombre del componente buscado en el código.
   - Los nodos del diseño se nombran con ese id. Así, cada elemento dibujado sabe qué código representa, y un cambio
     de código sabe qué parte del diseño queda desactualizada.
3. **Comprobación del resultado.** Se exporta la imagen del diseño y se compara con la captura real: diferencia de
   píxeles y comparación de textos, posiciones y colores. Se repite hasta quedar dentro de un margen.
   - Con un modelo sin visión se comparan **datos**: árbol, textos, cajas en JSON y porcentaje de píxeles distintos.
   - `multimodal-looker` solo interviene si hay un modelo con visión configurado.
4. **Skill "diseño desde la UI real":**
   - el orden de trabajo: capturar, mapear, dibujar y comparar;
   - nunca inventar una pantalla que no se pudo capturar (se informa);
   - cómo nombrar los nodos con el id.

## Criterios de aceptación
```gherkin
Feature: UI fiel al código
  Scenario: el diseño sale de la app real
    Given una app con UI en marcha
    When se pide su diseño
    Then cada pantalla dibujada procede de una captura real y no de leer el código
  Scenario: trazabilidad
    Then cada nodo del diseño tiene un id que el mapa resuelve a componente y archivo:línea
  Scenario: fidelidad comprobada
    When el diseño difiere de la captura más que el margen
    Then el agente lo corrige o informa de la diferencia, nunca lo da por bueno
```
