import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import type { SessionManager, ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import * as zod from "zod/v4";
import registerACMExtension from "./.acm-build/index.js";
import { RECOVERY_GUIDANCE } from "./.acm-build/generated-guidance.js";
import { useHostSessionHarnesses } from "./harness.js";
const VALID_HANDOFF = [
  "Goal: exercise context reconstruction",
  "State: summary branch selected",
  "Evidence: real SessionManager fixture",
  "External: none",
  "Exclusions: abandoned raw branch",
  "Recover: fixture root",
  "NEXT: continue from reconstructed context",
].join("\n");

type Handler = (event: any, ctx: ExtensionContext) => unknown;

interface CapturedRuntime {
  handlers: Map<string, Handler[]>;
  tools: Map<string, ToolDefinition>;
}

const createHarness = useHostSessionHarnesses();

function captureRuntime(): CapturedRuntime {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, ToolDefinition>();
  const api = {
    zod,
    on(name: string, handler: Handler) {
      const existing = handlers.get(name) ?? [];
      existing.push(handler);
      handlers.set(name, existing);
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };
  registerACMExtension(api as unknown as ExtensionAPI);
  return { handlers, tools };
}

function runtimeContext(
  sessionManager: ReadonlySessionManager,
  notifications: string[] = [],
): ExtensionContext {
  return {
    sessionManager,
    getContextUsage: () => ({ tokens: 1_200, contextWindow: 100_000, percent: 1.2 }),
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionContext;
}

function contextHandler(runtime: CapturedRuntime): Handler {
  const handler = runtime.handlers.get("context")?.[0];
  if (!handler) throw new Error("context handler was not registered");
  return handler;
}

async function runTravel(
  runtime: CapturedRuntime,
  sessionManager: ReadonlySessionManager,
  target: string,
) {
  const tool = runtime.tools.get("acm_travel");
  if (!tool) throw new Error("acm_travel was not registered");
  return tool.execute(
    "context-rebuild-fixture",
    { target, summary: VALID_HANDOFF },
    undefined,
    undefined,
    runtimeContext(sessionManager),
  );
}

async function runTimeline(runtime: CapturedRuntime, sessionManager: ReadonlySessionManager) {
  const tool = runtime.tools.get("acm_timeline");
  if (!tool) throw new Error("acm_timeline was not registered");
  return tool.execute(
    "context-rebuild-timeline",
    {},
    undefined,
    undefined,
    runtimeContext(sessionManager),
  );
}

function appendAssistantText(session: SessionManager, value: string): string {
  return session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: value }],
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  });
}

function appendInitialBranch(session: SessionManager): { userId: string; abandonedId: string } {
  const userId = session.appendMessage({
    role: "user",
    content: [{ type: "text", text: "root request" }],
    timestamp: Date.now(),
  });
  const abandonedId = appendAssistantText(session, "abandoned raw investigation");
  return { userId, abandonedId };
}

function asMessages(result: unknown): AgentMessage[] {
  if (typeof result !== "object" || result === null || !("messages" in result)) {
    throw new Error("context handler did not return replacement messages");
  }
  return (result as { messages: AgentMessage[] }).messages;
}

function serialized(messages: AgentMessage[]): string {
  return JSON.stringify(messages);
}

function controllableSessionView(session: SessionManager) {
  let failBuild = false;
  const view = {
    getEntries() {
      if (failBuild) throw new Error("fixture context build failed");
      return session.getEntries();
    },
    getTree: session.getTree.bind(session),
    getBranch: session.getBranch.bind(session),
    getLeafId: session.getLeafId.bind(session),
    getEntry: session.getEntry.bind(session),
    appendLabelChange: session.appendLabelChange.bind(session),
    branchWithSummary: session.branchWithSummary.bind(session),
  } as unknown as ReadonlySessionManager;
  return {
    view,
    failBuild(value: boolean) {
      failBuild = value;
    },
  };
}

