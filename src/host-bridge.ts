import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { LabelEntry, SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import { buildSessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { buildLabelMaps, type LabelMaps } from "./lib.js";

/** Named error codes for missing or malformed host capabilities and unsafe operations. */
export type HostBridgeErrorCode =
  | "missing_capability"
  | "malformed_capability"
  | "host_operation_failed"
  | "branch_verification_failed"
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

/** Mutation-free checkpoint label plan. */
export interface CheckpointLabelPrevalidation {
  targetId: string;
  name: string;
  status: "would_create" | "already_present";
  aliases: string[];
  existingLabelEntryId?: string;
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

/** Mutation-free branch plan. */
export interface BranchWithSummaryPrevalidation {
  branchFromId: string;
  leafBefore: string | null;
}

/** Structural facts captured when branch creation cannot be reported as successful. */
export interface BranchWithSummaryFailureDetails {
  branchFromId: string;
  leafBefore: string | null;
  leafAfter: string | null;
  mutationApplied: boolean;
  returnedSummaryEntryId?: unknown;
  actualSummaryEntryId?: string;
}

/** Information returned by branchWithSummary. */
export interface BranchWithSummaryResult {
  summaryEntryId: string;
  branchFromId: string;
  summary: string;
  leafBefore: string | null;
  leafAfter: string;
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

  /** Inspect checkpoint-label capability, target, and uniqueness without mutation. */
  prevalidateCheckpointLabel(targetId: string, name: string): HostBridgeResult<CheckpointLabelPrevalidation> {
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
    const existingOwner = labelMaps.labelToEntryId.get(name);
    if (existingOwner && existingOwner !== targetId) {
      const conflict: CheckpointLabelConflict = {
        entryId: existingOwner,
        onActivePath: this.getBranchIds().has(existingOwner),
      };
      return err(
        "label_conflict",
        `Checkpoint name '${name}' already exists at ${existingOwner}`,
        conflict,
      );
    }

    const aliases = labelMaps.entryToLabels.get(targetId) ?? [];
    if (aliases.includes(name)) {
      const existingLabelEntry = this.sm.getEntries().find(
        (entry) => isLabelEntry(entry) && entry.targetId === targetId && entry.label === name,
      );
      return ok({
        targetId,
        name,
        status: "already_present",
        aliases,
        existingLabelEntryId: existingLabelEntry?.id,
      });
    }

    return ok({ targetId, name, status: "would_create", aliases });
  }

  /** Append a checkpoint label after repeating mutation-free structural validation. */
  appendCheckpointLabel(targetId: string, name: string): HostBridgeResult<AppendCheckpointLabelResult> {
    const prevalidation = this.prevalidateCheckpointLabel(targetId, name);
    if (!prevalidation.ok) return prevalidation;

    if (prevalidation.value.status === "already_present") {
      if (!prevalidation.value.existingLabelEntryId) {
        return err(
          "malformed_capability",
          `Checkpoint '${name}' is present in the alias map but has no label journal entry`,
          { targetId, name },
        );
      }
      return ok({
        labelEntryId: prevalidation.value.existingLabelEntryId,
        targetId,
        name,
        status: "already_present",
        aliases: prevalidation.value.aliases,
      });
    }

    const appendLabelChange = getHostMethod<(id: string, label: string | undefined) => unknown>(this.sm, "appendLabelChange");
    let returned: unknown;
    try {
      returned = appendLabelChange!(targetId, name);
    } catch (error) {
      return err(
        "host_operation_failed",
        `appendLabelChange failed: ${error instanceof Error ? error.message : String(error)}`,
        { targetId, name },
      );
    }

    if (typeof returned !== "string" || returned.length === 0) {
      return err(
        "malformed_capability",
        `appendLabelChange returned an invalid entry id: ${typeof returned}`,
        { returned, targetId, name },
      );
    }
    const labelEntryId = returned;

    const labelEntry = this.sm.getEntry(labelEntryId);
    const labelOwner = this.buildLabelMaps().labelToEntryId.get(name);
    if (!labelEntry || !isLabelEntry(labelEntry) || labelEntry.targetId !== targetId || labelEntry.label !== name || labelOwner !== targetId) {
      return err(
        "malformed_capability",
        "appendLabelChange did not create the expected label journal entry",
        { labelEntryId, targetId, name, labelOwner },
      );
    }

    this.createdLabels.set(labelEntryId, { labelEntryId, targetId, label: name });

    return ok({
      labelEntryId,
      targetId,
      name,
      status: "created",
      aliases: [...prevalidation.value.aliases, name],
    });
  }

  /**
   * Safely clear a label created by this bridge instance.
   *
   * Allowed only when the target currently has exactly the bridge-created
   * label, so rollback cannot remove aliases owned by another operation.
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
        { targetId: created.targetId, currentAliases, labelStillPresent: currentAliases.includes(created.label) },
      );
    }

    const appendLabelChange = getHostMethod<(id: string, label: string | undefined) => unknown>(this.sm, "appendLabelChange");
    let returned: unknown;
    try {
      returned = appendLabelChange!(created.targetId, undefined);
    } catch (error) {
      const aliasesAfterFailure = this.buildLabelMaps().entryToLabels.get(created.targetId) ?? [];
      return err(
        "host_operation_failed",
        `appendLabelChange rollback failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          targetId: created.targetId,
          label: created.label,
          labelStillPresent: aliasesAfterFailure.includes(created.label),
        },
      );
    }

    const aliasesAfterClear = this.buildLabelMaps().entryToLabels.get(created.targetId) ?? [];
    if (typeof returned !== "string" || returned.length === 0 || aliasesAfterClear.includes(created.label)) {
      return err(
        "malformed_capability",
        "appendLabelChange did not produce a verifiable label clear",
        {
          returned,
          targetId: created.targetId,
          label: created.label,
          labelStillPresent: aliasesAfterClear.includes(created.label),
        },
      );
    }

    this.createdLabels.delete(labelEntryId);
    return ok({ clearEntryId: returned, targetId: created.targetId, label: created.label });
  }

  /** Inspect branch capability and target existence without mutation. */
  prevalidateBranchWithSummary(branchFromId: string): HostBridgeResult<BranchWithSummaryPrevalidation> {
    if (!this.capabilities.branchWithSummary) {
      return err(
        "missing_capability",
        "SessionManager does not support branchWithSummary — cannot travel",
      );
    }
    if (!this.sm.getEntry(branchFromId)) {
      return err("entry_not_found", `Entry ${branchFromId} not found`, { branchFromId });
    }
    return ok({ branchFromId, leafBefore: this.sm.getLeafId() });
  }

  /** Branch and verify the returned summary entry and resulting leaf. */
  branchWithSummary(branchFromId: string, summary: string, details?: unknown): HostBridgeResult<BranchWithSummaryResult> {
    const prevalidation = this.prevalidateBranchWithSummary(branchFromId);
    if (!prevalidation.ok) return prevalidation;
    const { leafBefore } = prevalidation.value;
    const branchWithSummary = getHostMethod<(
      id: string | null,
      summary: string,
      details?: unknown,
      fromExtension?: boolean,
    ) => unknown>(this.sm, "branchWithSummary");

    let returned: unknown;
    try {
      returned = branchWithSummary!(branchFromId, summary, details, true);
    } catch (error) {
      const leafAfter = this.sm.getLeafId();
      const leafEntry = leafAfter ? this.sm.getEntry(leafAfter) : undefined;
      const failure: BranchWithSummaryFailureDetails = {
        branchFromId,
        leafBefore,
        leafAfter,
        mutationApplied: leafAfter !== leafBefore,
        actualSummaryEntryId: leafEntry?.type === "branch_summary" ? leafAfter ?? undefined : undefined,
      };
      return err(
        "host_operation_failed",
        `branchWithSummary failed: ${error instanceof Error ? error.message : String(error)}`,
        failure,
      );
    }

    const leafAfter = this.sm.getLeafId();
    const leafEntry = leafAfter ? this.sm.getEntry(leafAfter) : undefined;
    const actualSummaryEntryId = leafEntry?.type === "branch_summary" ? leafAfter ?? undefined : undefined;
    const failure: BranchWithSummaryFailureDetails = {
      branchFromId,
      leafBefore,
      leafAfter,
      mutationApplied: leafAfter !== leafBefore,
      returnedSummaryEntryId: returned,
      actualSummaryEntryId,
    };

    if (typeof returned !== "string" || returned.length === 0) {
      return err(
        "branch_verification_failed",
        `branchWithSummary returned an invalid entry id: ${typeof returned}`,
        failure,
      );
    }

    const summaryEntry = this.sm.getEntry(returned);
    if (
      !summaryEntry ||
      summaryEntry.type !== "branch_summary" ||
      summaryEntry.parentId !== branchFromId ||
      summaryEntry.summary !== summary
    ) {
      return err(
        "branch_verification_failed",
        "branchWithSummary did not create the expected summary entry",
        failure,
      );
    }

    if (leafAfter !== returned) {
      return err(
        "branch_verification_failed",
        `branchWithSummary returned ${returned}, but the resulting leaf is ${leafAfter ?? "null"}`,
        failure,
      );
    }

    return ok({ summaryEntryId: returned, branchFromId, summary, leafBefore, leafAfter: returned });
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
