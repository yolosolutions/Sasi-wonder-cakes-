// Service worker tests: runs sw.js in a simulated browser (fake cache, fake network) and checks what it saves and serves.
// Run with:  node tests/sw.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const SRC = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://site.test';
const key = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);

function boot() {
  const handlers = {}, store = new Map();
  const state = { online: true, redirected: false, fetched: [] };
  const net = async (r) => {
    state.fetched.push(key(r));
    if (!state.online) throw new TypeError('Failed to fetch');
    const res = new Response('body of ' + key(r), { status: 200 });
    if (state.redirected) Object.defineProperty(res, 'redirected', { value: true });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const cache = { add: async (u) => { store.set(key(u), await net(u)); }, put: async (r, res) => { store.set(key(r), res); } };
  const ctx = {
    self: { location: { origin: ORIGIN }, addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache, match: async (r) => store.get(key(r)), keys: async () => ['swc-shell-v1', 'old'], delete: async () => true },
    fetch: net, Response, URL, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const request = (path, o) => Object.assign({ url: ORIGIN + path, method: 'GET', mode: 'no-cors' }, o);
  // runs the fetch handler; returns the response the worker answered with, or null when it left the request alone
  const ask = async (req) => {
    let answered = null;
    handlers.fetch({ request: req, respondWith: (p) => { answered = p; } });
    if (!answered) return null;
    const res = await answered; await new Promise((r) => setTimeout(r, 5));
    return res;
  };
  return { handlers, store, state, request, ask };
}

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok -', m); };
const text = async (r) => (r ? r.text() : null);

console.log('# service worker');
{
  const t = boot();
  await new Promise((resolve) => t.handlers.install({ waitUntil: (p) => p.then(resolve) }));
  ok(t.store.has(ORIGIN + '/offline') && t.store.has(ORIGIN + '/css/style.css'), 'installing saves the offline page and the stylesheet');

  ok((await t.ask(t.request('/api', { method: 'POST' }))) === null, 'POST requests are left alone');
  ok((await t.ask(t.request('/api'))) === null && (await t.ask(t.request('/api/live'))) === null, 'nothing under /api is ever intercepted or saved');
  ok((await t.ask({ url: 'https://other.example/x.js', method: 'GET', mode: 'no-cors' })) === null, 'other websites are left alone');

  const online = await t.ask(t.request('/admin', { mode: 'navigate' }));
  ok(await text(online) === 'body of ' + ORIGIN + '/admin' && t.store.has(ORIGIN + '/admin'), 'online: the page comes from the network and a spare copy is saved');

  t.state.online = false;
  const spare = await t.ask(t.request('/admin', { mode: 'navigate' }));
  ok(await text(spare) === 'body of ' + ORIGIN + '/admin', 'offline: a page seen before opens from the saved copy');
  const never = await t.ask(t.request('/classes-we-never-opened', { mode: 'navigate' }));
  ok(await text(never) === 'body of ' + ORIGIN + '/offline', 'offline: a page never seen shows the friendly offline page');
  const asset = await t.ask(t.request('/js/never-seen.js'));
  ok(asset && asset.type === 'error', 'offline: a file that was never saved fails cleanly (no fake page in its place)');

  t.state.online = true; t.state.redirected = true;
  await t.ask(t.request('/old-address', { mode: 'navigate' }));
  ok(!t.store.has(ORIGIN + '/old-address'), 'a redirected response is never saved (browsers refuse to use it later)');

  const cleaned = []; t.handlers.activate({ waitUntil: (p) => cleaned.push(p) }); await Promise.all(cleaned);
  ok(cleaned.length === 1, 'activating removes old saved copies');
}

console.log('# app description files (manifests)');
for (const name of ['manifest.webmanifest', 'admin.webmanifest']) {
  const m = JSON.parse(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
  ok(m.name && m.short_name.length <= 12 && m.display === 'standalone' && m.start_url.startsWith('/') && m.scope === '/' && /^#[0-9a-f]{6}$/i.test(m.theme_color), name + ': name, short name (fits under the icon), full-screen display, start page');
  const sizes = m.icons.map((i) => {
    const f = fs.readFileSync(new URL('..' + i.src, import.meta.url)); // PNG header: width and height at bytes 16-23
    return f.readUInt32BE(16) + 'x' + f.readUInt32BE(20) === i.sizes && f.subarray(1, 4).toString() === 'PNG';
  });
  ok(sizes.every(Boolean) && m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.purpose === 'maskable'), name + ': every icon exists and is the size it claims (192, 512 and a maskable one)');
}
{
  const apple = fs.readFileSync(new URL('../assets/icons/apple-touch-icon.png', import.meta.url));
  ok(apple.readUInt32BE(16) === 180 && apple.readUInt32BE(20) === 180, 'the iPhone home-screen icon is 180x180');
  for (const page of ['index.html', 'admin.html']) {
    const h = fs.readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    ok(/rel="manifest"/.test(h) && /apple-mobile-web-app-capable/.test(h) && h.includes('apple-touch-icon" href="/assets/icons/apple-touch-icon.png"') && h.includes('js/install.js'), page + ': links its manifest, the iPhone app tags and the install script');
  }
}

console.log('\nAll ' + passed + ' checks passed');
