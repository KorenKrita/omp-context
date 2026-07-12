#!/usr/bin/env bun
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const outputRoot = join(fixtureRoot, ".acm-build");
const hostPackages = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
];
const fixturePackage = JSON.parse(readFileSync(join(fixtureRoot, "package.json"), "utf8"));
const declaredVersions = hostPackages.map((packageName) => fixturePackage.dependencies?.[packageName]);
if (declaredVersions.some((version) => typeof version !== "string" || version.length === 0)) {
  throw new Error("Fixture package must declare every supported host package as an exact dependency");
}
const supportedVersion = declaredVersions[0];
if (!declaredVersions.every((version) => version === supportedVersion)) {
  throw new Error(`Fixture host package versions disagree: ${declaredVersions.join(", ")}`);
}
const entrypoints = [
  { source: "../../src/index.ts", output: "index.js" },
  { source: "../../src/host-bridge.ts", output: "host-bridge.js" },
  { source: "../../src/lib.ts", output: "lib.js" },
  { source: "../../src/generated-guidance.ts", output: "generated-guidance.js" },
  { source: "../../src/live-agent-session-adapter.ts", output: "live-agent-session-adapter.js" },
  { source: "../../src/runtime.ts", output: "runtime.js" },
  { source: "../../src/runtime-lifecycle.ts", output: "runtime-lifecycle.js" },
  { source: "../../src/timeline-tool.ts", output: "timeline-tool.js" },
  { source: "../../src/travel-tool.ts", output: "travel-tool.js" },
];

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const build = await Bun.build({
  entrypoints: entrypoints.map((entrypoint) => join(fixtureRoot, entrypoint.source)),
  outdir: outputRoot,
  naming: { entry: "[name].js" },
  target: "bun",
  format: "esm",
  packages: "external",
  sourcemap: "none",
});
if (!build.success) {
  throw new Error(build.logs.map((log) => log.message).join("\n") || "Failed to build isolated ACM source");
}

const requireFromBuild = createRequire(join(outputRoot, "index.js"));
const fixtureModules = join(fixtureRoot, "node_modules") + sep;
const resolvedPackages = hostPackages.map((packageName) => {
  const packageJsonPath = requireFromBuild.resolve(`${packageName}/package.json`);
  const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!packageJsonPath.startsWith(fixtureModules)) {
    throw new Error(`${packageName} resolved outside fixture node_modules: ${packageJsonPath}`);
  }
  if (metadata.version !== supportedVersion) {
    throw new Error(`${packageName} resolved ${String(metadata.version)} instead of ${supportedVersion}`);
  }
  return {
    packageName,
    packageJsonPath,
    relativePackageJsonPath: relative(fixtureRoot, packageJsonPath),
    version: metadata.version,
  };
});

writeFileSync(
  join(outputRoot, "host-packages.json"),
  `${JSON.stringify({ supportedVersion, entrypoints, resolvedPackages }, null, 2)}\n`,
);
process.stdout.write(`Built isolated ACM source with ${resolvedPackages.length} pinned host packages.\n`);
