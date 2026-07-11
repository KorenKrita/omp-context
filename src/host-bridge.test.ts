import { describe, expect, test } from "bun:test";
import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import {
  appendCheckpointLabel,
  applyBranchWithSummary,
  buildSessionMessages,
  getHostCapabilities,
  rollbackCheckpointLabel,
} from "./host-bridge.js";

function fakeMessage(id: string, role: "user" | "assistant"): SessionEntry {
  return {
    id,
    type: "message",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role, content: [{ type: "text", text: "hi" }] },
  } as unknown as SessionEntry;
}

function fakeLabel(id: string, targetId: string, label: string | undefined): SessionEntry {
  return {
    id,
    type: "label",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    targetId,
    label,
  } as SessionEntry;
}

interface FakeSessionControls {
  entries: SessionEntry[];
  getLeaf(): string | null;
  setLeaf(id: string | null): void;
}

interface MinimalOptions {
  entries?: SessionEntry[];
  leafId?: string | null;
  appendLabelChange?: (
    id: string,
    label: string | undefined,
    controls: FakeSessionControls,
  ) => unknown;
  branchWithSummary?: (
    id: string | null,
    summary: string,
    details: unknown,
    fromExtension: boolean | undefined,
    controls: FakeSessionControls,
  ) => unknown;
}

function makeMinimalSession(options: MinimalOptions = {}): ReadonlySessionManager {
  const entries = options.entries ?? [fakeMessage("e1", "user")];
  let leafId = options.leafId ?? entries.at(-1)?.id ?? null;
  const controls: FakeSessionControls = {
    entries,
    getLeaf: () => leafId,
    setLeaf: (id) => { leafId = id; },
  };
  const appendLabelChange = options.appendLabelChange ?? ((id: string, label: string | undefined) => {
    const entryId = `label-${entries.length}`;
    entries.push(fakeLabel(entryId, id, label));
    return entryId;
  });
  const branchWithSummary = options.branchWithSummary ?? ((id: string | null, summary: string, details: unknown) => {
    const summaryId = `summary-${entries.length}`;
    entries.push({
      id: summaryId,
      type: "branch_summary",
      parentId: id,
      timestamp: "2026-01-01T00:00:00.000Z",
      fromId: id ?? "root",
      summary,
      details,
    } as SessionEntry);
    leafId = summaryId;
    return summaryId;
  });
  const session = {
    getEntries: () => entries,
    getTree: () => entries.map((entry) => ({ entry, children: [] })),
    getBranch: () => entries,
    getLeafId: () => leafId,
    getEntry: (id: string) => entries.find((entry) => entry.id === id),
    getLabel: () => undefined,
    appendLabelChange: (id: string, label: string | undefined) => appendLabelChange(id, label, controls),
    branchWithSummary: (id: string | null, summary: string, details?: unknown, fromExtension?: boolean) =>
      branchWithSummary(id, summary, details, fromExtension, controls),
  };
  return session as unknown as ReadonlySessionManager;
}

