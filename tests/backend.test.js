// Backend tests: runs backend/Code.gs against fake Google services (Sheets, mail, locks, cache).
// Run with:  node tests/backend.test.js
// Runs backend/Code.gs against fake Google services and checks the main rules.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'backend', 'Code.gs'), 'utf8');

function makeContext(source) {
  const sheets = {}, mails = [], fetches = [], props = {}, cache = {};
  const pad = (n) => String(n).padStart(2, '0');
  const shift = (d, tz) => new Date(d.getTime() + (tz === 'Asia/Kolkata' ? 19800000 : 0));
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function makeSheet(name) {
    const sh = { name, rows: [], fmt: {}, frozen: 0 };
    sh.getMaxRows = () => 1000;
    sh.setFrozenRows = (n) => { sh.frozen = n; };
    sh.getLastRow = () => sh.rows.length;
    sh.deleteRow = (r) => { sh.rows.splice(r - 1, 1); };
    sh.getRange = (r, c, nr = 1, nc = 1) => {
      const rng = {
        setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.fmt[(r + i) + ',' + (c + j)] = f; return rng; },
        setFontWeight() { return rng; },
        setValues(v) {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
            assert.strictEqual(sh.fmt[(r + i) + ',' + (c + j)], '@', 'cell written without text format: ' + name + ' r' + (r + i) + ' c' + (c + j));
            sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || [];
            sh.rows[r - 1 + i][c - 1 + j] = v[i][j];
          }
          return rng;
        },
        getDisplayValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(String((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? '')); out.push(row); } return out; },
      };
      return rng;
    };
    return sh;
  }
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(s).digest()),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      getUuid: () => crypto.randomUUID(),
      formatDate(d, tz, f) {
        const s = shift(d, tz);
        return f.replace("yyyy-MM-dd'T'HH:mm", `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}T${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`)
          .replace('yyyy-MM-dd', `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`)
          .replace('EEE d MMM yyyy', `${DOW[s.getUTCDay()]} ${s.getUTCDate()} ${MON[s.getUTCMonth()]} ${s.getUTCFullYear()}`);
      },
    },
    MailApp: { sendEmail: (m) => mails.push(m) },
    UrlFetchApp: { fetch: (u) => { fetches.push(u); return { getResponseCode: () => 200 }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
    ScriptApp: {},
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const call = (req) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).t);
  return { ctx, call, sheets, mails, fetches, props };
}


let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok -', m); };
const fails = (r, m, re) => { assert.strictEqual(r.ok, false, m + ' (should fail)'); if (re) assert.match(r.error, re, m); passed++; console.log('  ok -', m, '->', r.error); };

{
  console.log('# password guard');
  fails(makeContext(SRC).call({ action: 'login', password: 'x' }), 'login refused while CHANGE_ME', /not been set up/);
}

const SRC2 = SRC.replace("INITIAL_ADMIN_PASSWORD = 'CHANGE_ME'", "INITIAL_ADMIN_PASSWORD = 'secret1'");
const t = makeContext(SRC2), call = t.call;
const tok = call({ action: 'login', password: 'secret1' }); ok(tok.ok, 'login works');
const A = (o) => call(Object.assign({ token: tok.token }, o));
const MEET = 'https://meet.google.com/abc-defg-hij';

console.log('# settings: price + meet link');
let r = A({ action: 'saveSettings', settings: { whatsappNumber: '98765 43210', notifyEmail: 'owner@example.com', callmebotKey: 'KEY123', price: '₹1,500', meetLink: MEET, upiId: 'sasi@oksbi', upiName: 'Sasi Wonder Cakes' } });
ok(r.ok && r.settings.price === '1500', 'price saved as plain number: ' + r.settings.price);
fails(A({ action: 'saveSettings', settings: { price: 'free!' } }), 'non-numeric price rejected', /whole number/);
fails(A({ action: 'saveSettings', settings: { meetLink: 'https://zoom.us/j/1' } }), 'non-Meet link rejected', /Google Meet/);

