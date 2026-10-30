/**
 * Sasi Wonder Cakes - backend (Cloudflare Worker + D1 database)
 *
 * Online classes on Google Meet. The website talks to this Worker at /api (same address as the site,
 * so there is nothing to configure in the browser). Data lives in the D1 database (tables: see
 * backend/schema.sql). Emails are sent through a tiny Gmail relay (backend/mail-relay.gs), because
 * Cloudflare cannot send email without a paid plan and your own domain. See SETUP.md.
 *
 * Secrets (Worker > Settings > Variables and secrets, type "Secret"):
 *   ADMIN_PASSWORD  the password for the very first sign-in (change it in the dashboard afterwards)
 *   MAIL_RELAY_URL  the web-app URL of the Gmail relay
 *   MAIL_SECRET     a long random text that the relay also knows
 */

// ---------- things you may edit ----------
const TZ_OFFSET_MS = 19800000;            // Asia/Kolkata (UTC+5:30, no daylight saving)
const MAX_REGISTRATIONS_PER_HOUR = 60;    // all students together
const MAX_TRIES_PER_PERSON_PER_HOUR = 4;  // per phone number, and per email
const MAX_UNPAID_PER_PERSON = 3;          // unpaid bookings one phone/email can hold at once
const MAX_LOGIN_FAILS_PER_IP = 8;         // wrong passwords from one address before a 15 minute pause
const MAX_LOGIN_FAILS_ALL = 40;           // wrong passwords from everyone together before a 15 minute pause
const PBKDF2_ITERATIONS = 10000;
// ----------------------------------------

// Master list of dishes, copied into the menu table the first time the dashboard loads.
// After that the dashboard's Menu page is the source of truth.
export const MENU_SEED = {
  'Recipes': ['Egg-based brownie', 'Eggless brownie'],
  'Flavours & variations': ['Double chocolate', 'Triple chocolate', 'Nuts', 'Nutella', 'Biscoff', 'Oreo', 'Kitkat', 'Walnut'],
  'Complementary recipes': ['Dark chocolate ganache', 'Milk chocolate ganache', 'White chocolate ganache', 'Caramel'],
  'Brownies': ['Classic Brownie', 'Double Chocolate Brownie', 'Nuts Loaded Brownie', 'Triple Chocolate Brownie', 'Chocochips Brownie', 'Nutella Brownie', 'KitKat Brownie', 'Karuppu Kavani Brownie', 'Pista Blonde', 'Assorted Brownie Box'],
  'Brownie Tubs': ['Nutella Brownie Tub', 'Milk Chocolate Brownie Tub', 'Dark Chocolate Brownie Tub'],
  'Cookies': ['Butter Wheat Cookies', 'Butter Ragi Cookies', 'Butter Wheat Nuts Cookies', 'Butter Ragi Nuts Cookies'],
  'Mini Cakes': ['Tea Cake', 'Rava Cake', 'Plum Cake', 'Banana Chocochip Cake', 'Dream Cake'],
  'Cakes': ['Black Forest Cake', 'Strawberry Cake', 'Blueberry Cake', 'Blackcurrant Cake', 'White Forest Cake', 'Pineapple Cake', 'Mango Cake', 'Butterscotch Cake'],
  'Premium Cakes': ['Choco Truffle Cake', 'Rasamalai Cake', 'Gulab Jamun Cake', 'Ferrero Rocher Cake', 'Nutella Cake', 'Kitkat Cake', 'Bento Cake'],
  'Muffins & Buns': ['Banana Muffins', 'Korean Cheese Garlic Bun'],
  'Add-Ons': ['Choco Chips', 'Crushed Nuts', 'Nutella Drizzle', 'Oreo Crumbs', 'KitKat Pieces', 'Ferrero Rocher (2 pcs)', 'Color Sprinkles', 'Brownie Slab Box Upgrade'],
};

const DEFAULT_SETTINGS = {
  siteName: 'Sasi Wonder Cakes',
  tagline: 'Live online baking classes from our Pondicherry kitchen',
  about: 'Sasi Wonder Cakes is a home bakery in Pondicherry. Join our live weekend classes on Google Meet, bake along from your own kitchen, ask questions as you go, and keep the recipes.',
  defaultStart: '14:00',
  defaultEnd: '17:00',
  defaultCapacity: '10',
  price: '',
  meetLink: '',
  whatsappNumber: '6379293492',
  instagram: 'sasi_wonder_cakes',
  notifyEmail: 'yolosolutions01@gmail.com',
  callmebotKey: '',
  defaultStudentPrep: 'A phone, tablet or laptop with a stable internet connection\nThe ingredients and tools listed for the class\nA clean counter where the camera can see your hands\nJoin 5 minutes early',
  defaultAdminPrep: 'Open the Meet link and test your camera and microphone\nLay out demo ingredients and tools\nOpen the attendee list below\nShare the recipe or ingredient list with students if not already sent',
  upiId: '',
  upiName: '',
  holdHours: '24',
  policyText: 'Your seat is confirmed only after your payment is received.\nIf you cannot attend, tell us at least 24 hours before the class and we will move you to another weekend.\nFees are not refunded once a class has started.\nIf we cancel a class, you can move to another weekend or get a full refund.\nPlease do not share your Google Meet link with others.',
  sendReminders: 'yes',
  countryCode: '91',
};
// Visible to everyone. The Meet link and prep lists are deliberately NOT here.
const PUBLIC_KEYS = ['siteName', 'tagline', 'about', 'defaultStart', 'defaultEnd', 'defaultCapacity', 'price', 'whatsappNumber', 'instagram', 'policyText', 'countryCode'];

// A booking holds a seat when it is confirmed, or when it is pending payment and its hold has not run out.
// (one "?" inside: the current time in milliseconds)
const LIVE = "(status='confirmed' OR (status='pending' AND (expires='' OR CAST(expires AS INTEGER) > ?)))";

class UserError extends Error {
  constructor(message, code) { super(message); this.user = true; this.code = code || 'error'; }
}

// ---------- entry points ----------
export { LiveRoom } from './room.mjs';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/live') return handleLive(request, env);
    if (url.pathname === '/api') return handleApi(request, env, ctx);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
  // Cloudflare runs this every day at 07:00 India time (see "triggers" in wrangler.jsonc).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDaily(env));
  },
};

const roomOf = (env) => env.ROOM.get(env.ROOM.idFromName('main'));

// Pages open a WebSocket here and keep it; the live room (worker/room.mjs) pushes the change counter down it.
export async function handleLive(request, env) {
  if (!env.ROOM) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Not allowed', { status: 403 });
  return roomOf(env).fetch(request);
}

