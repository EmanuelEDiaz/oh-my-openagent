import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

import { registerBtwSideTui } from "./features/btw-side"
import { registerNativeEditionNudgeTui } from "./features/native-edition-nudge"
import { registerOmoModelsTui } from "./features/omo-models"
import { computeView, viewKey } from "./features/tui-sidebar/compute-view"
import { mkdirSync, watch, type FSWatcher } from "node:fs"
import { basename, dirname } from "node:path"

import { mirrorFilePath } from "./features/tui-sidebar/mirror-path"
import { deriveAgents, deriveConfig, deriveConnection, deriveJobBoard, deriveLoop, deriveRoster } from "./features/tui-sidebar/derivers"
import type { ViewNode } from "./features/tui-sidebar/element-helpers"
import { readMirror } from "./features/tui-sidebar/mirror-io"
import { buildViewNodes } from "./features/tui-sidebar/render-view"
import type { RosterRow } from "./features/tui-sidebar/state-types"
import type { SidebarView } from "./features/tui-sidebar/state-types"
import { log } from "./shared/logger"
import { trackLoadedPluginSandbox } from "./hooks/auto-update-checker/checker/sandbox-refresh"

type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (parent: Node, child: Node | string) => unknown
  readonly setProp: (node: Node, name: string, value: unknown) => unknown
}

type SidebarSlotRegistration<Node> = {
  readonly order: number
  readonly slots: {
    readonly sidebar_content: () => Node | (() => Node)
  }
}

type RegisterSidebarContentSlotInput<Node> = {
  readonly registerSlot: (registration: SidebarSlotRegistration<Node>) => void
  readonly requestRender: () => void
  readonly renderSidebar: () => Node
}

export function registerSidebarContentSlot<Node>({
  registerSlot,
  requestRender,
  renderSidebar,
}: RegisterSidebarContentSlotInput<Node>): void {
  registerSlot({
    order: 900,
    slots: {
      sidebar_content: () => renderSidebar,
    },
  })
  requestRender()
}

function materialize<Node>(nodes: readonly ViewNode[], solid: SolidRuntime<Node>): Node {
  const root = solid.createElement("box")
  solid.setProp(root, "flexDirection", "column")
  for (const node of nodes) {
    solid.insert(root, materializeNode(node, solid))
  }
  return root
}

function materializeNode<Node>(node: ViewNode, solid: SolidRuntime<Node>): Node {
  const element = solid.createElement(node.kind)
  for (const [name, value] of Object.entries(node.props)) {
    solid.setProp(element, name, value)
  }
  if (node.kind === "text") {
    solid.insert(element, node.text ?? "")
  }
  for (const child of node.children ?? []) {
    solid.insert(element, materializeNode(child, solid))
  }
  return element
}

type RosterResolver = (directory: string) => RosterRow[]
type PluginValidation = {
  readonly valid: boolean
  readonly messages: readonly string[]
  readonly config: {
    readonly tui?: {
      readonly sidebar?: {
        readonly enabled?: boolean
      }
    }
  }
}

async function loadPluginValidation(directory: string): Promise<PluginValidation> {
  const { validatePluginConfig } = await import("./config/validate")
  return validatePluginConfig(directory)
}

async function loadRosterRows(directory: string): Promise<readonly RosterRow[]> {
  const { resolveRoster } = await import("./features/tui-sidebar/roster-resolver")
  const resolver: RosterResolver = resolveRoster
  return resolver(directory)
}

type StaticParts = { readonly config: ReturnType<typeof deriveConfig>; readonly roster: ReturnType<typeof deriveRoster> }

/** Config and roster only change when OpenCode restarts: computed once, not on every refresh. */
async function readStaticParts(directory: string, validation?: PluginValidation): Promise<StaticParts> {
  return {
    config: deriveConfig(validation ?? (await loadPluginValidation(directory))),
    roster: deriveRoster(await loadRosterRows(directory)),
  }
}