console.log('# sessions');
const now = new Date(Date.now() + 19800000);
const nm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const month = nm.getUTCFullYear() + '-' + String(nm.getUTCMonth() + 1).padStart(2, '0');
r = A({ action: 'generateWeekends', month, days: [6, 0], topic: 'Cakes' }); ok(r.added >= 8, 'generated ' + r.added + ' sessions');
let pub = call({ action: 'getPublic' });
const s1 = pub.sessions[0];
ok(s1.price === '1500' && s1.start === '14:00' && s1.capacity === 10, 'class inherits default price, 2-4 PM, 10 seats');
const leak = JSON.stringify(pub);
ok(!leak.includes('meet.google.com') && !leak.includes('prepStudents') && !leak.includes('owner@example.com') && !leak.includes('KEY123'), 'Meet link, prep lists, admin email and key are NOT in the public data');

console.log('# booking (email required, 1 seat each)');
const reg = (o) => call(Object.assign({ action: 'register', agree: true, sessionId: s1.id, name: 'Anitha', phone: '98765 00001', email: 'Anitha@Example.com', note: 'first time' }, o));
r = reg({});
ok(r.ok && r.booking.status === 'pending' && r.meetLink === '' && r.payment.amount === 1500 && r.payment.upiId === 'sasi@oksbi' && r.booking.email === 'anitha@example.com', 'paid class: seat is pending, NO Meet link yet, payment details returned; email lower-cased');
ok(!JSON.stringify(r.session).includes('meet.google'), 'session object in response has no private fields');
ok(t.mails.length === 2, 'booking sends 2 emails (admin + student)');
const stuMail = t.mails.find((m) => m.to === 'anitha@example.com');
ok(stuMail && /Complete your payment/.test(stuMail.subject) && !stuMail.htmlBody.includes(MEET) && stuMail.htmlBody.includes('₹1,500') && stuMail.htmlBody.includes('sasi@oksbi') && stuMail.htmlBody.includes(r.booking.code), 'student gets a payment email (amount, UPI ID, ref) and NOT the Meet link');
const admMail = t.mails.find((m) => m.to === 'owner@example.com');
ok(admMail && /Awaiting payment/.test(admMail.subject) && admMail.htmlBody.includes('anitha@example.com') && admMail.htmlBody.includes('PAYMENT PENDING'), 'admin email says payment is pending and lists the student');
ok(t.fetches.length === 1 && t.fetches[0].includes('phone=%2B919876543210') && t.fetches[0].includes('apikey=KEY123'), 'admin WhatsApp alert fired on the booking');
fails(reg({ email: '' }), 'email is required', /valid email/);
fails(reg({ email: 'nope' }), 'bad email rejected', /valid email/);
fails(reg({ phone: '9876500002' }), 'same email twice rejected', /already booked/);
fails(reg({ email: 'x@example.com' }), 'same phone twice rejected', /already booked/);
for (let i = 2; i <= 10; i++) ok(reg({ name: 'Student ' + i, phone: '98765000' + String(i).padStart(2, '0'), email: 's' + i + '@example.com' }).ok, 'student ' + i + ' booked');
fails(reg({ name: 'Eleven', phone: '9876500099', email: 'e11@example.com' }), 'class full at 10 (unpaid bookings still hold their seats)', /full/);

