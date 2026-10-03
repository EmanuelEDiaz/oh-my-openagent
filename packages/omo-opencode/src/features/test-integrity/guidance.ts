/** Always-on rule (fork roadmap 0.9a): an explicit way out cuts test cheating sharply (ImpossibleBench: 54 % → 9 %). */
export const TEST_INTEGRITY_TAG = "<omo-test-integrity>"

export const TEST_INTEGRITY_GUIDANCE = `${TEST_INTEGRITY_TAG}
Tests are the specification. When a test fails, fix the code, not the test.
- If a test looks wrong, do NOT edit, skip or weaken it: stop and ask the user (question tool, option "Allow editing <file>") and say why.
- Existing tests are read-only for implementers, and skips, removed or weakened assertions, self-mocks and type/lint suppressions are refused by the plugin.
- A new test counts only if it fails before the fix, on an assertion, and passes after it. Run it before fixing.
</omo-test-integrity>`
