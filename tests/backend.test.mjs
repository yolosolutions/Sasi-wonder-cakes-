// Backend tests: runs worker/index.mjs against a real SQLite database (node:sqlite) shaped like Cloudflare D1,
// with a fake email relay and fake WhatsApp service.
// Run with:  node tests/backend.test.mjs   (needs Node 22.13 or newer)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker, { handleApi, runDaily, MENU_SEED } from '../worker/index.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'backend', 'schema.sql'), 'utf8');
const RELAY = 'https://relay.test/exec', SECRET = 'relay-secret-123';

// ---------- a D1 look-alike on top of node:sqlite ----------
class FakeD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec(SCHEMA); }
  prepare(sql) {
    const self = this;
    const make = (args) => ({
      sql, args,
      bind: (...a) => { a.forEach((v) => assert.ok(v !== undefined, 'undefined bound to: ' + sql)); return make(a); },
      async first() { const r = self.sql.prepare(sql).get(...args); return r ? { ...r } : null; },
      async all() { return self.exec1(sql, args); },
      async run() { return self.exec1(sql, args); },
    });
    return make([]);
  }
  exec1(sql, args) {
    const st = this.sql.prepare(sql);
    if (st.columns().length) return { results: st.all(...args).map((r) => ({ ...r })), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(st.run(...args).changes) } };
  }
  async batch(stmts) {
    this.sql.exec('BEGIN');
    try { const out = stmts.map((s) => this.exec1(s.sql, s.args)); this.sql.exec('COMMIT'); return out; } catch (e) { this.sql.exec('ROLLBACK'); throw e; }
  }
}

let active = null;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url === RELAY) {
    const body = JSON.parse(init.body);
    if (body.secret !== SECRET) return new Response(JSON.stringify({ ok: false, error: 'denied' }));
    body.messages.forEach((m) => active.mails.push({ to: m.to, subject: m.subject, htmlBody: m.html, name: m.name }));
    return new Response(JSON.stringify({ ok: true, results: body.messages.map(() => true) }));
  }
  active.fetches.push(url);
  return new Response('ok');
};

function makeEnv(extra) {
  const d1 = new FakeD1();
  const t = { d1, mails: [], fetches: [], pending: [], env: Object.assign({ DB: d1, ADMIN_PASSWORD: 'secret1', MAIL_RELAY_URL: RELAY, MAIL_SECRET: SECRET }, extra) };
  const ctx = { waitUntil: (p) => t.pending.push(p) };
  t.flush = async () => { while (t.pending.length) await t.pending.shift(); };
  t.rows = (sql, ...a) => d1.sql.prepare(sql).all(...a).map((r) => ({ ...r }));
  t.exec = (sql, ...a) => d1.sql.prepare(sql).run(...a);
  t.raw = async (req, headers) => {
    active = t;
    const res = await handleApi(new Request('https://site.test/api', { method: 'POST', body: typeof req === 'string' ? req : JSON.stringify(req), headers: headers || {} }), t.env, ctx);
    await t.flush();
    return res;
  };
  t.call = async (req, headers) => (await t.raw(req, headers)).json();
  t.ctx = ctx;
  return t;
}

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok -', m); };
const fails = (r, m, re) => { assert.strictEqual(r.ok, false, m + ' (should fail)'); if (re) assert.match(r.error, re, m); passed++; console.log('  ok -', m, '->', r.error); };
const istToday = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

console.log('# schema');
{
  const d = new FakeD1();
  d.sql.exec(SCHEMA);
  ok(d.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n === 6, 'schema.sql can be run twice and makes the 6 tables');
}

console.log('# password guard');
{
  const g = makeEnv({ ADMIN_PASSWORD: undefined });
  fails(await g.call({ action: 'login', password: 'x' }), 'login refused while no ADMIN_PASSWORD secret is set', /not been set up/);
}

const t = makeEnv(), call = t.call;
const login = await call({ action: 'login', password: 'secret1' }); ok(login.ok, 'login works');
const tok = login;
const A = (o) => call(Object.assign({ token: tok.token }, o));
const MEET = 'https://meet.google.com/abc-defg-hij';
fails(await call({ action: 'login', password: 'nope' }), 'wrong password refused', /Wrong password/);
ok(t.rows('SELECT hash FROM tokens').every((r) => r.hash !== tok.token && r.hash.length === 64), 'only a hash of the sign-in token is stored');

