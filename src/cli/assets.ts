// Files the standalone binary carries inside itself (`bun build --compile`
// embeds every `with { type: "file" }` import); run from source, these are
// the paths in node_modules and assets/.

import avifDec from "@jsquash/avif/codec/dec/avif_dec.wasm" with { type: "file" };
import avifEnc from "@jsquash/avif/codec/enc/avif_enc.wasm" with { type: "file" };
import jpegDec from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm" with { type: "file" };
import jpegEnc from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm" with { type: "file" };
import jxlDec from "@jsquash/jxl/codec/dec/jxl_dec.wasm" with { type: "file" };
import jxlEnc from "@jsquash/jxl/codec/enc/jxl_enc.wasm" with { type: "file" };
// @ts-expect-error The package types its .wasm as a module; imported as a file it is a path.
import oxipng from "@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm" with { type: "file" };
// @ts-expect-error The package types its .wasm as a module; imported as a file it is a path.
import png from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };
import qoiDec from "@jsquash/qoi/codec/dec/qoi_dec.wasm" with { type: "file" };
import qoiEnc from "@jsquash/qoi/codec/enc/qoi_enc.wasm" with { type: "file" };
// @ts-expect-error The package types its .wasm as a module; imported as a file it is a path.
import resize from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm" with { type: "file" };
import webpDec from "@jsquash/webp/codec/dec/webp_dec.wasm" with { type: "file" };
import webpEnc from "@jsquash/webp/codec/enc/webp_enc_simd.wasm" with { type: "file" };
import resvg from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };
import heif from "libheif-js/libheif-wasm/libheif.wasm" with { type: "file" };
import ort from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm" with { type: "file" };
import mono from "../../assets/fonts/LiberationMono-Bold.ttf" with { type: "file" };
import sans from "../../assets/fonts/LiberationSans-Bold.ttf" with { type: "file" };
import serif from "../../assets/fonts/LiberationSerif-Bold.ttf" with { type: "file" };
import type { WasmName } from "../engine/wasm.ts";

export const CODECS: Record<WasmName, string> = {
  "jpeg-enc": jpegEnc,
  "jpeg-dec": jpegDec,
  "webp-enc": webpEnc,
  "webp-dec": webpDec,
  "avif-enc": avifEnc,
  "avif-dec": avifDec,
  "jxl-enc": jxlEnc,
  "jxl-dec": jxlDec,
  png,
  oxipng,
  "qoi-enc": qoiEnc,
  "qoi-dec": qoiDec,
  resize,
  heif,
};

export const FONT_FILES = { sans, serif, mono };
export const ORT_WASM = ort;
export const RESVG_WASM = resvg;

export const read = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());
