import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"

import {
  createCommentCheckerHooks,
  createToolOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createRulesInjectorHook,
  createTasksTodowriteDisablerHook,
  createWriteExistingFileGuardHook,
  createBashFileReadGuardHook,
  createHashlineReadEnhancerHook,
  createReadImageResizerHook,
  createJsonErrorRecoveryHook,
  createTodoDescriptionOverrideHook,
  createWebFetchRedirectGuardHook,
  createTeamToolGating,
  createFsyncSkipWarningHook,
  createNotepadWriteGuardHook,
  createPlanFormatValidatorHook,
} from "../../hooks"
import { createManagedProcessGuardHook } from "../../hooks/managed-process-guard/hook"
import { createTestIntegrityGuardHook } from "../../hooks/test-integrity-guard"
import { createEditDiagnosticsHook } from "../../hooks/edit-diagnostics"
import {
  getOpenCodeVersion,
  isOpenCodeVersionAtLeast,
  log,
  OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
} from "../../shared"
import { safeCreateHook } from "../../shared/safe-create-hook"
import { createKnowledgeIndexerHook } from "../../hooks/knowledge-indexer"
import { createDecisionInjectorHook } from "../../hooks/decision-injector"
import { createEvidenceGateHook } from "../../hooks/evidence-gate"
import { createCitationCheckHook } from "../../hooks/citation-check"

export type ToolGuardHooks = {
  commentChecker: ReturnType<typeof createCommentCheckerHooks> | null
  toolOutputTruncator: ReturnType<typeof createToolOutputTruncatorHook> | null
  directoryAgentsInjector: ReturnType<typeof createDirectoryAgentsInjectorHook> | null
  directoryReadmeInjector: ReturnType<typeof createDirectoryReadmeInjectorHook> | null
  emptyTaskResponseDetector: ReturnType<typeof createEmptyTaskResponseDetectorHook> | null
  rulesInjector: ReturnType<typeof createRulesInjectorHook> | null
  knowledgeIndexer: ReturnType<typeof createKnowledgeIndexerHook> | null
  decisionInjector: ReturnType<typeof createDecisionInjectorHook> | null
  evidenceGate: ReturnType<typeof createEvidenceGateHook> | null
  citationCheck: ReturnType<typeof createCitationCheckHook> | null
  tasksTodowriteDisabler: ReturnType<typeof createTasksTodowriteDisablerHook> | null
  writeExistingFileGuard: ReturnType<typeof createWriteExistingFileGuardHook> | null
  bashFileReadGuard: ReturnType<typeof createBashFileReadGuardHook> | null
  managedProcessGuard: ReturnType<typeof createManagedProcessGuardHook> | null
  testIntegrityGuard: ReturnType<typeof createTestIntegrityGuardHook> | null
  editDiagnostics: ReturnType<typeof createEditDiagnosticsHook> | null
  hashlineReadEnhancer: ReturnType<typeof createHashlineReadEnhancerHook> | null
  jsonErrorRecovery: ReturnType<typeof createJsonErrorRecoveryHook> | null
  readImageResizer: ReturnType<typeof createReadImageResizerHook> | null
  todoDescriptionOverride: ReturnType<typeof createTodoDescriptionOverrideHook> | null
  webfetchRedirectGuard: ReturnType<typeof createWebFetchRedirectGuardHook> | null
  fsyncSkipWarning: ReturnType<typeof createFsyncSkipWarningHook> | null
  teamToolGating: ReturnType<typeof createTeamToolGating> | null
  notepadWriteGuard: ReturnType<typeof createNotepadWriteGuardHook> | null
  planFormatValidator: ReturnType<typeof createPlanFormatValidatorHook> | null
}

