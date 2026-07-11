import { describe, expect, test } from "bun:test";
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

describe("ACM tool description contract", () => {
  test("registers every runtime description from canonical generated guidance", () => {
    expect(captureToolDescriptions()).toEqual(new Map([
      ["acm_checkpoint", TOOL_DESCRIPTIONS.checkpoint],
      ["acm_timeline", TOOL_DESCRIPTIONS.timeline],
      ["acm_travel", TOOL_DESCRIPTIONS.travel],
    ]));
  });

  test("describes timeline through the strict view discriminator", () => {
    expect(TOOL_DESCRIPTIONS.timeline).toContain("one view: `active`, `checkpoints`, `search`, or `tree`");
    expect(TOOL_DESCRIPTIONS.timeline).toContain("Omit view for `active`");
    expect(TOOL_DESCRIPTIONS.timeline).not.toMatch(/list_checkpoints|full_tree|active_path/);
  });

  test("keeps checkpoint and travel descriptions concise and evidence-oriented", () => {
    expect(TOOL_DESCRIPTIONS.checkpoint).toContain("Checkpoint does not branch or fold the active context");
    expect(TOOL_DESCRIPTIONS.travel).toContain("Travel reports structural and context deltas");
    expect(TOOL_DESCRIPTIONS.travel).not.toContain("preview");
  });
});