console.log('# payment (UPI, confirmed by hand)');
let adm0 = A({ action: 'adminGet' });
ok(adm0.bookings.length === 10 && adm0.bookings.every((b) => b.status === 'pending' && b.amount === '1500' && b.expired === false), 'all 10 bookings wait for payment');
fails(call({ action: 'markPaid', id: adm0.bookings[0].id }), 'marking paid needs the admin login');
const firstPay = adm0.bookings.find((b) => b.email === 'anitha@example.com');
t.mails.length = 0;
r = A({ action: 'markPaid', id: firstPay.id });
ok(r.ok && t.mails.length === 1 && t.mails[0].to === 'anitha@example.com' && /Payment received/.test(t.mails[0].subject) && t.mails[0].htmlBody.includes(MEET) && t.mails[0].htmlBody.includes('internet connection'), 'Mark paid emails the student their Meet link and what to keep ready');
A({ action: 'markPaid', id: firstPay.id }); ok(t.mails.length === 1, 'marking paid twice sends nothing more');
adm0 = A({ action: 'adminGet' });
ok(adm0.bookings.find((b) => b.id === firstPay.id).status === 'confirmed' && adm0.bookings.find((b) => b.id === firstPay.id).paidAt.length > 0, 'booking is confirmed with a paid time');
adm0.bookings.filter((b) => b.status === 'pending').forEach((b) => A({ action: 'markPaid', id: b.id }));
ok(A({ action: 'adminGet' }).bookings.every((b) => b.status === 'confirmed'), 'all 10 students marked paid');

console.log('# admin: edit class with price, meet link, prep');
let ad = A({ action: 'adminGet' });
ok(ad.sessions[0].meetLink === MEET && ad.sessions[0].prepStudents.includes('ingredients') && ad.bookings.length === 10, 'admin sees Meet link, prep lists, 10 students');
const base = ad.sessions[0];
const NEWMEET = 'https://meet.google.com/zzz-yyyy-xxx';
A({ action: 'saveSession', session: Object.assign({}, base, { price: 999, meetLink: NEWMEET, prepStudents: '2 cups flour\r\n3 eggs\n\n  cocoa  ', topic: 'Brownies', capacity: 12 }) });
ad = A({ action: 'adminGet' });
ok(ad.sessions[0].price === '999' && ad.sessions[0].meetLink === NEWMEET && ad.sessions[0].prepStudents === '2 cups flour\n3 eggs\ncocoa', 'class overrides saved; prep list tidied');
ok(ad.sessions[1].price === '1500' && ad.sessions[1].meetLink === MEET, 'other classes still follow defaults');
fails(A({ action: 'saveSession', session: Object.assign({}, base, { meetLink: 'http://evil.example/x' }) }), 'bad Meet link rejected on a class', /Google Meet/);
A({ action: 'saveSettings', settings: { price: '1800', meetLink: 'https://meet.google.com/new-link-aaa' } });
ad = A({ action: 'adminGet' });
ok(ad.sessions[1].price === '1800' && ad.sessions[1].meetLink.endsWith('new-link-aaa') && ad.sessions[0].price === '999', 'changing default price/link updates inheriting classes, not overridden ones');

console.log('# master menu');
const vmx = require('vm');
const seedCount = vmx.runInContext('Object.keys(MENU_SEED).reduce(function (n, k) { return n + MENU_SEED[k].length; }, 0)', t.ctx);
let menu = A({ action: 'adminGet' }).menu;
ok(menu.length === seedCount && seedCount > 60, 'master menu seeded from the PDF (' + menu.length + ' dishes)');
ok(A({ action: 'adminGet' }).menu.length === seedCount, 'seed is not repeated on the next load');
ok(menu.some((m) => m.category === 'Brownies' && m.name === 'Karuppu Kavani Brownie') && menu.some((m) => m.category === 'Complementary recipes' && m.name === 'Caramel'), 'menu has your brownies and the class recipes');
r = A({ action: 'saveMenuItem', category: 'brownies', name: '  Walnut   Brownie ' });
ok(r.ok && r.menu.some((m) => m.category === 'Brownies' && m.name === 'Walnut Brownie'), 'add dish: category spelling reused, spaces tidied');
fails(A({ action: 'saveMenuItem', category: 'Brownies', name: 'walnut brownie' }), 'duplicate dish in same category rejected', /already in Brownies/);
ok(A({ action: 'saveMenuItem', category: 'Brownies', name: 'Walnut Brownie' }).ok === false, 'duplicate check ignores case');
r = A({ action: 'saveMenuItem', category: 'Festival Specials', name: '# Diwali Cake' });
ok(r.ok && r.menu.some((m) => m.category === 'Festival Specials' && m.name === 'Diwali Cake'), 'new category created; leading # stripped from name');
fails(A({ action: 'saveMenuItem', category: '', name: 'No Category' }), 'category required', /category/);
fails(A({ action: 'saveMenuItem', category: 'X', name: 'a' }), 'name too short rejected', /dish name/);
const diwali = r.menu.find((m) => m.name === 'Diwali Cake');
r = A({ action: 'saveMenuItem', id: diwali.id, category: 'Festival Specials', name: 'Diwali Plum Cake' });
ok(r.menu.find((m) => m.id === diwali.id).name === 'Diwali Plum Cake' && r.menu.length === seedCount + 2, 'edit renames in place');
const wb = r.menu.find((m) => m.name === 'Walnut Brownie');
r = A({ action: 'deleteMenuItem', id: wb.id });
ok(r.ok && !r.menu.some((m) => m.name === 'Walnut Brownie'), 'delete dish');
fails(call({ action: 'saveMenuItem', category: 'A', name: 'Hack' }), 'menu cannot be changed without login');
ok(!JSON.stringify(call({ action: 'getPublic' })).includes('Karuppu'), 'master menu is not in the public data');
ok(!t.sheets.Menu.rows.some((row) => row.some((c) => typeof c !== 'string')), 'menu cells are plain text');

