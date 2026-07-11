import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TOOL_DESCRIPTIONS } from "./generated-guidance.js";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("ACM tool description contract", () => {
 test("registers every runtime description from canonical generated guidance", () => {
  expect(source).toContain("description: TOOL_DESCRIPTIONS.checkpoint");
  expect(source).toContain("description: TOOL_DESCRIPTIONS.timeline");
  expect(source).toContain("description: TOOL_DESCRIPTIONS.travel");
 });

 test("describes timeline through the strict view discriminator", () => {
  expect(TOOL_DESCRIPTIONS.timeline).toContain("one view: `active`, `checkpoints`, `search`, or `tree`");
  expect(TOOL_DESCRIPTIONS.timeline).toContain("Omit view for `active`");
  expect(`${source}\n${TOOL_DESCRIPTIONS.timeline}`).not.toMatch(/list_checkpoints|full_tree|active_path/);
 });

 test("keeps checkpoint and travel descriptions concise and evidence-oriented", () => {
  expect(TOOL_DESCRIPTIONS.checkpoint).toContain("Checkpoint does not branch or fold the active context");
  expect(TOOL_DESCRIPTIONS.travel).toContain("Travel reports structural and context deltas");
  expect(TOOL_DESCRIPTIONS.travel).not.toContain("preview");
 });
});
