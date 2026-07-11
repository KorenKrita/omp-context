#!/usr/bin/env node
/**
 * inject-pi-acm.mjs — Apply the legacy Pi-only integration glue.
 * OMP integration uses the reviewed fail-closed omp-integration.patch instead.
 *
 * Usage: node scripts/inject-pi-acm.mjs <index.ts> <system-prompt.ts>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [indexPath, promptPath] = process.argv.slice(2);
if (!indexPath || !promptPath) {
  console.error("Usage: node inject-acm.mjs <index.ts> <system-prompt.ts>");
  process.exit(1);
}

// --- index.ts ---
let index = readFileSync(indexPath, "utf-8");

// 1. Add import (anchor: after `import { registerMagicContextTools } from "./tools"`)
const TOOLS_IMPORT = 'import { registerMagicContextTools } from "./tools";';
const ACM_IMPORT = 'import registerACMExtension from "./acm/tools";';
if (!index.includes(ACM_IMPORT)) {
  const pos = index.indexOf(TOOLS_IMPORT);
  if (pos === -1) {
    console.error(`ERROR: anchor not found in ${indexPath}: ${TOOLS_IMPORT}`);
    process.exit(1);
  }
  index = index.slice(0, pos + TOOLS_IMPORT.length) +
    "\n" + ACM_IMPORT +
    index.slice(pos + TOOLS_IMPORT.length);
}

// 2. Add registration call (anchor: after registerMagicContextTools(...) block closes with `});`)
// We find the `info("registered tools:` line and insert before it
const ACM_REGISTER = "\tregisterACMExtension(pi);";
if (!index.includes("registerACMExtension(pi)")) {
  // Find the info() call about registered tools
  const infoAnchor = index.indexOf('info(\n\t\t"registered tools:') !== -1
    ? 'info(\n\t\t"registered tools:'
    : 'info(\n\t\t`registered tools:';
  const infoPos = index.indexOf(infoAnchor);
  if (infoPos === -1) {
    // Fallback: find the info() call about registered tools that comes AFTER registerMagicContextTools
    const regToolsPos = index.indexOf("registerMagicContextTools(");
    if (regToolsPos === -1) {
      console.error(`ERROR: could not find registerMagicContextTools in ${indexPath}`);
      process.exit(1);
    }
    // Find the next info() call after registerMagicContextTools that mentions "registered tools"
    const afterReg = index.slice(regToolsPos);
    const re = /info\(/g;
    let m;
    let insertPos = -1;
    while ((m = re.exec(afterReg)) !== null) {
      const lineEnd = afterReg.indexOf("\n", m.index + 100) || afterReg.length;
      const chunk = afterReg.slice(m.index, Math.min(m.index + 300, afterReg.length));
      if (chunk.includes("registered tools")) {
        insertPos = regToolsPos + m.index;
        break;
      }
    }
    if (insertPos === -1) {
      console.error(`ERROR: could not find registered tools info() in ${indexPath}`);
      process.exit(1);
    }
    index = index.slice(0, insertPos) +
      "// Register ACM tools (acm_checkpoint, acm_timeline, acm_travel)\n\t" +
      "registerACMExtension(pi);\n\n\t" +
      index.slice(insertPos);
  } else {
    index = index.slice(0, infoPos) +
      "// Register ACM tools (acm_checkpoint, acm_timeline, acm_travel)\n\t" +
      "registerACMExtension(pi);\n\n\t" +
      index.slice(infoPos);
  }
}

writeFileSync(indexPath, index);
console.log(`✓ ${indexPath}: ACM glue injected`);

// --- system-prompt.ts ---
let prompt = readFileSync(promptPath, "utf-8");

// 1. Add import (anchor: after `import { buildMagicContextSection }`)
const MC_SECTION_IMPORT = 'import { buildMagicContextSection }';
const UNIFIED_PROMPT_IMPORT =
  'import { buildUnifiedPromptSection } from "./acm/prompt";';
if (!prompt.includes(UNIFIED_PROMPT_IMPORT)) {
  const pos = prompt.indexOf(MC_SECTION_IMPORT);
  if (pos === -1) {
    console.error(`ERROR: anchor not found in ${promptPath}: ${MC_SECTION_IMPORT}`);
    process.exit(1);
  }
  // Find end of this import statement (next semicolon + newline)
  const importEnd = prompt.indexOf(";", pos);
  if (importEnd === -1) {
    console.error(`ERROR: could not find end of import statement in ${promptPath}`);
    process.exit(1);
  }
  prompt = prompt.slice(0, importEnd + 1) +
    "\n" + UNIFIED_PROMPT_IMPORT +
    prompt.slice(importEnd + 1);
}

// 2. Wrap the return in buildMagicContextBlock
// Anchor: `return buildMagicContextSection(` → store in variable and assemble
// the unified Foreword → ACM → MC → Closing prompt.
const RETURN_ANCHOR = "\treturn buildMagicContextSection(";
const UNIFIED_RETURN = '\treturn buildUnifiedPromptSection(mcBlock ?? "");';
if (!prompt.includes(UNIFIED_RETURN)) {
  const returnPos = prompt.indexOf(RETURN_ANCHOR);
  if (returnPos === -1) {
    // Maybe already wrapped — fail unless the expected unified return is present.
    if (prompt.includes("const mcBlock = buildMagicContextSection(")) {
      console.error(`ERROR: unified return not found in ${promptPath}`);
    } else {
      console.error(`ERROR: anchor not found in ${promptPath}: ${RETURN_ANCHOR}`);
    }
    process.exit(1);
  }

  // Find the matching closing `);` for this return statement.
  // Count parens from the opening `buildMagicContextSection(`.
  const searchStart = returnPos + RETURN_ANCHOR.length;
  let depth = 1;
  let i = searchStart;
  while (i < prompt.length && depth > 0) {
    if (prompt[i] === "(") depth++;
    else if (prompt[i] === ")") depth--;
    i++;
  }
  // i now points just after the closing `)` — expect `;` next.
  const closingEnd = prompt.indexOf(";", i - 1) + 1;

  const originalReturn = prompt.slice(returnPos, closingEnd);
  const mcCall = originalReturn.replace(/^\treturn /, "\tconst mcBlock = ");

  const replacement = mcCall + "\n\n" +
    "\t// Assemble unified prompt: Foreword → ACM → MC → Closing\n" +
    UNIFIED_RETURN;

  prompt = prompt.slice(0, returnPos) + replacement + prompt.slice(closingEnd);
}

writeFileSync(promptPath, prompt);
console.log(`✓ ${promptPath}: ACM glue injected`);
