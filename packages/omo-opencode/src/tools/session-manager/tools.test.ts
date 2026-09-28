import { describe, test, expect } from "bun:test"
import { createSessionManagerTools } from "./tools"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { PluginInput } from "@opencode-ai/plugin"
import type { SessionInfo, SessionMessage, SearchResult, SessionMetadata, TodoItem } from "./types"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const mockCtx = { directory: projectDir } as PluginInput

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createTestTools(extra: Partial<Parameters<typeof createSessionManagerTools>[1]> = {}) {
  return createSessionManagerTools(mockCtx, {
    ...extra,
    setStorageClient: () => {},
    getMainSessions: async (): Promise<SessionMetadata[]> => [
      {
        id: "ses_test123",
        projectID: "project-1",
        directory: projectDir,
        time: { created: Date.now(), updated: Date.now() },
      },
      {
        id: "ses_test456",
        projectID: "project-1",
        directory: projectDir,
        time: { created: Date.now(), updated: Date.now() },
      },
    ],
    filterSessionsByDate: async (sessionIDs) => sessionIDs,
    formatSessionList: async (sessionIDs) => `sessions:${sessionIDs.join(",")}`,
    sessionExists: async (sessionID) => sessionID === "ses_test123",
    readSessionMessages: async (sessionID): Promise<SessionMessage[]> =>
      sessionID === "ses_test123"
        ? [{
            id: `${sessionID}-msg`,
            role: "user",
            time: { created: Date.now() },
            parts: [{ id: `${sessionID}-part`, type: "text", text: "hello" }],
          }]
        : [],
    readSessionTodos: async (): Promise<TodoItem[]> => [],
    formatSessionMessages: (messages) => `messages:${messages.length}`,
    getAllSessions: async () => ["ses_test123", "ses_test456"],
    searchInSession: async (sessionID): Promise<SearchResult[]> => [
      {
        session_id: sessionID,
        message_id: `${sessionID}-msg`,
        excerpt: "test snippet",
        role: "user",
        match_count: 1,
      },
    ],
    formatSearchResults: (results) => `results:${results.length}`,
    getSessionInfo: async (sessionID): Promise<SessionInfo | null> =>
      sessionID === "ses_test123"
        ? {
            id: sessionID,
            message_count: 1,
            first_message: new Date(),
            last_message: new Date(),
            agents_used: ["test-agent"],
            has_todos: false,
            has_transcript: false,
            todos: [],
            transcript_entries: 0,
          }
        : null,
    formatSessionInfo: (info) => `info:${info.id}`,
  })
}

describe("session-manager tools", () => {
  test("session_list executes without error", async () => {
    const { session_list } = createTestTools()
    const result = await session_list.execute({}, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list respects limit parameter", async () => {
    const { session_list } = createTestTools()
    const result = await session_list.execute({ limit: 5 }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list filters by date range", async () => {
    const { session_list } = createTestTools()
    const result = await session_list.execute({
      from_date: "2025-12-01T00:00:00Z",
      to_date: "2025-12-31T23:59:59Z",
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list filters by project_path", async () => {
    const { session_list } = createTestTools()
    //#given
    const projectPath = "/Users/yeongyu/local-workspaces/oh-my-opencode"

    //#when
    const result = await session_list.execute({ project_path: projectPath }, mockContext)

    //#then
    expect(typeof result).toBe("string")
  })

  test("session_list uses ctx.directory as default project_path", async () => {
    const { session_list } = createTestTools()
    //#given - no project_path provided

    //#when
    const result = await session_list.execute({}, mockContext)

    //#then
    expect(typeof result).toBe("string")
  })

  test("session_read handles non-existent session", async () => {
    const { session_read } = createTestTools()
    const result = await session_read.execute({ session_id: "ses_nonexistent" }, mockContext)
    
    expect(result).toContain("not found")
  })

  test("session_read executes with valid parameters", async () => {
    const { session_read } = createTestTools()
    const result = await session_read.execute({
      session_id: "ses_test123",
      include_todos: true,
      include_transcript: true,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_read respects limit parameter", async () => {
    const { session_read } = createTestTools()
    const result = await session_read.execute({
      session_id: "ses_test123",
      limit: 10,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search executes without error", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({ query: "test" }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search filters by session_id", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({
      query: "test",
      session_id: "ses_test123",
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search respects case_sensitive parameter", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({
      query: "TEST",
      case_sensitive: true,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search respects limit parameter", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({
      query: "test",
      limit: 5,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_info handles non-existent session", async () => {
    const { session_info } = createTestTools()
    const result = await session_info.execute({ session_id: "ses_nonexistent" }, mockContext)
    
    expect(result).toContain("not found")
  })

  test("session_info executes with valid session", async () => {
    const { session_info } = createTestTools()
    const result = await session_info.execute({ session_id: "ses_test123" }, mockContext)
    
    expect(typeof result).toBe("string")
  })
})

describe("session_search with the knowledge index", () => {
  test("#given ranked index results #then returns them instead of the substring scan", async () => {
    // given
    const queries: string[] = []
    const { session_search } = createTestTools({
      rankedSearch: async (query) => {
        queries.push(query)
        return "1. [user] ses_a/msg_b/prt_c — Billing (2026-09-28)"
      },
    })

    // when
    const output = await session_search.execute({ query: "billing codename" }, mockContext)

    // then
    expect(queries).toEqual(["billing codename"])
    expect(output).toContain("ses_a/msg_b/prt_c")
    expect(output).not.toContain("results:")
  })

  test("#given no ranked hits #then falls back to the substring scan", async () => {
    // given
    const { session_search } = createTestTools({ rankedSearch: async () => null })

    // when
    const output = await session_search.execute({ query: "hello" }, mockContext)

    // then
    expect(output).toBe("results:2")
  })

  test("#given a session_id or case-sensitive search #then the exact substring scan is used", async () => {
    // given
    let rankedCalls = 0
    const { session_search } = createTestTools({ rankedSearch: async () => { rankedCalls++; return "ranked" } })

    // when
    const inSession = await session_search.execute({ query: "hello", session_id: "ses_test123" }, mockContext)
    const caseSensitive = await session_search.execute({ query: "Hello", case_sensitive: true }, mockContext)

    // then
    expect(inSession).toBe("results:1")
    expect(caseSensitive).toBe("results:2")
    expect(rankedCalls).toBe(0)
  })
})