console.log('# point-by-point class menu');
const MENU = '# Recipes\r\n- Egg-based brownie\r\n• Eggless brownie\r\n\r\n# Flavours\r\nNutella\r\nBiscoff\r\n# Complementary\r\nDark chocolate ganache\r\nCaramel & <b>';
A({ action: 'saveSession', session: Object.assign({}, A({ action: 'adminGet' }).sessions[0], { details: MENU }) });
ad = A({ action: 'adminGet' });
ok(ad.sessions[0].details === '# Recipes\nEgg-based brownie\nEggless brownie\n# Flavours\nNutella\nBiscoff\n# Complementary\nDark chocolate ganache\nCaramel & <b>', 'menu saved tidy: bullets stripped, blank lines removed');
pub = call({ action: 'getPublic' });
ok(pub.sessions.find((s) => s.id === base.id).details.includes('Eggless brownie') && !pub.sessions.find((s) => s.id === base.id).meetLink, 'menu is public (students see it) but the Meet link is still hidden');
t.mails.length = 0;
call({ action: 'register', agree: true, sessionId: base.id, name: 'Menu Tester', phone: '9822222222', email: 'menu@example.com' });
const mm = t.mails.find((m) => m.to === 'menu@example.com');
ok(mm.htmlBody.includes('What we\'ll cover') && mm.htmlBody.includes('<b>Flavours</b>') && mm.htmlBody.includes('Biscoff') && mm.htmlBody.includes('Caramel &amp; &lt;b&gt;'), 'confirmation email lists the menu with sections, and escapes HTML');
A({ action: 'saveSession', session: Object.assign({}, A({ action: 'adminGet' }).sessions.find((s) => s.id === base.id), { details: '' }) });
t.mails.length = 0; call({ action: 'register', agree: true, sessionId: base.id, name: 'No Menu', phone: '9833333333', email: 'nomenu@example.com' });
ok(!t.mails.find((m) => m.to === 'nomenu@example.com').htmlBody.includes('What we\'ll cover'), 'no menu section when a class has none');
A({ action: 'saveSession', session: Object.assign({}, A({ action: 'adminGet' }).sessions.find((s) => s.id === base.id), { details: MENU }) });
ok(t.ctx.settingsDefaultEnd === undefined && A({ action: 'adminGet' }).settings.defaultEnd === '17:00', 'default class time is now 2 PM to 5 PM');

