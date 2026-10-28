import { expect, test } from "@playwright/test";
import { watch } from "./helpers.ts";

test("the site loads with no external request", async ({ page }) => {
  const w = await watch(page);
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await w.assertClean();
});
