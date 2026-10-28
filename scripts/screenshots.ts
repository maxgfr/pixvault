// README screenshots, light and dark, against the local build:
//   bun scripts/build.ts --serve &   then   bun scripts/screenshots.ts <folder of photos>
// The README's photos are public-domain NASA images (docs/CREDITS.md).
import { chromium } from "@playwright/test";
import { readdir } from "node:fs/promises";

const dir = process.argv[2];
if (!dir) throw new Error("usage: bun scripts/screenshots.ts <folder of photos>");
const photos = (await readdir(dir)).filter((f) => /\.(jpe?g|png|heic|webp)$/i.test(f)).sort().map((f) => `${dir}/${f}`);
const out = new URL("../docs/", import.meta.url).pathname;
const site = "http://localhost:4173/pixvault/";

const browser = await chromium.launch();
for (const scheme of ["light", "dark"] as const) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2, colorScheme: scheme, locale: "en-US" });
  await page.goto(site);
  await page.screenshot({ path: `${out}home-${scheme}.png` });
  await page.locator('input[type="file"]').first().setInputFiles(photos);
  await page.locator(".mat .window img").nth(photos.length - 1).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}workspace-${scheme}.png` });
  await page.evaluate(() => (location.hash = "#/adjust"));
  await page.locator(".compare").waitFor();
  await page.getByLabel("Contrast").fill("30");
  await page.getByLabel("Vibrance").fill("45");
  await page.getByLabel("Temperature").fill("-20");
  await page.locator(".compare-frame img").nth(1).waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}adjust-${scheme}.png` });
  await page.close();
}
await browser.close();
// WebP keeps the README light (cwebp from libwebp).
for (const f of (await readdir(out)).filter((f) => f.endsWith(".png"))) {
  await Bun.$`cwebp -quiet -q 86 ${out}${f} -o ${out}${f.replace(/\.png$/, ".webp")}`;
  await Bun.$`rm ${out}${f}`;
}
console.log("screenshots written to docs/");