console.log('# settings: price + meet link');
let r = await A({ action: 'saveSettings', settings: { whatsappNumber: '98765 43210', notifyEmail: 'owner@example.com', callmebotKey: 'KEY123', price: '₹1,500', meetLink: MEET, upiId: 'sasi@oksbi', upiName: 'Sasi Wonder Cakes' } });
ok(r.ok && r.settings.price === '1500', 'price saved as plain number: ' + r.settings.price);
fails(await A({ action: 'saveSettings', settings: { price: 'free!' } }), 'non-numeric price rejected', /whole number/);
fails(await A({ action: 'saveSettings', settings: { meetLink: 'https://zoom.us/j/1' } }), 'non-Meet link rejected', /Google Meet/);
fails(await A({ action: 'saveSettings', settings: { upiName: 'Should not save', defaultStart: 'bad' } }), 'one bad value rejects the whole save', /time/);
ok((await A({ action: 'adminGet' })).settings.upiName === 'Sasi Wonder Cakes', '...and nothing else from that save is stored');
ok(!JSON.stringify(await A({ action: 'adminGet' })).includes('_pw'), 'internal keys never reach the dashboard');

console.log('# sessions');
const now = new Date(Date.now() + 19800000);
const nm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const month = nm.getUTCFullYear() + '-' + String(nm.getUTCMonth() + 1).padStart(2, '0');
r = await A({ action: 'generateWeekends', month, days: [6, 0], topic: 'Cakes' }); ok(r.added >= 8, 'generated ' + r.added + ' sessions');
ok((await A({ action: 'generateWeekends', month, days: [6, 0] })).added === 0, 'generating the same month again adds nothing');
let pub = await call({ action: 'getPublic' });
const s1 = pub.sessions[0];
ok(s1.price === '1500' && s1.start === '14:00' && s1.capacity === 10, 'class inherits default price, 2-4 PM, 10 seats');
const leak = JSON.stringify(pub);
ok(!leak.includes('meet.google.com') && !leak.includes('prepStudents') && !leak.includes('owner@example.com') && !leak.includes('KEY123') && !leak.includes('_pw') && !leak.includes('secret1'), 'Meet link, prep lists, admin email, keys and password are NOT in the public data');

console.log('# booking (email required, 1 seat each)');
const reg = (o) => call(Object.assign({ action: 'register', agree: true, sessionId: s1.id, name: 'Anitha', phone: '98765 00001', email: 'Anitha@Example.com', note: 'first time' }, o));
r = await reg({});
ok(r.ok && r.booking.status === 'pending' && r.meetLink === '' && r.payment.amount === 1500 && r.payment.upiId === 'sasi@oksbi' && r.booking.email === 'anitha@example.com', 'paid class: seat is pending, NO Meet link yet, payment details returned; email lower-cased');
ok(!JSON.stringify(r.session).includes('meet.google'), 'session object in response has no private fields');
ok(t.mails.length === 2, 'booking sends 2 emails (admin + student)');
const stuMail = t.mails.find((m) => m.to === 'anitha@example.com');
ok(stuMail && /Complete your payment/.test(stuMail.subject) && !stuMail.htmlBody.includes(MEET) && stuMail.htmlBody.includes('₹1,500') && stuMail.htmlBody.includes('sasi@oksbi') && stuMail.htmlBody.includes(r.booking.code), 'student gets a payment email (amount, UPI ID, ref) and NOT the Meet link');
const admMail = t.mails.find((m) => m.to === 'owner@example.com');
ok(admMail && /Awaiting payment/.test(admMail.subject) && admMail.htmlBody.includes('anitha@example.com') && admMail.htmlBody.includes('PAYMENT PENDING'), 'admin email says payment is pending and lists the student');
ok(t.fetches.length === 1 && t.fetches[0].includes('phone=%2B919876543210') && t.fetches[0].includes('apikey=KEY123'), 'admin WhatsApp alert fired on the booking');
fails(await reg({ email: '' }), 'email is required', /valid email/);
fails(await reg({ email: 'nope' }), 'bad email rejected', /valid email/);
fails(await reg({ phone: '9876500002' }), 'same email twice rejected', /already booked/);
fails(await reg({ email: 'x@example.com' }), 'same phone twice rejected', /already booked/);
for (let i = 2; i <= 10; i++) ok((await reg({ name: 'Student ' + i, phone: '98765000' + String(i).padStart(2, '0'), email: 's' + i + '@example.com' })).ok, 'student ' + i + ' booked');
fails(await reg({ name: 'Eleven', phone: '9876500099', email: 'e11@example.com' }), 'class full at 10 (unpaid bookings still hold their seats)', /full/);