describe("typed host mutation ports", () => {
  test("detects only the guarded mutation capabilities", () => {
    expect(getHostCapabilities(makeMinimalSession())).toEqual({ appendLabelChange: true, branchWithSummary: true });
    const withoutMutations = {
      getEntries: () => [],
      getTree: () => [],
      getBranch: () => [],
      getLeafId: () => null,
      getEntry: () => undefined,
    } as unknown as ReadonlySessionManager;
    expect(getHostCapabilities(withoutMutations)).toEqual({ appendLabelChange: false, branchWithSummary: false });
  });

  test("builds messages through the public session-context implementation", () => {
    const session = makeMinimalSession({ entries: [fakeMessage("e1", "user"), fakeMessage("e2", "assistant")], leafId: "e2" });
    const result = buildSessionMessages(session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0]).toMatchObject({ role: "assistant" } satisfies Partial<AgentMessage>);
  });

  test("creates labels idempotently and preserves aliases", () => {
    const entries = [fakeMessage("e1", "user")];
    const session = makeMinimalSession({ entries });
    const first = appendCheckpointLabel(session, "e1", "first");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state).toBe("applied");
    expect(first.value.rollback?.priorAliases).toEqual([]);

    const second = appendCheckpointLabel(session, "e1", "second");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.aliases).toEqual(["first", "second"]);

    const duplicate = appendCheckpointLabel(session, "e1", "second");
    expect(duplicate).toMatchObject({ ok: true, state: "not_applied", value: { status: "already_present" } });
  });

  test("returns a typed collision without mutation", () => {
    const entries = [fakeMessage("e1", "user"), fakeLabel("l1", "e1", "taken"), fakeMessage("e2", "assistant")];
    const session = makeMinimalSession({ entries, leafId: "e2" });
    const result = appendCheckpointLabel(session, "e2", "taken");
    expect(result).toMatchObject({
      ok: false,
      state: "not_applied",
      error: "label_conflict",
      details: { entryId: "e1", onActivePath: true },
    });
  });

  test("reports not_applied when a malformed host makes no mutation", () => {
    const session = makeMinimalSession({ appendLabelChange: () => "" });
    const result = appendCheckpointLabel(session, "e1", "checkpoint");
    expect(result).toMatchObject({ ok: false, state: "not_applied", error: "malformed_capability" });
  });

  test("accepts an observed label mutation even when the host returns malformed data", () => {
    const session = makeMinimalSession({
      appendLabelChange(id, label, controls) {
        controls.entries.push(fakeLabel("observed-label", id, label));
        return undefined;
      },
    });
    const result = appendCheckpointLabel(session, "e1", "checkpoint");
    expect(result).toMatchObject({
      ok: true,
      state: "applied",
      value: { labelEntryId: "observed-label", status: "created" },
    });
  });

  test("operation-scoped rollback restores prior aliases", () => {
    const entries = [fakeMessage("e1", "user"), fakeLabel("l1", "e1", "keeper")];
    const session = makeMinimalSession({ entries });
    const append = appendCheckpointLabel(session, "e1", "temporary");
    expect(append.ok).toBe(true);
    if (!append.ok || !append.value.rollback) return;

    const rollback = rollbackCheckpointLabel(session, append.value.rollback);
    expect(rollback).toMatchObject({ ok: true, state: "applied", value: { restoredAliases: ["keeper"] } });
  });

  test("accepts an observed summary mutation despite a malformed return", () => {
    const session = makeMinimalSession({
      branchWithSummary(id, summary, details, _fromExtension, controls) {
        controls.entries.push({
          id: "observed-summary",
          type: "branch_summary",
          parentId: id,
          timestamp: "2026-01-01T00:00:00.000Z",
          fromId: id ?? "root",
          summary,
          details,
        } as SessionEntry);
        controls.setLeaf("observed-summary");
        return "missing-summary";
      },
    });
    const result = applyBranchWithSummary(session, "e1", "summary");
    expect(result).toMatchObject({
      ok: true,
      state: "applied",
      value: { summaryEntryId: "observed-summary", hostReturnedEntryId: "missing-summary" },
    });
  });

  test("distinguishes not_applied from indeterminate branch failures", () => {
    const unchanged = makeMinimalSession({ branchWithSummary: () => "" });
    expect(applyBranchWithSummary(unchanged, "e1", "summary")).toMatchObject({
      ok: false,
      state: "not_applied",
    });

    const changed = makeMinimalSession({
      branchWithSummary(_id, _summary, _details, _fromExtension, controls) {
        controls.setLeaf("unexpected-leaf");
        return "";
      },
    });
    expect(applyBranchWithSummary(changed, "e1", "summary")).toMatchObject({
      ok: false,
      state: "indeterminate",
      details: { leafAfter: "unexpected-leaf" },
    });
  });
});
