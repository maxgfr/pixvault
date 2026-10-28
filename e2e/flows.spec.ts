import { expect, type Page, test } from "@playwright/test";
import exifr from "exifr";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { fixture, watch } from "./helpers.ts";

async function drop(page: Page, names: string[]) {
  await page.goto("./");
  await page.locator('input[type="file"]').first().setInputFiles(names.map(fixture));
  await expect(page.locator(".mat")).toHaveCount(names.length);
  // Thumbnails and details are read in workers.
  await expect(page.locator(".mat .window img")).toHaveCount(names.length, { timeout: 30_000 });
}

async function runAndDownload(page: Page, button: RegExp | string, download: RegExp | string) {
  await page.locator(".run-button").click();
  const results = page.getByRole("region", { name: /Results|Résultats/ });
  await expect(results).toBeVisible({ timeout: 90_000 });
  await expect(results.locator(".error-text")).toHaveCount(0);
  const [file] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: download }).first().click()]);
  expect(button).toBeTruthy();
  return { bytes: new Uint8Array(await readFile((await file.path())!)), name: file.suggestedFilename() };
}

test("compress a batch and download it as a ZIP", async ({ page }) => {
  const w = await watch(page);
  await drop(page, ["gps.jpg", "plain.jpg", "logo.png"]);
  await expect(page.locator(".badge-gps")).toHaveCount(1);
  await page.getByRole("link", { name: /^Compress/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compress" })).toBeVisible();
  const { bytes, name } = await runAndDownload(page, "Compress", "Download all (ZIP)");
  expect(name).toBe("pixvault-compress.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files).sort()).toEqual(["gps.jpg", "logo.png", "plain.jpg"]);
  // Never larger than the originals.
  expect(files["plain.jpg"]!.length).toBeLessThanOrEqual((await readFile(fixture("plain.jpg"))).length);
  await w.assertClean();
});

test("convert an iPhone HEIC photo to JPEG", async ({ page }) => {
  const w = await watch(page);
  await drop(page, ["sample.heic"]);
  await page.goto("./#/convert");
  const { bytes, name } = await runAndDownload(page, "Convert", "Download");
  expect(name).toBe("sample.jpg");
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  await w.assertClean();
});

test("remove the location without touching the pixels", async ({ page }) => {
  const w = await watch(page);
  await drop(page, ["gps.jpg"]);
  expect(await exifr.gps(await readFile(fixture("gps.jpg")))).toBeTruthy();
  await page.goto("./#/strip");
  await page.getByLabel("Remove", { exact: true }).selectOption("gps");
  const { bytes } = await runAndDownload(page, "Remove metadata", "Download");
  expect(await exifr.gps(Buffer.from(bytes))).toBeUndefined();
  const meta = await exifr.parse(Buffer.from(bytes));
  expect(meta?.Model).toBe("iPhone 15 Pro");
  await w.assertClean();
});

test("a recipe chains steps and writes WebP", async ({ page }) => {
  const w = await watch(page);
  await drop(page, ["plain.jpg"]);
  await page.goto("./#/recipe");
  await page.getByLabel("Save as").selectOption("webp");
  await page.getByRole("button", { name: /Run the recipe/ }).click();
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toBeVisible({ timeout: 60_000 });
  const [file] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: "Download" }).first().click()]);
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
  await w.assertClean();
});

test("a collage of several photos", async ({ page }) => {
  const w = await watch(page);
  await drop(page, ["gps.jpg", "plain.jpg"]);
  await page.goto("./#/collage");
  const { bytes, name } = await runAndDownload(page, "Collage", "Download");
  expect(name).toMatch(/\.jpg$/);
  expect(bytes[0]).toBe(0xff);
  await w.assertClean();
});

test("the interface speaks French", async ({ page }) => {
  const w = await watch(page);
  await page.goto("./");
  await page.getByRole("button", { name: "FR" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Des outils photo qui n'envoient jamais vos photos.");
  await page.getByRole("button", { name: "EN" }).click();
  await w.assertClean();
});

test("an iPhone HEIC shows its size and compresses to a format the browser can write", async ({ page }) => {
  const w = await watch(page);
  await drop(page, ["sample.heic"]);
  await expect(page.locator(".mat .label-line")).toContainText("HEIC · 96×64");
  await page.goto("./#/compress");
  await page.locator(".run-button").click();
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toBeVisible({ timeout: 60_000 });
  await expect(results).toContainText("cannot be written in a browser");
  await expect(results.locator(".result-name")).toContainText(/sample\.(webp|jpg)/);
  await w.assertClean();
});