export function createToolGuardHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}): ToolGuardHooks {
  const { ctx, pluginConfig, modelCacheState, isHookEnabled, safeHookEnabled } = args
  const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
    safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

  const commentChecker = isHookEnabled("comment-checker")
    ? safeHook("comment-checker", () => createCommentCheckerHooks(pluginConfig.comment_checker))
    : null

  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? safeHook("tool-output-truncator", () =>
        createToolOutputTruncatorHook(ctx, {
          modelCacheState,
          experimental: pluginConfig.experimental,
        }))
    : null

  let directoryAgentsInjector: ReturnType<typeof createDirectoryAgentsInjectorHook> | null = null
  if (isHookEnabled("directory-agents-injector")) {
    const currentVersion = getOpenCodeVersion()
    const hasNativeSupport =
      currentVersion !== null && isOpenCodeVersionAtLeast(OPENCODE_NATIVE_AGENTS_INJECTION_VERSION)
    if (hasNativeSupport) {
      log("directory-agents-injector auto-disabled due to native OpenCode support", {
        currentVersion,
        nativeVersion: OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
      })
    } else {
      directoryAgentsInjector = safeHook("directory-agents-injector", () =>
        createDirectoryAgentsInjectorHook(ctx, modelCacheState))
    }
  }

  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? safeHook("directory-readme-injector", () =>
        createDirectoryReadmeInjectorHook(ctx, modelCacheState))
    : null

  const emptyTaskResponseDetector = isHookEnabled("empty-task-response-detector")
    ? safeHook("empty-task-response-detector", () => createEmptyTaskResponseDetectorHook(ctx))
    : null

  const cc = pluginConfig.claude_code
  const skipClaudeUserRules = cc?.hooks === false
  const rulesInjector = isHookEnabled("rules-injector")
    ? safeHook("rules-injector", () =>
        createRulesInjectorHook(ctx, modelCacheState, {
          skipClaudeUserRules,
        }))
    : null

  const knowledgeIndexer = isHookEnabled("knowledge-indexer") && pluginConfig.knowledge?.enabled !== false
    ? safeHook("knowledge-indexer", () => createKnowledgeIndexerHook(ctx, pluginConfig.knowledge))
    : null

  const decisionInjector = isHookEnabled("decision-injector") && pluginConfig.knowledge?.enabled !== false && pluginConfig.knowledge?.inject_decisions !== false
    ? safeHook("decision-injector", () => createDecisionInjectorHook(ctx, pluginConfig.knowledge))
    : null

  const knowledgeOn = pluginConfig.knowledge?.enabled !== false
  const evidenceGate = isHookEnabled("evidence-gate") && knowledgeOn && pluginConfig.knowledge?.evidence_gate !== "off"
    ? safeHook("evidence-gate", () => createEvidenceGateHook(ctx, pluginConfig.knowledge))
    : null
  const citationCheck = isHookEnabled("citation-check") && knowledgeOn && pluginConfig.knowledge?.check_citations !== false
    ? safeHook("citation-check", () => createCitationCheckHook(ctx))
    : null

  const tasksTodowriteDisabler = isHookEnabled("tasks-todowrite-disabler")
    ? safeHook("tasks-todowrite-disabler", () =>
        createTasksTodowriteDisablerHook({ experimental: pluginConfig.experimental }))
    : null

  const writeExistingFileGuard = isHookEnabled("write-existing-file-guard")
    ? safeHook("write-existing-file-guard", () => createWriteExistingFileGuardHook(ctx))
    : null

  // Long-running commands must use process_start; self-destructive kills are refused (fork roadmap 0.8b).
  const managedProcessGuard = isHookEnabled("managed-process-guard") && pluginConfig.processes?.enabled !== false
    ? safeHook("managed-process-guard", () => createManagedProcessGuardHook({ enforceLongRunning: pluginConfig.processes?.enforce !== false }))
    : null

  // Existing tests are read-only while fixing and cheating edits are refused (fork roadmap 0.9a).
  const testIntegrityGuard = isHookEnabled("test-integrity-guard") && pluginConfig.test_integrity?.enabled !== false
    ? safeHook("test-integrity-guard", () => createTestIntegrityGuardHook(ctx))
    : null

  const editDiagnostics = isHookEnabled("edit-diagnostics") && pluginConfig.edit_diagnostics?.enabled !== false
    ? safeHook("edit-diagnostics", () =>
        createEditDiagnosticsHook(ctx, pluginConfig.edit_diagnostics, {}))
    : null

  const bashFileReadGuard = isHookEnabled("bash-file-read-guard")
    ? safeHook("bash-file-read-guard", () => createBashFileReadGuardHook())
    : null

  const hashlineReadEnhancer = isHookEnabled("hashline-read-enhancer")
    ? safeHook("hashline-read-enhancer", () => createHashlineReadEnhancerHook(ctx, { hashline_edit: { enabled: pluginConfig.hashline_edit ?? false } }))
    : null

  const jsonErrorRecovery = isHookEnabled("json-error-recovery")
    ? safeHook("json-error-recovery", () => createJsonErrorRecoveryHook(ctx))
    : null

  const readImageResizer = isHookEnabled("read-image-resizer")
    ? safeHook("read-image-resizer", () => createReadImageResizerHook(ctx))
    : null

  const todoDescriptionOverride = isHookEnabled("todo-description-override")
    ? safeHook("todo-description-override", () => createTodoDescriptionOverrideHook())
    : null

  const webfetchRedirectGuard = isHookEnabled("webfetch-redirect-guard")
    ? safeHook("webfetch-redirect-guard", () => createWebFetchRedirectGuardHook(ctx))
    : null

  const teamToolGating = isHookEnabled("team-tool-gating")
    ? safeHook("team-tool-gating", () => createTeamToolGating(ctx, pluginConfig.team_mode))
    : null

  const fsyncSkipWarning = isHookEnabled("fsync-skip-warning")
    ? safeHook("fsync-skip-warning", () => createFsyncSkipWarningHook())
    : null

  const planFormatValidator = isHookEnabled("plan-format-validator")
    ? safeHook("plan-format-validator", () => createPlanFormatValidatorHook(ctx))
    : null

  const notepadWriteGuard = isHookEnabled("notepad-write-guard")
    ? safeHook("notepad-write-guard", () => createNotepadWriteGuardHook())
    : null

  return {
    commentChecker,
    toolOutputTruncator,
    directoryAgentsInjector,
    directoryReadmeInjector,
    emptyTaskResponseDetector,
    rulesInjector,
    knowledgeIndexer,
    decisionInjector,
    evidenceGate,
    citationCheck,
    tasksTodowriteDisabler,
    writeExistingFileGuard,
    bashFileReadGuard,
    managedProcessGuard,
    testIntegrityGuard,
    editDiagnostics,
    hashlineReadEnhancer,
    jsonErrorRecovery,
    readImageResizer,
    todoDescriptionOverride,
    webfetchRedirectGuard,
    fsyncSkipWarning,
    teamToolGating,
    notepadWriteGuard,
    planFormatValidator,
  }
}
