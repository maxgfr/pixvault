// Writes the small test photos the end-to-end suite drops into the app:
// run once with `bun --preload ./src/engine/test/setup.ts scripts/fixtures.ts`
// (outputs are committed, fixtures/sample.heic was made with macOS sips).
import { encode } from "../src/engine/codecs.ts";
import { setMeta } from "../src/engine/meta/containers.ts";
import { buildExif } from "../src/engine/meta/exif-write.ts";
import { PHONE } from "../src/engine/meta/fixtures.ts";
import { noisy, sample } from "../src/engine/test/setup.ts";

const dir = new URL("../fixtures/", import.meta.url).pathname;
await Bun.write(`${dir}gps.jpg`, setMeta(await encode(noisy(640, 480), "jpeg", { quality: 95 }), { exif: buildExif(PHONE) }));
await Bun.write(`${dir}plain.jpg`, await encode(noisy(480, 640), "jpeg", { quality: 92 }));
await Bun.write(`${dir}logo.png`, await encode(sample(200, 120, true), "png"));
console.log("fixtures written");
