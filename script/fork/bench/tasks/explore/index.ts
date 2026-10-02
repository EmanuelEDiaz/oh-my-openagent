/**
 * `explore` suite (fork roadmap 4.1, docs/fork/plans/explore.md): 24 tasks over 5 repos, 7 of them holdout.
 * Expected answers were checked by hand against each pinned snapshot.
 */
import type { Fixture, GitFixture } from "../../fixtures"
import { answerMatches, citationsExist, citesLine, contract, EXPLORE_CONTRACT, saysAbsent, toolNotUsed } from "../../graders"
import type { Budget, Grader, Task } from "../../types"

const FORK: GitFixture = {
  name: "omo-fork",
  repo: `${import.meta.dir}/../../../../..`,
  ref: "eb18e522a63dbb48624207425b789b9dc0537d84",
}
// The user's real project (decided 02-10-2026): a copy at its last commit, never the working tree.
const CODEGEN: GitFixture = { name: "codegenerator", repo: "/mnt/datos/emanuel/Programacion/codegenerator", ref: "649fcd7" }
const CLICK: GitFixture = { name: "click", repo: "https://github.com/pallets/click", ref: "8.2.2" }
const CHI: GitFixture = { name: "chi", repo: "https://github.com/go-chi/chi", ref: "v5.3.2" }

const SMALL: Budget = { maxTurns: 25, timeoutMs: 600_000 }
const LARGE: Budget = { maxTurns: 40, timeoutMs: 900_000 }

// Every explore answer: its own <results> format, only real paths, and it never writes.
const COMMON: readonly Grader[] = [
  contract(EXPLORE_CONTRACT),
  citationsExist(),
  toolNotUsed(/^(write|edit|multiedit|apply_patch|patch|hashline_edit)$/),
]

function task(
  id: string,
  fixture: Fixture,
  prompt: string,
  expect: readonly Grader[],
  options: { holdout?: boolean; budget?: Budget } = {},
): Task {
  return {
    id: `explore/${id}`,
    agent: "explore",
    mode: "subtask",
    fixture,
    prompt,
    expect: [...COMMON, ...expect],
    split: options.holdout ? "holdout" : "dev",
    budget: options.budget ?? SMALL,
  }
}

