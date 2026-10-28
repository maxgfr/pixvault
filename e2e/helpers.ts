import { expect, type Page } from "@playwright/test";

export const siteURL = process.env.PIXVAULT_URL ?? "http://localhost:4173/pixvault/";
const siteOrigin = new URL(siteURL).origin;

export const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;

/** Records every request leaving the page's origin, every CSP violation and every page error. */
export async function watch(page: Page) {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (![siteOrigin, "null"].includes(u.origin) && !["blob:", "data:"].includes(u.protocol)) external.push(r.url());
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return {
    async assertClean() {
      expect(external, "requests to other origins").toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), "CSP violations").toEqual([]);
      expect(errors, "page errors").toEqual([]);
    },
  };
}
