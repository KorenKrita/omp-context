import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { z } from "zod";
import { ACM_CORE, GUIDANCE_CUES, RECOVERY_GUIDANCE } from "./generated-guidance.js";
import registerACMExtension from "./index.js";

type RegisteredTool = {
 name: string;
 execute: (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown) => Promise<{
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
 }>;
};

function message(id: string, parentId: string | null, role: "user" | "assistant", text: string): SessionEntry {
 return {
  id,
  type: "message",
  parentId,
  timestamp: "2026-07-11T00:00:00.000Z",
  message: role === "user"
   ? { role, content: [{ type: "text", text }] }
   : { role, content: [{ type: "text", text }], api: "test", provider: "test", model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 }, stopReason: "endTurn", timestamp: 0 },
 } as unknown as SessionEntry;
}

function custom(id: string, parentId: string | null): SessionEntry {
 return { id, type: "custom", parentId, timestamp: "2026-07-11T00:00:01.000Z", customType: "transient", data: {} } as unknown as SessionEntry;
}

function captureCheckpointTool(): RegisteredTool {
 let checkpoint: RegisteredTool | undefined;
 const pi = { zod: z, on() {}, registerTool(tool: RegisteredTool) { if (tool.name === "acm_checkpoint") checkpoint = tool; } };
 registerACMExtension(pi as unknown as ExtensionAPI);
 if (!checkpoint) throw new Error("acm_checkpoint was not registered");
 return checkpoint;
}

