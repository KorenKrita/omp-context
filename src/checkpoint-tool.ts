import type { infer as Static } from "zod/v4";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { Text } from "@oh-my-pi/pi-tui";
import {
  buildLabelMaps,
  formatContextUsage,
  isReservedTargetName,
  sanitizeTerminalText,
  isValidEntryId,
  resolveTargetId,
} from "./lib.js";
import { rebuildAcmContextPacket, type AcmProtocolNormalization } from "./context-packet.js";
import {
  appendCheckpointLabel,
  type CheckpointLabelConflict,
} from "./host-bridge.js";
import {
  describeEntrySnippet,
  findEntryInTree,
  getMessageRoleLabel,
  isCheckpointableMessage,
} from "./entry-resolution.js";
import { findContainingAssistantToolBatch, type ToolProtocolDefect, type ToolProtocolRepair } from "./tool-protocol.js";
import { GUIDANCE_CUES, RECOVERY_GUIDANCE, TOOL_DESCRIPTIONS } from "./generated-guidance.js";
import { withAvailableAdvancedGuidance } from "./advanced-guidance.js";

interface SkippedCheckpointAnchor {
  id: string;
  reason: "context_build_failed" | "protocol_repaired" | "protocol_invalid";
  message?: string;
  repairs?: ToolProtocolRepair[];
  defects?: ToolProtocolDefect[];
}

interface AutomaticCheckpointAnchor {
  entryId: string | null;
  role?: string;
  snippet?: string;
  protocolStatus?: "complete";
  normalizations: AcmProtocolNormalization[];
  skipped: SkippedCheckpointAnchor[];
  aborted?: boolean;
}

