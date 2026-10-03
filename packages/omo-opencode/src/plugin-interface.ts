import { GROUNDING_GUIDANCE } from "./features/knowledge/grounding"
import { PROCESS_GUIDANCE } from "./features/managed-process/guidance"
import { TEST_INTEGRITY_GUIDANCE } from "./features/test-integrity/guidance"
import { createPausedWorkGuidance } from "./features/resume/paused-guidance"
import type { PluginContext, PluginInterface, ToolsRecord } from "./plugin/types"
import type { OhMyOpenCodeConfig } from "./config"

import { applyAgentVariant } from "./shared/agent-variant"
import { createChatParamsHandler } from "./plugin/chat-params"
import { createChatHeadersHandler } from "./plugin/chat-headers"
import { createChatMessageHandler } from "./plugin/chat-message"
import { createCommandExecuteBeforeHandler } from "./plugin/command-execute-before"
import { createMessagesTransformHandler } from "./plugin/messages-transform"
import { createSystemTransformHandler } from "./plugin/system-transform"
import { getUltraworkMessage } from "./hooks/keyword-detector/ultrawork"
import { createEventHandler } from "./plugin/event"
import { createToolDefinitionHandler } from "./plugin/tool-definition"
import { createToolExecuteAfterHandler } from "./plugin/tool-execute-after"
import { createToolExecuteBeforeHandler } from "./plugin/tool-execute-before"

import type { CreatedHooks } from "./create-hooks"
import type { Managers } from "./create-managers"

export function createPluginInterface(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: {
    shouldOverride: (sessionID: string) => boolean
    markApplied: (sessionID: string) => void
    markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
    clear: (sessionID: string) => void
  }
  managers: Managers
  hooks: CreatedHooks
  tools: ToolsRecord
}): PluginInterface {
  const { ctx, pluginConfig, firstMessageVariantGate, managers, hooks, tools } =
    args

  return {
    tool: tools,

    "chat.params": async (input: unknown, output: unknown) => {
      const chatParamsInput = input as {
        agent?: string | { name?: string }
        model?: { providerID?: unknown; modelID?: unknown; id?: unknown }
        message?: { variant?: string }
      }
      const agentName =
        typeof chatParamsInput.agent === "string"
          ? chatParamsInput.agent
          : chatParamsInput.agent?.name
      const providerID = chatParamsInput.model?.providerID
      const rawModelID = chatParamsInput.model?.modelID ?? chatParamsInput.model?.id
      const modelID = typeof rawModelID === "string" ? rawModelID : undefined
      if (chatParamsInput.message && typeof providerID === "string" && modelID !== undefined) {
        applyAgentVariant(pluginConfig, agentName, chatParamsInput.message, { providerID, modelID })
      }
      const handler = createChatParamsHandler({
        client: ctx.client,
      })
      await handler(input, output)
    },

    "chat.headers": createChatHeadersHandler({ ctx }),

    "command.execute.before": createCommandExecuteBeforeHandler({
      directory: ctx.directory,
      hooks,
    }),

    "chat.message": createChatMessageHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      hooks,
    }),

    "experimental.chat.messages.transform": createMessagesTransformHandler({
      hooks,
    }),

    "experimental.chat.system.transform": createSystemTransformHandler(
      pluginConfig.default_mode,
      getUltraworkMessage,
      hooks.keywordDetector,
      pluginConfig.knowledge?.enabled === false ? undefined : GROUNDING_GUIDANCE,
      pluginConfig.processes?.enabled === false ? undefined : PROCESS_GUIDANCE,
      pluginConfig.resume?.enabled === false ? undefined : createPausedWorkGuidance(ctx.directory),
      pluginConfig.test_integrity?.enabled === false || pluginConfig.disabled_hooks?.includes("test-integrity-guard") ? undefined : TEST_INTEGRITY_GUIDANCE,
    ),

    config: managers.configHandler,

    event: createEventHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      managers,
      hooks,
    }),

    "tool.definition": createToolDefinitionHandler({
      hooks,
    }),

    "tool.execute.before": createToolExecuteBeforeHandler({
      ctx,
      hooks,
      backgroundManager: managers.backgroundManager,
    }),

    "tool.execute.after": createToolExecuteAfterHandler({
      ctx,
      hooks,
    }),
  }
}