console.log('# payment (UPI, confirmed by hand)');
let adm0 = await A({ action: 'adminGet' });
ok(adm0.bookings.length === 10 && adm0.bookings.every((b) => b.status === 'pending' && b.amount === '1500' && b.expired === false), 'all 10 bookings wait for payment');
fails(await call({ action: 'markPaid', id: adm0.bookings[0].id }), 'marking paid needs the admin login', /log in/);
const firstPay = adm0.bookings.find((b) => b.email === 'anitha@example.com');
t.mails.length = 0;
r = await A({ action: 'markPaid', id: firstPay.id });
ok(r.ok && r.emailed === true && t.mails.length === 1 && t.mails[0].to === 'anitha@example.com' && /Payment received/.test(t.mails[0].subject) && t.mails[0].htmlBody.includes(MEET) && t.mails[0].htmlBody.includes('internet connection'), 'Mark paid emails the student their Meet link and what to keep ready');
await A({ action: 'markPaid', id: firstPay.id }); ok(t.mails.length === 1, 'marking paid twice sends nothing more');
adm0 = await A({ action: 'adminGet' });
ok(adm0.bookings.find((b) => b.id === firstPay.id).status === 'confirmed' && adm0.bookings.find((b) => b.id === firstPay.id).paidAt.length > 0, 'booking is confirmed with a paid time');
for (const b of adm0.bookings.filter((x) => x.status === 'pending')) await A({ action: 'markPaid', id: b.id });
ok((await A({ action: 'adminGet' })).bookings.every((b) => b.status === 'confirmed'), 'all 10 students marked paid');

console.log('# admin: edit class with price, meet link, prep');
let ad = await A({ action: 'adminGet' });
ok(ad.sessions[0].meetLink === MEET && ad.sessions[0].prepStudents.includes('ingredients') && ad.bookings.length === 10, 'admin sees Meet link, prep lists, 10 students');
const base = ad.sessions[0];
const NEWMEET = 'https://meet.google.com/zzz-yyyy-xxx';
await A({ action: 'saveSession', session: Object.assign({}, base, { price: 999, meetLink: NEWMEET, prepStudents: '2 cups flour\r\n3 eggs\n\n  cocoa  ', topic: 'Brownies', capacity: 12 }) });
ad = await A({ action: 'adminGet' });
ok(ad.sessions[0].price === '999' && ad.sessions[0].meetLink === NEWMEET && ad.sessions[0].prepStudents === '2 cups flour\n3 eggs\ncocoa', 'class overrides saved; prep list tidied');
ok(ad.sessions[1].price === '1500' && ad.sessions[1].meetLink === MEET, 'other classes still follow defaults');
fails(await A({ action: 'saveSession', session: Object.assign({}, base, { meetLink: 'http://evil.example/x' }) }), 'bad Meet link rejected on a class', /Google Meet/);
fails(await A({ action: 'saveSession', session: Object.assign({}, base, { id: 'nope', meetLink: '' }) }), 'editing a class that does not exist is refused', /no longer exists/);
await A({ action: 'saveSettings', settings: { price: '1800', meetLink: 'https://meet.google.com/new-link-aaa' } });
ad = await A({ action: 'adminGet' });
ok(ad.sessions[1].price === '1800' && ad.sessions[1].meetLink.endsWith('new-link-aaa') && ad.sessions[0].price === '999', 'changing default price/link updates inheriting classes, not overridden ones');

console.log('# master menu');
const seedCount = Object.keys(MENU_SEED).reduce((n, k) => n + MENU_SEED[k].length, 0);
let menu = (await A({ action: 'adminGet' })).menu;
ok(menu.length === seedCount && seedCount > 60, 'master menu seeded from the PDF (' + menu.length + ' dishes)');
ok((await A({ action: 'adminGet' })).menu.length === seedCount, 'seed is not repeated on the next load');
ok(menu.some((m) => m.category === 'Brownies' && m.name === 'Karuppu Kavani Brownie') && menu.some((m) => m.category === 'Complementary recipes' && m.name === 'Caramel'), 'menu has your brownies and the class recipes');
r = await A({ action: 'saveMenuItem', category: 'brownies', name: '  Walnut   Brownie ' });
ok(r.ok && r.menu.some((m) => m.category === 'Brownies' && m.name === 'Walnut Brownie'), 'add dish: category spelling reused, spaces tidied');
fails(await A({ action: 'saveMenuItem', category: 'Brownies', name: 'walnut brownie' }), 'duplicate dish in same category rejected', /already in Brownies/);
r = await A({ action: 'saveMenuItem', category: 'Festival Specials', name: '# Diwali Cake' });
ok(r.ok && r.menu.some((m) => m.category === 'Festival Specials' && m.name === 'Diwali Cake'), 'new category created; leading # stripped from name');
fails(await A({ action: 'saveMenuItem', category: '', name: 'No Category' }), 'category required', /category/);
fails(await A({ action: 'saveMenuItem', category: 'X', name: 'a' }), 'name too short rejected', /dish name/);
const diwali = r.menu.find((m) => m.name === 'Diwali Cake');
r = await A({ action: 'saveMenuItem', id: diwali.id, category: 'Festival Specials', name: 'Diwali Plum Cake' });
ok(r.menu.find((m) => m.id === diwali.id).name === 'Diwali Plum Cake' && r.menu.length === seedCount + 2, 'edit renames in place');
const wb = r.menu.find((m) => m.name === 'Walnut Brownie');
r = await A({ action: 'deleteMenuItem', id: wb.id });
ok(r.ok && !r.menu.some((m) => m.name === 'Walnut Brownie'), 'delete dish');
fails(await call({ action: 'saveMenuItem', category: 'A', name: 'Hack' }), 'menu cannot be changed without login', /log in/);
ok(!JSON.stringify(await call({ action: 'getPublic' })).includes('Karuppu'), 'master menu is not in the public data');