console.log('# class-day notifications');
t.mails.length = 0; t.fetches.length = 0;
r = A({ action: 'remindNow', sessionId: base.id });
ok(r.ok && r.result.students === 10 && r.result.pending === 2 && r.result.studentEmails === 10 && r.result.adminEmail === true && r.result.adminWhatsApp === true, 'remindNow: 10 paid students emailed, the 2 unpaid are not, admin summary sent by email + WhatsApp');
const toStu = t.mails.filter((m) => m.to !== 'owner@example.com');
ok(!t.mails.some((m) => m.to === 'menu@example.com' || m.to === 'nomenu@example.com') && toStu.length === 10 && toStu.every((m) => m.htmlBody.includes(NEWMEET) && m.htmlBody.includes('2 cups flour') && /today/i.test(m.subject)), 'each student email: "today", Meet link, this class\'s ingredient list');
const sum = t.mails.find((m) => m.to === 'owner@example.com');
ok(sum.htmlBody.includes("Today's class menu") && sum.htmlBody.includes('Nutella'), 'admin class-day summary includes the class menu');
ok(/10 students/.test(sum.subject) && /UNPAID|awaiting payment/i.test(sum.htmlBody) && sum.htmlBody.includes('menu@example.com') === false && sum.htmlBody.includes(NEWMEET) && sum.htmlBody.includes('Open the Meet link and test') && sum.htmlBody.includes('Student 7') && sum.htmlBody.includes('s7@example.com') && sum.htmlBody.includes('2 cups flour'), 'admin summary: count, Meet link, own checklist, student list with emails, student prep');
ok(t.fetches.length === 1 && decodeURIComponent(t.fetches[0]).includes('TODAY: Brownies') && decodeURIComponent(t.fetches[0]).includes('Prepare:'), 'admin WhatsApp summary has class, link and checklist');

// the scheduled path: a class today
const today = t.ctx.today_();
A({ action: 'saveSession', session: { date: today, topic: 'Today class', status: 'open' } });
const todays = A({ action: 'adminGet' }).sessions.find((s) => s.date === today);
call({ action: 'register', agree: true, sessionId: todays.id, name: 'Late Bird', phone: '9811111111', email: 'late@example.com' });
A({ action: 'markPaid', id: A({ action: 'adminGet' }).bookings.find((b) => b.email === 'late@example.com').id });
t.mails.length = 0; t.fetches.length = 0;
t.ctx.sendDailyReminders();
ok(t.mails.some((m) => m.to === 'late@example.com' && /Today/.test(m.subject)) && t.mails.some((m) => m.to === 'owner@example.com' && /Today class/.test(m.subject)), 'scheduled run (7 AM trigger) notifies students and admin for classes happening today');
ok(!t.mails.some((m) => m.to === 's3@example.com'), 'students of other days are not emailed');
t.mails.length = 0;
A({ action: 'saveSettings', settings: { sendReminders: 'no' } }); t.ctx.sendDailyReminders();
ok(t.mails.length === 0, 'reminders switch off from Settings');
A({ action: 'saveSession', session: Object.assign({}, todays, { status: 'cancelled' }) });
fails(A({ action: 'remindNow', sessionId: todays.id }), 'cancelled class cannot be notified', /cancelled/);

console.log('# misc');
fails(A({ action: 'deleteSession', id: base.id }), 'cannot delete class with students', /has students/);
const victim = ad.bookings[0]; A({ action: 'removeBooking', id: victim.id });
ok(call({ action: 'getPublic' }).sessions.find((s) => s.id === base.id).booked === 11, 'removing a student frees the seat');
ok(A({ action: 'addBooking', sessionId: base.id, name: 'Walk In', phone: '9000000009', email: 'walk@example.com' }).ok, 'admin can add a student (email required)');
fails(A({ action: 'addBooking', sessionId: base.id, name: 'No Mail', phone: '9000000010', email: '' }), 'admin add also needs email', /valid email/);
ok(!t.sheets.Bookings.rows.some((row) => row.some((c) => typeof c !== 'string')) && !t.sheets.Sessions.rows.some((row) => row.some((c) => typeof c !== 'string')), 'every stored cell is a plain string');

