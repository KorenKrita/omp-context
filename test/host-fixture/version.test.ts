import { expect, test } from "bun:test";
import metadata from "./.acm-build/host-packages.json";
import packageMetadata from "./package.json";

test("fixture resolves the exact supported OMP host", () => {
  const expectedVersion = packageMetadata.dependencies["@oh-my-pi/pi-coding-agent"];
  expect(metadata.supportedVersion).toBe(expectedVersion);
  expect(metadata.resolvedPackages).toHaveLength(4);
  expect(metadata.resolvedPackages.every((entry) => entry.version === expectedVersion)).toBe(true);
});
