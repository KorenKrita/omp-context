import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { z } from "zod";
import registerAcmExtension from "./index.js";
import { TOOL_DESCRIPTIONS } from "./generated-guidance.js";

interface RegisteredTool {
  name: string;
  description: string;
}

function captureToolDescriptions(): Map<string, string> {
  const tools = new Map<string, string>();
  const pi = {
    zod: z,
    on() {},
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool.description);
    },
  };
  registerAcmExtension(pi as unknown as ExtensionAPI);
  return tools;
}

const travelToolSource = readFileSync(new URL("./travel-tool.ts", import.meta.url), "utf8");

describe("ACM tool description contract", () => {
  test("registers every runtime description from canonical generated guidance", () => {
    expect(captureToolDescriptions()).toEqual(new Map([
      ["acm_checkpoint", TOOL_DESCRIPTIONS.checkpoint],
      ["acm_timeline", TOOL_DESCRIPTIONS.timeline],
      ["acm_travel", TOOL_DESCRIPTIONS.travel],
    ]));
  });

  test("describes timeline through the strict view discriminator", () => {
    expect(TOOL_DESCRIPTIONS.timeline).toContain("one view");
    expect(TOOL_DESCRIPTIONS.timeline).toContain("`active`");
    expect(TOOL_DESCRIPTIONS.timeline).toContain("`checkpoints`");
    expect(TOOL_DESCRIPTIONS.timeline).toContain("`search`");
    expect(TOOL_DESCRIPTIONS.timeline).toContain("`tree`");
    expect(TOOL_DESCRIPTIONS.timeline).toContain("projected post-travel summary depth");
    expect(TOOL_DESCRIPTIONS.timeline).not.toMatch(/list_checkpoints|full_tree|active_path/);
  });

  test("keeps the rebase target schema aligned with cold start and projected depth", () => {
    expect(travelToolSource).toContain("projected summary depth does not grow");
    expect(travelToolSource).toContain("whose handoff passes cold start");
    expect(travelToolSource).toContain("root is a candidate, not a default");
  });

  test("keeps checkpoint and travel descriptions concise and judgment-oriented", () => {
    expect(TOOL_DESCRIPTIONS.checkpoint).toContain("Never blocks or folds anything");
    expect(TOOL_DESCRIPTIONS.travel).toContain("fold finished process into its handoff");
    expect(TOOL_DESCRIPTIONS.travel).toContain("alone in its assistant tool batch");
    expect(TOOL_DESCRIPTIONS.travel).toContain("The result is the only fact");
    expect(TOOL_DESCRIPTIONS.travel).not.toContain("preview");
  });
});