function readView(directory: string, parts: StaticParts): SidebarView {
  const mirror = readMirror(directory)
  return computeView({
    ...parts,
    agents: deriveAgents(mirror),
    jobs: deriveJobBoard(mirror),
    loop: deriveLoop(mirror),
    connection: deriveConnection(mirror),
  })
}

/** Refreshes after the server rewrites its state file: a file-system watch, no polling. */
export function watchMirror(directory: string, onChange: () => void): FSWatcher | undefined {
  const file = mirrorFilePath(directory)
  try {
    // The directory may not exist before the server's first write.
    mkdirSync(dirname(file), { recursive: true })
    const watcher = watch(dirname(file), { persistent: false }, (_event, name) => {
      if (!name || basename(String(name)).startsWith(basename(file).replace(/\.json$/, ""))) onChange()
    })
    watcher.on("error", () => watcher.close())
    return watcher
  } catch {
    return undefined
  }
}

export function handleTuiPollError(
  error: unknown,
  reportPollError: (error: Error) => void = (pollError) => log("[tui-sidebar] polling failed", { error: pollError }),
): void {
  if (error instanceof Error) {
    reportPollError(error)
    return
  }
  throw error
}

const module: TuiPluginModule = {
  id: "oh-my-openagent:tui",
  tui: async (api) => {
    // The TUI plugin runs on OpenCode's main thread, the only thread that
    // emits `exit`; it applies a sandbox refresh the server plugin requested.
    trackLoadedPluginSandbox()

    const solid = await import("@opentui/solid").catch(() => null)
    if (!solid) {
      return
    }

    try {
      await registerBtwSideTui(api, solid)
    } catch (error) {
      log("[btw-side] TUI registration failed", { error })
    }

    try {
      registerNativeEditionNudgeTui(api as never)
    } catch (error) {
      log("[native-edition-nudge] TUI registration failed", { error })
    }

    try {
      registerOmoModelsTui(api as never)
    } catch (error) {
      log("[omo-models] TUI registration failed", { error })
    }

    const directory = api.state.path.directory

    const validation = await loadPluginValidation(directory)
    if (validation.config.tui?.sidebar?.enabled === false) {
      return
    }
    const parts = await readStaticParts(directory, validation)
    let currentView = readView(directory, parts)
    let currentKey = viewKey(currentView)
    let timer: ReturnType<typeof setTimeout> | null = null

    registerSidebarContentSlot({
      registerSlot: (registration) => {
        api.slots.register(registration)
      },
      requestRender: () => {
        api.renderer.requestRender()
      },
      renderSidebar: () => materialize(buildViewNodes(currentView, api.theme.current), solid),
    })

    const refresh = (): void => {
      try {
        const nextView = readView(directory, parts)
        const nextKey = viewKey(nextView)
        if (nextKey !== currentKey) {
          currentView = nextView
          currentKey = nextKey
          api.renderer.requestRender()
        }
      } catch (error) {
        handleTuiPollError(error)
      }
    }
    // Coalesce bursts of writes (the server debounces too) into one read.
    const scheduleRefresh = (): void => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        refresh()
      }, 120)
    }

    // No polling: refresh when the server's state file changes, or, if the file system cannot be watched, when
    // OpenCode reports session activity.
    const watcher = watchMirror(directory, scheduleRefresh)
    const unsubscribe: Array<() => void> = []
    if (!watcher) {
      const events = api.event as unknown as { on?: (type: string, handler: () => void) => (() => void) | undefined }
      for (const type of ["session.status", "session.idle", "session.created", "session.error", "message.part.updated"]) {
        const off = events.on?.(type, scheduleRefresh)
        if (off) unsubscribe.push(off)
      }
    }
    api.lifecycle.onDispose(() => {
      if (timer) clearTimeout(timer)
      watcher?.close()
      for (const off of unsubscribe) off()
    })
  },
}

export default module
