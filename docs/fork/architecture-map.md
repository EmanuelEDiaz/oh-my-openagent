# Mapa de la arquitectura del fork (08-10-2026)

Cómo se organiza el plugin para **controlar al modelo y limar sus inconsistencias**: quién usa a quién y qué capa
vigila qué. Estado sacado de `docs/fork/roadmap.md` a fecha de hoy.

Leyenda: 🟩 **hecho** (en `mis-mejoras`, con pruebas) · 🟨 **en curso / a medias** (código sin fusionar o medición
abierta) · ⬜ **pendiente**.

## 1. Vista general: capas y quién usa a quién

```mermaid
flowchart TB
    U([Usuario])

    subgraph UI["Interfaz"]
        SB["Barra lateral"]:::done
        TOAST["Avisos y reanudación"]:::done
        OMOM["/omo-models"]:::wip
        MERM["Mermaid en el chat · 0.19"]:::todo
        GVIS["Guardianes visibles · 0.18"]:::todo
        LAB["Laboratorio visual · 7.x"]:::todo
    end

    subgraph TAB["Orquestadores · agentes de tab · planifican y delegan"]
        SIS["Sisyphus"]:::done
        HEP["Hephaestus"]:::done
        ATL["Atlas"]:::done
        PRO["Prometheus"]:::done
        ARCH["Planificador arquitecto · 4.16"]:::todo
        ROUTE["Uso obligatorio · 4.19"]:::todo
    end

    subgraph SPEC["Especialistas @ · atómicos"]
        WR["@web-researcher"]:::done
        EXP["@explore"]:::wip
        EXPL["@explainer · 4.25"]:::todo
        REST["Resto del plantel · 4.2–4.15"]:::todo
        ADV["Adversarios · 4.21–4.23"]:::todo
    end

    subgraph GUARD["Guardianes por código"]
        TI["Tests · 0.9a"]:::done
        ED["Errores de tipos · 0.9a"]:::done
        EVG["Evidencia y citas · 1.5"]:::done
        GU["Apagar solo desde tu config"]:::done
        LB["Freno de bucles · 0.9b"]:::wip
        TG["Tipos y catch vacíos · 0.9c"]:::todo
        CG["Commit sin pruebas · 0.16"]:::todo
        RG["Reglas aprobadas · 4.5"]:::todo
    end

    subgraph BASE["Soporte"]
        subgraph RES["Resiliencia"]
            STALL["Cuelgues · 0.8"]:::done
            NET["Red, RAM, kill · 0.15"]:::done
            TNR["Nombres de herramienta"]:::done
        end
        subgraph MODEL["Modelos"]
            FREE["Gratuitos · 0.5"]:::done
            RET["Retirados · 0.7"]:::done
            ZEN["Puerta Zen"]:::done
            FB["Respaldo y no atendidos"]:::wip
        end
        subgraph CTX["Contexto y memoria"]
            KN["Índice y decisiones · 1.2–1.4"]:::done
            LOSS["Compactación sin pérdida · 1.6"]:::done
            BUD["Presupuesto de contexto · 0.13"]:::wip
            SK["Skills bajo demanda · 4.20"]:::todo
            CLOOP["Compactación sin bucles · 0.17"]:::todo
        end
    end

    subgraph MEAS["Medición"]
        BENCH["Banco · 3.0"]:::done
        QA["QA aislada"]:::done
        SUITE["Suite de integración · 0.16"]:::todo
        MATRIX["Matriz · 5.2"]:::todo
    end

    U --> UI
    UI --> TAB
    TAB -- "delegan en" --> SPEC
    SPEC -- "vigilados por" --> GUARD
    GUARD -- "se apoyan en" --> BASE
    MEAS -. "mide todo" .-> GUARD

    classDef done fill:#c8ecd3,stroke:#1f7a3a,stroke-width:2px,color:#0d2e18
    classDef wip fill:#ffe6a8,stroke:#b87d00,stroke-width:2px,color:#3d2a00
    classDef todo fill:#ececec,stroke:#9a9a9a,stroke-dasharray:4 3,color:#3a3a3a
```


**Relaciones finas entre piezas** (fuera del diagrama para que se lea):
- Los guardianes vigilan tanto a los orquestadores como a los especialistas.
- El freno de bucles investiga con `@web-researcher` y comparte el tope de reintentos con el vigilante de cuelgues.
- Un corte de red, congelamiento o kill deja una tarjeta y una nota que se entrega con tu siguiente mensaje.
- El planificador arquitecto pedirá las variantes a `@explainer`.
- El estado de la conexión aparece en la barra lateral; el de los guardianes aparecerá con 0.18.

