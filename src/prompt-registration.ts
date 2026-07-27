import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import {
  ACM_CORE,
  ACM_CORE_MARKER,
  PROMPT_GUIDELINES,
  PROMPT_SNIPPETS,
} from "./generated-guidance.js";

/** Pure canonical CORE producer shared by prompt registration and idempotence tests. */
export function ensureAcmCoreSegment(systemPrompt: string): string {
  if (systemPrompt.includes(ACM_CORE_MARKER)) return systemPrompt;
  return `${systemPrompt}\n\n${ACM_CORE_MARKER}\n${ACM_CORE}`;
}

export const ACM_TOOL_PROMPT_MARKER = "<!-- OMP-CONTEXT:ACM-TOOL-PROMPTS:v1 -->";

function acmToolPromptSegment(): string {
  return [
    ACM_TOOL_PROMPT_MARKER,
    "ACM tool-use cues:",
    ...Object.values(PROMPT_SNIPPETS),
    ...Object.values(PROMPT_GUIDELINES),
  ].join("\n");
}

export function registerAcmPrompt(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const segments = event.systemPrompt;
    const joined = segments.join("\n");
    const additions: string[] = [];
    if (!joined.includes(ACM_CORE_MARKER)) additions.push(`${ACM_CORE_MARKER}\n${ACM_CORE}`);
    if (!joined.includes(ACM_TOOL_PROMPT_MARKER)) additions.push(acmToolPromptSegment());
    return additions.length === 0 ? undefined : { systemPrompt: [...segments, ...additions] };
  });
}