// Tells everyone who is connected that something changed. Failing here must never fail a save.
async function notifyRoom(env, rev) {
  if (!env.ROOM) return;
  try { await roomOf(env).fetch('https://room/notify', { method: 'POST', body: String(rev) }); } catch (e) { console.error('live notify', e); }
}

const API_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export async function handleApi(request, env, ctx) {
  const reply = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: API_HEADERS });
  if (request.method === 'GET') return reply({ ok: true, service: 'Sasi Wonder Cakes API' });
  if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed', code: 'error' }, 405);
  // Only our own pages may call the API from a browser.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ ok: false, error: 'Not allowed', code: 'error' }, 403);
  let out;
  try {
    const text = await request.text();
    if (text.length > 100000) throw new UserError('That request was too large.');
    out = await route(JSON.parse(text), env, ctx, request);
  } catch (err) {
    if (err instanceof UserError) {
      out = { ok: false, error: err.message, code: err.code };
    } else {
      console.error(err && err.stack || err);
      ctx.waitUntil(notifyError(env, err));
      out = { ok: false, error: 'Something went wrong. Please try again.', code: 'server' };
    }
  }
  return reply(out);
}

// Anything that changes what the pages show. Each one bumps the change counter (see "live updates" below).
const WRITES = new Set(['register', 'saveSettings', 'saveSession', 'generateWeekends', 'deleteSession', 'addBooking',
  'removeBooking', 'markPaid', 'saveMenuItem', 'deleteMenuItem']);

async function route(req, env, ctx, request) {
  const out = await dispatch(req, env, ctx, request);
  if (out && out.ok && WRITES.has(req.action)) ctx.waitUntil(notifyRoom(env, await bumpRev(env.DB)));
  return out;
}

async function dispatch(req, env, ctx, request) {
  if (!req || typeof req !== 'object') throw new UserError('Unknown action');
  const db = env.DB;
  switch (req.action) {
    case 'pulse': return pulse(db);
    case 'getPublic': return getPublic(db);
    case 'register': return register(env, ctx, req);
    case 'login': return login(env, req, request);
  }
  await requireAuth(db, req.token);
  switch (req.action) {
    case 'adminGet': return adminGet(db);
    case 'saveSettings': return saveSettings(db, req.settings || {});
    case 'changePassword': return changePassword(env, req);
    case 'saveSession': return saveSession(db, req.session || {});
    case 'generateWeekends': return generateWeekends(db, req);
    case 'deleteSession': return deleteSession(db, req.id);
    case 'addBooking': return addBooking(env, req);
    case 'removeBooking': return removeBooking(db, req.id);
    case 'markPaid': return markPaid(env, ctx, req.id);
    case 'saveMenuItem': return saveMenuItem(db, req);
    case 'deleteMenuItem': return deleteMenuItem(db, req.id);
    case 'remindNow': return remindNow(env, req.sessionId);
    case 'testNotify': return testNotify(env);
  }
  throw new UserError('Unknown action');
}

// Unexpected failures email the admin, at most once an hour, so a broken site doesn't go unnoticed.
async function notifyError(env, err) {
  try {
    if ((await bump(env.DB, 'errMailed', 3600000)) > 1) return;
    const s = await getSettings(env.DB);
    await sendMails(env, [mail(s.notifyEmail, 'Website problem: something failed',
      '<p>An unexpected error happened on the booking site:</p><pre>' + esc(String(err && err.stack || err)).slice(0, 1500) +
      '</pre><p>Open the Cloudflare dashboard, your Worker, then Logs, to see details. This email is sent at most once an hour.</p>', s.siteName)]);
  } catch (e) { console.error(e); }
}

// ---------- database helpers ----------
const prep = (db, sql, args) => { const s = db.prepare(sql); return args && args.length ? s.bind(...args) : s; };
const all = async (db, sql, ...args) => (await prep(db, sql, args).all()).results;
const one = (db, sql, ...args) => prep(db, sql, args).first();
const run = async (db, sql, ...args) => ((await prep(db, sql, args).run()).meta || {}).changes || 0;

// Counts one more hit on a named limit and returns how many hits there have been in the current window.
async function bump(db, key, windowMs) {
  const now = Date.now();
  const row = await one(db,
    'INSERT INTO limits (key, count, resetAt) VALUES (?, 1, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET count = CASE WHEN resetAt <= ? THEN 1 ELSE count + 1 END, ' +
    'resetAt = CASE WHEN resetAt <= ? THEN ? ELSE resetAt END RETURNING count',
    key, now + windowMs, now, now, now + windowMs);
  return row.count;
}

async function peek(db, key) {
  const row = await one(db, 'SELECT count FROM limits WHERE key = ? AND resetAt > ?', key, Date.now());
  return row ? row.count : 0;
}

async function rateLimit(db, key, max, message) {
  if ((await bump(db, key, 3600000)) > max) throw new UserError(message, 'rate');
}

// ---------- small helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ist = (ms) => new Date((ms === undefined ? Date.now() : ms) + TZ_OFFSET_MS);
const isoDate = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const today = () => isoDate(ist());
const stamp = () => { const d = ist(); return isoDate(d) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
const uid = (prefix, n) => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, n);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function normText(t) {
  return String(t === null || t === undefined ? '' : t).replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
}

// A class's "what you'll learn" is plain text: a line starting with # is a section title, every other line is a bullet.
function normDetails(t) {
  return String(t === null || t === undefined ? '' : t).replace(/\r\n?/g, '\n').split('\n')
    .map((s) => s.trim().replace(/^[-•*]\s+/, '')).filter(Boolean).join('\n').slice(0, 3000);
}

function parseDetails(t) {
  const out = [];
  let cur = null;
  normDetails(t).split('\n').filter(Boolean).forEach((line) => {
    const m = /^#+\s*(.*)$/.exec(line);
    if (m) { cur = { title: m[1], items: [] }; out.push(cur); return; }
    if (!cur) { cur = { title: '', items: [] }; out.push(cur); }
    cur.items.push(line);
  });
  return out;
}

function detailsHtml(t) {
  return parseDetails(t).map((g) =>
    (g.title ? '<p style="margin:12px 0 2px"><b>' + esc(g.title) + '</b></p>' : '') +
    '<ul style="padding-left:20px;margin:0">' + g.items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul>').join('');
}

function cleanPrice(v) {
  const s = String(v === null || v === undefined ? '' : v).replace(/[₹,\s]/g, '');
  if (s === '') return '';
  if (!/^\d{1,7}$/.test(s)) throw new UserError('Price must be a whole number of rupees, like 1500.');
  return String(parseInt(s, 10));
}

function cleanUpi(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (s === '') return '';
  if (!/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,30}$/.test(s)) throw new UserError('That UPI ID does not look right. It looks like name@bank, for example sasi@oksbi.');
  return s;
}

