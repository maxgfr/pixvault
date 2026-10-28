// V8 runs a wasm function unoptimised until it has been called enough; one
// call on a 12 MP photo runs entirely in the slow tier (2.5× slower). A new
// worker therefore runs the everyday codecs a few times on tiny images first,
// while the user is still choosing settings.

import { encode } from "./codecs.ts";
import { raster } from "./raster.ts";
import { resize } from "./resize.ts";

let done: Promise<void> | undefined;

export function warmUp(): Promise<void> {
  done ??= (async () => {
    const small = raster(192, 128, [120, 90, 60, 255]);
    for (let i = 0; i < 12; i++) await resize(small, 96 + (i % 3), 64, "lanczos3");
    for (let i = 0; i < 6; i++) await encode(small, "jpeg", { quality: 80 });
    for (let i = 0; i < 3; i++) await encode(small, "webp", { quality: 80 });
  })().catch(() => {});
  return done;
}
