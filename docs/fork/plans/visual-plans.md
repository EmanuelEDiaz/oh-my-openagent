# Planes visuales (dentro de 4.16)

Parte del roadmap: `docs/fork/roadmap.md`, paso 4.16. Estado: **idea aprobada (01-10-2026)**; se diseña en detalle y se mide
con la plantilla de la Fase 4 (`plans/per-agent-program.md`).

## Problema
Un plan que es solo texto cuesta de seguir: no se ve el flujo, la arquitectura ni a qué código se refiere cada parte.

## Decisión del usuario (01-10-2026)
- Va como **skill + herramienta** dentro del paso de Prometheus y los orquestadores (4.16), no como agente.
- Tiene que funcionar también con **modelos que no leen imágenes**.

## Diseño
1. **Diagramas como código.** Mermaid dentro del `.md` del plan cuando el plan trata flujos, arquitectura, datos o
   estados (secuencia, entidad-relación, estados, flujo). Si hace falta un esquema a medida, SVG escrito a mano, que
   también es texto. Cada nodo lleva su `archivo:línea`.

   Un modelo solo-texto lee y escribe la fuente del diagrama; la imagen es para el usuario.
2. **Skill `visual-plan`**, para pasar a cualquier modelo lo que hace bien un modelo fuerte:
   - plantillas completas por tipo de diagrama;
   - errores típicos de sintaxis y cómo evitarlos (paréntesis o comillas en etiquetas, ids con espacios, palabras
     reservadas);
   - cuándo usar Mermaid, SVG o un gráfico de datos;
   - límites de tamaño, para que siga siendo legible.
3. **Validación por código.** Antes de guardar el plan se comprueba que cada bloque Mermaid y SVG compila. Si no, el
   error vuelve como texto al agente para que lo corrija. Así se cierra el ciclo sin necesidad de visión.
4. **Herramienta `plan_render`.** Convierte el plan en un HTML autocontenido con los diagramas dibujados y las
   referencias `archivo:línea` como enlaces. Por decidir en el diseño: incluir mermaid en el propio HTML o cargarlo
   de un CDN gratuito, y la dependencia que pida (se pregunta antes de añadirla).
5. **Gráficos de datos** (matplotlib u otros): opcionales por `bash`, sin dependencia obligatoria de Python.

## Criterios de aceptación
```gherkin
Feature: planes visuales
  Scenario: diagrama válido
    Given un plan con un diagrama Mermaid con un error de sintaxis
    When el agente intenta guardarlo
    Then recibe el error como texto y el plan guardado solo contiene diagramas que compilan
  Scenario: modelo sin visión
    Given un modelo solo-texto
    Then puede escribir y leer los diagramas porque su fuente es texto
  Scenario: HTML navegable
    When se ejecuta plan_render sobre un plan
    Then se obtiene un HTML autocontenido con los diagramas dibujados y las referencias archivo:línea como enlaces
```