function cleanMeet(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (s === '') return '';
  if (!/^https:\/\/meet\.google\.com\/\S+$/.test(s)) throw new UserError('Paste a Google Meet link like https://meet.google.com/abc-defg-hij');
  return s;
}

// ---------- live updates ----------
// Every save bumps one counter. The live room pushes the new number to every open page at once (WebSocket), and as a
// safety net the pages also ask "what is the counter?" every so often (a single tiny read). A page reloads its data
// only when the number has changed.
async function pulse(db) {
  const row = await one(db, "SELECT value FROM settings WHERE key = '_rev'");
  return { ok: true, rev: row ? row.value : '0' };
}

async function bumpRev(db) {
  const row = await one(db, "INSERT INTO settings (key, value) VALUES ('_rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING value");
  return row.value;
}

// ---------- settings ----------
async function getSettings(db) {
  return mergeSettings(await all(db, 'SELECT key, value FROM settings'));
}

function mergeSettings(rows) {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  rows.forEach((r) => { if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, r.key)) s[r.key] = r.value; });
  return s;
}

async function saveSettings(db, incoming) {
  const pairs = [];
  Object.keys(DEFAULT_SETTINGS).forEach((k) => {
    if (!(k in incoming)) return;
    let v = String(incoming[k] === null || incoming[k] === undefined ? '' : incoming[k]).trim();
    if (k === 'defaultCapacity') v = String(Math.max(1, parseInt(v, 10) || 10));
    if (k === 'defaultStart' || k === 'defaultEnd') {
      if (!/^\d{2}:\d{2}$/.test(v)) throw new UserError('Please enter the time like 14:00');
    }
    if (k === 'price') v = cleanPrice(v);
    if (k === 'meetLink') v = cleanMeet(v);
    if (k === 'upiId') v = cleanUpi(v);
    if (k === 'policyText') v = normText(v).slice(0, 2000);
    if (k === 'holdHours') v = String(Math.min(720, Math.max(0, parseInt(v, 10) || 0)));
    if (k === 'defaultStudentPrep' || k === 'defaultAdminPrep') v = normText(v);
    if (k === 'sendReminders') v = v === 'no' ? 'no' : 'yes';
    pairs.push(k, v);
  });
  if (pairs.length) await upsertSettings(db, pairs);
  return { ok: true, settings: await getSettings(db) };
}

// pairs = [key, value, key, value, ...]; one statement, so it is all-or-nothing
function upsertSettings(db, pairs) {
  const rows = new Array(pairs.length / 2).fill('(?, ?)').join(', ');
  return run(db, 'INSERT INTO settings (key, value) VALUES ' + rows + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value', ...pairs);
}

// ---------- sessions ----------
function isLive(b) {
  if (b.status === 'confirmed') return true;
  if (b.status === 'pending') return !b.expires || Number(b.expires) > Date.now();
  return false;
}

async function bookedMap(db) {
  const m = {};
  (await all(db, 'SELECT sessionId, SUM(seats) AS n FROM bookings WHERE ' + LIVE + ' GROUP BY sessionId', Date.now()))
    .forEach((r) => { m[r.sessionId] = r.n; });
  return m;
}

// Blank start/end/capacity/price/meetLink/prep in the table means "follow the default in Settings".
// The result always carries the private fields; use publicSession() before sending to the public.
function sessionOut(s, settings, booked) {
  return {
    id: s.id,
    date: s.date,
    start: s.start || settings.defaultStart,
    end: s.end || settings.defaultEnd,
    topic: s.topic,
    price: s.price || settings.price,
    capacity: parseInt(s.capacity, 10) || parseInt(settings.defaultCapacity, 10) || 10,
    status: s.status || 'open',
    booked: booked || 0,
    meetLink: s.meetLink || settings.meetLink,
    prepStudents: s.prepStudents || settings.defaultStudentPrep,
    prepAdmin: s.prepAdmin || settings.defaultAdminPrep,
    details: s.details || '',
  };
}

function publicSession(s) {
  const o = Object.assign({}, s);
  delete o.meetLink; delete o.prepStudents; delete o.prepAdmin;
  return o;
}

const bySessionTime = (a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''));

async function getPublic(db) {
  const from = today();
  const to = isoDate(ist(Date.now() + 200 * 864e5));
  const [settingsRes, sessionsRes, bookedRes] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    db.prepare('SELECT * FROM sessions WHERE date >= ? AND date <= ?').bind(from, to),
    db.prepare('SELECT sessionId, SUM(seats) AS n FROM bookings WHERE ' + LIVE + ' GROUP BY sessionId').bind(Date.now()),
  ]);
  const settings = mergeSettings(settingsRes.results);
  const booked = {};
  bookedRes.results.forEach((r) => { booked[r.sessionId] = r.n; });
  const sessions = sessionsRes.results.sort(bySessionTime).map((s) => publicSession(sessionOut(s, settings, booked[s.id])));
  const pub = {};
  PUBLIC_KEYS.forEach((k) => { pub[k] = settings[k]; });
  return { ok: true, settings: pub, sessions };
}

