import { describe, expect, test } from "bun:test";
import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import { HostBridge, getHostBridge } from "./host-bridge.js";

function fakeMessage(id: string, role: "user" | "assistant"): SessionEntry {
  return {
    id,
    type: "message",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role, content: [{ type: "text", text: "hi" }] },
  } as unknown as SessionEntry;
}

function fakeLabelEntry(id: string, targetId: string, label: string): SessionEntry {
  return {
    id,
    type: "label",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    targetId,
    label,
  } as unknown as SessionEntry;
}

interface MinimalSMOptions {
  entries?: SessionEntry[];
  leafId?: string | null;
  appendLabelChange?: (entries: SessionEntry[], id: string, label: string | undefined) => string;
  branchWithSummary?: (id: string | null, summary: string, details?: unknown, fromExtension?: boolean) => string;
  buildSessionContext?: () => { messages: AgentMessage[] };
}

function makeMinimalSM(overrides?: MinimalSMOptions): ReadonlySessionManager {
  const entries = overrides?.entries ?? [fakeMessage("e1", "user")];
  const leafId = overrides?.leafId ?? "e1";

  const appendLabelChange = overrides?.appendLabelChange
    ? (id: string, label: string | undefined) => overrides.appendLabelChange!(entries, id, label)
    : undefined;

  return {
    getEntries: () => entries,
    getTree: () => entries.map((entry) => ({ entry, children: [] })),
    getBranch: () => entries,
    getLeafId: () => leafId,
    getEntry: (id: string) => entries.find((e) => e.id === id),
    getLabel: () => undefined,
    ...(appendLabelChange ? { appendLabelChange } : {}),
    ...(overrides?.branchWithSummary ? { branchWithSummary: overrides.branchWithSummary } : {}),
    ...(overrides?.buildSessionContext ? { buildSessionContext: overrides.buildSessionContext } : {}),
  } as unknown as ReadonlySessionManager;
}

function mutatingAppendLabelChange(entries: SessionEntry[], id: string, label: string | undefined): string {
  const labelEntryId = `label-${entries.length}`;
  if (label === undefined) {
    entries.push({
      id: labelEntryId,
      type: "label",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      targetId: id,
      label: undefined,
    } as unknown as SessionEntry);
  } else {
    entries.push(fakeLabelEntry(labelEntryId, id, label));
  }
  return labelEntryId;
}

describe("HostBridge capabilities", () => {
  test("detects available capabilities", () => {
    const sm = makeMinimalSM({
      appendLabelChange: mutatingAppendLabelChange,
      branchWithSummary: () => "summary-id",
      buildSessionContext: () => ({ messages: [] }),
    });
    const bridge = new HostBridge(sm);
    expect(bridge.capabilities).toEqual({
      appendLabelChange: true,
      branchWithSummary: true,
    });
  });

  test("detects missing capabilities", () => {
    const sm = makeMinimalSM();
    const bridge = new HostBridge(sm);
    expect(bridge.capabilities).toEqual({
      appendLabelChange: false,
      branchWithSummary: false,
    });
  });

  test("getHostBridge returns the same instance for the same SessionManager", () => {
    const sm = makeMinimalSM();
    const a = getHostBridge(sm);
    const b = getHostBridge(sm);
    expect(a).toBe(b);
  });
});

describe("HostBridge structural reads", () => {
  test("exposes entries, tree, branch, leaf, entry, label", () => {
    const entries = [fakeMessage("e1", "user"), fakeMessage("e2", "assistant")];
    const sm = makeMinimalSM({ entries, leafId: "e2" });
    const bridge = new HostBridge(sm);

    expect(bridge.getEntries()).toEqual(entries);
    expect(bridge.getTree()).toHaveLength(2);
    expect(bridge.getBranch()).toEqual(entries);
    expect(bridge.getLeafId()).toBe("e2");
    expect(bridge.getEntry("e1")?.id).toBe("e1");
    expect(bridge.getEntry("missing")).toBeUndefined();
  });
});

