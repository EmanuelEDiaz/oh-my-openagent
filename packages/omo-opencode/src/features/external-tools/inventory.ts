/**
 * The external tools the plugin relies on, in one place (fork roadmap 0.25): what stops working without each, and how to
 * install it so it survives Node upgrades. The installer, the startup notice, `doctor` and the lsp-setup skill read it.
 * `impact` is for `doctor` (English, like the rest of its output); `impactEs` is the short line of the startup notice.
 */
export type ToolNeed =
  /** Every project. */
  | { readonly kind: "always" }
  /** Only a project in this language. */
  | { readonly kind: "language"; readonly language: ProjectLanguage }
  /** Nice to have: listed by `doctor`, never in the startup notice. */
  | { readonly kind: "optional" }

export type ProjectLanguage = "typescript" | "python" | "go" | "rust"

export type ToolCheck =
  /** A language server: started and required to answer the LSP handshake. `servers` in order of preference. */
  | { readonly kind: "language-server"; readonly servers: readonly { readonly id: string; readonly command: readonly string[] }[] }
  /** A command that must run `args` (e.g. `--version`) and exit 0. */
  | { readonly kind: "command"; readonly command: string; readonly args: readonly string[] }

export type ExternalTool = {
  readonly id: string
  readonly label: string
  readonly need: ToolNeed
  readonly check: ToolCheck
  readonly impact: string
  readonly impactEs: string
  readonly install: { readonly linux: string; readonly windows: string }
  /** How to keep it across Node upgrades or a reinstall, when that differs from `install`. */
  readonly durable?: string
}

const TS_DURABLE =
  'mise: [tools] node = { version = "22", postinstall = "npm install -g typescript-language-server@6 typescript@6" } in ~/.config/mise/config.toml'

export const EXTERNAL_TOOLS: readonly ExternalTool[] = [
  {
    id: "typescript-language-server",
    label: "TypeScript language server (with TypeScript 6)",
    need: { kind: "language", language: "typescript" },
    check: { kind: "language-server", servers: [{ id: "typescript", command: ["typescript-language-server", "--stdio"] }] },
    impact: "no type diagnostics after edits, no lsp_* tools and no type guard in TypeScript/JavaScript projects",
    impactEs: "sin diagnósticos de tipos ni herramientas LSP en TypeScript/JavaScript",
    install: {
      linux: "npm install -g typescript-language-server@6 typescript@6",
      windows: "npm install -g typescript-language-server@6 typescript@6",
    },
    durable: TS_DURABLE,
  },
  {
    id: "python-language-server",
    label: "Python language server (basedpyright or pyright)",
    need: { kind: "language", language: "python" },
    check: {
      kind: "language-server",
      servers: [
        { id: "basedpyright", command: ["basedpyright-langserver", "--stdio"] },
        { id: "pyright", command: ["pyright-langserver", "--stdio"] },
      ],
    },
    impact: "no type diagnostics after edits and no lsp_* tools in Python projects",
    impactEs: "sin diagnósticos de tipos ni herramientas LSP en Python",
    install: { linux: "pipx install basedpyright", windows: "pipx install basedpyright" },
  },
  {
    id: "gopls",
    label: "Go language server (gopls)",
    need: { kind: "language", language: "go" },
    check: { kind: "language-server", servers: [{ id: "gopls", command: ["gopls"] }] },
    impact: "no diagnostics after edits and no lsp_* tools in Go projects",
    impactEs: "sin diagnósticos ni herramientas LSP en Go",
    install: { linux: "go install golang.org/x/tools/gopls@latest", windows: "go install golang.org/x/tools/gopls@latest" },
  },
  {
    id: "rust-analyzer",
    label: "Rust language server (rust-analyzer)",
    need: { kind: "language", language: "rust" },
    check: { kind: "language-server", servers: [{ id: "rust", command: ["rust-analyzer"] }] },
    impact: "no diagnostics after edits and no lsp_* tools in Rust projects",
    impactEs: "sin diagnósticos ni herramientas LSP en Rust",
    install: { linux: "rustup component add rust-analyzer", windows: "rustup component add rust-analyzer" },
  },
  {
    id: "git",
    label: "git",
    need: { kind: "always" },
    check: { kind: "command", command: "git", args: ["--version"] },
    impact: "no worktrees, no resume of cut work and no protection of existing tests",
    impactEs: "sin worktrees, sin reanudar trabajo cortado ni protección de tests",
    install: { linux: "your package manager, e.g. sudo pacman -S git / sudo apt install git", windows: "winget install --id Git.Git" },
  },
  {
    id: "ast-grep",
    label: "ast-grep (sg)",
    need: { kind: "optional" },
    check: { kind: "command", command: "sg", args: ["--version"] },
    impact: "the ast-grep skill cannot run structural search and rewrite",
    impactEs: "sin búsqueda estructural (skill ast-grep)",
    install: { linux: "npm install -g @ast-grep/cli", windows: "npm install -g @ast-grep/cli" },
  },
  {
    id: "tmux",
    label: "tmux",
    need: { kind: "optional" },
    check: { kind: "command", command: "tmux", args: ["-V"] },
    impact: "no interactive_bash tool and no tmux views of subagents",
    impactEs: "sin la herramienta interactive_bash",
    install: { linux: "your package manager, e.g. sudo pacman -S tmux / sudo apt install tmux", windows: "not available natively; use WSL" },
  },
]