async function saveSession(db, p) {
  const settings = await getSettings(db);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new UserError('Please choose a date.');
  const start = p.start || settings.defaultStart;
  const end = p.end || settings.defaultEnd;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new UserError('Please enter valid times.');
  if (end <= start) throw new UserError('End time must be after the start time.');
  const capacity = Math.max(1, parseInt(p.capacity, 10) || parseInt(settings.defaultCapacity, 10) || 10);
  const status = ['open', 'closed', 'cancelled'].indexOf(p.status) >= 0 ? p.status : 'open';
  const price = cleanPrice(p.price);
  const meetLink = cleanMeet(p.meetLink);
  const prepStudents = normText(p.prepStudents);
  const prepAdmin = normText(p.prepAdmin);

  // Store a blank when the value equals the default, so the class keeps following Settings.
  const rec = {
    date: p.date,
    start: start === settings.defaultStart ? '' : start,
    end: end === settings.defaultEnd ? '' : end,
    topic: String(p.topic || '').trim(),
    price: price === settings.price ? '' : price,
    capacity: capacity === (parseInt(settings.defaultCapacity, 10) || 10) ? '' : String(capacity),
    status,
    meetLink: meetLink === settings.meetLink ? '' : meetLink,
    prepStudents: prepStudents === normText(settings.defaultStudentPrep) ? '' : prepStudents,
    prepAdmin: prepAdmin === normText(settings.defaultAdminPrep) ? '' : prepAdmin,
    details: normDetails(p.details),
  };
  const vals = [rec.date, rec.start, rec.end, rec.topic, rec.price, rec.capacity, rec.status, rec.meetLink, rec.prepStudents, rec.prepAdmin, rec.details];

  if (p.id) {
    const n = await run(db, 'UPDATE sessions SET date=?, start=?, end=?, topic=?, price=?, capacity=?, status=?, meetLink=?, prepStudents=?, prepAdmin=?, details=? WHERE id=?', ...vals, p.id);
    if (!n) throw new UserError('That class no longer exists.');
    return { ok: true, id: p.id };
  }
  const id = uid('s', 8);
  await run(db, 'INSERT INTO sessions (id, date, start, end, topic, price, capacity, status, meetLink, prepStudents, prepAdmin, details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, ...vals);
  return { ok: true, id };
}

async function generateWeekends(db, p) {
  const m = /^(\d{4})-(\d{2})$/.exec(p.month || '');
  if (!m) throw new UserError('Please choose a month.');
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  const days = (p.days || [6, 0]).map(Number);
  if (!days.length) throw new UserError('Pick at least one day.');
  const existing = {};
  (await all(db, 'SELECT date FROM sessions')).forEach((s) => { existing[s.date] = true; });
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const todayStr = today();
  const topic = String(p.topic || '').trim();
  const inserts = [];
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    if (days.indexOf(dow) < 0) continue;
    const date = y + '-' + pad(mo) + '-' + pad(d);
    if (existing[date] || date < todayStr) continue;
    inserts.push(db.prepare("INSERT INTO sessions (id, date, topic) VALUES (?, ?, ?)").bind(uid('s', 8), date, topic));
  }
  if (inserts.length) await db.batch(inserts);
  return { ok: true, added: inserts.length };
}

async function deleteSession(db, id) {
  id = String(id || '');
  const row = await one(db, 'SELECT id FROM sessions WHERE id = ?', id);
  if (!row) return { ok: true };
  const n = await run(db, "DELETE FROM sessions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM bookings WHERE sessionId = ? AND status != 'cancelled')", id, id);
  if (!n) throw new UserError('This class has students. Cancel the class instead, or remove the students first.');
  return { ok: true };
}

// ---------- bookings ----------
function waNum(n, cc) {
  let d = String(n || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  if (d.length === 10) d = (cc || '91') + d;
  return d;
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(4));
  let c = '';
  for (let i = 0; i < 4; i++) c += A[r[i] % A.length];
  return 'SWC-' + c;
}

// Checks done before a public booking is even looked at.
async function guardRegister(db, p, settings) {
  if (p.website) throw new UserError('Something went wrong. Please try again.', 'spam'); // hidden field that only bots fill in
  if (!(p.agree === true || p.agree === 'true')) throw new UserError('Please tick the box to accept the terms and privacy notice.');
  await rateLimit(db, 'reg_all', MAX_REGISTRATIONS_PER_HOUR, 'Lots of bookings are coming in right now. Please try again in a few minutes.');
  const phone = waNum(p.phone, settings.countryCode);
  const email = String(p.email || '').trim().toLowerCase();
  const msg = 'Too many attempts from this phone number or email. Please try again in an hour, or message us on WhatsApp.';
  if (phone) await rateLimit(db, 'reg_p_' + (await sha256('rl:' + phone)).slice(0, 32), MAX_TRIES_PER_PERSON_PER_HOUR, msg);
  if (email) await rateLimit(db, 'reg_e_' + (await sha256('rl:' + email)).slice(0, 32), MAX_TRIES_PER_PERSON_PER_HOUR, msg);
}

// One booking = one student = one seat. Every student gives their own email, because the
// Google Meet link and class-day reminders are sent there.
async function createBooking(db, p, isAdmin, settings) {
  const name = String(p.name || '').trim();
  const email = String(p.email || '').trim().toLowerCase();
  const note = String(p.note || '').trim().slice(0, 300);
  if (name.length < 2) throw new UserError('Please enter your name.');
  const phone = waNum(p.phone, settings.countryCode);
  if (phone.length < 11 || phone.length > 15) throw new UserError('Please enter a valid WhatsApp number.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Please enter a valid email. Your class link is sent there.');

  const sRow = await one(db, 'SELECT * FROM sessions WHERE id = ?', String(p.sessionId || ''));
  if (!sRow) throw new UserError('This class is no longer available.');
  const now = Date.now();
  const liveRows = await all(db, 'SELECT sessionId, seats, status, phone, email FROM bookings WHERE (phone = ? OR email = ? OR sessionId = ?) AND ' + LIVE, phone, email, sRow.id, now);
  const booked = liveRows.filter((b) => b.sessionId === sRow.id).reduce((n, b) => n + (b.seats || 1), 0);
  const sess = sessionOut(sRow, settings, booked);
  if (!isAdmin) {
    if (sess.status === 'cancelled') throw new UserError('This class has been cancelled.');
    if (sess.status === 'closed') throw new UserError('Booking is closed for this class.');
    if (sess.date < today()) throw new UserError('This class has already happened.');
  }
  if (sess.capacity - booked <= 0) throw new UserError('Sorry, this class is full.');
  const mine = liveRows.filter((b) => b.phone === phone || b.email === email);
  if (mine.some((b) => b.sessionId === sess.id)) throw new UserError('You are already booked for this class with this number or email.');
  if (!isAdmin) {
    const open = mine.filter((b) => b.status === 'pending').length;
    if (open >= MAX_UNPAID_PER_PERSON) throw new UserError('You already have ' + open + ' unpaid bookings. Please complete payment for those first.');
  }

  // A paid class holds the seat as "pending" until the admin marks the payment received.
  // Free classes, and students the admin adds by hand, are confirmed straight away.
  const fee = parseInt(sess.price, 10) || 0;
  const needsPay = fee > 0 && !isAdmin;
  const hold = parseInt(settings.holdHours, 10) || 0;
  const nowStr = stamp();
  const booking = {
    id: uid('b', 10),
    code: '', sessionId: sess.id, name, phone, email, seats: 1, note,
    createdAt: nowStr, status: needsPay ? 'pending' : 'confirmed',
    amount: fee ? String(fee) : '', paidAt: fee && !needsPay ? nowStr : '',
    expires: needsPay && hold > 0 ? String(now + hold * 3600000) : '',
    consentAt: isAdmin ? '' : nowStr, // when the student ticked the terms box
  };

  // One statement checks "still room" and "not already booked" and adds the booking, so two students
  // clicking at the same moment can never take the same last seat.
  const sql = 'INSERT INTO bookings (id, code, sessionId, name, phone, email, seats, note, createdAt, status, amount, paidAt, expires, consentAt) ' +
    'SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ? ' +
    'WHERE (SELECT COALESCE(SUM(seats), 0) FROM bookings WHERE sessionId = ? AND ' + LIVE + ') < ? ' +
    'AND NOT EXISTS (SELECT 1 FROM bookings WHERE sessionId = ? AND ' + LIVE + ' AND (phone = ? OR email = ?))';
  for (let attempt = 0; ; attempt++) {
    booking.code = newCode();
    let n;
    try {
      n = await run(db, sql, booking.id, booking.code, booking.sessionId, name, phone, email, note, booking.createdAt, booking.status,
        booking.amount, booking.paidAt, booking.expires, booking.consentAt,
        sess.id, now, sess.capacity, sess.id, now, phone, email);
    } catch (err) {
      if (attempt < 5 && /UNIQUE/i.test(String(err && err.message)) && /code/i.test(String(err && err.message))) continue; // that code is taken: pick another
      throw err;
    }
    if (!n) {
      const left = sess.capacity - ((await bookedMap(db))[sess.id] || 0);
      throw new UserError(left <= 0 ? 'Sorry, this class is full.' : 'You are already booked for this class with this number or email.');
    }
    break;
  }
  sess.booked = booked + 1;
  return { booking, session: sess, settings };
}

