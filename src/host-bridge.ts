import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { LabelEntry, SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import { buildSessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { buildLabelMaps, type LabelMaps } from "./lib.js";

/** Named error codes for missing or malformed host capabilities and unsafe operations. */
export type HostBridgeErrorCode =
  | "missing_capability"
  | "malformed_capability"
  | "entry_not_found"
  | "label_conflict"
  | "label_not_created_here"
  | "unsafe_clear";

/** Discriminated result returned by guarded Host Bridge operations. */
export type HostBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: HostBridgeErrorCode; message: string; details?: unknown };

/** Runtime capabilities detected on the host SessionManager. */
export interface HostBridgeCapabilities {
  appendLabelChange: boolean;
  branchWithSummary: boolean;
}

/** Information returned when a checkpoint label is appended. */
export interface AppendCheckpointLabelResult {
  labelEntryId: string;
  targetId: string;
  name: string;
  status: "created" | "already_present";
  aliases: string[];
}

/** Information about an existing label owner on a conflict. */
export interface CheckpointLabelConflict {
  entryId: string;
  onActivePath: boolean;
}

/** Information returned when a created label is safely cleared. */
export interface ClearCreatedLabelResult {
  clearEntryId: string;
  targetId: string;
  label: string;
}

/** Information returned by branchWithSummary. */
export interface BranchWithSummaryResult {
  summaryEntryId: string;
  branchFromId: string;
  summary: string;
}

interface CreatedLabel {
  labelEntryId: string;
  targetId: string;
  label: string;
}

function ok<T>(value: T): HostBridgeResult<T> {
  return { ok: true, value };
}

function err<T>(error: HostBridgeErrorCode, message: string, details?: unknown): HostBridgeResult<T> {
  return { ok: false, error, message, details };
}

function hasFunction(sm: unknown, name: string): boolean {
  if (sm === null || typeof sm !== "object") return false;
  const record = sm as Record<string, unknown>;
  return name in record && typeof record[name] === "function";
}

function isLabelEntry(entry: SessionEntry): entry is LabelEntry {
  return entry.type === "label";
}

function getHostMethod<T>(sm: unknown, name: string): T | undefined {
  if (!hasFunction(sm, name)) return undefined;
  const record = sm as Record<string, unknown>; // verified object shape in hasFunction
  const fn = record[name];
  // Bind to the SessionManager instance so private fields (e.g. #index) remain accessible.
  return Function.prototype.bind.call(fn as Function, sm) as T;
}

/**
 * Narrow Host Bridge: the only guarded runtime access boundary to non-public
 * OMP SessionManager capabilities used by ACM.
 *
 * The bridge validates method presence, callable shape, required arguments, and
 * returned identifiers before reporting success. Missing or malformed
 * capabilities return named, actionable errors instead of throwing opaque cast
 * failures.
 */
export class HostBridge {
  readonly capabilities: HostBridgeCapabilities;
  private readonly createdLabels = new Map<string, CreatedLabel>();

  constructor(private readonly sm: ReadonlySessionManager) {
    this.capabilities = {
      appendLabelChange: hasFunction(sm, "appendLabelChange"),
      branchWithSummary: hasFunction(sm, "branchWithSummary"),
    };
  }

  /** All session entries. */
  getEntries(): SessionEntry[] {
    return this.sm.getEntries();
  }

  /** Session tree view. */
  getTree(): SessionTreeNode[] {
    return this.sm.getTree();
  }

  /** Active branch from the given entry (or current leaf) back to root. */
  getBranch(fromId?: string): SessionEntry[] {
    return this.sm.getBranch(fromId);
  }

  /** Current leaf entry ID. */
  getLeafId(): string | null {
    return this.sm.getLeafId();
  }

  /** Look up a single entry by ID. */
  getEntry(id: string): SessionEntry | undefined {
    return this.sm.getEntry(id);
  }

  /** Build label alias maps from the current entries. */
  buildLabelMaps(): LabelMaps {
    return buildLabelMaps(this.sm.getEntries());
  }

  /** Active branch entry IDs as a set. */
  getBranchIds(): Set<string> {
    return new Set(this.sm.getBranch().map((entry) => entry.id));
  }

  /**
   * Build the LLM message array from the session entries.
   * Uses the public OMP buildSessionContext() export, never a runtime cast.
   * When leafId is omitted, uses the current leaf.
   */
  buildSessionMessages(leafId?: string | null): HostBridgeResult<AgentMessage[]> {
    try {
      const entries = this.sm.getEntries();
      const effectiveLeaf = leafId === undefined ? this.sm.getLeafId() : leafId;
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const ctx = buildSessionContext(entries, effectiveLeaf, byId);
      return ok(ctx.messages as AgentMessage[]);
    } catch (e) {
      return err("malformed_capability", `Failed to build session messages: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Append a checkpoint label to a session entry.
   *
   * Enforces:
   * - method presence and returned identifier validation
   * - tree-wide, case-sensitive name uniqueness
   * - same-node same-name idempotence
   * - same-node second alias preserves the first alias
   */
  appendCheckpointLabel(targetId: string, name: string): HostBridgeResult<AppendCheckpointLabelResult> {
    if (!this.capabilities.appendLabelChange) {
      return err(
        "missing_capability",
        "SessionManager does not support appendLabelChange — cannot create checkpoint label",
      );
    }

    if (!this.sm.getEntry(targetId)) {
      return err("entry_not_found", `Entry ${targetId} not found`, { targetId });
    }

    const labelMaps = this.buildLabelMaps();
    const branchIds = this.getBranchIds();

    const existingOwner = labelMaps.labelToEntryId.get(name);
    if (existingOwner && existingOwner !== targetId) {
      const conflict: CheckpointLabelConflict = {
        entryId: existingOwner,
        onActivePath: branchIds.has(existingOwner),
      };
      return err(
        "label_conflict",
        `Checkpoint name '${name}' already exists at ${existingOwner}`,
        conflict,
      );
    }

    const priorAliases = labelMaps.entryToLabels.get(targetId) ?? [];
    if (priorAliases.includes(name)) {
      const existingLabelEntry = this.sm.getEntries().find(
        (entry) => isLabelEntry(entry) && entry.targetId === targetId && entry.label === name,
      );
      return ok({
        labelEntryId: existingLabelEntry?.id ?? "",
        targetId,
        name,
        status: "already_present",
        aliases: priorAliases,
      });
    }

    const appendLabelChange = getHostMethod<(id: string, label: string | undefined) => string>(this.sm, "appendLabelChange");
    const labelEntryId = appendLabelChange!(targetId, name);

    if (typeof labelEntryId !== "string" || labelEntryId.length === 0) {
      return err(
        "malformed_capability",
        `appendLabelChange returned an invalid entry id: ${typeof labelEntryId}`,
        { returned: labelEntryId },
      );
    }

    this.createdLabels.set(labelEntryId, { labelEntryId, targetId, label: name });

    return ok({
      labelEntryId,
      targetId,
      name,
      status: "created",
      aliases: [...priorAliases, name],
    });
  }

  /**
   * Safely clear a label created by this bridge instance.
   *
   * Allowed only when:
   * - the label entry was created by this bridge
   * - the target entry currently has exactly this one alias
   *
   * This guarantees the clear removes only the bridge-created label and no
   * prior aliases belonging to other operations.
   */
  clearCreatedLabel(labelEntryId: string): HostBridgeResult<ClearCreatedLabelResult> {
    const created = this.createdLabels.get(labelEntryId);
    if (!created) {
      return err(
        "label_not_created_here",
        "Label was not created by this Host Bridge instance — cannot safely clear",
      );
    }

    if (!this.capabilities.appendLabelChange) {
      return err(
        "missing_capability",
        "SessionManager does not support appendLabelChange — cannot clear checkpoint label",
      );
    }

    const currentAliases = this.buildLabelMaps().entryToLabels.get(created.targetId) ?? [];
    if (currentAliases.length !== 1 || currentAliases[0] !== created.label) {
      return err(
        "unsafe_clear",
        "Target entry has prior aliases or additional labels; cannot safely clear this label",
        { targetId: created.targetId, currentAliases },
      );
    }

    const appendLabelChange = getHostMethod<(id: string, label: string | undefined) => string>(this.sm, "appendLabelChange");
    const clearEntryId = appendLabelChange!(created.targetId, undefined);

    if (typeof clearEntryId !== "string" || clearEntryId.length === 0) {
      return err(
        "malformed_capability",
        `appendLabelChange returned an invalid entry id: ${typeof clearEntryId}`,
        { returned: clearEntryId },
      );
    }

    this.createdLabels.delete(labelEntryId);

    return ok({
      clearEntryId,
      targetId: created.targetId,
      label: created.label,
    });
  }

  /**
   * Branch from an entry and append a branch_summary entry.
   *
   * Validates method presence, target existence, and returned summary entry id.
   */
  branchWithSummary(branchFromId: string, summary: string, details?: unknown): HostBridgeResult<BranchWithSummaryResult> {
    if (!this.capabilities.branchWithSummary) {
      return err(
        "missing_capability",
        "SessionManager does not support branchWithSummary — cannot travel",
      );
    }

    if (!this.sm.getEntry(branchFromId)) {
      return err("entry_not_found", `Entry ${branchFromId} not found`, { branchFromId });
    }

    const branchWithSummary = getHostMethod<(id: string | null, summary: string, details?: unknown, fromExtension?: boolean) => string>(this.sm, "branchWithSummary");
    // Capability was already checked via this.capabilities; getHostMethod is a narrow accessor.
    const summaryEntryId = branchWithSummary!(branchFromId, summary, details, true);

    if (typeof summaryEntryId !== "string" || summaryEntryId.length === 0) {
      return err(
        "malformed_capability",
        `branchWithSummary returned an invalid entry id: ${typeof summaryEntryId}`,
        { returned: summaryEntryId },
      );
    }

    return ok({ summaryEntryId, branchFromId, summary });
  }
}

const hostBridges = new WeakMap<object, HostBridge>();

/** Get or create a Host Bridge for a SessionManager instance. */
export function getHostBridge(sm: ReadonlySessionManager): HostBridge {
  let bridge = hostBridges.get(sm);
  if (!bridge) {
    bridge = new HostBridge(sm);
    hostBridges.set(sm, bridge);
  }
  return bridge;
}
