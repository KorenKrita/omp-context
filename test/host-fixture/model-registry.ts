import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent/sdk";

export async function createModelRegistry(tempDir: string): Promise<ModelRegistry> {
  return new ModelRegistry(await discoverAuthStorage(tempDir));
}