console.log('# point-by-point class menu');
const MENU = '# Recipes\r\n- Egg-based brownie\r\n• Eggless brownie\r\n\r\n# Flavours\r\nNutella\r\nBiscoff\r\n# Complementary\r\nDark chocolate ganache\r\nCaramel & <b>';
await A({ action: 'saveSession', session: Object.assign({}, (await A({ action: 'adminGet' })).sessions[0], { details: MENU }) });
ad = await A({ action: 'adminGet' });
ok(ad.sessions[0].details === '# Recipes\nEgg-based brownie\nEggless brownie\n# Flavours\nNutella\nBiscoff\n# Complementary\nDark chocolate ganache\nCaramel & <b>', 'menu saved tidy: bullets stripped, blank lines removed');
pub = await call({ action: 'getPublic' });
ok(pub.sessions.find((s) => s.id === base.id).details.includes('Eggless brownie') && !pub.sessions.find((s) => s.id === base.id).meetLink, 'menu is public (students see it) but the Meet link is still hidden');
t.mails.length = 0;
await call({ action: 'register', agree: true, sessionId: base.id, name: 'Menu Tester', phone: '9822222222', email: 'menu@example.com' });
const mm = t.mails.find((m) => m.to === 'menu@example.com');
ok(mm.htmlBody.includes('What we\'ll cover') && mm.htmlBody.includes('<b>Flavours</b>') && mm.htmlBody.includes('Biscoff') && mm.htmlBody.includes('Caramel &amp; &lt;b&gt;'), 'confirmation email lists the menu with sections, and escapes HTML');
await A({ action: 'saveSession', session: Object.assign({}, (await A({ action: 'adminGet' })).sessions.find((s) => s.id === base.id), { details: '' }) });
t.mails.length = 0; await call({ action: 'register', agree: true, sessionId: base.id, name: 'No Menu', phone: '9833333333', email: 'nomenu@example.com' });
ok(!t.mails.find((m) => m.to === 'nomenu@example.com').htmlBody.includes('What we\'ll cover'), 'no menu section when a class has none');
await A({ action: 'saveSession', session: Object.assign({}, (await A({ action: 'adminGet' })).sessions.find((s) => s.id === base.id), { details: MENU }) });
ok((await A({ action: 'adminGet' })).settings.defaultEnd === '17:00', 'default class time is 2 PM to 5 PM');

console.log('# class-day notifications');
t.mails.length = 0; t.fetches.length = 0;
r = await A({ action: 'remindNow', sessionId: base.id });
ok(r.ok && r.result.students === 10 && r.result.pending === 2 && r.result.studentEmails === 10 && r.result.adminEmail === true && r.result.adminWhatsApp === true, 'remindNow: 10 paid students emailed, the 2 unpaid are not, admin summary sent by email + WhatsApp');
const toStu = t.mails.filter((m) => m.to !== 'owner@example.com');
ok(!t.mails.some((m) => m.to === 'menu@example.com' || m.to === 'nomenu@example.com') && toStu.length === 10 && toStu.every((m) => m.htmlBody.includes(NEWMEET) && m.htmlBody.includes('2 cups flour') && /today/i.test(m.subject)), 'each student email: "today", Meet link, this class\'s ingredient list');
const sum = t.mails.find((m) => m.to === 'owner@example.com');
ok(sum.htmlBody.includes("Today's class menu") && sum.htmlBody.includes('Nutella'), 'admin class-day summary includes the class menu');
ok(/10 students/.test(sum.subject) && /UNPAID|awaiting payment/i.test(sum.htmlBody) && sum.htmlBody.includes('menu@example.com') === false && sum.htmlBody.includes(NEWMEET) && sum.htmlBody.includes('Open the Meet link and test') && sum.htmlBody.includes('Student 7') && sum.htmlBody.includes('s7@example.com') && sum.htmlBody.includes('2 cups flour'), 'admin summary: count, Meet link, own checklist, student list with emails, student prep');
ok(t.fetches.length === 1 && decodeURIComponent(t.fetches[0]).includes('TODAY: Brownies') && decodeURIComponent(t.fetches[0]).includes('Prepare:'), 'admin WhatsApp summary has class, link and checklist');

