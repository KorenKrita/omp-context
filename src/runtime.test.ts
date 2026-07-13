import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type {
  AgentSessionAdapterInstallationOutcome,
  AgentSessionSyncOutcome,
  LiveAgentSessionAdapter,
} from "./live-agent-session-adapter.js";
import { registerAcmLifecycle } from "./runtime-lifecycle.js";
import { AcmSessionRuntime } from "./runtime.js";

class RecordingAdapter implements LiveAgentSessionAdapter {
  readonly installation: AgentSessionAdapterInstallationOutcome = { status: "ready" };
  readonly pending = new WeakMap<object, { toolCallId: string; preferredLeafId?: string }>();
  readonly outcomes = new WeakMap<object, AgentSessionSyncOutcome>();
  failNext = false;

  schedule(session: object, toolCallId: string, preferredLeafId?: string): AgentSessionSyncOutcome {
    this.pending.set(session, { toolCallId, preferredLeafId });
    const outcome: AgentSessionSyncOutcome = preferredLeafId
      ? { status: "pending", preferredLeafId }
      : { status: "pending" };
    this.outcomes.set(session, outcome);
    return outcome;
  }

  apply(session: object, toolCallId: string): AgentSessionSyncOutcome {
    const pending = this.pending.get(session);
    if (!pending || pending.toolCallId !== toolCallId) {
      return { status: "skipped", reason: "not_pending", message: "idle" };
    }
    this.pending.delete(session);
    const outcome: AgentSessionSyncOutcome = this.failNext
      ? { status: "failed", reason: "replace_messages_failed", message: "replacement refused" }
      : { status: "applied", leafId: null, messageCount: 1 };
    this.failNext = false;
    this.outcomes.set(session, outcome);
    return outcome;
  }

  getStatus(session: object): AgentSessionSyncOutcome {
    return this.outcomes.get(session) ?? { status: "skipped", reason: "not_pending", message: "idle" };
  }

  clear(session: object): void {
    this.pending.delete(session);
    this.outcomes.delete(session);
  }
}

describe("AcmSessionRuntime live synchronization failures", () => {
  test("a mismatched tool completion cannot consume pending work", () => {
    const adapter = new RecordingAdapter();
    const runtime = new AcmSessionRuntime(adapter);
    const session = {};

    runtime.scheduleLiveAgentSync(session, "travel-new", "leaf-new");
    expect(runtime.applyLiveAgentSync(session, "travel-old")).toMatchObject({
      status: "skipped",
      reason: "not_pending",
    });
    expect(runtime.getLiveAgentSyncStatus(session)).toMatchObject({
      status: "pending",
      preferredLeafId: "leaf-new",
    });
    expect(runtime.applyLiveAgentSync(session, "travel-new")).toMatchObject({ status: "applied" });
  });

  test("session lifecycle boundaries discard stale pending work and permit recapture", async () => {
    for (const eventName of ["session_start", "session_compact", "session_shutdown"] as const) {
      const adapter = new RecordingAdapter();
      const runtime = new AcmSessionRuntime(adapter);
      const session = {};
      const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
      const api = {
        on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
          const current = handlers.get(name) ?? [];
          current.push(handler);
          handlers.set(name, current);
        },
      } as unknown as ExtensionAPI;
      registerAcmLifecycle(api, runtime);

      runtime.scheduleLiveAgentSync(session, `${eventName}-old`, "old-leaf");
      for (const handler of handlers.get(eventName) ?? []) {
        await handler({}, { sessionManager: session });
      }
      expect(runtime.applyLiveAgentSync(session, `${eventName}-old`)).toMatchObject({
        status: "skipped",
        reason: "not_pending",
      });

      runtime.scheduleLiveAgentSync(session, `${eventName}-new`, "new-leaf");
      expect(runtime.applyLiveAgentSync(session, `${eventName}-new`)).toMatchObject({ status: "applied" });
    }
  });

  test("a terminal failure clears only its request and permits a later travel", () => {
    const adapter = new RecordingAdapter();
    const runtime = new AcmSessionRuntime(adapter);
    const session = {};
    adapter.failNext = true;

    runtime.scheduleLiveAgentSync(session, "travel-failed", "leaf-one");
    expect(runtime.applyLiveAgentSync(session, "travel-failed")).toMatchObject({
      status: "failed",
      reason: "replace_messages_failed",
    });
    expect(runtime.applyLiveAgentSync(session, "travel-failed")).toMatchObject({
      status: "skipped",
      reason: "not_pending",
    });

    runtime.scheduleLiveAgentSync(session, "travel-later", "leaf-two");
    expect(runtime.applyLiveAgentSync(session, "travel-later")).toMatchObject({ status: "applied" });
  });
});
