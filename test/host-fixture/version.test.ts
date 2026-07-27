import { expect, test } from "bun:test";
import metadata from "./.acm-build/host-packages.json";

test("fixture resolves the exact supported OMP host", () => {
  expect(metadata.supportedVersion).toBe("17.1.4");
  expect(metadata.resolvedPackages).toHaveLength(4);
  expect(metadata.resolvedPackages.every((entry) => entry.version === "17.1.4")).toBe(true);
});
