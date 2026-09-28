---
id: D-20260928-1
title: "Keep one Markdown file per decision; plans link to decisions instead of copying them"
status: active
date: 2026-09-28
reversibility: easy
agent: "claude-code (fork maintenance)"
evidence:
  - type: file
    ref: "docs/fork/plans/decisions-scaling.md:9-24"
    fingerprint: 1b3e3f42706709cd94b915bd5d1aca48d10b2d48
    note: "options evaluated"
  - type: file
    ref: "docs/fork/plans/decisions-scaling.md:25-35"
    fingerprint: f2a831ac69fd7e3213a99464690bcf22cf9763c1
    note: "conclusion"
  - type: url
    ref: "https://adr.github.io/adr-tooling/"
    note: "ADR tooling: log4brains, adr-tools, adr-log"
  - type: url
    ref: "https://www.techtarget.com/searchapparchitecture/tip/4-best-practices-for-creating-architecture-decision-records"
    note: "one decision per record"
---
# D-20260928-1: Keep one Markdown file per decision; plans link to decisions instead of copying them

- **Context:** The 1.4 decision log copied full entries into plan files, which grows unreadable and drifts when a decision is superseded. The user asked whether Markdown is the right store as decisions grow.
- **Options considered:**
  - One .md per decision in docs/decisions (ADR standard) + derived FTS5 index and generated views
  - SQLite as source of truth — binary in git, no review, unresolvable merges
  - Single JSONL/YAML file — one growing file, constant merge conflicts
  - External tool (Notion/issues) — detached from code, invisible to agents offline
- **Decision:** Keep one Markdown file per decision as the source of truth; plans hold a generated link block between markers; add generated views, schema validation and per-file decision injection (roadmap 1.4b/1.4c).
- **Reason:** Matches the ADR community practice (one decision per file, generated views once there are dozens) while fixing the parts that scale badly: duplicated copies in plans and manual navigation.
- **Reversibility:** easy
- **Evidence:**
  - `docs/fork/plans/decisions-scaling.md:9-24` — options evaluated
  - `docs/fork/plans/decisions-scaling.md:25-35` — conclusion
  - `https://adr.github.io/adr-tooling/` — ADR tooling: log4brains, adr-tools, adr-log
  - `https://www.techtarget.com/searchapparchitecture/tip/4-best-practices-for-creating-architecture-decision-records` — one decision per record