Versión ampliable sin internet: `docs/fork/architecture-map.html` (solo local, fuera de git).

## 2. Qué pasa con cada petición (de arriba abajo)

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario
    participant O as Orquestador (tab)
    participant G as Guardianes
    participant S as Especialista @
    participant M as Modelo (gratuito)
    participant R as Resiliencia

    U->>O: mensaje (cualquier texto)
    Note over O: nota de reanudación si hubo un corte 🟩<br/>reglas y skills que tocan 🟨
    O->>M: petición (contexto recortado 🟨)
    M-->>R: error / silencio / corte
    R-->>O: espera, reintenta o pasa al respaldo 🟩/🟨
    O->>S: delega (uso obligatorio ⬜)
    S->>G: intenta editar
    G-->>S: bloquea trampas: tests 🟩, tipos y catch ⬜,<br/>bucles 🟨, commit sin pruebas ⬜
    S-->>O: resultado con evidencia 🟩
    O-->>U: respuesta (Mermaid dibujado ⬜)
```

## 3. Lista de estado

### 🟩 Hecho (en `mis-mejoras`, con pruebas)
- **Orquestadores y plantel base:** taxonomía y enrutamiento (2.1), plantel unificado con 13 especialistas (2.2),
  Prometheus solo escribe en `.omo/` (0.4), ningún agente desaparece por su modelo (0.3).
- **`@web-researcher`** (4.18): con ficha y medición (difíciles 8/10 frente a 2/10 de `@librarian`).
- **Guardianes:** integridad de tests (0.9a, medido: 4/4 honestas con guardián frente a 1/4 sin él), errores de tipos
  nuevos tras cada edición (0.9a), evidencia y citas (1.5), guardianes solo apagables desde la configuración del
  usuario.
- **Resiliencia:** cuelgues del modelo (0.8), red / congelamiento / kill / poca RAM con reanudación (0.15, QA 6/6 + un
  cambio de red real), límite al primer byte, avisos de procesos que ya no se pierden, reparación de nombres de
  herramienta, comandos de solo lectura sin permiso en `test-writer`/`debugger`.
- **Modelos:** preferir gratuitos (0.5), modelos retirados (0.7), puerta Zen gratis.
- **Contexto y memoria:** índice del proyecto y de sesiones (1.2–1.3), decisiones citadas (1.4), compactación sin
  pérdida (1.6).
- **Medición:** banco con modelos reales (3.0), QA aislada (`script/fork/qa/resilience.ts`).
- **Barra lateral** sin sondeo y con el estado de conexión.

### 🟨 En curso / a medias
- **Incidentes del uso real** (rama `fix/user-session-incidents`, sin fusionar): respaldo de modelos encendido por
  defecto y modelos no atendidos, `/omo-models` sin reiniciar, modelo pequeño gratuito para títulos, recortes de
  contexto en el plugin (filtro de herramientas, MCP y `ctx_*` ocultos a orquestadores, skills listados una vez).
  Ya aplicado en la configuración del usuario: reglas de `ai-guidelines` acotadas (~12k tokens menos por petición).
- **Freno de bucles (0.9b):** código y QA hechos; **medición abierta** (ningún modelo gratuito probado entra en bucle).
- **Integridad de tests (0.9a):** medición abierta (faltan 2 repeticiones y las tareas de tipos).
- **`@explore` (4.1):** en curso.

### ⬜ Pendiente (en orden de trabajo)
1. **0.9c** guardián de tipos y errores tragados + linter del proyecto sobre lo tocado.
2. **0.16** suite de integración acumulativa y bloqueo de commits sin pruebas.
3. **0.19** Mermaid dibujado en el chat.
4. **0.18** guardianes visibles y protegidos.
5. **0.17a** compactación sin bucles.
6. **0.13** presupuesto de contexto completo (prompts cortos + skills bajo demanda, regla 16).
7. **0.17b** varios temas por conversación.
8. **0.14** título automático de la sesión.
9. **0.10–0.12** ver subagentes en segundo plano, Windows nativo, MCP bajo demanda.
10. **Fase 4**, un especialista cada vez con su ficha: `@explainer` (4.25) antes del planificador arquitecto (4.16),
    reglas del proyecto aprobadas (4.5), adversarios (4.21–4.23), skills y choques (4.20), uso obligatorio (4.19).
11. **Fase 5–7:** renombrado, evaluación conjunta, matriz de integración, documentación, laboratorio visual.
