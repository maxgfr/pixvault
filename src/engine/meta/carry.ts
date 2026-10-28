// Placeholder until the metadata module lands: re-encoded files carry no metadata.
import type { Format, OutFormat } from "../formats.ts";
import type { PhotoMeta } from "./types.ts";

export type MetaMode = "keep" | "no-gps" | "strip";

export async function carryMeta(out: Uint8Array, _format: OutFormat, _source: Uint8Array, _sourceFormat: Format, _meta: PhotoMeta, _mode: MetaMode): Promise<Uint8Array> {
  return out;
}
