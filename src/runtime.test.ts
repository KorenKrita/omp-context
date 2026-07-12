import { describe, expect, test } from "bun:test";
import type {
  AgentSessionSyncOutcome,
  LiveAgentSessionAdapter,
} from "./live-agent-session-adapter.js";
import { AcmSessionRuntime } from "./runtime.js";

class RecordingAdapter implements LiveAgentSessionAdapter {
  readonly installation: AgentSessionSyncOutcome = {
    status: "skipped",
    reason: "not_pending",
    message: "idle",
  };
  readonly pending = new WeakMap<object, string | undefined>();
  readonly outcomes = new WeakMap<object, AgentSessionSyncOutcome>();
  failNext = false;

  schedule(session: object, preferredLeafId?: string): AgentSessionSyncOutcome {
    this.pending.set(session, preferredLeafId);
    const outcome: AgentSessionSyncOutcome = preferredLeafId
      ? { status: "pending", preferredLeafId }
      : { status: "pending" };
    this.outcomes.set(session, outcome);
    return outcome;
  }

  apply(session: object): AgentSessionSyncOutcome {
    if (!this.pending.has(session)) {
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
    return this.outcomes.get(session) ?? this.installation;
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