export const EXPLORE_TASKS: readonly Task[] = [
  // ts-service (bundled, 10 files)
  task("retry-delay", "ts-service", "Where is the delay between HTTP retries configured? Give the file and the line.", [
    answerMatches([/250/]),
    citesLine("http/retry.ts", 4, 4),
  ]),
  task("api-token-readers", "ts-service", "Find every place in the code that reads the environment variable API_TOKEN.", [
    citesLine("config.ts", 4, 4),
    citesLine("auth/token.ts", 2, 2),
  ]),
  task("email-callers", "ts-service", "Which function validates email addresses, and which non-test source files call it?", [
    answerMatches([/isValidEmail/, /users\/validate\.ts/, /users\/service\.ts/, /admin\/invite\.ts/]),
  ]),

  // this fork (large TypeScript monorepo)
  task("fork-paid-model", FORK, "Which function decides whether a model counts as paid for the prefer_free_models option? Give the file and the line.", [
    answerMatches([/isPaidModel/]),
    citesLine("shared/free-model-preference.ts", 36, 36),
  ], { budget: LARGE }),
  task("fork-known-missing-callers", FORK, "Which source files (not tests, not index re-exports) call `isKnownMissingModel`? Do not confuse it with functions that have similar names.", [
    answerMatches([/delegate-core\/src\/model-selection\.ts/, /agent-registration-warning\.ts/, /builtin-agents\/model-resolution\.ts/, /general-agents\.ts/, /atlas-agent\.ts/]),
  ], { budget: LARGE }),
  task("fork-compaction-flow", FORK, "How does the lossless-compaction state card end up in the compaction prompt? Follow the flow from the hook to where it is added.", [
    answerMatches([/lossless-compaction\/index\.ts/, /session-compacting\.ts/, /compaction-snapshot\.ts/]),
    citesLine("plugin/session-compacting.ts", 120, 136),
  ], { budget: LARGE }),
  task("fork-postgres", FORK, "Where does the plugin store its data in PostgreSQL?", [saysAbsent()], { budget: LARGE }),
  task("fork-lsp-timeout", FORK, "What is the timeout of an LSP request in lsp-core, and where is it defined?", [
    answerMatches([/15[_,.\s]?000|15\s*s/]),
    citesLine("lsp-core/src/lsp/constants.ts", 6, 6),
  ], { budget: LARGE }),
  task("fork-prometheus-blocked-tools", FORK, "Which tools does the Prometheus md-only hook block, including tools that rewrite the workspace?", [
    answerMatches([/apply_patch/, /hashline_edit/, /multiedit/, /lsp_rename/, /ast_grep_rewrite/]),
  ], { holdout: true, budget: LARGE }),
  task("fork-team-delete-message", FORK, "Where is the message shown when a non-lead session tries to delete a team defined, and where is it used?", [
    answerMatches([/teamDeleteLeadOnlyMessage/, /lifecycle-shutdown-tools\.ts/, /team-tool-gating\/hook\.ts/]),
  ], { holdout: true, budget: LARGE }),

  // codegenerator (the user's real project, Python, hexagonal + plugins)
  task("codegen-generate-flow", CODEGEN, "What happens from the moment the CLI receives a JSON schema until the files are written? List the files involved, in order.", [
    answerMatches([/interface\/cli\.py/, /use_cases\/generate\.py/, /generator\.py/, /jinja_renderer\.py/, /fs_writer\.py/]),
  ]),
  task("codegen-plugin-discovery", CODEGEN, "How are code generator plugins discovered and loaded?", [
    answerMatches([/plugin_loader\.py/, /entry.?points?/i, /_load_from_dir/]),
  ]),
  task("codegen-dependency-rule", CODEGEN, "Does any module in the domain or application layers import from the infrastructure or interface layers?", [
    answerMatches([/\b(no|none)\b/i]),
    saysAbsent(),
  ]),
  task("codegen-componentdef-users", CODEGEN, "Where is ComponentDef defined and which modules use it?", [
    answerMatches([/ports\/registry\.py/, /component_store\.py/, /jinja_renderer\.py/, /components\.py/, /use_cases\/catalog\.py/]),
  ], { holdout: true }),
  task("codegen-graphql", CODEGEN, "Where is the GraphQL generator implemented?", [saysAbsent()], { holdout: true }),

  // click (Python, public)
  task("click-help-width", CLICK, "How does click decide the width of help text, and what is the default maximum width?", [
    answerMatches([/\b80\b/]),
    citesLine("formatting.py", 116, 131),
  ]),
  task("click-shell-completion-caller", CLICK, "What calls `_main_shell_completion`, and at which point of the command's execution?", [
    answerMatches([/\bmain\b/]),
    citesLine("core.py", 1350, 1360),
  ]),
  task("click-version-flow", CLICK, "How does the `--version` option work, from the decorator to printing the version and exiting?", [
    answerMatches([/version_option/, /decorators\.py/, /exit/]),
  ]),
  task("click-envvar-name", CLICK, "How does click build the environment variable name for an option when auto_envvar_prefix is set?", [
    answerMatches([/resolve_envvar_value/, /upper\(\)/]),
    citesLine("core.py", 2969, 2995),
  ], { holdout: true }),
  task("click-async", CLICK, "Where does click run async (asyncio) command callbacks?", [saysAbsent()], { holdout: true }),

  // chi (Go, public)
  task("chi-insert-route", CHI, "Where is a route inserted into the radix tree?", [
    answerMatches([/InsertRoute/]),
    citesLine("tree.go", 148, 160),
  ]),
  task("chi-request-flow", CHI, "How does an incoming request reach a handler that was registered with `r.Get`?", [
    answerMatches([/mux\.go/, /routeHTTP/, /FindRoute/]),
  ]),
  task("chi-websocket", CHI, "Where does chi implement WebSocket support?", [saysAbsent()]),
  task("chi-urlparam-users", CHI, "Where is URLParam defined and which example programs use it?", [
    answerMatches([/context\.go/, /_examples\/rest\/main\.go/, /_examples\/versions\/main\.go/]),
  ], { holdout: true }),
]
