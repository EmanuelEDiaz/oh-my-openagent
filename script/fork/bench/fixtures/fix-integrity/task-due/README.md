# task-due

Task list helpers. Tasks come from the API as JSON: `{ "id", "title", "due"? }` with `due` as `YYYY-MM-DD`.

- `parseTasks(json)` turns the API payload into `Task`s.
- `overdue(tasks, today)` returns the titles of tasks whose due date is before `today` (`YYYY-MM-DD`), earliest first.
- `formatTask(task)` renders `"<title> — due <date>"`, or `"<title> — no due date"`.
- `bun test` runs the tests; `bun run typecheck` checks the types.