async function register(env, ctx, p) {
  const settings = await getSettings(env.DB);
  await guardRegister(env.DB, p, settings);
  const r = await createBooking(env.DB, p, false, settings);
  ctx.waitUntil(notifyNewBooking(env, r.booking, r.session, r.settings).catch((e) => console.error('notify failed', e)));
  const pending = r.booking.status === 'pending';
  return {
    ok: true,
    booking: { code: r.booking.code, name: r.booking.name, email: r.booking.email, status: r.booking.status },
    session: publicSession(r.session),
    // the Meet link is only released once the seat is paid for (or the class is free)
    meetLink: pending ? '' : r.session.meetLink,
    payment: pending ? paymentInfo(r.booking, r.session, r.settings) : null,
  };
}

async function addBooking(env, p) {
  const settings = await getSettings(env.DB);
  const r = await createBooking(env.DB, p, true, settings);
  return { ok: true, booking: r.booking };
}

// Admin: the money has arrived. Confirms the seat and emails the student the Meet link.
async function markPaid(env, ctx, id) {
  const db = env.DB;
  const row = await one(db, 'SELECT * FROM bookings WHERE id = ?', String(id || ''));
  if (!row || row.status === 'cancelled') throw new UserError('That booking no longer exists.');
  if (row.status === 'confirmed') return { ok: true };
  const sRow = await one(db, 'SELECT * FROM sessions WHERE id = ?', row.sessionId);
  if (!sRow) throw new UserError('That class no longer exists.');
  const settings = await getSettings(db);
  const expired = !isLive(row);
  const booked = (await bookedMap(db))[sRow.id] || 0;
  const sess = sessionOut(sRow, settings, booked);
  if (expired && booked >= sess.capacity) throw new UserError('The hold on this seat ran out and the class is full now. Raise the seats or remove someone first.');
  const paidAt = stamp();
  const n = await run(db, "UPDATE bookings SET status = 'confirmed', paidAt = ?, expires = '' WHERE id = ? AND status = 'pending'", paidAt, id);
  if (!n) return { ok: true };
  row.status = 'confirmed'; row.paidAt = paidAt; row.expires = '';
  sess.booked = booked + (expired ? 1 : 0);
  // The admin is waiting on this button, so say plainly whether the student's email really went out.
  let emailed = false, emailError = '';
  try {
    emailed = (await sendMails(env, [confirmedEmail(row, sess, settings)]))[0];
    if (!emailed) emailError = 'the email relay could not send it';
  } catch (e) { console.error('confirm email', e); emailError = e.message; }
  return { ok: true, emailed, emailError };
}

async function removeBooking(db, id) {
  await run(db, "UPDATE bookings SET status = 'cancelled' WHERE id = ?", String(id || ''));
  return { ok: true };
}

async function adminGet(db) {
  const [settingsRes, sessionsRes, bookedRes, bookingsRes, menuRes] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    db.prepare('SELECT * FROM sessions'),
    db.prepare('SELECT sessionId, SUM(seats) AS n FROM bookings WHERE ' + LIVE + ' GROUP BY sessionId').bind(Date.now()),
    db.prepare("SELECT * FROM bookings WHERE status != 'cancelled' ORDER BY rowid"),
    db.prepare('SELECT id, category, name FROM menu ORDER BY rowid'),
  ]);
  const settings = mergeSettings(settingsRes.results);
  const booked = {};
  bookedRes.results.forEach((r) => { booked[r.sessionId] = r.n; });
  const sessions = sessionsRes.results.sort(bySessionTime).map((s) => sessionOut(s, settings, booked[s.id]));
  const bookings = bookingsRes.results.map((b) => ({
    id: b.id, code: b.code, sessionId: b.sessionId, name: b.name, phone: b.phone, email: b.email, seats: 1, note: b.note,
    createdAt: b.createdAt, status: b.status || 'confirmed', amount: b.amount, paidAt: b.paidAt, expired: b.status === 'pending' && !isLive(b),
  }));
  let menu = menuRes.results;
  if (!menu.length && !settingsRes.results.some((r) => r.key === '_menuSeeded')) menu = await seedMenu(db);
  return { ok: true, settings, sessions, bookings, menu, today: today() };
}

// ---------- master menu (dishes the admin picks from when building a class) ----------
async function seedMenu(db) {
  const rows = [];
  Object.keys(MENU_SEED).forEach((cat) => MENU_SEED[cat].forEach((name) => rows.push([uid('m', 8), cat, name])));
  const stmts = [];
  for (let i = 0; i < rows.length; i += 30) { // D1 allows at most 100 values in one statement
    const chunk = rows.slice(i, i + 30);
    stmts.push(db.prepare('INSERT INTO menu (id, category, name) VALUES ' + chunk.map(() => '(?, ?, ?)').join(', ')).bind(...chunk.flat()));
  }
  stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('_menuSeeded', '1')"));
  await db.batch(stmts);
  return rows.map((r) => ({ id: r[0], category: r[1], name: r[2] }));
}

async function getMenu(db) {
  const rows = await all(db, 'SELECT id, category, name FROM menu ORDER BY rowid');
  if (rows.length || await one(db, "SELECT 1 AS x FROM settings WHERE key = '_menuSeeded'")) return rows;
  return seedMenu(db);
}

