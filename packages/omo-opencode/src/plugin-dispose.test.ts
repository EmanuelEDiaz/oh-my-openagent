import { describe, expect, spyOn, test } from "bun:test"

import { disposeCreatedHooks } from "./create-hooks"
import { createPluginDispose } from "./plugin-dispose"

describe("createPluginDispose", () => {
  test("#given plugin with active managers and hooks #when dispose() is called #then backgroundManager.shutdown() is called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(shutdownSpy).toHaveBeenCalledTimes(1)
  })

  test("#given plugin with a TUI mirror #when dispose() is called #then the mirror is stopped", async () => {
    // given
    const tuiStateMirror = { stop: (): void => {} }
    const stopSpy = spyOn(tuiStateMirror, "stop")
    const dispose = createPluginDispose({
      backgroundManager: { shutdown: async (): Promise<void> => {} },
      skillMcpManager: { disconnectAll: async (): Promise<void> => {} },
      tuiStateMirror,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(stopSpy).toHaveBeenCalledTimes(1)
  })

  test("#given plugin with active MCP connections #when dispose() is called #then skillMcpManager.disconnectAll() is called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
  })

  test("#given plugin with hooks that have dispose #when dispose() is called #then each hook's dispose is called", async () => {
    // given
    const claudeCodeHooks = {
      dispose: (): void => {},
    }
    const commentChecker = {
      dispose: (): void => {},
    }
    const runtimeFallback = {
      dispose: (): void => {},
    }
    const atlasHook = {
      dispose: (): void => {},
    }
    const todoContinuationEnforcer = {
      dispose: (): void => {},
    }
    const autoSlashCommand = {
      dispose: (): void => {},
    }
    const claudeCodeHooksDisposeSpy = spyOn(claudeCodeHooks, "dispose")
    const commentCheckerDisposeSpy = spyOn(commentChecker, "dispose")
    const runtimeFallbackDisposeSpy = spyOn(runtimeFallback, "dispose")
    const atlasHookDisposeSpy = spyOn(atlasHook, "dispose")
    const todoContinuationEnforcerDisposeSpy = spyOn(todoContinuationEnforcer, "dispose")
    const autoSlashCommandDisposeSpy = spyOn(autoSlashCommand, "dispose")
    const dispose = createPluginDispose({
      backgroundManager: {
      shutdown: async (): Promise<void> => {},
      },
      skillMcpManager: {
        disconnectAll: async (): Promise<void> => {},
      },
      disposeHooks: (): void => {
        disposeCreatedHooks({
          claudeCodeHooks,
          commentChecker,
          runtimeFallback,
          atlasHook,
          todoContinuationEnforcer,
          autoSlashCommand,
        })
      },
    })

    // when
    await dispose()

    // then
    expect(claudeCodeHooksDisposeSpy).toHaveBeenCalledTimes(1)
    expect(commentCheckerDisposeSpy).toHaveBeenCalledTimes(1)
    expect(runtimeFallbackDisposeSpy).toHaveBeenCalledTimes(1)
    expect(atlasHookDisposeSpy).toHaveBeenCalledTimes(1)
    expect(todoContinuationEnforcerDisposeSpy).toHaveBeenCalledTimes(1)
    expect(autoSlashCommandDisposeSpy).toHaveBeenCalledTimes(1)
  })

  test("#given dispose already called #when dispose() called again #then no errors", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const disposeHooks = {
      run: (): void => {},
    }
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const disposeHooksSpy = spyOn(disposeHooks, "run")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: disposeHooks.run,
    })

    // when
    await dispose()
    await dispose()

    // then
      expect(shutdownSpy).toHaveBeenCalledTimes(1)
      expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
      expect(disposeHooksSpy).toHaveBeenCalledTimes(1)
  })

  test("#given backgroundManager.shutdown() throws #when dispose() is called #then skillMcpManager.disconnectAll() and disposeHooks() are still called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {
        throw new Error("shutdown failed")
      },
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const disposeHooksCalls: number[] = []
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {
        disposeHooksCalls.push(1)
      },
    })

    // when
    await dispose()

    // then
    expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
    expect(disposeHooksCalls).toHaveLength(1)
  })

  test("#given skillMcpManager.disconnectAll() throws #when dispose() is called #then disposeHooks() is still called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {
        throw new Error("disconnectAll failed")
      },
    }
    const disposeHooksCalls: number[] = []
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {
        disposeHooksCalls.push(1)
      },
    })

    // when
    await dispose()

    // then
    expect(shutdownSpy).toHaveBeenCalledTimes(1)
    expect(disposeHooksCalls).toHaveLength(1)
  })

  test("#given a resume service #when OpenCode disposes the instance #then its memory timer stops (bench 19-10-2026)", async () => {
    // given
    const resumeService = { dispose: (): void => {} }
    const disposeSpy = spyOn(resumeService, "dispose")
    const dispose = createPluginDispose({
      backgroundManager: { shutdown: async (): Promise<void> => {} },
      skillMcpManager: { disconnectAll: async (): Promise<void> => {} },
      resumeService,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  test("#given the interruption tracker #when OpenCode disposes the instance #then its heartbeat stops (incidents H12)", async () => {
    // given
    const resilience = { dispose: (): void => {} }
    const spy = spyOn(resilience, "dispose")
    const dispose = createPluginDispose({
      backgroundManager: { shutdown: async (): Promise<void> => {} },
      skillMcpManager: { disconnectAll: async (): Promise<void> => {} },
      resilience,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test("#given the stall watchdog and network guard #when OpenCode disposes the instance #then their timers stop too (incidents H12)", () => {
    // given
    const stallWatchdog = { dispose: (): void => {} }
    const networkGuard = { dispose: (): void => {} }
    const stallSpy = spyOn(stallWatchdog, "dispose")
    const networkSpy = spyOn(networkGuard, "dispose")

    // when
    disposeCreatedHooks({ stallWatchdog, networkGuard })

    // then
    expect(stallSpy).toHaveBeenCalledTimes(1)
    expect(networkSpy).toHaveBeenCalledTimes(1)
  })
})