describe("public context reconstruction with real OMP SessionManager", () => {
  test("rebuilds from the selected summary leaf on every later context event", async () => {
    const harness = createHarness();
    const { userId } = appendInitialBranch(harness.session);
    const runtime = captureRuntime();
    const travel = await runTravel(runtime, harness.session, userId);
    expect((travel.details as Record<string, unknown>).contextRefreshPending).toBe(true);

    const first = asMessages(await contextHandler(runtime)(
      { messages: [{ role: "user", content: [{ type: "text", text: "stale host context" }] }] },
      runtimeContext(harness.session),
    ));
    expect(serialized(first)).toContain("summary branch selected");
    expect(serialized(first)).not.toContain("abandoned raw investigation");
    expect(serialized(first)).not.toContain("stale host context");

    harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "later user turn" }],
      timestamp: Date.now(),
    });
    appendAssistantText(harness.session, "later assistant turn");

    const second = asMessages(await contextHandler(runtime)(
      { messages: first },
      runtimeContext(harness.session),
    ));
    expect(serialized(second)).toContain("later user turn");
    expect(serialized(second)).toContain("later assistant turn");
    expect(serialized(second)).not.toContain("abandoned raw investigation");
  });

  test("sanitizes a restored orphaned travel result without an in-memory marker", async () => {
    const harness = createHarness();
    const { userId } = appendInitialBranch(harness.session);
    const originalRuntime = captureRuntime();
    await runTravel(originalRuntime, harness.session, userId);
    harness.session.appendMessage({
      role: "toolResult",
      toolCallId: "orphaned-acm-travel",
      toolName: "acm_travel",
      content: [{ type: "text", text: "persisted travel result" }],
      isError: false,
      timestamp: Date.now(),
    });
    harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "request after restored travel" }],
      timestamp: Date.now(),
    });

    const reloaded = await harness.reload();
    const restoredRuntime = captureRuntime();
    const start = restoredRuntime.handlers.get("session_start")?.[0];
    if (!start) throw new Error("session_start handler was not registered");
    await start({ reason: "resume" }, runtimeContext(reloaded));

    const outbound = reloaded.buildSessionContext().messages as AgentMessage[];
    expect(serialized(outbound)).toContain("persisted travel result");
    const sanitized = asMessages(await contextHandler(restoredRuntime)(
      { messages: outbound },
      runtimeContext(reloaded),
    ));
    expect(serialized(sanitized)).not.toContain("orphaned-acm-travel");
    expect(serialized(sanitized)).not.toContain("persisted travel result");
    expect(serialized(sanitized)).toContain("request after restored travel");
    expect(serialized(sanitized)).toContain("summary branch selected");
  });

  test("repairs a tool call whose result remains only on the abandoned branch", async () => {
    const harness = createHarness();
    harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "inspect the parser" }],
      timestamp: Date.now(),
    });
    const assistantId = harness.session.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-read", name: "read", arguments: { path: "parser.ts" } }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    harness.session.appendMessage({
      role: "toolResult",
      toolCallId: "call-read",
      toolName: "read",
      content: [{ type: "text", text: "abandoned parser source" }],
      isError: false,
      timestamp: Date.now(),
    });

    const outbound = harness.session.getBranch(assistantId)
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message) as AgentMessage[];
    expect(serialized(outbound)).toContain("call-read");
    expect(serialized(outbound)).not.toContain("abandoned parser source");

    const runtime = captureRuntime();
    const rebuilt = asMessages(await contextHandler(runtime)(
      { messages: outbound },
      runtimeContext(harness.session),
    ));
    const repaired = rebuilt.find(
      (message) => message.role === "toolResult" && message.toolCallId === "call-read",
    );
    expect(repaired?.role).toBe("toolResult");
    if (repaired?.role === "toolResult") {
      expect(repaired.isError).toBe(true);
      expect(serialized([repaired])).toContain("Interrupted by context travel");
    }
    expect(serialized(rebuilt)).not.toContain("abandoned parser source");
  });

  test("preserves valid tool pairs and unrelated content when no rebuild is pending", async () => {
    const harness = createHarness();
    harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "valid pair request" }],
      timestamp: Date.now(),
    });
    harness.session.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-valid", name: "read", arguments: { path: "valid.ts" } }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    harness.session.appendMessage({
      role: "toolResult",
      toolCallId: "call-valid",
      toolName: "read",
      content: [{ type: "text", text: "valid result" }],
      isError: false,
      timestamp: Date.now(),
    });
    appendAssistantText(harness.session, "unrelated conclusion");

    const messages = harness.session.buildSessionContext().messages as AgentMessage[];
    const result = await contextHandler(captureRuntime())(
      { messages },
      runtimeContext(harness.session),
    );
    expect(result).toBeUndefined();
    expect(serialized(messages)).toContain("call-valid");
    expect(serialized(messages)).toContain("valid result");
    expect(serialized(messages)).toContain("unrelated conclusion");
  });

  test("recovers after a transient build failure and clears retry evidence", async () => {
    const harness = createHarness();
    const { userId } = appendInitialBranch(harness.session);
    const controlled = controllableSessionView(harness.session);
    const runtime = captureRuntime();
    await runTravel(runtime, controlled.view, userId);
    const notifications: string[] = [];
    const ctx = runtimeContext(controlled.view, notifications);
    const hostMessages = [{ role: "user", content: [{ type: "text", text: "host fallback" }] }];

    controlled.failBuild(true);
    expect(await contextHandler(runtime)({ messages: hostMessages }, ctx)).toEqual({ messages: hostMessages });
    expect(notifications.at(-1)).toContain("Will retry on the next LLM turn");

    controlled.failBuild(false);
    const recovered = asMessages(await contextHandler(runtime)({ messages: hostMessages }, ctx));
    expect(serialized(recovered)).toContain("summary branch selected");
    expect(serialized(recovered)).not.toContain("host fallback");

    const timeline = await runTimeline(runtime, controlled.view);
    expect((timeline.details as Record<string, unknown>).contextRefreshPending).toBe(true);
    expect((timeline.details as Record<string, unknown>).contextRefreshFailure).toBeNull();
  });

  test("bounds failed rebuilds, preserves host context, and exposes a reload path", async () => {
    const harness = createHarness();
    const { userId } = appendInitialBranch(harness.session);
    const controlled = controllableSessionView(harness.session);
    const runtime = captureRuntime();
    await runTravel(runtime, controlled.view, userId);
    const notifications: string[] = [];
    const ctx = runtimeContext(controlled.view, notifications);
    const hostMessages = [{ role: "user", content: [{ type: "text", text: "authoritative host fallback" }] }];

    controlled.failBuild(true);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await contextHandler(runtime)({ messages: hostMessages }, ctx)).toEqual({ messages: hostMessages });
    }
    expect(notifications).toHaveLength(3);
    expect(notifications.at(-1)).toContain(RECOVERY_GUIDANCE.refreshExhausted);

    controlled.failBuild(false);
    const timeline = await runTimeline(runtime, controlled.view);
    expect((timeline.details as Record<string, unknown>).contextRefreshPending).toBe(false);
    expect((timeline.details as Record<string, unknown>).contextRefreshFailure).toContain("fixture context build failed");
    expect(timeline.content.map((part) => part.type === "text" ? part.text : "").join("\n"))
      .toContain(RECOVERY_GUIDANCE.refreshExhausted);

    expect(await contextHandler(runtime)({ messages: hostMessages }, ctx)).toBeUndefined();
  });
});
