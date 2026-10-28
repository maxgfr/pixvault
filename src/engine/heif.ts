// HEIC/HEIF (iPhone photos) through libheif compiled to wasm, for browsers
// that do not decode it themselves (all but Safari).

import { DecodeError } from "./errors.ts";
import { fromImageData, MAX_PIXELS, type Raster } from "./raster.ts";
import { once, wasm } from "./wasm.ts";

interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (r: unknown) => void): void;
  free(): void;
}
interface Libheif {
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
}

const libheif = once<Libheif>(async () => {
  const module = await wasm("heif");
  const { default: factory } = (await import("libheif-js/libheif-wasm/libheif.js")) as unknown as { default: (o: object) => Libheif | Promise<Libheif> };
  return await factory({
    instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
      const instance = new WebAssembly.Instance(module, imports);
      done(instance);
      return instance.exports;
    },
  });
});

export async function decodeHeif(bytes: Uint8Array): Promise<Raster> {
  const lib = await libheif();
  const images = new lib.HeifDecoder().decode(bytes);
  const image = images.find((i) => i.is_primary?.()) ?? images[0];
  if (!image) throw new DecodeError("this HEIC file has no image pixvault can read");
  try {
    const width = image.get_width();
    const height = image.get_height();
    if (width * height > MAX_PIXELS) throw new DecodeError(`${width}×${height} is too large to process here`, "too-large");
    const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
    await new Promise<void>((resolve, reject) => image.display(target, (r) => (r ? resolve() : reject(new DecodeError("this HEIC file could not be decoded")))));
    return fromImageData(target);
  } finally {
    for (const i of images) i.free?.();
  }
}
