/**
 * Web research suite (fork roadmap 4.18, docs/fork/plans/web-researcher.md): 20 questions asked to web-researcher and,
 * as the baseline it replaces, to librarian. Versions are graded against the live registry at grading time, so the
 * answer key never goes stale.
 */
import { answerHasLiveVersion, answerMatches, citedUrlsFromTools, ranAs, saysNotFound, toolNotUsed, urlsResolve } from "../../graders"
import type { Budget, Grader, Task } from "../../types"

const EMPTY = "empty"
const BUDGET: Budget = { maxTurns: 30, timeoutMs: 600_000 }

type Question = { readonly id: string; readonly prompt: string; readonly expect: readonly Grader[]; readonly holdout?: boolean; readonly unanswerable?: boolean }

const QUESTIONS: readonly Question[] = [
  // Errors with well-known fixes.
  { id: "err-eaddrinuse", prompt: "Starting my Node server fails with `Error: listen EADDRINUSE: address already in use :::3000`. What causes it and how do I fix it?", expect: [answerMatches([/another process|already (?:being )?used|in use/i, /lsof|kill|netstat|fuser|taskkill|different port|PORT=/i])] },
  { id: "err-distutils", prompt: "On Python 3.12 I get `ModuleNotFoundError: No module named 'distutils'`. Why, and what is the fix?", expect: [answerMatches([/removed|deprecat/i, /setuptools/i])] },
  { id: "err-eresolve", prompt: "`npm install` fails with `ERESOLVE unable to resolve dependency tree`. What does it mean and how do I get past it?", expect: [answerMatches([/peer/i, /--legacy-peer-deps|--force|overrides/i])] },
  { id: "err-unrelated", prompt: "git pull says `fatal: refusing to merge unrelated histories`. How do I merge anyway?", expect: [answerMatches([/--allow-unrelated-histories/])] },
  { id: "err-docker-sock", prompt: "On Linux, `docker ps` gives `permission denied while trying to connect to the Docker daemon socket`. How do I fix it without using sudo every time?", expect: [answerMatches([/docker group|usermod|groupadd docker/i])], holdout: true },
  { id: "err-ts2307", prompt: "TypeScript reports `TS2307: Cannot find module 'some-js-lib' or its corresponding type declarations` for a plain JavaScript package. How do I fix it?", expect: [answerMatches([/@types|declare module|\.d\.ts/i])] },
  // Current facts: graded live.
  { id: "ver-react", prompt: "What is the latest published version of the npm package `react`?", expect: [answerHasLiveVersion("npm", "react")] },
  { id: "ver-typescript", prompt: "What is the latest published version of the npm package `typescript`?", expect: [answerHasLiveVersion("npm", "typescript")] },
  { id: "ver-requests", prompt: "What is the latest version of the Python package `requests` on PyPI?", expect: [answerHasLiveVersion("PyPI", "requests")] },
  { id: "ver-django", prompt: "What is the latest version of Django on PyPI?", expect: [answerHasLiveVersion("PyPI", "Django")], holdout: true },
  { id: "ver-lodash", prompt: "What is the latest version of the npm package `lodash`, and does it have known security advisories?", expect: [answerHasLiveVersion("npm", "lodash")] },
  // Stable facts.
  { id: "fact-rust", prompt: "In which year was Rust 1.0 released?", expect: [answerMatches([/2015/])] },
  { id: "fact-429", prompt: "Which HTTP status code means \"Too Many Requests\", and which RFC introduced it?", expect: [answerMatches([/429/, /6585/])] },
  { id: "fact-postgres", prompt: "What is PostgreSQL's default TCP port?", expect: [answerMatches([/5432/])] },
  { id: "fact-python", prompt: "Who created the Python programming language?", expect: [answerMatches([/Guido van Rossum/i])], holdout: true },
  // Two hops.
  { id: "hop-node-lts", prompt: "What are the codenames of the Node.js 20 and Node.js 22 LTS lines?", expect: [answerMatches([/Iron/, /Jod/])] },
  { id: "hop-bun-engine", prompt: "Which JavaScript engine does Bun use, and which company originally developed that engine?", expect: [answerMatches([/JavaScriptCore/i, /Apple/i])] },
  { id: "hop-deno", prompt: "Who created Deno, and which other JavaScript runtime did the same person create earlier?", expect: [answerMatches([/Ryan Dahl/i, /Node/i])], holdout: true },
  // No reliable answer exists: the right answer says so.
  { id: "none-python4", prompt: "What is the exact release date of Python 4.0?", expect: [saysNotFound()], unanswerable: true },
  { id: "none-fake-pkg", prompt: "What is the latest version of the npm package `zq-nonexistent-pkg-7781`?", expect: [saysNotFound()], unanswerable: true },
]

function suite(agent: string, prefix: string, suffix: string): Task[] {
  return QUESTIONS.map((question) => ({
    id: `${prefix}/${question.id}`,
    agent,
    mode: "subtask" as const,
    fixture: EMPTY,
    prompt: `${question.prompt}${suffix}`,
    expect: [
      ranAs(agent),
      toolNotUsed(/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/),
      ...(question.unanswerable ? [] : [citedUrlsFromTools(), urlsResolve()]),
      ...question.expect,
    ],
    split: question.holdout ? ("holdout" as const) : ("dev" as const),
    budget: BUDGET,
  }))
}

export const WEB_RESEARCHER_TASKS: readonly Task[] = suite("web-researcher", "web-researcher", "")
/** Baseline: how open-web questions were answered before 4.18. */
export const LIBRARIAN_WEB_TASKS: readonly Task[] = suite("librarian", "librarian-web", "\n\nAnswer with the sources (URLs) you used.")
