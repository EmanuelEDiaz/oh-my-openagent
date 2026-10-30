# TypeScript / JavaScript — LSP setup

- **Builtin server:** `typescript` — `typescript-language-server --stdio`
- **Extensions:** `.ts .tsx .js .jsx .mjs .cjs .mts .cts`
- **Install hint:** `npm install -g typescript-language-server@6 typescript@6`

## Install

- **macOS:** `npm install -g typescript-language-server@6 typescript@6`
- **Linux:** `npm install -g typescript-language-server@6 typescript@6`
- **Windows:** `npm install -g typescript-language-server@6 typescript@6` (PowerShell or cmd)

`typescript-language-server` is only a thin wrapper: it needs the `typescript`
package (`tsserver`) present too, either globally or in the project's
`node_modules`. Always install both, and pin TypeScript to 6: TypeScript 7 (the
native compiler, now the `latest` tag) ships no `lib/tsserver.js`, so the server
cannot start with it. typescript-language-server 6 needs Node 22.22.2 or newer.

To keep them across Node upgrades, install them where the Node manager reinstalls
them on every new Node version instead of a one-off global install. With mise, a
`postinstall` on the `node` tool in `~/.config/mise/config.toml`:

```toml
[tools]
node = { version = "22", postinstall = "npm install -g typescript-language-server@6 typescript@6" }
```

Ask the user before changing their Node manager configuration.

Confirm it resolves:

```bash
command -v typescript-language-server
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "typescript": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. To favor inlay hints or tweak preferences:

```json
{ "lsp": { "typescript": { "initialization": { "preferences": { "includeInlayParameterNameHints": "all" } } } } }
```

## Alternatives

All builtin — pick by toolchain. Raise the alternative's `priority` and/or
`disabled` the default so the file routes to your choice:

| id           | command                                  | when to choose                          |
| ------------ | ---------------------------------------- | --------------------------------------- |
| `deno`       | `deno lsp`                               | Deno projects (handles `.ts/.tsx/.js`)  |
| `biome`      | `biome lsp-proxy --stdio`                | Biome lint/format as the LSP            |
| `eslint`     | `vscode-eslint-language-server --stdio`  | ESLint diagnostics (install below)      |
| `oxlint`     | `oxlint --lsp`                           | fast Oxc-based linting                  |
| `vue`        | `vue-language-server --stdio`            | `.vue` single-file components           |
| `svelte`     | `svelteserver --stdio`                   | `.svelte` files                         |
| `astro`      | `astro-ls --stdio`                       | `.astro` files                          |

`eslint` install: `npm i -g vscode-langservers-extracted`.

Pick Deno or Biome over the default:

```json
{ "lsp": {
  "typescript": { "disabled": true },
  "deno": { "priority": 100 }
} }
```

(Swap `"deno"` for `"biome"` to use Biome instead.)

## Troubleshooting
- **PATH:** `typescript-language-server` must be on PATH; reopen shell after `npm i -g`. Check your global bin with `npm bin -g`.
- **Missing tsserver:** errors like "Could not find tsserver" mean the `typescript` package is absent — install it globally or in the project.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.ts
```
