import type { ModelRequirement } from "./model-requirement-types"

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode", "bailian-coding-plan", "moonshotai-cn", "firmware", "ollama-cloud", "aihubmix"],
        model: "kimi-k3",
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["zai-coding-plan", "opencode", "bailian-coding-plan"], model: "glm-5.2" },
      { providers: ["opencode"], model: "big-pickle" }
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-sol",
        variant: "medium",
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      }
    ],
    requiresProvider: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
    requiresAnyModel: true,
  },
  oracle: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "xhigh" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" }
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" }
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "low" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      { providers: ["zai-coding-plan"], model: "glm-4.6v" },
      { providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"], model: "gpt-5-nano" }
    ],
  },
  prometheus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "xhigh",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: "kimi-k3",
        variant: "max",
      }
    ],
  },
  metis: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: "kimi-k3",
        variant: "max",
      }
    ],
  },
  momus: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-astra", variant: "xhigh" },
      { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-6-astra", variant: "high" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-5" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" }
    ],
  },
  "sisyphus-junior": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-5" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["opencode"], model: "big-pickle" }
    ],
  },
}

/**
 * Atomic specialists (fork roadmap 2.2) reuse the chain of the builtin agent whose tier they share:
 * fast = explore, medium = sisyphus-junior, strong = oracle. Override per specialist with `agents.<name>.model`.
 */
export const SPECIALIST_MODEL_TIERS = {
  "api-lookup": "fast",
  memory: "fast",
  "dependency-check": "fast",
  verifier: "fast",
  "git-committer": "fast",
  "test-writer": "medium",
  "ui-tester": "medium",
  "test-reviewer": "medium",
  "lang-reviewer": "medium",
  "docs-writer": "medium",
  debugger: "strong",
  "security-reviewer": "strong",
  "architect-reviewer": "strong",
} as const satisfies Record<string, "fast" | "medium" | "strong">

const TIER_SOURCE_AGENT = { fast: "explore", medium: "sisyphus-junior", strong: "oracle" } as const

for (const [name, tier] of Object.entries(SPECIALIST_MODEL_TIERS)) {
  const source = AGENT_MODEL_REQUIREMENTS[TIER_SOURCE_AGENT[tier]]
  if (source) AGENT_MODEL_REQUIREMENTS[name] = { ...source, fallbackChain: [...source.fallbackChain] }
}
