# Paso 0.9c — Guardián de tipos, errores tragados y estándares del proyecto (+ 4.5 ampliado)

Estado: **investigación hecha (08-10-2026)**; plan detallado pendiente de aprobación (tras los incidentes del uso real).
`S/` = `packages/omo-opencode/src/`. `[nv]` = sin verificar.

## Piezas que ya existen (reutilizar)
- Correctores del banco por diferencia "nuevas apariciones frente al original", sin comentarios ni cadenas:
  `noNewSuppressions` (`script/fork/bench/graders.ts:425`), `TYPE_ESCAPE_PATTERN` (:440), `noNewTypeEscapes` (:448);
  `integrityGraders` (:485) aún no incluye `noNewTypeEscapes`.
- `S/features/edit-diagnostics/service.ts:73,100,160`: antes/después de cada edición y solo errores nuevos
  (`classifyErrors(before, changedLines, touchedNames)`).
- Guardián de tests (bloqueo + desbloqueo solo con la pregunta al usuario): el mismo patrón.
- Regla del usuario `ai-guidelines/base/10-error-handling-and-logging.md:21-26` (regla 3: capturar donde se puede
  actuar, recuperarse o añadir contexto al relanzar, nunca capturar-registrar-y-seguir): los mensajes del guardián la citan.

## Sistemas homólogos (qué tomar)
1. Nuestros propios correctores por diferencia → guardián antes de aceptar la edición (coste casi nulo).
2. **reviewdog** `-filter-mode=added` (solo hallazgos en líneas añadidas) + recuento antes/después por archivo;
   **ESLint** supresiones masivas (`eslint-suppressions.json`), **PHPStan** `--generate-baseline`, Psalm
   `--set-baseline`, golangci-lint `--new-from-rev` `[nv]`: "solo violaciones nuevas".
3. **ESLint `preserve-caught-error`** (v9.35+): relanzar perdiendo el error capturado (sin `cause`).
4. **type-coverage `--strict`** (al hacer commit): cuenta `any[]`, `Promise<any>`, `as X`, `x!`; excluye `as const`,
   `as unknown` y aserciones seguras → política de falsos positivos lista.
5. **ruff** ANN001/ANN201/ANN401, PGH003, S110, BLE001, E722; mypy `--warn-unused-ignores`; **errcheck** (Go).
6. typescript-eslint `no-explicit-any`, `ban-ts-comment` (`@ts-expect-error` con descripción: modelo para la excepción
   comentada), `no-non-null-assertion`; Biome `noExplicitAny`, `noEmptyBlockStatements`; ESLint `no-empty` (un bloque
   comentado no cuenta como vacío).
7. **tdd-guard** (hook que bloquea por la salida real): misma forma que nuestro guardián de tests.
8. Convenciones: Claude Code `/init`, Cursor reglas con `globs`, Copilot `.github/instructions` con `applyTo`, Aider
   `CONVENTIONS.md` + `--auto-lint`.
9. Medición: OpenTau (arXiv 2305.17145): "comprobar tipos" solo no basta; puntuación "compila ∧ sin `any` nuevo".

## Diseño propuesto
### Por edición (síncrono, <50 ms, sin herramientas del proyecto) — se bloquea solo lo **nuevo**
- **Tipos:** `any` nuevo, `as any`, **`as unknown as X`** (doble aserción; `unknown` solo no se bloquea), `x!` nuevo,
  `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error` sin descripción, `eslint-disable`/`biome-ignore` nuevos, anotaciones
  borradas (mismo símbolo, por nombre, no por línea), y configuración aflojada (`tsconfig` `strict`/`noImplicitAny` a
  false, reglas rebajadas en ESLint/Biome, nivel de mypy/pyright/phpstan bajado).
- **Errores tragados:**

  | Lenguaje | Se bloquea si es nuevo |
  |---|---|
  | TS/JS | `catch {}`, `catch (e) {}`, `.catch(() => {})`, `catch` cuyo cuerpo solo devuelve `null`/`undefined`/`[]`/`false`; `throw new X(msg)` dentro de un `catch` sin `{ cause }` |
  | Python | `except: pass`, `except Exception: pass`; `except Exception` que ni relanza ni registra la excepción |
  | Go | `_ = err`, `_ = f()` con error, `if err != nil { return nil }` (lista de excepciones de errcheck) |
  | PHP | `catch (\Throwable $e) {}` vacío |

  Un tragado intencional se acepta **solo con un comentario explicativo dentro del bloque** (≥ ~3 palabras, no
  `// ignore`).
- **Mensaje al modelo:** la alternativa tipada o correcta (`unknown` + estrechamiento, `satisfies`, guarda de tipo,
  `new Error(msg, { cause: e })`, registrar el error completo) citando la regla del usuario; excepción solo con la
  pregunta al usuario.
- **Exentos:** archivos de test (aserciones y casts habituales), código generado (`*.d.ts`, `generated/`,
  `__generated__`, `vendor/`, clientes OpenAPI/protobuf), `as const`, `satisfies`.
### Tras la edición (asíncrono, 0,3–3 s)
Errores de tipos nuevos por el demonio LSP (ya existe) y, si el proyecto tiene linter, `eslint --cache <archivo>` /
`biome lint <archivo>` / `ruff check <archivo>` sobre el archivo tocado: solo violaciones nuevas (líneas añadidas +
recuento antes/después).
### Al hacer commit / cerrar un paso (más profundo)
`type-coverage --strict` antes/después en archivos cambiados; `tsc --noEmit` contra una línea base; retornos
ensanchados en funciones exportadas tocadas vía API del compilador (segundos: no por edición). Encaja con el bloqueo de
commits de 0.16.
### Orden de lenguajes
TypeScript → Python (ruff) → Go (errcheck) → PHP (PHPStan).
### 4.5 ampliado — estándares de un proyecto ya hecho
1. Escaneo determinista de configuración (tsconfig, ESLint/Biome/Prettier/editorconfig, ruff/mypy, phpstan,
   golangci). 2. Inferencia con ~20 archivos recientes no generados: solo convenciones presentes en ≥80 %, con
   evidencia `archivo:línea`. 3. ≤7 reglas propuestas (aplicable por código o solo consejo, y a qué archivos) que el
   usuario aprueba o edita. 4. Guardadas con `applyTo`; se inyectan solo al tocar archivos que coinciden; se aplican por
   código cuando equivalen a una regla de linter o patrón.
## Medición
Por tarea `types-*` y nuevas tareas de errores tragados ("haz que esta llamada inestable deje de romper", donde la
trampa es `catch {}`): Δ cobertura de tipos estricta (≥0), escapes nuevos, supresiones nuevas, `catch` tragados nuevos,
`typecheckPasses`, funciones exportadas que pierden el tipo de retorno; con y sin guardián; casos difíciles aparte.
