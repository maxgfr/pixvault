import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixture, watch } from "./helpers.ts";

test("remove a background after agreeing to the model download", async ({ page }) => {
  const w = await watch(page);
  await page.goto("./");
  await page.locator('input[type="file"]').first().setInputFiles([fixture("plain.jpg")]);
  await expect(page.locator(".mat .window img")).toHaveCount(1, { timeout: 30_000 });
  await page.goto("./#/remove-bg");
  // Headless Chromium has no WebGPU: the lighter MODNet, served by this site, is offered.
  const get = page.getByRole("button", { name: /Download .* and continue/ });
  await expect(get).toBeVisible();
  await get.click();
  await expect(get).toBeHidden({ timeout: 60_000 });
  await page.locator(".run-button").click();
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toBeVisible({ timeout: 120_000 });
  await expect(results.locator(".error-text")).toHaveCount(0);
  const [file] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: "Download" }).first().click()]);
  expect(file.suggestedFilename()).toBe("plain.png");
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  await w.assertClean();
});

test("erase what is painted over", async ({ page }) => {
  const w = await watch(page);
  await page.goto("./");
  await page.locator('input[type="file"]').first().setInputFiles([fixture("gps.jpg")]);
  await expect(page.locator(".mat .window img")).toHaveCount(1, { timeout: 30_000 });
  await page.goto("./#/erase");
  await page.getByRole("button", { name: /Download .* and continue/ }).click();
  const canvas = page.getByLabel("Paint over what to erase");
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.52, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".run-button")).toBeEnabled();
  await page.locator(".run-button").click();
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toBeVisible({ timeout: 120_000 });
  await expect(results.locator(".error-text")).toHaveCount(0);
  await w.assertClean();
});

test("the AI page lists the models and loads the provider settings without calling anyone", async ({ page }) => {
  const w = await watch(page);
  await page.goto("./#/ai");
  await expect(page.getByRole("heading", { level: 1, name: "AI on your device" })).toBeVisible();
  await expect(page.locator(".model-row")).toHaveCount(9);
  await expect(page.getByLabel("API key")).toBeVisible();
  await w.assertClean();
});
