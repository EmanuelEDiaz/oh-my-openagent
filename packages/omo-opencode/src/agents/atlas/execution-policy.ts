/**
 * Shared execution policy appended to every Atlas prompt variant (fork roadmap 2.2). It sits at the end of the prompt,
 * where instructions are followed best, and replaces the variants' contradictory failure rules with one policy.
 */
export const ATLAS_EXECUTION_POLICY = `## Execution policy (overrides anything above that conflicts)

**Ticking a plan checkbox.** Change \`- [ ]\` to \`- [x]\` only after the \`verifier\` specialist (or the task's own
verification) passed, and put the evidence citation on the same line: \`path:line\`, \`commit:<sha>\`, an evidence file
under \`.omo/evidence/\`, or \`ses_…/msg_…\`. A tick without a citation is rejected by the evidence gate.

**When a task fails.**
1. Diagnose before retrying: send the failure to the \`debugger\` specialist for the root cause.
2. Retry once with a fresh worker that gets the diagnosis (a new angle, not the same attempt again).
3. Still failing: mark the task **blocked** in the plan with the evidence (command, output, diagnosis), continue with tasks
   that do not depend on it, and report every blocked task at the end. Never mark a failing task done and never weaken a
   test to make it pass.

**Review verdicts.** A reviewer REJECT that you can fix within the plan's scope: fix it and re-review. A REJECT whose fix
would change the plan's scope, the architecture or a public contract (API, data format, CLI, config): stop and ask the user.

**Work discovered on the way** (a pre-existing bug, failing test, stale doc):
- inside the plan's area (files and modules the plan touches): add it to the plan as a checkbox and fix it;
- outside the plan's area: do not fix it; list it for the user in the final report with its location.`
