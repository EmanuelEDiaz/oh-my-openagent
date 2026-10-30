import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { shellWriteTargets } from "./shell-write-targets"

let project = ""

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "shell-write-targets-"))
  mkdirSync(join(project, "src", "shared"), { recursive: true })
  for (const file of ["src/shared/money.ts", "src/a.ts", "src/b.ts", "notes.md"]) writeFileSync(join(project, file), "x\n")
})

afterAll(() => {
  rmSync(project, { recursive: true, force: true })
})

const targets = (command: string) => shellWriteTargets(command, project).map((path) => path.slice(project.length + 1))

describe("shellWriteTargets", () => {
  // 0.27 baseline (28-10-2026): impact/extreme-currency #1 rewrote 7 files this way and never used edit or write.
  test("#given a heredoc rewriting an existing file #then that file is a target, and the heredoc body is not parsed", () => {
    expect(targets("cat > src/shared/money.ts <<'EOF'\nexport const a = b > c\nEOF")).toEqual(["src/shared/money.ts"])
    expect(targets("cat >> src/a.ts <<EOF\nx\nEOF\necho done > src/b.ts")).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("#given sed -i, perl -i or tee on existing files #then each file is a target", () => {
    expect(targets("sed -i 's/a/b/' src/a.ts src/b.ts")).toEqual(["src/a.ts", "src/b.ts"])
    expect(targets("sed -i.bak -e 's/a/b/' src/a.ts")).toEqual(["src/a.ts"])
    expect(targets("perl -pi -e 's/a/b/' src/a.ts")).toEqual(["src/a.ts"])
    expect(targets("echo x | tee -a notes.md src/a.ts > /dev/null")).toEqual(["notes.md", "src/a.ts"])
  })

  test("#given absolute or ./ paths inside the project #then they are resolved", () => {
    expect(targets(`printf 'x' > ${join(project, "src/a.ts")} && echo ok > ./src/b.ts`)).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("#given reads, descriptors, /dev, new files or files outside the project #then nothing is a target", () => {
    expect(targets("bun test 2>&1 | tail -8")).toEqual([])
    expect(targets("ls > /dev/null; cat src/a.ts 2>/dev/null")).toEqual([])
    expect(targets("echo x > src/new-file.ts")).toEqual([])
    expect(targets("echo x > /tmp/scratch.txt")).toEqual([])
    expect(targets("sed -n '1,5p' src/a.ts")).toEqual([])
    expect(targets("grep -c '>' src/a.ts")).toEqual([])
  })

  test("#given the same file written twice #then it is listed once", () => {
    expect(targets("echo a > src/a.ts; echo b >> src/a.ts")).toEqual(["src/a.ts"])
  })
})