describe("HostBridge buildSessionMessages", () => {
  test("builds messages for current leaf using standalone builder", () => {
    const entries = [fakeMessage("e1", "user"), fakeMessage("e2", "assistant")];
    const sm = makeMinimalSM({
      entries,
      leafId: "e2",
    });
    const bridge = new HostBridge(sm);
    const result = bridge.buildSessionMessages();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
  });

  test("uses standalone builder for explicit leafId", () => {
    const entries = [fakeMessage("e1", "user"), fakeMessage("e2", "assistant")];
    const sm = makeMinimalSM({
      entries,
      leafId: "e2",
      buildSessionContext: () => ({ messages: [{ role: "assistant", content: [{ type: "text", text: "current" }] }] as unknown as AgentMessage[] }),
    });
    const bridge = new HostBridge(sm);
    const result = bridge.buildSessionMessages("e1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Standalone builder uses entries and leafId; result should reflect e1 path.
    expect(result.value).toBeDefined();
    expect(result.value.length).toBeGreaterThan(0);
  });
});

describe("HostBridge appendCheckpointLabel", () => {
  test("returns missing_capability when appendLabelChange is absent", () => {
    const sm = makeMinimalSM();
    const bridge = new HostBridge(sm);
    const result = bridge.appendCheckpointLabel("e1", "checkpoint");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("missing_capability");
  });

  test("returns entry_not_found for unknown target", () => {
    const sm = makeMinimalSM({ appendLabelChange: mutatingAppendLabelChange });
    const bridge = new HostBridge(sm);
    const result = bridge.appendCheckpointLabel("missing", "checkpoint");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("entry_not_found");
  });

  test("returns malformed_capability when appendLabelChange returns invalid id", () => {
    const sm = makeMinimalSM({ appendLabelChange: () => "" });
    const bridge = new HostBridge(sm);
    const result = bridge.appendCheckpointLabel("e1", "checkpoint");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("malformed_capability");
  });

  test("returns label_conflict when name already exists on another node", () => {
    const entries = [fakeMessage("e1", "user"), fakeLabelEntry("l1", "e2", "taken"), fakeMessage("e2", "user")];
    const sm = makeMinimalSM({ entries, leafId: "e2", appendLabelChange: mutatingAppendLabelChange });
    const bridge = new HostBridge(sm);
    const result = bridge.appendCheckpointLabel("e1", "taken");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("label_conflict");
    expect(result.details).toEqual({ entryId: "e2", onActivePath: true });
  });

  test("is idempotent for same-node same-name", () => {
    const entries = [fakeLabelEntry("l1", "e2", "mine"), fakeMessage("e2", "user")];
    const sm = makeMinimalSM({ entries, leafId: "e2", appendLabelChange: mutatingAppendLabelChange });
    const bridge = new HostBridge(sm);
    const result = bridge.appendCheckpointLabel("e2", "mine");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("already_present");
    expect(result.value.aliases).toEqual(["mine"]);
  });

  test("preserves existing alias when adding a second alias", () => {
    const entries = [fakeLabelEntry("l1", "e2", "first"), fakeMessage("e2", "user")];
    const sm = makeMinimalSM({
      entries,
      leafId: "e2",
      appendLabelChange: mutatingAppendLabelChange,
    });
    const bridge = new HostBridge(sm);
    const result = bridge.appendCheckpointLabel("e2", "second");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("created");
    expect(result.value.aliases).toEqual(["first", "second"]);
  });

  test("case-sensitive name uniqueness", () => {
    const entries = [fakeLabelEntry("l1", "e2", "Case"), fakeMessage("e2", "user")];
    const sm = makeMinimalSM({ entries, leafId: "e2", appendLabelChange: mutatingAppendLabelChange });
    const bridge = new HostBridge(sm);
    const conflict = bridge.appendCheckpointLabel("e2", "case");
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) return;
    expect(conflict.value.status).toBe("created");

    const duplicate = bridge.appendCheckpointLabel("e2", "case");
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.value.status).toBe("already_present");
  });
});

describe("HostBridge clearCreatedLabel", () => {
  test("returns label_not_created_here for unknown label entry", () => {
    const sm = makeMinimalSM({ appendLabelChange: mutatingAppendLabelChange });
    const bridge = new HostBridge(sm);
    const result = bridge.clearCreatedLabel("unknown");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("label_not_created_here");
  });

  test("returns unsafe_clear when target has prior aliases", () => {
    const entries = [fakeLabelEntry("l1", "e2", "prior"), fakeMessage("e2", "user")];
    const sm = makeMinimalSM({ entries, leafId: "e2", appendLabelChange: mutatingAppendLabelChange });
    const bridge = new HostBridge(sm);
    const append = bridge.appendCheckpointLabel("e2", "new");
    expect(append.ok).toBe(true);
    if (!append.ok) return;

    const clear = bridge.clearCreatedLabel(append.value.labelEntryId);
    expect(clear.ok).toBe(false);
    if (clear.ok) return;
    expect(clear.error).toBe("unsafe_clear");
  });

  test("safely clears a label created this operation on a clean target", () => {
    const sm = makeMinimalSM({ appendLabelChange: mutatingAppendLabelChange });
    const bridge = new HostBridge(sm);
    const append = bridge.appendCheckpointLabel("e1", "new");
    expect(append.ok).toBe(true);
    if (!append.ok) return;

    const clear = bridge.clearCreatedLabel(append.value.labelEntryId);
    expect(clear.ok).toBe(true);
    if (!clear.ok) return;
    expect(clear.value.label).toBe("new");
    expect(clear.value.clearEntryId).toBeDefined();

    const labelMaps = bridge.buildLabelMaps();
    expect(labelMaps.entryToLabels.get("e1")).toBeUndefined();
  });
});

describe("HostBridge branchWithSummary", () => {
  test("returns missing_capability when branchWithSummary is absent", () => {
    const sm = makeMinimalSM();
    const bridge = new HostBridge(sm);
    const result = bridge.branchWithSummary("e1", "summary");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("missing_capability");
  });

  test("returns entry_not_found for unknown branch point", () => {
    const sm = makeMinimalSM({ branchWithSummary: () => "summary-id" });
    const bridge = new HostBridge(sm);
    const result = bridge.branchWithSummary("missing", "summary");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("entry_not_found");
  });

  test("returns malformed_capability when branchWithSummary returns invalid id", () => {
    const sm = makeMinimalSM({ branchWithSummary: () => "" });
    const bridge = new HostBridge(sm);
    const result = bridge.branchWithSummary("e1", "summary");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("malformed_capability");
  });

  test("branches with summary and returns summary entry id", () => {
    const sm = makeMinimalSM({ branchWithSummary: () => "summary-id" });
    const bridge = new HostBridge(sm);
    const result = bridge.branchWithSummary("e1", "summary", { originId: "o1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summaryEntryId).toBe("summary-id");
  });
});