// the scheduled path: a class today
const today = istToday();
await A({ action: 'saveSession', session: { date: today, topic: 'Today class', status: 'open' } });
const todays = (await A({ action: 'adminGet' })).sessions.find((s) => s.date === today);
await call({ action: 'register', agree: true, sessionId: todays.id, name: 'Late Bird', phone: '9811111111', email: 'late@example.com' });
await A({ action: 'markPaid', id: (await A({ action: 'adminGet' })).bookings.find((b) => b.email === 'late@example.com').id });
t.mails.length = 0; t.fetches.length = 0;
active = t; await runDaily(t.env);
ok(t.mails.some((m) => m.to === 'late@example.com' && /Today/.test(m.subject)) && t.mails.some((m) => m.to === 'owner@example.com' && /Today class/.test(m.subject)), 'scheduled run (7 AM trigger) notifies students and admin for classes happening today');
ok(!t.mails.some((m) => m.to === 's3@example.com'), 'students of other days are not emailed');
t.mails.length = 0;
await A({ action: 'saveSettings', settings: { sendReminders: 'no' } }); await runDaily(t.env);
ok(t.mails.length === 0, 'reminders switch off from Settings');
await A({ action: 'saveSession', session: Object.assign({}, todays, { status: 'cancelled' }) });
fails(await A({ action: 'remindNow', sessionId: todays.id }), 'cancelled class cannot be notified', /cancelled/);
{
  const sch = []; active = t;
  await worker.scheduled({}, t.env, { waitUntil: (p) => sch.push(p) });
  await Promise.all(sch);
  ok(sch.length === 1, 'Cloudflare cron entry point runs the daily job');
}

console.log('# misc');
fails(await A({ action: 'deleteSession', id: base.id }), 'cannot delete class with students', /has students/);
const victim = ad.bookings[0]; await A({ action: 'removeBooking', id: victim.id });
ok((await call({ action: 'getPublic' })).sessions.find((s) => s.id === base.id).booked === 11, 'removing a student frees the seat');
ok((await A({ action: 'addBooking', sessionId: base.id, name: 'Walk In', phone: '9000000009', email: 'walk@example.com' })).ok, 'admin can add a student (email required)');
fails(await A({ action: 'addBooking', sessionId: base.id, name: 'No Mail', phone: '9000000010', email: '' }), 'admin add also needs email', /valid email/);
const emptyId = (await A({ action: 'saveSession', session: { date: '2027-11-06', status: 'open' } })).id;
ok((await A({ action: 'deleteSession', id: emptyId })).ok && !(await A({ action: 'adminGet' })).sessions.some((s) => s.id === emptyId), 'a class with no students can be deleted');
ok(t.rows('SELECT * FROM bookings').concat(t.rows('SELECT * FROM sessions')).every((row) => Object.keys(row).every((k) => k === 'seats' || typeof row[k] === 'string')), 'every stored value is plain text (except the seat count)');

console.log('# UPI link, free classes, expiry');
const s2id = pub.sessions[1].id;
r = await call({ action: 'register', agree: true, sessionId: s2id, name: 'Pay Tester', phone: '9844444444', email: 'pt@example.com' });
ok(r.payment.uri === 'upi://pay?pa=sasi@oksbi&pn=Sasi%20Wonder%20Cakes&am=1800.00&cu=INR&tn=' + r.booking.code && r.payment.holdHours === 24 && r.meetLink === '', 'UPI link has ID, name, amount and the booking ref as the note');
const ptCode = r.booking.code;
fails(await A({ action: 'saveSettings', settings: { upiId: 'not a upi id' } }), 'bad UPI ID rejected', /UPI ID/);
ok((await A({ action: 'saveSettings', settings: { upiId: ' sasi@oksbi ', holdHours: '12' } })).settings.upiId === 'sasi@oksbi', 'UPI ID saved');

