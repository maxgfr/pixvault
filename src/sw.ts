/// <reference lib="webworker" />
// Offline support. The build replaces __MANIFEST__ with the hashed list of
// files: the app shell and everyday codecs are cached at install; the rarer
// codecs the first time a photo needs them. AI models are not handled here:
// the page downloads them on request into their own cache (ai/models.ts).

const sw = self as unknown as ServiceWorkerGlobalScope;
declare const __MANIFEST__: { version: string; precache: string[]; lazy: string[] };

const { version, precache, lazy } = __MANIFEST__;
const CACHE = `pixvault-${version}`;
const scope = new URL(sw.registration.scope);
const abs = (p: string) => new URL(p, scope).href;
const lazySet = new Set(lazy.map(abs));
// Photos shared to the app from another one wait here until the page takes them.
const INBOX = "pixvault-inbox";
// Downloaded models: pinned files that outlive app updates, deleted only by the user.
const MODELS = "pixvault-models";
const SHARE_TARGET = abs("./share-target");

sw.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(precache.map(abs)))
      .then(() => sw.skipWaiting()),
  );
});

// The previous version's files stay cached: a tab still open on it keeps
// finding its own code (hashed names the new deploy no longer has) until it
// reloads. Older versions are deleted.
const META = "pixvault-meta";
const KEEP_VERSIONS = 2;

sw.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const meta = await caches.open(META);
      const res = await meta.match(abs("./__versions"));
      const versions = ((res ? await res.json() : []) as string[]).filter((v) => v !== CACHE);
      versions.push(CACHE);
      const keep = new Set([...versions.slice(-KEEP_VERSIONS), INBOX, MODELS, META]);
      await meta.put(abs("./__versions"), new Response(JSON.stringify(versions.slice(-KEEP_VERSIONS))));
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("pixvault-") && !keep.has(k)).map((k) => caches.delete(k)));
      await sw.clients.claim();
    })(),
  );
});

/** Another app shared photos to pixvault (the manifest's share_target). They never leave the device. */
async function receiveShared(req: Request): Promise<Response> {
  const form = await req.formData();
  await caches.delete(INBOX);
  const inbox = await caches.open(INBOX);
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  await Promise.all(
    files.map((f, i) => inbox.put(abs(`./share-inbox/${i}`), new Response(f, { headers: { "content-type": f.type, "x-name": encodeURIComponent(f.name) } }))),
  );
  return Response.redirect(abs("./#/?shared"), 303);
}

sw.addEventListener("fetch", (event: FetchEvent) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === "POST" && url.origin + url.pathname === SHARE_TARGET) {
    event.respondWith(receiveShared(req));
    return;
  }
  if (req.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Navigations always get the app shell: routing lives in the hash.
  const key = req.mode === "navigate" ? abs("./") : url.origin + url.pathname;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // This version first, then the previous one (for tabs still running it).
      const hit = (await cache.match(key)) ?? (req.mode === "navigate" ? undefined : await caches.match(key));
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && (lazySet.has(key) || key === abs("./"))) await cache.put(key, res.clone());
      return res;
    })(),
  );
});
