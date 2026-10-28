// Placeholder until the metadata module lands: reads nothing.
import type { PhotoMeta } from "./types.ts";

export async function readMeta(_bytes: Uint8Array): Promise<PhotoMeta> {
  return {};
}