export function registerCheckpointTool(pi: ExtensionAPI): void {
  const schema = pi.zod.object({
    name: pi.zod.string().min(1).regex(/^[A-Za-z0-9._-]+$/).describe(
      "Semantic save-point name; unique and case-sensitive across the session tree ('root' is reserved). Name the state a future search should find, e.g. payments-retry-baseline. Suffixes are naming convention only; they never classify workflow state.",
    ),
    target: pi.zod.string().min(1).describe(
      "History node ID or checkpoint name to label. Omit to anchor on the latest protocol-complete leaf before this call; pass an explicit target only to label a deliberately chosen older node.",
    ).optional(),
  }).strict();

  pi.registerTool({
    name: "acm_checkpoint",
    label: "ACM Checkpoint",
    description: TOOL_DESCRIPTIONS.checkpoint,
    parameters: schema,
    renderCall(rawArgs: Static<typeof schema>, _options: any, theme: any) {
      const args = rawArgs as Static<typeof schema>;
      const target = sanitizeTerminalText(args.target ?? "latest protocol-complete pre-call leaf");
      const name = sanitizeTerminalText(args.name ?? "…");
      return new Text(
        theme.fg("toolTitle", theme.bold("◆ ACM CHECKPOINT  "))
          + theme.fg("accent", name)
          + theme.fg("dim", `  →  ${target}`),
        0,
        0,
      );
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any) {
      const raw = sanitizeTerminalText(result.content.find((item: { type: string; text?: string }) => item.type === "text")?.text ?? "");
      const details = result.details as Record<string, unknown> | undefined;

      if (isPartial) return new Text(theme.fg("warning", "◌ Creating checkpoint…"), 0, 0);

      if (typeof details?.error === "string") {
        return new Text(
          theme.fg("error", "✕ CHECKPOINT NOT CREATED")
            + (raw ? `\n${theme.fg("muted", raw.split("\n", 1)[0] ?? raw)}` : ""),
          0,
          0,
        );
      }

      const status = details?.status === "already_present" ? "REUSED" : "CREATED";
      const name = sanitizeTerminalText(typeof details?.name === "string" ? details.name : "checkpoint");
      const entryId = sanitizeTerminalText(typeof details?.entryId === "string" ? details.entryId : "unknown entry");
      const role = sanitizeTerminalText(typeof details?.role === "string" ? details.role : "node");
      const usage = details?.contextUsage && typeof details.contextUsage === "object"
        ? formatContextUsage(details.contextUsage as { tokens: number; contextWindow: number; percent: number }, true)
        : "unknown";
      const cue = sanitizeTerminalText(typeof details?.cue === "string" ? details.cue : "");
      const lines = [
        theme.fg("success", `✓ CHECKPOINT ${status}`) + theme.fg("accent", `  ${name}`),
        theme.fg("muted", `  ${role} · ${entryId} · context ${usage}`),
      ];
      if (cue) lines.push(theme.fg("dim", `  → ${cue}`));
      if (expanded && raw) {
        lines.push(theme.fg("dim", "  ─ full result ─"), theme.fg("toolOutput", raw));
      }
      return new Text(lines.join("\n"), 0, 0);
    },
    async execute(
      toolCallId: string,
      rawParams: Static<typeof schema>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const params = rawParams;
      if (isReservedTargetName(params.name)) {
        return {
          content: [{ type: "text" as const, text: `Error: Checkpoint name '${params.name}' is reserved for the structural root target. Choose a different semantic name.` }],
          details: { error: "reserved_name", name: params.name },
        };
      }
      const sessionManager = ctx.sessionManager;
      const tree = sessionManager.getTree();
      const labelMaps = buildLabelMaps(sessionManager.getEntries());
      const branch = sessionManager.getBranch();
      const branchIds = new Set(branch.map((entry: SessionEntry) => entry.id));

      let entryId: string;
      let autoResolved: AutomaticCheckpointAnchor | undefined;
      let targetEntry: SessionEntry | undefined;
      if (params.target) {
        const resolved = resolveTargetId(sessionManager, tree, params.target, branchIds, labelMaps);
        entryId = resolved.id;
        if (!isValidEntryId(entryId)) {
          return {
            content: [{ type: "text" as const, text: "Error: Cannot checkpoint root — session tree is empty." }],
            details: { error: "empty_session", requestedTarget: params.target },
          };
        }
        if (params.target.toLowerCase() === "root" && tree.length > 1) {
          ctx.ui.notify(
            `Note: 'root' resolved to the first top-level node (${entryId}); this session has ${tree.length} top-level roots.`,
            "info",
          );
        }
        targetEntry = findEntryInTree(tree, entryId);
        if (!targetEntry) {
          const hint = " Use acm_timeline to locate the node you want to label; raw node IDs are valid targets.";
          return {
            content: [{ type: "text" as const, text: `Error: Target '${params.target}' not found in session tree.${hint}` }],
            details: { error: "target_not_found", requestedTarget: params.target },
          };
        }
        if (!isCheckpointableMessage(targetEntry)) {
          const role = getMessageRoleLabel(targetEntry) ?? targetEntry.type;
          ctx.ui.notify(
            `Warning: explicit checkpoint target '${params.target}' (${entryId}) is a ${role} node, not USER/AI. Prefer conversational turns; travel semantics may be unintuitive.`,
            "warning",
          );
        }
        if (resolved.fromOffPath) {
          ctx.ui.notify(`Note: target '${params.target}' resolved from an off-path branch. Checkpoint will be placed on a non-active node.`, "warning");
        }
      } else {
        const containingBatch = findContainingAssistantToolBatch(branch, toolCallId);
        const startIndex = (containingBatch?.entryIndex ?? branch.length) - 1;
        const skipped: SkippedCheckpointAnchor[] = [];
        autoResolved = { entryId: null, normalizations: [], skipped };
        for (let index = startIndex; index >= 0; index--) {
          if (signal?.aborted) {
            autoResolved.aborted = true;
            break;
          }
          const candidate = branch[index]!;
          const packet = rebuildAcmContextPacket(sessionManager, candidate.id);
          if (!packet.ok) {
            skipped.push({ id: candidate.id, reason: "context_build_failed", message: packet.message });
            continue;
          }
          if (packet.value.protocol.status === "invalid") {
            skipped.push({
              id: candidate.id,
              reason: "protocol_invalid",
              defects: packet.value.protocol.defects,
            });
            continue;
          }
          if (packet.value.protocol.status === "repaired") {
            skipped.push({
              id: candidate.id,
              reason: "protocol_repaired",
              repairs: packet.value.protocol.repairs,
            });
            continue;
          }
          autoResolved = {
            entryId: candidate.id,
            role: getMessageRoleLabel(candidate) ?? candidate.type.toUpperCase(),
            snippet: describeEntrySnippet(candidate),
            protocolStatus: "complete",
            normalizations: packet.value.protocol.normalizations,
            skipped,
          };
          break;
        }
        entryId = autoResolved.entryId ?? "";
      }

      if (signal?.aborted || autoResolved?.aborted) {
        return { content: [{ type: "text" as const, text: "acm_checkpoint aborted." }], details: { error: "aborted" } };
      }
      if (!entryId) {
        const isEmpty = branch.length === 0;
        return {
          content: [{
            type: "text" as const,
            text: isEmpty
              ? "No session entry to checkpoint. The conversation is empty."
              : "No protocol-complete session prefix exists before this checkpoint call. Finish or explicitly recover the current tool batch, then retry; no label was written.",
          }],
          details: {
            error: isEmpty ? "empty_session" : "no_protocol_complete_checkpoint_target",
            skipped: autoResolved?.skipped ?? [],
          },
        };
      }

      const append = appendCheckpointLabel(sessionManager, entryId, params.name);
      if (!append.ok) {
        if (append.error === "label_conflict") {
          const conflict = append.details as CheckpointLabelConflict;
          return {
            content: [{
              type: "text" as const,
              text: `Checkpoint '${params.name}' already belongs to ${conflict.entryId} (${conflict.onActivePath ? "on-path" : "off-path"}). ${withAvailableAdvancedGuidance(pi, RECOVERY_GUIDANCE.nameCollision, GUIDANCE_CUES.advancedTargetPointer)}`,
            }],
            details: {
              error: "duplicate_name",
              label: params.name,
              name: params.name,
              entryId: conflict.entryId,
              existingEntryId: conflict.entryId,
              existingEntryOnActivePath: conflict.onActivePath,
            },
          };
        }
        return {
          content: [{ type: "text" as const, text: `${append.message}. ${RECOVERY_GUIDANCE.hostCapability}` }],
          details: {
            error: append.error,
            label: params.name,
            name: params.name,
            entryId,
            message: append.message,
            resolvedEntryId: entryId,
            hostBridgeMessage: append.message,
          },
        };
      }

      const { status, aliases, labelEntryId } = append.value;
      const resolvedEntry = targetEntry ?? findEntryInTree(tree, entryId);
      const role = autoResolved?.role ?? (resolvedEntry ? getMessageRoleLabel(resolvedEntry) : undefined) ?? resolvedEntry?.type.toUpperCase() ?? "NODE";
      const usage = ctx.getContextUsage();
      const usageLike = usage && usage.tokens != null && usage.percent != null
        ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
        : undefined;
      const usageText = usageLike ? formatContextUsage(usageLike, true) : "unknown";
      const cue = GUIDANCE_CUES.checkpoint;
      const skippedCount = autoResolved?.skipped.length;
      const placement = autoResolved
        ? `${role}; latest protocol-complete pre-call leaf${skippedCount ? ` after skipping ${skippedCount} newer unsafe/unavailable entr${skippedCount === 1 ? "y" : "ies"}` : ""}`
        : `${role}; explicit target '${params.target}'`;
      const action = status === "already_present" ? "Reused" : "Created";
      return {
        content: [{
          type: "text" as const,
          text: `${action} checkpoint '${params.name}' at ${entryId} via label entry ${labelEntryId} (${placement}). Aliases: ${aliases.join(", ")}. Context usage: ${usageText}. ${cue}`,
        }],
        details: {
          status,
          alreadyPresent: status === "already_present",
          label: params.name,
          labelEntryId,
          entryId,
          resolvedEntryId: entryId,
          role,
          aliases,
          target: params.target ?? "auto",
          targetResolution: params.target ? "explicit" : "automatic_protocol_complete",
          protocolStatus: autoResolved?.protocolStatus ?? null,
          protocolNormalizations: autoResolved?.normalizations ?? [],
          contextUsage: usage ? { percent: usage.percent, tokens: usage.tokens, contextWindow: usage.contextWindow } : null,
          contextUsageAvailable: usage !== undefined,
          skippedTransientCount: skippedCount ?? null,
          autoResolved: autoResolved
            ? {
                role: autoResolved.role,
                snippet: autoResolved.snippet,
                skippedCount: autoResolved.skipped.length,
                skipped: autoResolved.skipped,
              }
            : undefined,
          cue,
        },
      };
    },
  } as any);
}