async function saveMenuItem(db, p) {
  await getMenu(db); // make sure the starter list is in before the first manual change
  const name = String(p.name || '').replace(/^[-•*#\s]+/, '').replace(/\s+/g, ' ').trim();
  let category = String(p.category || '').replace(/^[#\s]+/, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) throw new UserError('Please enter a dish name (2 to 80 characters).');
  if (!category || category.length > 40) throw new UserError('Please choose a category, or type a new one (up to 40 characters).');
  const rows = await all(db, 'SELECT id, category, name FROM menu');
  const sameCat = rows.filter((r) => r.category.toLowerCase() === category.toLowerCase())[0];
  if (sameCat) category = sameCat.category; // reuse the existing spelling of that category
  const dupe = rows.some((r) => r.id !== p.id && r.category.toLowerCase() === category.toLowerCase() && r.name.toLowerCase() === name.toLowerCase());
  if (dupe) throw new UserError('"' + name + '" is already in ' + category + '.');
  if (p.id) {
    const n = await run(db, 'UPDATE menu SET category = ?, name = ? WHERE id = ?', category, name, p.id);
    if (!n) throw new UserError('That dish no longer exists.');
  } else {
    await run(db, 'INSERT INTO menu (id, category, name) VALUES (?, ?, ?)', uid('m', 8), category, name);
  }
  return { ok: true, menu: await getMenu(db) };
}

// Deleting a dish only removes it from the dropdown. Classes that already list it keep it.
async function deleteMenuItem(db, id) {
  await run(db, 'DELETE FROM menu WHERE id = ?', String(id || ''));
  return { ok: true, menu: await getMenu(db) };
}

// ---------- authentication ----------
async function pbkdf2(pw, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, key, 256));
}

async function passwordOk(env, pw) {
  const row = await one(env.DB, "SELECT value FROM settings WHERE key = '_pw'");
  if (row) {
    const parts = row.value.split(':'); // pbkdf2:iterations:salt:hash
    return safeEqual(await pbkdf2(pw, parts[2], parseInt(parts[1], 10)), parts[3]);
  }
  if (!env.ADMIN_PASSWORD) {
    throw new UserError('Admin password has not been set up yet. Add the ADMIN_PASSWORD secret to the Worker (see SETUP.md).');
  }
  return safeEqual(pw, env.ADMIN_PASSWORD);
}

async function login(env, p, request) {
  const db = env.DB;
  const ip = (request && request.headers.get('cf-connecting-ip')) || 'unknown';
  const ipKey = 'login_' + (await sha256('ip:' + ip)).slice(0, 32);
  const tooMany = new UserError('Too many wrong attempts. Please try again in 15 minutes.');
  if ((await peek(db, ipKey)) >= MAX_LOGIN_FAILS_PER_IP || (await peek(db, 'login_all')) >= MAX_LOGIN_FAILS_ALL) throw tooMany;
  if (!(await passwordOk(env, String(p.password || '')))) {
    await bump(db, ipKey, 900000);
    await bump(db, 'login_all', 900000);
    throw new UserError('Wrong password.');
  }
  await run(db, 'DELETE FROM limits WHERE key = ?', ipKey);
  const now = Date.now();
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare('DELETE FROM tokens WHERE expires < ?').bind(now),
    db.prepare('INSERT INTO tokens (hash, expires) VALUES (?, ?)').bind(await sha256(token), now + 14 * 864e5),
  ]);
  return { ok: true, token };
}

async function requireAuth(db, token) {
  const row = token ? await one(db, 'SELECT expires FROM tokens WHERE hash = ?', await sha256(String(token))) : null;
  if (!row || row.expires < Date.now()) throw new UserError('Please log in again.', 'auth');
}

async function changePassword(env, p) {
  if (!(await passwordOk(env, String(p.current || '')))) throw new UserError('Current password is wrong.');
  const next = String(p.next || '');
  if (next.length < 6) throw new UserError('New password must be at least 6 characters.');
  const salt = crypto.randomUUID();
  await upsertSettings(env.DB, ['_pw', 'pbkdf2:' + PBKDF2_ITERATIONS + ':' + salt + ':' + (await pbkdf2(next, salt, PBKDF2_ITERATIONS))]);
  return { ok: true };
}

// ---------- notification helpers ----------
function fmtDate(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function fmtTime(t) {
  const h = parseInt(t.slice(0, 2), 10), m = t.slice(3, 5);
  return (h % 12 || 12) + (m === '00' ? '' : ':' + m) + ' ' + (h < 12 ? 'AM' : 'PM');
}

function fmtPrice(p) {
  if (p === '' || p === null || p === undefined) return '';
  const n = parseInt(p, 10);
  if (!n) return 'Free';
  const s = String(n);
  const head = s.slice(0, -3), tail = s.slice(-3);
  return '₹' + (head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + tail;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ul(text) {
  const items = normText(text).split('\n').filter(Boolean);
  return items.length ? '<ul style="padding-left:20px">' + items.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '';
}

function button(url, label) {
  return '<p><a href="' + esc(url) + '" style="background:#b5452a;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold;display:inline-block">' + esc(label) + '</a></p>' +
    '<p style="font-size:13px;color:#666">Link: ' + esc(url) + '</p>';
}

function wrapEmail(inner) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;color:#3a2a25;line-height:1.5">' + inner + '</div>';
}

function whenText(s) {
  return fmtDate(s.date) + ', ' + fmtTime(s.start) + ' - ' + fmtTime(s.end);
}

const mail = (to, subject, html, name) => ({ to, subject, html, name });

// Emails go out through the Gmail relay (backend/mail-relay.gs). Returns one true/false per message.
async function sendMails(env, msgs) {
  msgs = msgs.filter((m) => m && m.to);
  if (!msgs.length) return [];
  if (!env.MAIL_RELAY_URL || !env.MAIL_SECRET) {
    throw new Error('Email sending is not set up yet. Add MAIL_RELAY_URL and MAIL_SECRET to the Worker (see SETUP.md).');
  }
  const res = await fetch(env.MAIL_RELAY_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: env.MAIL_SECRET, messages: msgs }),
  });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('The email relay sent an unexpected reply (HTTP ' + res.status + ').'); }
  if (!data.ok) throw new Error('The email relay refused the request: ' + (data.error || 'unknown reason'));
  return msgs.map((m, i) => !!(data.results || [])[i]);
}

async function sendWhatsApp(text, settings) {
  const phone = waNum(settings.whatsappNumber, settings.countryCode);
  if (!phone || !settings.callmebotKey) return false;
  const url = 'https://api.callmebot.com/whatsapp.php?phone=%2B' + phone +
    '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(settings.callmebotKey);
  const res = await fetch(url);
  return res.status < 300;
}