const freeId = (await A({ action: 'saveSession', session: { date: '2027-12-04', price: '0', status: 'open' } })).id;
t.mails.length = 0;
r = await call({ action: 'register', agree: true, sessionId: freeId, name: 'Free Student', phone: '9855555555', email: 'free@example.com' });
ok(r.booking.status === 'confirmed' && r.payment === null && r.meetLink.endsWith('new-link-aaa') && /You're booked/.test(t.mails.find((m) => m.to === 'free@example.com').subject), 'free class (price 0): confirmed at once, link released, no payment step');

// expiry: a pending hold that ran out stops blocking the seat
const before = (await call({ action: 'getPublic' })).sessions.find((x) => x.id === s2id).booked;
t.exec("UPDATE bookings SET expires = '1' WHERE code = ?", ptCode);
ok((await call({ action: 'getPublic' })).sessions.find((x) => x.id === s2id).booked === before - 1, 'an expired hold no longer counts toward seats');
ok((await A({ action: 'adminGet' })).bookings.find((b) => b.code === ptCode).expired === true, 'admin still sees the expired booking, flagged');
ok((await call({ action: 'register', agree: true, sessionId: s2id, name: 'Pay Tester', phone: '9844444444', email: 'pt@example.com' })).ok, 'same student can book again after their hold expired');
const expiredId = t.rows('SELECT id FROM bookings WHERE code = ?', ptCode)[0].id;
ok((await A({ action: 'markPaid', id: expiredId })).ok && (await call({ action: 'getPublic' })).sessions.find((x) => x.id === s2id).booked === before + 1, 'a late payment on an expired hold can still be confirmed when there is room');

const tinyId = (await A({ action: 'saveSession', session: { date: '2027-12-11', capacity: 1, status: 'open' } })).id;
await call({ action: 'register', agree: true, sessionId: tinyId, name: 'First', phone: '9866666661', email: 'f1@example.com' });
t.exec("UPDATE bookings SET expires = '1' WHERE email = 'f1@example.com'");
await call({ action: 'register', agree: true, sessionId: tinyId, name: 'Second', phone: '9866666662', email: 'f2@example.com' });
fails(await A({ action: 'markPaid', id: t.rows("SELECT id FROM bookings WHERE email = 'f1@example.com'")[0].id }), 'expired hold cannot be confirmed once someone else took the last seat', /full now/);

r = await A({ action: 'addBooking', sessionId: s2id, name: 'Walk In Two', phone: '9877777777', email: 'w2@example.com' });
ok(r.ok && r.booking.status === 'confirmed' && r.booking.paidAt.length > 0, 'student added by the admin is confirmed (paid) straight away');

console.log('# two students click at the same moment');
const raceId = (await A({ action: 'saveSession', session: { date: '2027-12-18', capacity: 1, status: 'open' } })).id;
const racers = await Promise.all([1, 2, 3, 4].map((i) => call({ action: 'register', agree: true, sessionId: raceId, name: 'Racer ' + i, phone: '970000000' + i, email: 'race' + i + '@example.com' })));
ok(racers.filter((x) => x.ok).length === 1 && racers.filter((x) => !x.ok && /full/.test(x.error)).length === 3, 'one seat left, four students at once: exactly one gets it, the others are told it is full');
ok(t.rows('SELECT COUNT(*) AS n FROM bookings WHERE sessionId = ?', raceId)[0].n === 1, 'and only one booking was stored');
const sameId = (await A({ action: 'saveSession', session: { date: '2027-12-25', status: 'open' } })).id;
const twins = await Promise.all([1, 2].map(() => call({ action: 'register', agree: true, sessionId: sameId, name: 'Twin', phone: '9711111111', email: 'twin@example.com' })));
ok(twins.filter((x) => x.ok).length === 1, 'the same person double-clicking Reserve books only one seat');

console.log('# spam protection, consent, error alerts');
const abuseId = pub.sessions[3].id;
const reg2 = (sid, o) => call(Object.assign({ action: 'register', agree: true, sessionId: sid, name: 'Some One', phone: '9800000001', email: 'x@example.com' }, o));
fails(await call({ action: 'register', agree: true, website: 'http://spam.example', sessionId: abuseId, name: 'Bot', phone: '9800000001', email: 'bot@example.com' }), 'hidden form field catches bots', /Something went wrong/);
fails(await call({ action: 'register', sessionId: abuseId, name: 'No Tick', phone: '9800000002', email: 'nt@example.com' }), 'booking needs the terms box ticked', /tick the box/);
ok((await reg2(abuseId, { phone: '9800000003', email: 'sp0@example.com' })).ok, 'normal booking still works');
for (let i = 1; i < 4; i++) await reg2(abuseId, { phone: '9800000003', email: 'sp' + i + '@example.com' });
fails(await reg2(abuseId, { phone: '9800000003', email: 'sp9@example.com' }), 'one phone number is limited to 4 tries an hour', /Too many attempts/);
fails(await reg2(abuseId, { phone: '9800000004', email: 'sp0@example.com' }), 'one email address is limited too', /already booked|Too many attempts/);
for (let i = 0; i < 4; i++) await reg2(abuseId, { phone: '9800000005', email: 'sp5@example.com', name: 'Same Again' });
fails(await reg2(abuseId, { phone: '9800000006', email: 'sp5@example.com' }), 'one email is limited to 4 tries an hour', /Too many attempts/);

const capSessions = [pub.sessions[4].id, pub.sessions[5].id, pub.sessions[6].id, pub.sessions[7].id];
const cap = (sid) => reg2(sid, { phone: '9800000010', email: 'cap@example.com', name: 'Many Seats' });
ok((await cap(capSessions[0])).ok && (await cap(capSessions[1])).ok && (await cap(capSessions[2])).ok, 'one person can hold up to 3 unpaid seats');
fails(await cap(capSessions[3]), 'a 4th unpaid seat is refused until they pay', /3 unpaid bookings/);
ok(/^\d{4}-\d{2}-\d{2}T/.test(t.rows("SELECT consentAt FROM bookings WHERE email = 'cap@example.com'")[0].consentAt), 'the time they accepted the terms is recorded');
ok((await call({ action: 'getPublic' })).settings.policyText.includes('payment is received'), 'terms text is public so the form can show it');
ok((await A({ action: 'saveSettings', settings: { policyText: '  Line one \r\n\r\n Line two  ' } })).settings.policyText === 'Line one\nLine two', 'terms text saved tidy');

t.mails.length = 0;
const bad = await t.raw('{not json'); const badJson = await bad.json();
ok(badJson.code === 'server' && t.mails.some((m) => m.to === 'owner@example.com' && /Website problem/.test(m.subject)), 'an unexpected failure emails the admin');
t.mails.length = 0; await t.raw('{still bad');
ok(t.mails.length === 0, 'error emails are limited to one an hour');
fails(await call('null'), 'an empty request is refused politely', /Unknown action/);
fails(await A({ action: 'nothing' }), 'unknown actions are refused', /Unknown action/);
fails(await call({ action: 'nothing' }), 'and signed-out visitors cannot probe for actions', /log in/);

console.log('# passwords and sign-in');
fails(await A({ action: 'changePassword', current: 'wrong', next: 'newpass1' }), 'changing the password needs the current one', /Current password/);
fails(await A({ action: 'changePassword', current: 'secret1', next: 'abc' }), 'new password must be 6+ characters', /6 characters/);
ok((await A({ action: 'changePassword', current: 'secret1', next: 'newpass1' })).ok, 'password changed');
ok(!JSON.stringify(t.rows('SELECT * FROM settings WHERE key = ?', '_pw')).includes('newpass1') && /^pbkdf2:\d+:/.test(t.rows("SELECT value FROM settings WHERE key = '_pw'")[0].value), 'the new password is stored only as a salted hash');
fails(await call({ action: 'login', password: 'secret1' }), 'the first-time password stops working once changed', /Wrong password/);
ok((await call({ action: 'login', password: 'newpass1' })).ok, 'the new password works');
t.exec('DELETE FROM limits');
{
  const ipA = { 'cf-connecting-ip': '203.0.113.7' }, ipB = { 'cf-connecting-ip': '198.51.100.9' };
  for (let i = 0; i < 8; i++) await call({ action: 'login', password: 'bad' + i }, ipA);
  fails(await call({ action: 'login', password: 'newpass1' }, ipA), '8 wrong passwords lock that address for 15 minutes', /Too many wrong attempts/);
  ok((await call({ action: 'login', password: 'newpass1' }, ipB)).ok, '...but you can still sign in from another address');
}
t.exec("UPDATE tokens SET expires = 1");
fails(await A({ action: 'adminGet' }), 'an expired sign-in no longer works', /log in again/);

console.log('# web access rules');
{
  active = t;
  const hit = await worker.fetch(new Request('https://site.test/api', { method: 'GET' }), t.env, t.ctx);
  ok(hit.status === 200 && (await hit.json()).ok === true && hit.headers.get('cache-control') === 'no-store' && hit.headers.get('x-content-type-options') === 'nosniff', 'GET /api answers with no-store and nosniff headers');
  const foreign = await handleApi(new Request('https://site.test/api', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{"action":"getPublic"}' }), t.env, t.ctx);
  ok(foreign.status === 403, 'another website cannot call the API from a browser');
  const own = await handleApi(new Request('https://site.test/api', { method: 'POST', headers: { origin: 'https://site.test' }, body: '{"action":"getPublic"}' }), t.env, t.ctx);
  ok((await own.json()).ok === true, 'the site itself can');
  ok((await handleApi(new Request('https://site.test/api', { method: 'PUT' }), t.env, t.ctx)).status === 405, 'other methods are refused');
  const big = await t.call(JSON.stringify({ action: 'getPublic', pad: 'x'.repeat(120000) }));
  fails(big, 'oversized requests are refused', /too large/);
  let asked = '';
  const page = await worker.fetch(new Request('https://site.test/admin'), Object.assign({}, t.env, { ASSETS: { fetch: async (rq) => { asked = new URL(rq.url).pathname; return new Response('page'); } } }), t.ctx);
  ok(asked === '/admin' && await page.text() === 'page', 'every other address is handed to the static website files');
}

console.log('# email relay problems');
{
  const m = makeEnv({ MAIL_SECRET: 'wrong-secret' });
  const tk = (await m.call({ action: 'login', password: 'secret1' })).token;
  const res = await m.call({ action: 'testNotify', token: tk });
  ok(res.ok && /failed.*denied/.test(res.result.email), 'test alert tells you when the email relay refuses (wrong secret): ' + res.result.email);
  const n = makeEnv({ MAIL_RELAY_URL: undefined });
  const tk2 = (await n.call({ action: 'login', password: 'secret1' })).token;
  const res2 = await n.call({ action: 'testNotify', token: tk2 });
  ok(/not set up/.test(res2.result.email), 'test alert tells you when email sending is not set up: ' + res2.result.email);
  await n.call({ action: 'generateWeekends', token: tk2, month, days: [6] });
  const sid = (await n.call({ action: 'getPublic' })).sessions[0].id;
  const booked = await n.call({ action: 'register', agree: true, sessionId: sid, name: 'Still Works', phone: '9788888888', email: 'sw@example.com' });
  ok(booked.ok, 'a booking still succeeds when emails cannot be sent');
  ok((await m.call({ action: 'testNotify', token: 'bogus' })).code === 'auth', 'test alert needs the admin login');
  await m.call({ action: 'saveSettings', token: tk, settings: { price: '500' } });
  await m.call({ action: 'generateWeekends', token: tk, month, days: [6] });
  const msid = (await m.call({ action: 'getPublic' })).sessions[0].id;
  await m.call({ action: 'register', agree: true, sessionId: msid, name: 'Pays Late', phone: '9799999999', email: 'pl@example.com' });
  const mbid = m.rows("SELECT id FROM bookings WHERE email = 'pl@example.com'")[0].id;
  const paid = await m.call({ action: 'markPaid', token: tk, id: mbid });
  ok(paid.ok && paid.emailed === false && /denied/.test(paid.emailError) && m.rows('SELECT status FROM bookings WHERE id = ?', mbid)[0].status === 'confirmed', 'Mark paid still confirms the seat but tells the admin when the email could not be sent: ' + paid.emailError);
}

console.log('# live updates (change counter)');
{
  const L = makeEnv();
  const lt = (await L.call({ action: 'login', password: 'secret1' })).token;
  const LA = (o) => L.call(Object.assign({ token: lt }, o));
  const rev = async () => (await L.call({ action: 'pulse' })).rev;
  const r0 = await rev();
  ok(r0 === '0' && (await rev()) === r0 && !JSON.stringify(await L.call({ action: 'pulse' })).match(/token|email|phone/), 'the change counter starts at 0, reading it changes nothing, and it carries no data');
  await LA({ action: 'getPublic' }); await LA({ action: 'adminGet' });
  ok((await rev()) === r0, 'looking at the pages does not count as a change');
  const sid = (await LA({ action: 'saveSession', session: { date: '2027-03-06', status: 'open' } })).id;
  const r1 = await rev(); ok(r1 !== r0, 'saving a class moves the counter');
  fails(await LA({ action: 'saveSession', session: { date: 'nope' } }), 'a refused save is rejected', /date/);
  ok((await rev()) === r1, 'and a refused save does not');
  await L.call({ action: 'register', agree: true, sessionId: sid, name: 'Live Student', phone: '9700000001', email: 'live@example.com' });
  const r2 = await rev(); ok(r2 !== r1, 'a student booking moves the counter, so open pages reload');
  const bid = L.rows('SELECT id FROM bookings')[0].id;
  await LA({ action: 'removeBooking', id: bid });
  ok((await rev()) !== r2, 'removing a student moves it too');
  ok(!JSON.stringify(await LA({ action: 'adminGet' })).includes('_rev') && !JSON.stringify(await L.call({ action: 'getPublic' })).includes('_rev'), 'the counter is not mixed into the settings');
}

console.log('# the starter menu list in the backend and the website are the same');
{
  const win = {}; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'common.js'), 'utf8'), { window: win, document: {}, console });
  ok(JSON.stringify(MENU_SEED) === JSON.stringify(win.SWC.MENU_SEED), 'MENU_SEED in the Worker equals MENU_SEED in js/common.js');
}

console.log('\nAll ' + passed + ' checks passed');
