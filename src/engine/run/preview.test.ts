import { expect, test } from "bun:test";
import { encode } from "../codecs.ts";
import { noisy } from "../test/setup.ts";
import { preview } from "./preview.ts";

const ctx = { progress() {}, check() {} };

test("the live preview reuses the reduced photo and never changes it", async () => {
  const bytes = await encode(noisy(400, 300), "jpeg", { quality: 90 });
  const input = { name: "a.jpg", bytes };
  const first = await preview(input, [{ tool: "adjust", options: { exposure: 50 } }], 200, ctx, false, "k1");
  // Same key: the cached photo is used (a different input would show otherwise).
  const other = { name: "a.jpg", bytes: await encode(noisy(80, 60), "jpeg") };
  const again = await preview(other, [{ tool: "redact", options: { regions: "0,0,100,100", style: "fill" } }], 200, ctx, false, "k1");
  expect([again.width, again.height]).toEqual([400, 300]);
  expect(again.before.bytes).toEqual(first.before.bytes);
  // A step that paints the whole photo did not reach the cache.
  const plain = await preview(other, [], 200, ctx, false, "k1");
  expect(plain.after.bytes).toEqual(first.before.bytes);
});