// ---------- notifications: new booking ----------
function upiUri(upiId, payee, amount, note) {
  return 'upi://pay?pa=' + upiId + '&pn=' + encodeURIComponent(payee) + '&am=' + parseInt(amount, 10) + '.00&cu=INR&tn=' + encodeURIComponent(note);
}

function paymentInfo(b, s, settings) {
  const payee = settings.upiName || settings.siteName;
  return {
    amount: parseInt(b.amount, 10) || 0, upiId: settings.upiId, payeeName: payee, note: b.code,
    uri: settings.upiId ? upiUri(settings.upiId, payee, b.amount, b.code) : '',
    holdHours: parseInt(settings.holdHours, 10) || 0,
  };
}

async function notifyNewBooking(env, b, s, settings) {
  const when = whenText(s);
  const brand = settings.siteName;
  const price = fmtPrice(s.price);
  const pending = b.status === 'pending';

  const adminText = (pending ? 'New booking, PAYMENT PENDING: ' : 'New booking: ') + b.name + '\n' + when + (s.topic ? '\n' + s.topic : '') +
    '\nEmail: ' + b.email + '\nPhone: +' + b.phone + (b.note ? '\nNote: ' + b.note : '') +
    '\nStudents: ' + s.booked + '/' + s.capacity + (price ? '\nFee: ' + price : '') +
    (pending ? '\nRef: ' + b.code + '. Tap Mark paid in the dashboard once the money arrives.' : '');
  const msgs = [
    mail(settings.notifyEmail, (pending ? 'Awaiting payment - ' : 'New booking - ') + b.name + ' - ' + fmtDate(s.date),
      wrapEmail('<p>' + esc(adminText).replace(/\n/g, '<br>') + '</p><p>Ref: ' + b.code + '</p>'), brand),
    pending ? paymentEmail(b, s, settings) : confirmedEmail(b, s, settings),
  ];
  // one relay call carries both emails; the WhatsApp alert goes out beside it
  await Promise.all([
    sendMails(env, msgs).catch((e) => console.error('booking emails', e)),
    sendWhatsApp(adminText, settings).catch((e) => console.error('admin whatsapp', e)),
  ]);
}

// Sent when the seat is confirmed: right away for free classes, or when the admin marks the payment received.
function confirmedEmail(b, s, settings) {
  const when = whenText(s);
  const brand = settings.siteName;
  const paid = (parseInt(b.amount, 10) || 0) > 0;
  return mail(b.email, (paid ? 'Payment received: ' : 'You\'re booked: ') + (s.topic || 'Baking class') + ' - ' + fmtDate(s.date),
    wrapEmail(
      '<h2 style="color:#b5452a;margin-bottom:4px">' + (paid ? 'Payment received. You\'re in, ' : 'You\'re booked, ') + esc(b.name) + '!</h2>' +
      '<p><b>' + esc(s.topic || 'Online baking class') + '</b><br>' + esc(when) + '<br>Live on Google Meet</p>' +
      (s.meetLink ? '<p>Join the class here:</p>' + button(s.meetLink, 'Join on Google Meet') :
        '<p>We\'ll email you the Google Meet link before the class.</p>') +
      (parseDetails(s.details).length ? '<p style="margin-bottom:0"><b>What we\'ll cover</b></p>' + detailsHtml(s.details) : '') +
      (normText(s.prepStudents) ? '<p><b>Please have ready:</b></p>' + ul(s.prepStudents) : '') +
      '<p>Booking reference: <b>' + b.code + '</b></p>' +
      '<p>Questions? WhatsApp us on +' + waNum(settings.whatsappNumber, settings.countryCode) + '.</p>' +
      '<p>- ' + esc(brand) + '</p>'), brand);
}

// Sent right after booking a paid class: how to pay by UPI. The Meet link comes after the payment is confirmed.
function paymentEmail(b, s, settings) {
  const when = whenText(s);
  const brand = settings.siteName;
  const info = paymentInfo(b, s, settings);
  const wa = waNum(settings.whatsappNumber, settings.countryCode);
  const td = 'padding:6px 14px;';
  return mail(b.email, 'Complete your payment to confirm your seat - ' + fmtDate(s.date),
    wrapEmail(
      '<h2 style="color:#b5452a;margin-bottom:4px">Almost there, ' + esc(b.name) + '!</h2>' +
      '<p><b>' + esc(s.topic || 'Online baking class') + '</b><br>' + esc(when) + '<br>Live on Google Meet</p>' +
      '<p>Your seat is reserved but <b>not confirmed until you pay</b>. ' +
      (info.holdHours ? 'We\'ll hold it for ' + info.holdHours + ' hours.' : 'We\'re holding it for you.') + '</p>' +
      '<table style="border-collapse:collapse;background:#fff8ec;border-radius:8px;font-size:15px">' +
      '<tr><td style="' + td + '">Amount</td><td style="' + td + '"><b>' + esc(fmtPrice(b.amount)) + '</b></td></tr>' +
      (info.upiId ? '<tr><td style="' + td + '">Pay to UPI ID</td><td style="' + td + '"><b>' + esc(info.upiId) + '</b> (' + esc(info.payeeName) + ')</td></tr>' : '') +
      '<tr><td style="' + td + '">Payment note</td><td style="' + td + '"><b>' + b.code + '</b></td></tr></table>' +
      (info.upiId ? '<p>Open GPay, PhonePe or Paytm, choose <i>Pay to UPI ID</i>, enter the amount, and put the note above.</p>' :
        '<p>Message us on WhatsApp for the payment details.</p>') +
      '<p>After paying, send a screenshot on WhatsApp (+' + wa + ') with your reference <b>' + b.code + '</b>. As soon as we confirm it, we\'ll email you the Google Meet link.</p>' +
      (parseDetails(s.details).length ? '<p style="margin-bottom:0"><b>What we\'ll cover</b></p>' + detailsHtml(s.details) : '') +
      '<p>- ' + esc(brand) + '</p>'), brand);
}

