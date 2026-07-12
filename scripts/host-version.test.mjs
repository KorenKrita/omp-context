import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OMP_HOST_PACKAGES,
  readDeclaredHostVersion,
  readLocalOmpInstallation,
  updateExactHostVersion,
} from "./host-version.mjs";

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "omp-context-host-version-"));
  mkdirSync(join(root, "test", "host-fixture"), { recursive: true });
  const hostEntries = Object.fromEntries(OMP_HOST_PACKAGES.map((name) => [name, "1.2.3"]));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    devDependencies: { ...hostEntries, unrelated: "9.9.9" },
    peerDependencies: { ...hostEntries },
  }, null, 2)}\n`);
  writeFileSync(join(root, "test", "host-fixture", "package.json"), `${JSON.stringify({
    dependencies: { ...hostEntries, zod: "4.4.3" },
  }, null, 2)}\n`);
  return root;
}

function createLocalInstallation(versionFor = () => "3.4.5") {
  const root = mkdtempSync(join(tmpdir(), "omp-context-local-omp-"));
  const scopeRoot = join(root, "node_modules", "@oh-my-pi");
  for (const packageName of OMP_HOST_PACKAGES) {
    const packageRoot = join(scopeRoot, packageName.slice("@oh-my-pi/".length));
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version: versionFor(packageName) }));
  }
  const executable = join(scopeRoot, "pi-coding-agent", "dist", "cli.js");
  mkdirSync(join(scopeRoot, "pi-coding-agent", "dist"), { recursive: true });
  writeFileSync(executable, "#!/usr/bin/env bun\n");
  chmodSync(executable, 0o755);
  return { root, executable };
}

describe("local OMP host version promotion", () => {
  test("updates every exact host field while preserving unrelated metadata", () => {
    const root = createFixture();
    try {
      expect(readDeclaredHostVersion(root)).toBe("1.2.3");
      updateExactHostVersion(root, "2.3.4");
      expect(readDeclaredHostVersion(root)).toBe("2.3.4");

      const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      const fixturePackage = JSON.parse(readFileSync(join(root, "test", "host-fixture", "package.json"), "utf8"));
      for (const packageName of OMP_HOST_PACKAGES) {
        expect(rootPackage.devDependencies[packageName]).toBe("2.3.4");
        expect(rootPackage.peerDependencies[packageName]).toBe("2.3.4");
        expect(fixturePackage.dependencies[packageName]).toBe("2.3.4");
      }
      expect(rootPackage.devDependencies.unrelated).toBe("9.9.9");
      expect(fixturePackage.dependencies.zod).toBe("4.4.3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("detects one exact local package set from an explicit OMP executable", () => {
    const localFixture = createLocalInstallation();
    const previous = process.env.OMP_EXECUTABLE;
    try {
      process.env.OMP_EXECUTABLE = localFixture.executable;
      const local = readLocalOmpInstallation();
      expect(local.version).toBe("3.4.5");
      expect(local.resolvedExecutable).toBe(localFixture.executable);
      expect([...local.versions.values()]).toEqual(OMP_HOST_PACKAGES.map(() => "3.4.5"));
    } finally {
      if (previous === undefined) delete process.env.OMP_EXECUTABLE;
      else process.env.OMP_EXECUTABLE = previous;
      rmSync(localFixture.root, { recursive: true, force: true });
    }
  });

  test("reports an invalid OMP_EXECUTABLE override clearly", () => {
    const previous = process.env.OMP_EXECUTABLE;
    try {
      process.env.OMP_EXECUTABLE = join(tmpdir(), "missing-omp-executable");
      expect(() => readLocalOmpInstallation()).toThrow("OMP_EXECUTABLE must point to an executable file");
    } finally {
      if (previous === undefined) delete process.env.OMP_EXECUTABLE;
      else process.env.OMP_EXECUTABLE = previous;
    }
  });

  test("rejects disagreement in the local OMP package set", () => {
    const localFixture = createLocalInstallation((packageName) => packageName === "@oh-my-pi/pi-ai" ? "3.4.6" : "3.4.5");
    const previous = process.env.OMP_EXECUTABLE;
    try {
      process.env.OMP_EXECUTABLE = localFixture.executable;
      expect(() => readLocalOmpInstallation()).toThrow("Local OMP host packages disagree");
    } finally {
      if (previous === undefined) delete process.env.OMP_EXECUTABLE;
      else process.env.OMP_EXECUTABLE = previous;
      rmSync(localFixture.root, { recursive: true, force: true });
    }
  });

  test("reports missing promotion fields with actionable context", () => {
    const root = createFixture();
    try {
      const packagePath = join(root, "package.json");
      const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
      delete metadata.peerDependencies;
      writeFileSync(packagePath, JSON.stringify(metadata));
      expect(() => updateExactHostVersion(root, "2.3.4")).toThrow("package.json is missing required object peerDependencies");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects disagreement instead of choosing one declared version", () => {
    const root = createFixture();
    try {
      const packagePath = join(root, "package.json");
      const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
      metadata.peerDependencies[OMP_HOST_PACKAGES[0]] = "1.2.4";
      writeFileSync(packagePath, JSON.stringify(metadata));
      expect(() => readDeclaredHostVersion(root)).toThrow("Declared OMP host versions disagree");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