function makeContext(options: { entries: SessionEntry[]; branch?: SessionEntry[]; usage?: { percent: number; tokens: number; contextWindow: number }; appendCapability?: boolean }) {
 const entries = [...options.entries];
 const branch = options.branch ?? entries.filter((entry) => entry.type !== "label");
 const byId = new Map(entries.map((entry) => [entry.id, entry]));
 let sequence = 0;
 const sessionManager: Record<string, unknown> = {
  getEntries: () => entries,
  getTree: () => {
   const nodes = new Map<string, SessionTreeNode>();
   for (const entry of entries) if (entry.type !== "label") nodes.set(entry.id, { entry, children: [] });
   const roots: SessionTreeNode[] = [];
   for (const node of nodes.values()) {
    const parent = node.entry.parentId ? nodes.get(node.entry.parentId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
   }
   return roots;
  },
  getBranch: () => branch,
  getLeafId: () => branch.at(-1)?.id ?? null,
  getEntry: (id: string) => byId.get(id),
  getLabel: () => undefined,
 };
 if (options.appendCapability !== false) {
  sessionManager.appendLabelChange = (targetId: string, name: string) => {
   const id = `label-${++sequence}`;
   const entry = { id, type: "label", parentId: null, timestamp: "2026-07-11T00:00:02.000Z", targetId, label: name } as unknown as SessionEntry;
   entries.push(entry);
   byId.set(id, entry);
   return id;
  };
 }
 return { sessionManager, ui: { notify() {} }, getContextUsage: () => options.usage };
}

async function execute(tool: RegisteredTool, params: unknown, ctx: unknown) {
 return tool.execute("checkpoint-test", params, undefined, undefined, ctx);
}

const tool = captureCheckpointTool();

describe("registered acm_checkpoint progressive results", () => {
 test("automatic target reports placement, skipped transient entries, usage, and one concise start cue", async () => {
  const user = message("u1", null, "user", "begin");
  const assistant = message("a1", "u1", "assistant", "working");
  const transient = custom("c1", "a1");
  const result = await execute(tool, { name: "parser-fix-start" }, makeContext({ entries: [user, assistant, transient], branch: [user, assistant, transient], usage: { percent: 25, tokens: 1000, contextWindow: 4000 } }));
  expect(result.details).toMatchObject({ status: "created", label: "parser-fix-start", resolvedEntryId: "a1", role: "AI", aliases: ["parser-fix-start"], targetResolution: "automatic", skippedTransientCount: 1, contextUsageAvailable: true, cue: GUIDANCE_CUES.checkpointStart });
  const text = result.content[0].text;
  expect(text).toContain("label entry label-1");
  expect(text).toContain("skipped 1 nearer transient/non-meaningful entry");
  expect(text).toContain("25.0%");
  expect(text.split(GUIDANCE_CUES.checkpointStart)).toHaveLength(2);
  expect(text).not.toContain(ACM_CORE.slice(0, 40));
  expect(text).not.toMatch(/fold gate|Goal:|State:|Evidence:|External:|Exclusions:|Recover:|NEXT:/);
 });

 test("explicit target preserves structural facts and unknown usage", async () => {
  const user = message("u1", null, "user", "begin");
  const result = await execute(tool, { name: "explicit-start", target: "u1" }, makeContext({ entries: [user] }));
  expect(result.details).toMatchObject({ entryId: "u1", resolvedEntryId: "u1", role: "USER", aliases: ["explicit-start"], target: "u1", targetResolution: "explicit", contextUsage: null, contextUsageAvailable: false, skippedTransientCount: null });
  expect(result.content[0].text).toContain("Context usage: unknown");
 });

 test("same-node reuse is idempotent and a second alias preserves both names", async () => {
  const user = message("u1", null, "user", "begin");
  const ctx = makeContext({ entries: [user] });
  const first = await execute(tool, { name: "first-start", target: "u1" }, ctx);
  const reused = await execute(tool, { name: "first-start", target: "u1" }, ctx);
  const second = await execute(tool, { name: "second-start", target: "u1" }, ctx);
  expect(reused.details).toMatchObject({ status: "already_present", alreadyPresent: true, labelEntryId: first.details.labelEntryId, aliases: ["first-start"] });
  expect(reused.content[0].text).toStartWith("Reused checkpoint");
  expect(second.details).toMatchObject({ status: "created", aliases: ["first-start", "second-start"] });
 });

 test("collision discloses only existing-entry evidence and canonical semantic renaming guidance", async () => {
  const first = message("u1", null, "user", "first");
  const second = message("u2", "u1", "user", "second");
  const ctx = makeContext({ entries: [first, second] });
  await execute(tool, { name: "shared-start", target: "u1" }, ctx);
  const collision = await execute(tool, { name: "shared-start", target: "u2" }, ctx);
  expect(collision.details).toEqual({ error: "duplicate_name", label: "shared-start", name: "shared-start", entryId: "u1", existingEntryId: "u1", existingEntryOnActivePath: true });
  expect(collision.content[0].text).toContain(RECOVERY_GUIDANCE.nameCollision);
  expect(collision.content[0].text).not.toContain(RECOVERY_GUIDANCE.hostCapability);
 });

 test("missing capability discloses only generated Host Bridge recovery context", async () => {
  const user = message("u1", null, "user", "begin");
  const result = await execute(tool, { name: "missing-start" }, makeContext({ entries: [user], appendCapability: false }));
  expect(result.details).toMatchObject({ error: "missing_capability", label: "missing-start", resolvedEntryId: "u1" });
  expect(result.content[0].text).toContain(RECOVERY_GUIDANCE.hostCapability);
  expect(result.content[0].text).not.toContain(RECOVERY_GUIDANCE.nameCollision);
  expect(result.content[0].text).not.toContain(GUIDANCE_CUES.checkpointStart);
 });

 test("done suffix selects exactly the milestone retreat cue", async () => {
  const user = message("u1", null, "user", "done");
  const result = await execute(tool, { name: "root-cause-done" }, makeContext({ entries: [user] }));
  expect(result.details.cue).toBe(GUIDANCE_CUES.checkpointDone);
  expect(result.content[0].text).toContain(GUIDANCE_CUES.checkpointDone);
  expect(result.content[0].text).not.toContain(GUIDANCE_CUES.checkpointStart);
 });

 test("rejects the structural root keyword as a checkpoint name before mutation", async () => {
  const user = message("u1", null, "user", "begin");
  const ctx = makeContext({ entries: [user] });
  for (const name of ["root", "ROOT", "Root"]) {
   const result = await execute(tool, { name }, ctx);
   expect(result.details).toMatchObject({ error: "reserved_name", name });
   expect(result.content[0].text).toContain("reserved for the structural root target");
  }
  const sm = ctx.sessionManager;
  if (typeof sm === "object" && sm !== null && "getEntries" in sm) {
   const entries = (sm as { getEntries: () => SessionEntry[] }).getEntries();
   expect(entries.every((entry) => entry.type !== "label")).toBe(true);
  }
 });
});