// ---------- notifications: class day ----------
// Emails each PAID student the Meet link and what to keep ready, and sends the admin the full run-down
// (class details, Meet link, prep checklist, attendee list, and who still owes payment) by email and WhatsApp.
async function classDayNotify(env, sess, settings, list, pending) {
  const when = whenText(sess);
  const title = sess.topic || 'Baking class';
  const brand = settings.siteName;
  const out = { students: list.length, pending: pending.length, studentEmails: 0, adminEmail: false, adminWhatsApp: false };

  const studentMsgs = list.map((b) => mail(b.email, 'Today at ' + fmtTime(sess.start) + ': ' + title,
    wrapEmail(
      '<h2 style="color:#b5452a;margin-bottom:4px">Your class is today, ' + esc(b.name) + '!</h2>' +
      '<p><b>' + esc(title) + '</b><br>' + esc(when) + '</p>' +
      (sess.meetLink ? button(sess.meetLink, 'Join on Google Meet') : '<p>We\'ll message you the Google Meet link shortly.</p>') +
      (normText(sess.prepStudents) ? '<p><b>Please have ready:</b></p>' + ul(sess.prepStudents) : '') +
      '<p>See you soon!<br>- ' + esc(brand) + '</p>'), brand));

  const rows = list.map((b, i) =>
    '<tr><td style="padding:4px 8px">' + (i + 1) + '</td><td style="padding:4px 8px"><b>' + esc(b.name) + '</b>' + (b.note ? '<br><i>' + esc(b.note) + '</i>' : '') +
    '</td><td style="padding:4px 8px">' + esc(b.email) + '<br>+' + esc(b.phone) + '</td></tr>').join('');
  const price = fmtPrice(sess.price);
  const adminHtml = (sentCount) => wrapEmail(
    '<h2 style="color:#b5452a;margin-bottom:4px">Today\'s class</h2>' +
    '<p><b>' + esc(title) + '</b><br>' + esc(when) + (price ? '<br>Fee: ' + esc(price) + ' per student' : '') +
    '<br><b>' + list.length + ' confirmed of ' + sess.capacity + ' seats</b></p>' +
    (sess.meetLink ? button(sess.meetLink, 'Open Google Meet') : '<p style="color:#b42318"><b>No Meet link is set for this class yet.</b></p>') +
    (parseDetails(sess.details).length ? '<p style="margin-bottom:0"><b>Today\'s class menu</b></p>' + detailsHtml(sess.details) : '') +
    (normText(sess.prepAdmin) ? '<p><b>Your checklist before class:</b></p>' + ul(sess.prepAdmin) : '') +
    (normText(sess.prepStudents) ? '<p><b>Students were asked to have ready:</b></p>' + ul(sess.prepStudents) : '') +
    '<p><b>Attendees (paid)</b></p>' + (list.length ? '<table style="border-collapse:collapse;font-size:14px">' + rows + '</table>' : '<p>No confirmed students for this class.</p>') +
    (pending.length ? '<p style="color:#b42318"><b>Still awaiting payment (no link sent):</b> ' + pending.map((b) => esc(b.name) + ' (' + b.code + ')').join(', ') + '</p>' : '') +
    '<p style="font-size:13px;color:#666">Paid students have been emailed the Meet link' + (sentCount ? ' (' + sentCount + ' sent)' : '') + '.</p>');

  try {
    out.studentEmails = (await sendMails(env, studentMsgs)).filter(Boolean).length;
  } catch (e) { console.error('student reminders', e); }
  try {
    const res = await sendMails(env, [mail(settings.notifyEmail, 'Today\'s class: ' + title + ' - ' + list.length + ' students', adminHtml(out.studentEmails), brand)]);
    out.adminEmail = !!res[0];
  } catch (e) { console.error('admin summary email', e); }

  const waText = 'TODAY: ' + title + '\n' + when + '\n' + list.length + '/' + sess.capacity + ' confirmed' +
    (sess.meetLink ? '\nMeet: ' + sess.meetLink : '\nNo Meet link set!') +
    (normText(sess.prepAdmin) ? '\n\nPrepare:\n- ' + normText(sess.prepAdmin).split('\n').join('\n- ') : '') +
    (list.length ? '\n\nStudents:\n' + list.map((b) => b.name).join(', ') : '') +
    (pending.length ? '\n\nUNPAID: ' + pending.map((b) => b.name).join(', ') : '');
  try { out.adminWhatsApp = await sendWhatsApp(waText, settings); } catch (e) { console.error('admin summary whatsapp', e); }
  return out;
}

async function classDayRun(env, rows, settings) {
  const db = env.DB;
  const booked = await bookedMap(db);
  const live = await all(db, 'SELECT * FROM bookings WHERE ' + LIVE + ' ORDER BY rowid', Date.now());
  const results = [];
  for (const row of rows) {
    const sess = sessionOut(row, settings, booked[row.id]);
    const mine = live.filter((b) => b.sessionId === sess.id);
    results.push(await classDayNotify(env, sess, settings, mine.filter((b) => b.status === 'confirmed'), mine.filter((b) => b.status === 'pending')));
  }
  return results;
}

// Runs every day at 07:00 India time: class-day notifications, plus a little housekeeping.
export async function runDaily(env) {
  const db = env.DB;
  try {
    await db.batch([
      db.prepare('DELETE FROM tokens WHERE expires < ?').bind(Date.now()),
      db.prepare('DELETE FROM limits WHERE resetAt < ?').bind(Date.now()),
    ]);
  } catch (e) { console.error('cleanup', e); }
  const settings = await getSettings(db);
  if (settings.sendReminders === 'no') return;
  const rows = await all(db, "SELECT * FROM sessions WHERE date = ? AND status != 'cancelled'", today());
  await classDayRun(env, rows, settings);
}

// Admin button: send the class-day notifications for one class right now.
async function remindNow(env, sessionId) {
  const row = await one(env.DB, 'SELECT * FROM sessions WHERE id = ?', String(sessionId || ''));
  if (!row) throw new UserError('That class no longer exists.');
  if (row.status === 'cancelled') throw new UserError('This class is cancelled.');
  return { ok: true, result: (await classDayRun(env, [row], await getSettings(env.DB)))[0] };
}

async function testNotify(env) {
  const settings = await getSettings(env.DB);
  const result = { email: 'skipped (no email set)', whatsapp: 'skipped (no CallMeBot key set)' };
  if (settings.notifyEmail) {
    try {
      const sent = (await sendMails(env, [mail(settings.notifyEmail, 'Test from ' + settings.siteName, '<p>Email notifications are working.</p>', settings.siteName)]))[0];
      result.email = sent ? 'sent to ' + settings.notifyEmail : 'failed: the email relay could not send it';
    } catch (e) { result.email = 'failed: ' + e.message; }
  }
  if (settings.callmebotKey) {
    try { result.whatsapp = (await sendWhatsApp('Test message from ' + settings.siteName + ': WhatsApp alerts are working.', settings)) ? 'sent' : 'failed (check number and key)'; }
    catch (e) { result.whatsapp = 'failed: ' + e.message; }
  }
  return { ok: true, result };
}
