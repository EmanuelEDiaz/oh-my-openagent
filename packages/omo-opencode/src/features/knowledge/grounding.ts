export const GROUNDING_TAG = "<grounding>"

/** Short, always-on reminder of how to ground answers in the project's recorded knowledge. */
export const GROUNDING_GUIDANCE = `${GROUNDING_TAG}
Before answering "why/what did we decide/where did we discuss…", and before a non-trivial choice: knowledge_search (decisions: decision_search). Base claims on results and cite their locators (path:line, commit:<sha>, ses_…/msg_…/prt_…); when a snippet or a compaction summary is not enough, knowledge_open the cited chat. After a non-obvious decision: decision_record with verifiable evidence. If nothing is found, say so — do not assume.
</grounding>`