console.log('# UPI link, free classes, expiry, upgrade');
const s2id = pub.sessions[1].id;
r = call({ action: 'register', agree: true, sessionId: s2id, name: 'Pay Tester', phone: '9844444444', email: 'pt@example.com' });
ok(r.payment.uri === 'upi://pay?pa=sasi@oksbi&pn=Sasi%20Wonder%20Cakes&am=1800.00&cu=INR&tn=' + r.booking.code && r.payment.holdHours === 24 && r.meetLink === '', 'UPI link has ID, name, amount and the booking ref as the note');
const ptCode = r.booking.code;
fails(A({ action: 'saveSettings', settings: { upiId: 'not a upi id' } }), 'bad UPI ID rejected', /UPI ID/);
ok(A({ action: 'saveSettings', settings: { upiId: ' sasi@oksbi ', holdHours: '12' } }).settings.upiId === 'sasi@oksbi', 'UPI ID saved');

const freeId = A({ action: 'saveSession', session: { date: '2027-12-04', price: '0', status: 'open' } }).id;
t.mails.length = 0;
r = call({ action: 'register', agree: true, sessionId: freeId, name: 'Free Student', phone: '9855555555', email: 'free@example.com' });
ok(r.booking.status === 'confirmed' && r.payment === null && r.meetLink.endsWith('new-link-aaa') && /You're booked/.test(t.mails.find((m) => m.to === 'free@example.com').subject), 'free class (price 0): confirmed at once, link released, no payment step');

// expiry: a pending hold that ran out stops blocking the seat
const bookRows = () => t.sheets.Bookings.rows;
const hdr = bookRows()[0], ptRow = bookRows().find((row) => row[1] === ptCode);
const before = call({ action: 'getPublic' }).sessions.find((x) => x.id === s2id).booked;
ptRow[hdr.indexOf('expires')] = '1';
ok(call({ action: 'getPublic' }).sessions.find((x) => x.id === s2id).booked === before - 1, 'an expired hold no longer counts toward seats');
ok(A({ action: 'adminGet' }).bookings.find((b) => b.code === ptCode).expired === true, 'admin still sees the expired booking, flagged');
ok(call({ action: 'register', agree: true, sessionId: s2id, name: 'Pay Tester', phone: '9844444444', email: 'pt@example.com' }).ok, 'same student can book again after their hold expired');
const expiredId = A({ action: 'adminGet' }).bookings.find((b) => b.code === ptCode).id;
ok(A({ action: 'markPaid', id: expiredId }).ok && call({ action: 'getPublic' }).sessions.find((x) => x.id === s2id).booked === before + 1, 'a late payment on an expired hold can still be confirmed when there is room');

const tinyId = A({ action: 'saveSession', session: { date: '2027-12-11', capacity: 1, status: 'open' } }).id;
call({ action: 'register', agree: true, sessionId: tinyId, name: 'First', phone: '9866666661', email: 'f1@example.com' });
const tinyRow = bookRows().find((row) => row[hdr.indexOf('email')] === 'f1@example.com');
tinyRow[hdr.indexOf('expires')] = '1';
call({ action: 'register', agree: true, sessionId: tinyId, name: 'Second', phone: '9866666662', email: 'f2@example.com' });
fails(A({ action: 'markPaid', id: A({ action: 'adminGet' }).bookings.find((b) => b.email === 'f1@example.com').id }), 'expired hold cannot be confirmed once someone else took the last seat', /full now/);

r = A({ action: 'addBooking', sessionId: s2id, name: 'Walk In Two', phone: '9877777777', email: 'w2@example.com' });
ok(r.ok && r.booking.status === 'confirmed' && r.booking.paidAt.length > 0, 'student added by the admin is confirmed (paid) straight away');

// a sheet made by an older version gets the new columns added
const t2 = makeContext(SRC2);
const oldSheet = t2.ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Bookings');
oldSheet.rows[0] = ['id', 'code', 'sessionId', 'name', 'phone', 'email', 'seats', 'note', 'createdAt', 'status'];
const tok2 = t2.call({ action: 'login', password: 'secret1' }).token;
t2.call({ action: 'adminGet', token: tok2 });
ok(t2.sheets.Bookings.rows[0].join(',').endsWith('status,amount,paidAt,expires,consentAt'), 'old Bookings sheet is upgraded with the payment columns');


console.log('# spam protection, consent, error alerts');
const abuseId = pub.sessions[3].id;
const reg2 = (sid, o) => call(Object.assign({ action: 'register', agree: true, sessionId: sid, name: 'Some One', phone: '9800000001', email: 'x@example.com' }, o));
fails(call({ action: 'register', agree: true, website: 'http://spam.example', sessionId: abuseId, name: 'Bot', phone: '9800000001', email: 'bot@example.com' }), 'hidden form field catches bots', /Something went wrong/);
fails(call({ action: 'register', sessionId: abuseId, name: 'No Tick', phone: '9800000002', email: 'nt@example.com' }), 'booking needs the terms box ticked', /tick the box/);
ok(reg2(abuseId, { phone: '9800000003', email: 'sp0@example.com' }).ok, 'normal booking still works');
for (let i = 1; i < 4; i++) reg2(abuseId, { phone: '9800000003', email: 'sp' + i + '@example.com' });
fails(reg2(abuseId, { phone: '9800000003', email: 'sp9@example.com' }), 'one phone number is limited to 4 tries an hour', /Too many attempts/);
fails(reg2(abuseId, { phone: '9800000004', email: 'sp0@example.com' }), 'one email address is limited too', /already booked|Too many attempts/);
for (let i = 0; i < 4; i++) reg2(abuseId, { phone: '9800000005', email: 'sp5@example.com', name: 'Same Again' });
fails(reg2(abuseId, { phone: '9800000006', email: 'sp5@example.com' }), 'one email is limited to 4 tries an hour', /Too many attempts/);

const capSessions = [pub.sessions[4].id, pub.sessions[5].id, pub.sessions[6].id, pub.sessions[7].id];
const cap = (sid) => reg2(sid, { phone: '9800000010', email: 'cap@example.com', name: 'Many Seats' });
ok(cap(capSessions[0]).ok && cap(capSessions[1]).ok && cap(capSessions[2]).ok, 'one person can hold up to 3 unpaid seats');
fails(cap(capSessions[3]), 'a 4th unpaid seat is refused until they pay', /3 unpaid bookings/);
const bh = t.sheets.Bookings.rows[0], capRow = t.sheets.Bookings.rows.find((row) => row[bh.indexOf('email')] === 'cap@example.com');
ok(/^\d{4}-\d{2}-\d{2}T/.test(capRow[bh.indexOf('consentAt')]), 'the time they accepted the terms is recorded');
ok(call({ action: 'getPublic' }).settings.policyText.includes('payment is received'), 'terms text is public so the form can show it');
ok(A({ action: 'saveSettings', settings: { policyText: '  Line one \r\n\r\n Line two  ' } }).settings.policyText === 'Line one\nLine two', 'terms text saved tidy');

t.mails.length = 0;
const bad = t.ctx.doPost({ postData: { contents: '{not json' } });
ok(JSON.parse(bad.t).code === 'server' && t.mails.some((m) => m.to === 'owner@example.com' && /Website problem/.test(m.subject)), 'an unexpected failure emails the admin');
t.mails.length = 0; t.ctx.doPost({ postData: { contents: '{still bad' } });
ok(t.mails.length === 0, 'error emails are limited to one an hour');

console.log('# the starter menu list in the backend and the website are the same');
const win = {}; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'common.js'), 'utf8'), { window: win, document: {}, console });
ok(JSON.stringify(vm.runInContext('MENU_SEED', t.ctx)) === JSON.stringify(win.SWC.MENU_SEED), 'MENU_SEED in Code.gs equals MENU_SEED in js/common.js');

console.log('\nAll ' + passed + ' checks passed');
