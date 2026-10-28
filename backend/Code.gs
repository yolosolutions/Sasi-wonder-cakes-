/**
 * Sasi Wonder Cakes - backend (Google Apps Script, container-bound to a Google Sheet)
 *
 * Online classes on Google Meet. The Sheet is the database (tabs: Settings, Sessions, Bookings
 * are created automatically). The website talks to this script through one web-app URL. See SETUP.md.
 */

// ---------- things you may edit ----------
const TZ = 'Asia/Kolkata';
// Used to log in the very first time. Change it here BEFORE deploying, then change it again
// inside the dashboard (Settings > Change password). Login is refused while this is still CHANGE_ME.
const INITIAL_ADMIN_PASSWORD = 'CHANGE_ME';
// Class-day notifications (to you and to students) go out at this hour, once setupReminders() has been run.
const REMINDER_HOUR = 7;
// Protection against spam bookings (the booking form is public and sends emails):
const MAX_REGISTRATIONS_PER_HOUR = 60;  // all students together
const MAX_TRIES_PER_PERSON_PER_HOUR = 4; // per phone number, and per email
const MAX_UNPAID_PER_PERSON = 3;         // unpaid bookings one phone/email can hold at once
// ----------------------------------------

const SHEETS = {
  Settings: ['key', 'value'],
  Sessions: ['id', 'date', 'start', 'end', 'topic', 'price', 'capacity', 'status', 'meetLink', 'prepStudents', 'prepAdmin', 'details'],
  Bookings: ['id', 'code', 'sessionId', 'name', 'phone', 'email', 'seats', 'note', 'createdAt', 'status', 'amount', 'paidAt', 'expires', 'consentAt'],
  Menu: ['id', 'category', 'name'],
};

// Master list of dishes, copied into the Menu tab the first time the dashboard loads.
// After that the Menu tab (or the dashboard's Menu page) is the source of truth, so edit it there.
const MENU_SEED = {
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

// ---------- web app entry points ----------
function doGet() {
  return json_({ ok: true, service: 'Sasi Wonder Cakes API' });
}

function doPost(e) {
  let out;
  try {
    out = route_(JSON.parse(e.postData.contents));
  } catch (err) {
    if (err && err.user) {
      out = { ok: false, error: err.message, code: err.code || 'error' };
    } else {
      console.error(err && err.stack || err);
      notifyError_(err);
      out = { ok: false, error: 'Something went wrong. Please try again.', code: 'server' };
    }
  }
  return json_(out);
}

// Unexpected failures email the admin, at most once an hour, so a broken site doesn't go unnoticed.
function notifyError_(err) {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('errMailed')) return;
    cache.put('errMailed', '1', 3600);
    const s = getSettings_();
    sendEmail_(s.notifyEmail, 'Website problem: something failed',
      '<p>An unexpected error happened on the booking site:</p><pre>' + esc_(String(err && err.stack || err)).slice(0, 1500) +
      '</pre><p>Open Apps Script, then Executions, to see details. This email is sent at most once an hour.</p>', s.siteName);
  } catch (e) { console.error(e); }
}

function rateLimit_(key, max, message) {
  const cache = CacheService.getScriptCache();
  const n = parseInt(cache.get(key) || '0', 10);
  if (n >= max) throw userError_(message, 'rate');
  cache.put(key, String(n + 1), 3600);
}

// Checks done before a public booking is even looked at.
function guardRegister_(p) {
  if (p.website) throw userError_('Something went wrong. Please try again.', 'spam'); // hidden field that only bots fill in
  if (!(p.agree === true || p.agree === 'true')) throw userError_('Please tick the box to accept the terms and privacy notice.');
  rateLimit_('reg_all', MAX_REGISTRATIONS_PER_HOUR, 'Lots of bookings are coming in right now. Please try again in a few minutes.');
  const phone = waNum_(p.phone, getSettings_().countryCode);
  const email = String(p.email || '').trim().toLowerCase();
  const msg = 'Too many attempts from this phone number or email. Please try again in an hour, or message us on WhatsApp.';
  if (phone) rateLimit_('reg_p_' + hash_('rl', phone).slice(0, 32), MAX_TRIES_PER_PERSON_PER_HOUR, msg);
  if (email) rateLimit_('reg_e_' + hash_('rl', email).slice(0, 32), MAX_TRIES_PER_PERSON_PER_HOUR, msg);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(message, code) {
  const e = new Error(message);
  e.user = true;
  e.code = code || 'error';
  return e;
}

function route_(req) {
  switch (req.action) {
    case 'getPublic': return getPublic_();
    case 'register': return register_(req);
    case 'login': return login_(req);
  }
  requireAuth_(req.token);
  switch (req.action) {
    case 'adminGet': return adminGet_();
    case 'saveSettings': return withLock_(() => saveSettings_(req.settings || {}));
    case 'changePassword': return changePassword_(req);
    case 'saveSession': return withLock_(() => saveSession_(req.session || {}));
    case 'generateWeekends': return withLock_(() => generateWeekends_(req));
    case 'deleteSession': return withLock_(() => deleteSession_(req.id));
    case 'addBooking': return addBooking_(req);
    case 'removeBooking': return withLock_(() => removeBooking_(req.id));
    case 'markPaid': return markPaid_(req.id);
    case 'saveMenuItem': return withLock_(() => saveMenuItem_(req));
    case 'deleteMenuItem': return withLock_(() => deleteMenuItem_(req.id));
    case 'remindNow': return remindNow_(req.sessionId);
    case 'testNotify': return testNotify_();
  }
  throw userError_('Unknown action');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- sheet helpers ----------
// Every cell is forced to plain text so Sheets never turns "2026-11-07" or "+9198..." into dates/numbers.
const HEADER_OK = {};
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  const cols = SHEETS[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    HEADER_OK[name] = true;
  } else if (!HEADER_OK[name]) {
    // a sheet made by an older version may lack newer columns: add their headers once per request
    const have = sh.getRange(1, 1, 1, cols.length).getDisplayValues()[0];
    if (have.join('|') !== cols.join('|')) {
      sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    }
    HEADER_OK[name] = true;
  }
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name);
  const cols = SHEETS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getDisplayValues().map(function (r, i) {
    const o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = r[j]; });
    return o;
  });
}

function writeRow_(name, row, obj) {
  const sh = sheet_(name);
  const cols = SHEETS[name];
  sh.getRange(row, 1, 1, cols.length)
    .setNumberFormat('@')
    .setValues([cols.map(function (c) { return obj[c] === undefined || obj[c] === null ? '' : String(obj[c]); })]);
}

function appendRow_(name, obj) {
  writeRow_(name, sheet_(name).getLastRow() + 1, obj);
}

function deleteRow_(name, row) {
  sheet_(name).deleteRow(row);
}

// ---------- validation helpers ----------
function normText_(t) {
  return String(t === null || t === undefined ? '' : t).replace(/\r\n?/g, '\n').split('\n').map(function (s) { return s.trim(); }).filter(Boolean).join('\n');
}

// A class's "what you'll learn" is plain text: a line starting with # is a section title, every other line is a bullet.
function normDetails_(t) {
  return String(t === null || t === undefined ? '' : t).replace(/\r\n?/g, '\n').split('\n')
    .map(function (s) { return s.trim().replace(/^[-•*]\s+/, ''); }).filter(Boolean).join('\n').slice(0, 3000);
}

function parseDetails_(t) {
  const out = [];
  let cur = null;
  normDetails_(t).split('\n').filter(Boolean).forEach(function (line) {
    const m = /^#+\s*(.*)$/.exec(line);
    if (m) { cur = { title: m[1], items: [] }; out.push(cur); return; }
    if (!cur) { cur = { title: '', items: [] }; out.push(cur); }
    cur.items.push(line);
  });
  return out;
}

function detailsHtml_(t) {
  return parseDetails_(t).map(function (g) {
    return (g.title ? '<p style="margin:12px 0 2px"><b>' + esc_(g.title) + '</b></p>' : '') +
      '<ul style="padding-left:20px;margin:0">' + g.items.map(function (i) { return '<li>' + esc_(i) + '</li>'; }).join('') + '</ul>';
  }).join('');
}

function cleanPrice_(v) {
  const s = String(v === null || v === undefined ? '' : v).replace(/[₹,\s]/g, '');
  if (s === '') return '';
  if (!/^\d{1,7}$/.test(s)) throw userError_('Price must be a whole number of rupees, like 1500.');
  return String(parseInt(s, 10));
}

function cleanUpi_(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (s === '') return '';
  if (!/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,30}$/.test(s)) throw userError_('That UPI ID does not look right. It looks like name@bank, for example sasi@oksbi.');
  return s;
}

function cleanMeet_(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (s === '') return '';
  if (!/^https:\/\/meet\.google\.com\/\S+$/.test(s)) throw userError_('Paste a Google Meet link like https://meet.google.com/abc-defg-hij');
  return s;
}

// ---------- settings ----------
function getSettings_() {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  readAll_('Settings').forEach(function (r) { if (r.key in DEFAULT_SETTINGS) s[r.key] = r.value; });
  return s;
}

function saveSettings_(incoming) {
  const rows = readAll_('Settings');
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!(k in incoming)) return;
    let v = String(incoming[k] === null || incoming[k] === undefined ? '' : incoming[k]).trim();
    if (k === 'defaultCapacity') v = String(Math.max(1, parseInt(v, 10) || 10));
    if (k === 'defaultStart' || k === 'defaultEnd') {
      if (!/^\d{2}:\d{2}$/.test(v)) throw userError_('Please enter the time like 14:00');
    }
    if (k === 'price') v = cleanPrice_(v);
    if (k === 'meetLink') v = cleanMeet_(v);
    if (k === 'upiId') v = cleanUpi_(v);
    if (k === 'policyText') v = normText_(v).slice(0, 2000);
    if (k === 'holdHours') v = String(Math.min(720, Math.max(0, parseInt(v, 10) || 0)));
    if (k === 'defaultStudentPrep' || k === 'defaultAdminPrep') v = normText_(v);
    if (k === 'sendReminders') v = v === 'no' ? 'no' : 'yes';
    const existing = rows.filter(function (r) { return r.key === k; })[0];
    if (existing) writeRow_('Settings', existing._row, { key: k, value: v });
    else appendRow_('Settings', { key: k, value: v });
  });
  return { ok: true, settings: getSettings_() };
}

// ---------- sessions ----------
function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

// A booking holds a seat when it is confirmed, or when it is pending payment and its hold has not run out.
function isLive_(b) {
  if (b.status === 'confirmed') return true;
  if (b.status === 'pending') return !b.expires || Number(b.expires) > Date.now();
  return false;
}

function bookedMap_() {
  const m = {};
  readAll_('Bookings').forEach(function (b) {
    if (!isLive_(b)) return;
    m[b.sessionId] = (m[b.sessionId] || 0) + (parseInt(b.seats, 10) || 1);
  });
  return m;
}

// Blank start/end/capacity/price/meetLink/prep in the sheet means "follow the default in Settings".
// The result always carries the private fields; use publicSession_() before sending to the public.
function sessionOut_(s, settings, booked) {
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

function publicSession_(s) {
  const o = Object.assign({}, s);
  delete o.meetLink; delete o.prepStudents; delete o.prepAdmin;
  return o;
}

function getPublic_() {
  const settings = getSettings_();
  const booked = bookedMap_();
  const from = today_();
  const to = Utilities.formatDate(new Date(Date.now() + 200 * 864e5), TZ, 'yyyy-MM-dd');
  const sessions = readAll_('Sessions')
    .filter(function (s) { return s.date >= from && s.date <= to; })
    .sort(bySessionTime_)
    .map(function (s) { return publicSession_(sessionOut_(s, settings, booked[s.id])); });
  const pub = {};
  PUBLIC_KEYS.forEach(function (k) { pub[k] = settings[k]; });
  return { ok: true, settings: pub, sessions: sessions };
}

function bySessionTime_(a, b) {
  return (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''));
}

function saveSession_(p) {
  const settings = getSettings_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw userError_('Please choose a date.');
  const start = p.start || settings.defaultStart;
  const end = p.end || settings.defaultEnd;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw userError_('Please enter valid times.');
  if (end <= start) throw userError_('End time must be after the start time.');
  const capacity = Math.max(1, parseInt(p.capacity, 10) || parseInt(settings.defaultCapacity, 10) || 10);
  const status = ['open', 'closed', 'cancelled'].indexOf(p.status) >= 0 ? p.status : 'open';
  const price = cleanPrice_(p.price);
  const meetLink = cleanMeet_(p.meetLink);
  const prepStudents = normText_(p.prepStudents);
  const prepAdmin = normText_(p.prepAdmin);

  // Store a blank when the value equals the default, so the class keeps following Settings.
  const rec = {
    date: p.date,
    start: start === settings.defaultStart ? '' : start,
    end: end === settings.defaultEnd ? '' : end,
    topic: String(p.topic || '').trim(),
    price: price === settings.price ? '' : price,
    capacity: capacity === (parseInt(settings.defaultCapacity, 10) || 10) ? '' : capacity,
    status: status,
    meetLink: meetLink === settings.meetLink ? '' : meetLink,
    prepStudents: prepStudents === normText_(settings.defaultStudentPrep) ? '' : prepStudents,
    prepAdmin: prepAdmin === normText_(settings.defaultAdminPrep) ? '' : prepAdmin,
    details: normDetails_(p.details),
  };

  if (p.id) {
    const row = readAll_('Sessions').filter(function (s) { return s.id === p.id; })[0];
    if (!row) throw userError_('That class no longer exists.');
    rec.id = p.id;
    writeRow_('Sessions', row._row, rec);
  } else {
    rec.id = 's' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    appendRow_('Sessions', rec);
  }
  return { ok: true, id: rec.id };
}

function generateWeekends_(p) {
  const m = /^(\d{4})-(\d{2})$/.exec(p.month || '');
  if (!m) throw userError_('Please choose a month.');
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  const days = (p.days || [6, 0]).map(Number);
  if (!days.length) throw userError_('Pick at least one day.');
  const existing = {};
  readAll_('Sessions').forEach(function (s) { existing[s.date] = true; });
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  let added = 0;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    if (days.indexOf(dow) < 0) continue;
    const date = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
    if (existing[date] || date < today_()) continue;
    appendRow_('Sessions', {
      id: 's' + Utilities.getUuid().replace(/-/g, '').slice(0, 8),
      date: date, start: '', end: '', topic: String(p.topic || '').trim(), price: '', capacity: '', status: 'open',
      meetLink: '', prepStudents: '', prepAdmin: '', details: '',
    });
    added++;
  }
  return { ok: true, added: added };
}

function deleteSession_(id) {
  const row = readAll_('Sessions').filter(function (s) { return s.id === id; })[0];
  if (!row) return { ok: true };
  const has = readAll_('Bookings').some(function (b) { return b.sessionId === id && b.status !== 'cancelled'; });
  if (has) throw userError_('This class has students. Cancel the class instead, or remove the students first.');
  deleteRow_('Sessions', row._row);
  return { ok: true };
}

// ---------- bookings ----------
function waNum_(n, cc) {
  let d = String(n || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  if (d.length === 10) d = (cc || '91') + d;
  return d;
}

function newCode_() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
  return 'SWC-' + c;
}

// One booking = one student = one seat. Every student gives their own email, because the
// Google Meet link and class-day reminders are sent there.
function createBooking_(p, isAdmin) {
  const settings = getSettings_();
  const name = String(p.name || '').trim();
  const email = String(p.email || '').trim().toLowerCase();
  const note = String(p.note || '').trim().slice(0, 300);
  if (name.length < 2) throw userError_('Please enter your name.');
  const phone = waNum_(p.phone, settings.countryCode);
  if (phone.length < 11 || phone.length > 15) throw userError_('Please enter a valid WhatsApp number.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw userError_('Please enter a valid email. Your class link is sent there.');

  const sRow = readAll_('Sessions').filter(function (s) { return s.id === p.sessionId; })[0];
  if (!sRow) throw userError_('This class is no longer available.');
  const booked = bookedMap_()[sRow.id] || 0;
  const sess = sessionOut_(sRow, settings, booked);
  if (!isAdmin) {
    if (sess.status === 'cancelled') throw userError_('This class has been cancelled.');
    if (sess.status === 'closed') throw userError_('Booking is closed for this class.');
    if (sess.date < today_()) throw userError_('This class has already happened.');
  }
  if (sess.capacity - booked <= 0) throw userError_('Sorry, this class is full.');
  const dupe = readAll_('Bookings').some(function (b) {
    return b.sessionId === sess.id && isLive_(b) &&
      (waNum_(b.phone, settings.countryCode) === phone || String(b.email).toLowerCase() === email);
  });
  if (dupe) throw userError_('You are already booked for this class with this number or email.');
  if (!isAdmin) {
    const open = readAll_('Bookings').filter(function (b) {
      return b.status === 'pending' && isLive_(b) && (waNum_(b.phone, settings.countryCode) === phone || String(b.email).toLowerCase() === email);
    }).length;
    if (open >= MAX_UNPAID_PER_PERSON) throw userError_('You already have ' + open + ' unpaid bookings. Please complete payment for those first.');
  }

  // A paid class holds the seat as "pending" until the admin marks the payment received.
  // Free classes, and students the admin adds by hand, are confirmed straight away.
  const fee = parseInt(sess.price, 10) || 0;
  const needsPay = fee > 0 && !isAdmin;
  const hold = parseInt(settings.holdHours, 10) || 0;
  const nowStr = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm");
  const booking = {
    id: 'b' + Utilities.getUuid().replace(/-/g, '').slice(0, 10),
    code: newCode_(), sessionId: sess.id, name: name, phone: phone, email: email, seats: 1, note: note,
    createdAt: nowStr, status: needsPay ? 'pending' : 'confirmed',
    amount: fee ? String(fee) : '', paidAt: fee && !needsPay ? nowStr : '',
    expires: needsPay && hold > 0 ? String(Date.now() + hold * 3600000) : '',
    consentAt: isAdmin ? '' : nowStr, // when the student ticked the terms box
  };
  appendRow_('Bookings', booking);
  sess.booked = booked + 1;
  return { booking: booking, session: sess, settings: settings };
}

function register_(p) {
  guardRegister_(p);
  const r = withLock_(function () { return createBooking_(p, false); });
  try { notifyNewBooking_(r.booking, r.session, r.settings); } catch (err) { console.error('notify failed', err); }
  const pending = r.booking.status === 'pending';
  return {
    ok: true,
    booking: { code: r.booking.code, name: r.booking.name, email: r.booking.email, status: r.booking.status },
    session: publicSession_(r.session),
    // the Meet link is only released once the seat is paid for (or the class is free)
    meetLink: pending ? '' : r.session.meetLink,
    payment: pending ? paymentInfo_(r.booking, r.session, r.settings) : null,
  };
}

function addBooking_(p) {
  const r = withLock_(function () { return createBooking_(p, true); });
  return { ok: true, booking: r.booking };
}

// Admin: the money has arrived. Confirms the seat and emails the student the Meet link.
function markPaid_(id) {
  const settings = getSettings_();
  const res = withLock_(function () {
    const row = readAll_('Bookings').filter(function (b) { return b.id === id; })[0];
    if (!row || row.status === 'cancelled') throw userError_('That booking no longer exists.');
    if (row.status === 'confirmed') return { already: true };
    const sRow = readAll_('Sessions').filter(function (s) { return s.id === row.sessionId; })[0];
    if (!sRow) throw userError_('That class no longer exists.');
    const expired = !isLive_(row);
    const booked = bookedMap_()[sRow.id] || 0;
    const sess = sessionOut_(sRow, settings, booked);
    if (expired && booked >= sess.capacity) throw userError_('The hold on this seat ran out and the class is full now. Raise the seats or remove someone first.');
    row.status = 'confirmed';
    row.paidAt = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm");
    row.expires = '';
    writeRow_('Bookings', row._row, row);
    sess.booked = booked + (expired ? 1 : 0);
    return { row: row, sess: sess };
  });
  if (!res.already) { try { sendConfirmedEmail_(res.row, res.sess, settings); } catch (e) { console.error('confirm email', e); } }
  return { ok: true };
}

function removeBooking_(id) {
  const row = readAll_('Bookings').filter(function (b) { return b.id === id; })[0];
  if (!row) return { ok: true };
  row.status = 'cancelled';
  writeRow_('Bookings', row._row, row);
  return { ok: true };
}

function adminGet_() {
  const settings = getSettings_();
  const booked = bookedMap_();
  const sessions = readAll_('Sessions').sort(bySessionTime_).map(function (s) { return sessionOut_(s, settings, booked[s.id]); });
  const bookings = readAll_('Bookings').filter(function (b) { return b.status !== 'cancelled'; }).map(function (b) {
    return { id: b.id, code: b.code, sessionId: b.sessionId, name: b.name, phone: b.phone, email: b.email, seats: 1, note: b.note,
      createdAt: b.createdAt, status: b.status || 'confirmed', amount: b.amount, paidAt: b.paidAt, expired: b.status === 'pending' && !isLive_(b) };
  });
  return { ok: true, settings: settings, sessions: sessions, bookings: bookings, menu: getMenu_(), today: today_() };
}

// ---------- master menu (dishes the admin picks from when building a class) ----------
function getMenu_() {
  const props = PropertiesService.getScriptProperties();
  const sh = sheet_('Menu');
  if (!props.getProperty('menuSeeded') && sh.getLastRow() < 2) {
    const rows = [];
    Object.keys(MENU_SEED).forEach(function (cat) {
      MENU_SEED[cat].forEach(function (name) { rows.push(['m' + Utilities.getUuid().replace(/-/g, '').slice(0, 8), cat, name]); });
    });
    sh.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
    props.setProperty('menuSeeded', '1');
  }
  return readAll_('Menu').map(function (r) { return { id: r.id, category: r.category, name: r.name }; });
}

function saveMenuItem_(p) {
  getMenu_(); // make sure the starter list is in before the first manual change
  const name = String(p.name || '').replace(/^[-•*#\s]+/, '').replace(/\s+/g, ' ').trim();
  let category = String(p.category || '').replace(/^[#\s]+/, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) throw userError_('Please enter a dish name (2 to 80 characters).');
  if (!category || category.length > 40) throw userError_('Please choose a category, or type a new one (up to 40 characters).');
  const rows = readAll_('Menu');
  const sameCat = rows.filter(function (r) { return r.category.toLowerCase() === category.toLowerCase(); })[0];
  if (sameCat) category = sameCat.category; // reuse the existing spelling of that category
  const dupe = rows.some(function (r) {
    return r.id !== p.id && r.category.toLowerCase() === category.toLowerCase() && r.name.toLowerCase() === name.toLowerCase();
  });
  if (dupe) throw userError_('"' + name + '" is already in ' + category + '.');
  if (p.id) {
    const row = rows.filter(function (r) { return r.id === p.id; })[0];
    if (!row) throw userError_('That dish no longer exists.');
    writeRow_('Menu', row._row, { id: p.id, category: category, name: name });
  } else {
    appendRow_('Menu', { id: 'm' + Utilities.getUuid().replace(/-/g, '').slice(0, 8), category: category, name: name });
  }
  return { ok: true, menu: getMenu_() };
}

// Deleting a dish only removes it from the dropdown. Classes that already list it keep it.
function deleteMenuItem_(id) {
  const row = readAll_('Menu').filter(function (r) { return r.id === id; })[0];
  if (row) deleteRow_('Menu', row._row);
  return { ok: true, menu: getMenu_() };
}

// ---------- authentication ----------
function hash_(salt, pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw));
}

function passwordOk_(pw) {
  const stored = PropertiesService.getScriptProperties().getProperty('pwHash');
  if (stored) {
    const parts = stored.split(':');
    return hash_(parts[0], pw) === parts[1];
  }
  if (INITIAL_ADMIN_PASSWORD === 'CHANGE_ME') {
    throw userError_('Admin password has not been set up yet. Open Code.gs, set INITIAL_ADMIN_PASSWORD, and redeploy (see SETUP.md).');
  }
  return pw === INITIAL_ADMIN_PASSWORD;
}

function login_(p) {
  const cache = CacheService.getScriptCache();
  const fails = parseInt(cache.get('loginFails') || '0', 10);
  if (fails >= 8) throw userError_('Too many wrong attempts. Please try again in 15 minutes.');
  if (!passwordOk_(String(p.password || ''))) {
    cache.put('loginFails', String(fails + 1), 900);
    throw userError_('Wrong password.');
  }
  cache.remove('loginFails');
  const props = PropertiesService.getScriptProperties();
  const map = JSON.parse(props.getProperty('tokens') || '{}');
  const now = Date.now();
  Object.keys(map).forEach(function (k) { if (map[k] < now) delete map[k]; });
  const token = Utilities.getUuid() + Utilities.getUuid();
  map[token] = now + 14 * 864e5;
  props.setProperty('tokens', JSON.stringify(map));
  return { ok: true, token: token };
}

function requireAuth_(token) {
  const map = JSON.parse(PropertiesService.getScriptProperties().getProperty('tokens') || '{}');
  if (!token || !map[token] || map[token] < Date.now()) throw userError_('Please log in again.', 'auth');
}

function changePassword_(p) {
  if (!passwordOk_(String(p.current || ''))) throw userError_('Current password is wrong.');
  const next = String(p.next || '');
  if (next.length < 6) throw userError_('New password must be at least 6 characters.');
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('pwHash', salt + ':' + hash_(salt, next));
  return { ok: true };
}

// ---------- notification helpers ----------
function fmtDate_(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return Utilities.formatDate(d, 'UTC', 'EEE d MMM yyyy');
}

function fmtTime_(t) {
  const h = parseInt(t.slice(0, 2), 10), m = t.slice(3, 5);
  return (h % 12 || 12) + (m === '00' ? '' : ':' + m) + ' ' + (h < 12 ? 'AM' : 'PM');
}

function fmtPrice_(p) {
  if (p === '' || p === null || p === undefined) return '';
  const n = parseInt(p, 10);
  if (!n) return 'Free';
  const s = String(n);
  const head = s.slice(0, -3), tail = s.slice(-3);
  return '₹' + (head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + tail;
}

function esc_(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function ul_(text) {
  const items = normText_(text).split('\n').filter(Boolean);
  return items.length ? '<ul style="padding-left:20px">' + items.map(function (x) { return '<li>' + esc_(x) + '</li>'; }).join('') + '</ul>' : '';
}

function button_(url, label) {
  return '<p><a href="' + esc_(url) + '" style="background:#b5452a;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold;display:inline-block">' + esc_(label) + '</a></p>' +
    '<p style="font-size:13px;color:#666">Link: ' + esc_(url) + '</p>';
}

function wrapEmail_(inner) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;color:#3a2a25;line-height:1.5">' + inner + '</div>';
}

function whenText_(s) {
  return fmtDate_(s.date) + ', ' + fmtTime_(s.start) + ' - ' + fmtTime_(s.end);
}

function sendEmail_(to, subject, html, name) {
  if (!to) return false;
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: name });
  return true;
}

function sendWhatsApp_(text, settings) {
  const phone = waNum_(settings.whatsappNumber, settings.countryCode);
  if (!phone || !settings.callmebotKey) return false;
  const url = 'https://api.callmebot.com/whatsapp.php?phone=%2B' + phone +
    '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(settings.callmebotKey);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return res.getResponseCode() < 300;
}

// ---------- notifications: new booking ----------
function upiUri_(upiId, payee, amount, note) {
  return 'upi://pay?pa=' + upiId + '&pn=' + encodeURIComponent(payee) + '&am=' + parseInt(amount, 10) + '.00&cu=INR&tn=' + encodeURIComponent(note);
}

function paymentInfo_(b, s, settings) {
  const payee = settings.upiName || settings.siteName;
  return {
    amount: parseInt(b.amount, 10) || 0, upiId: settings.upiId, payeeName: payee, note: b.code,
    uri: settings.upiId ? upiUri_(settings.upiId, payee, b.amount, b.code) : '',
    holdHours: parseInt(settings.holdHours, 10) || 0,
  };
}

function notifyNewBooking_(b, s, settings) {
  const when = whenText_(s);
  const brand = settings.siteName;
  const price = fmtPrice_(s.price);
  const pending = b.status === 'pending';

  const adminText = (pending ? 'New booking, PAYMENT PENDING: ' : 'New booking: ') + b.name + '\n' + when + (s.topic ? '\n' + s.topic : '') +
    '\nEmail: ' + b.email + '\nPhone: +' + b.phone + (b.note ? '\nNote: ' + b.note : '') +
    '\nStudents: ' + s.booked + '/' + s.capacity + (price ? '\nFee: ' + price : '') +
    (pending ? '\nRef: ' + b.code + '. Tap Mark paid in the dashboard once the money arrives.' : '');
  try {
    sendEmail_(settings.notifyEmail, (pending ? 'Awaiting payment - ' : 'New booking - ') + b.name + ' - ' + fmtDate_(s.date),
      wrapEmail_('<p>' + esc_(adminText).replace(/\n/g, '<br>') + '</p><p>Ref: ' + b.code + '</p>'), brand);
  } catch (e) { console.error('admin email', e); }
  try { sendWhatsApp_(adminText, settings); } catch (e) { console.error('admin whatsapp', e); }

  try {
    if (pending) sendPaymentEmail_(b, s, settings); else sendConfirmedEmail_(b, s, settings);
  } catch (e) { console.error('student email', e); }
}

// Sent when the seat is confirmed: right away for free classes, or when the admin marks the payment received.
function sendConfirmedEmail_(b, s, settings) {
  const when = whenText_(s);
  const brand = settings.siteName;
  const paid = (parseInt(b.amount, 10) || 0) > 0;
  sendEmail_(b.email, (paid ? 'Payment received: ' : 'You\'re booked: ') + (s.topic || 'Baking class') + ' - ' + fmtDate_(s.date),
    wrapEmail_(
      '<h2 style="color:#b5452a;margin-bottom:4px">' + (paid ? 'Payment received. You\'re in, ' : 'You\'re booked, ') + esc_(b.name) + '!</h2>' +
      '<p><b>' + esc_(s.topic || 'Online baking class') + '</b><br>' + esc_(when) + '<br>Live on Google Meet</p>' +
      (s.meetLink ? '<p>Join the class here:</p>' + button_(s.meetLink, 'Join on Google Meet') :
        '<p>We\'ll email you the Google Meet link before the class.</p>') +
      (parseDetails_(s.details).length ? '<p style="margin-bottom:0"><b>What we\'ll cover</b></p>' + detailsHtml_(s.details) : '') +
      (normText_(s.prepStudents) ? '<p><b>Please have ready:</b></p>' + ul_(s.prepStudents) : '') +
      '<p>Booking reference: <b>' + b.code + '</b></p>' +
      '<p>Questions? WhatsApp us on +' + waNum_(settings.whatsappNumber, settings.countryCode) + '.</p>' +
      '<p>- ' + esc_(brand) + '</p>'), brand);
}

// Sent right after booking a paid class: how to pay by UPI. The Meet link comes after the payment is confirmed.
function sendPaymentEmail_(b, s, settings) {
  const when = whenText_(s);
  const brand = settings.siteName;
  const info = paymentInfo_(b, s, settings);
  const wa = waNum_(settings.whatsappNumber, settings.countryCode);
  const td = 'padding:6px 14px;';
  sendEmail_(b.email, 'Complete your payment to confirm your seat - ' + fmtDate_(s.date),
    wrapEmail_(
      '<h2 style="color:#b5452a;margin-bottom:4px">Almost there, ' + esc_(b.name) + '!</h2>' +
      '<p><b>' + esc_(s.topic || 'Online baking class') + '</b><br>' + esc_(when) + '<br>Live on Google Meet</p>' +
      '<p>Your seat is reserved but <b>not confirmed until you pay</b>. ' +
      (info.holdHours ? 'We\'ll hold it for ' + info.holdHours + ' hours.' : 'We\'re holding it for you.') + '</p>' +
      '<table style="border-collapse:collapse;background:#fff8ec;border-radius:8px;font-size:15px">' +
      '<tr><td style="' + td + '">Amount</td><td style="' + td + '"><b>' + esc_(fmtPrice_(b.amount)) + '</b></td></tr>' +
      (info.upiId ? '<tr><td style="' + td + '">Pay to UPI ID</td><td style="' + td + '"><b>' + esc_(info.upiId) + '</b> (' + esc_(info.payeeName) + ')</td></tr>' : '') +
      '<tr><td style="' + td + '">Payment note</td><td style="' + td + '"><b>' + b.code + '</b></td></tr></table>' +
      (info.upiId ? '<p>Open GPay, PhonePe or Paytm, choose <i>Pay to UPI ID</i>, enter the amount, and put the note above.</p>' :
        '<p>Message us on WhatsApp for the payment details.</p>') +
      '<p>After paying, send a screenshot on WhatsApp (+' + wa + ') with your reference <b>' + b.code + '</b>. As soon as we confirm it, we\'ll email you the Google Meet link.</p>' +
      (parseDetails_(s.details).length ? '<p style="margin-bottom:0"><b>What we\'ll cover</b></p>' + detailsHtml_(s.details) : '') +
      '<p>- ' + esc_(brand) + '</p>'), brand);
}

// ---------- notifications: class day ----------
// Emails each PAID student the Meet link and what to keep ready, and sends the admin the full run-down
// (class details, Meet link, prep checklist, attendee list, and who still owes payment) by email and WhatsApp.
function classDayNotify_(sess, settings, list, pending) {
  const when = whenText_(sess);
  const title = sess.topic || 'Baking class';
  const brand = settings.siteName;
  const out = { students: list.length, pending: pending.length, studentEmails: 0, adminEmail: false, adminWhatsApp: false };

  list.forEach(function (b) {
    try {
      const sent = sendEmail_(b.email, 'Today at ' + fmtTime_(sess.start) + ': ' + title,
        wrapEmail_(
          '<h2 style="color:#b5452a;margin-bottom:4px">Your class is today, ' + esc_(b.name) + '!</h2>' +
          '<p><b>' + esc_(title) + '</b><br>' + esc_(when) + '</p>' +
          (sess.meetLink ? button_(sess.meetLink, 'Join on Google Meet') : '<p>We\'ll message you the Google Meet link shortly.</p>') +
          (normText_(sess.prepStudents) ? '<p><b>Please have ready:</b></p>' + ul_(sess.prepStudents) : '') +
          '<p>See you soon!<br>- ' + esc_(brand) + '</p>'), brand);
      if (sent) out.studentEmails++;
    } catch (e) { console.error('student reminder', e); }
  });

  const rows = list.map(function (b, i) {
    return '<tr><td style="padding:4px 8px">' + (i + 1) + '</td><td style="padding:4px 8px"><b>' + esc_(b.name) + '</b>' + (b.note ? '<br><i>' + esc_(b.note) + '</i>' : '') +
      '</td><td style="padding:4px 8px">' + esc_(b.email) + '<br>+' + esc_(b.phone) + '</td></tr>';
  }).join('');
  const price = fmtPrice_(sess.price);
  const adminHtml = wrapEmail_(
    '<h2 style="color:#b5452a;margin-bottom:4px">Today\'s class</h2>' +
    '<p><b>' + esc_(title) + '</b><br>' + esc_(when) + (price ? '<br>Fee: ' + esc_(price) + ' per student' : '') +
    '<br><b>' + list.length + ' confirmed of ' + sess.capacity + ' seats</b></p>' +
    (sess.meetLink ? button_(sess.meetLink, 'Open Google Meet') : '<p style="color:#b42318"><b>No Meet link is set for this class yet.</b></p>') +
    (parseDetails_(sess.details).length ? '<p style="margin-bottom:0"><b>Today\'s class menu</b></p>' + detailsHtml_(sess.details) : '') +
    (normText_(sess.prepAdmin) ? '<p><b>Your checklist before class:</b></p>' + ul_(sess.prepAdmin) : '') +
    (normText_(sess.prepStudents) ? '<p><b>Students were asked to have ready:</b></p>' + ul_(sess.prepStudents) : '') +
    '<p><b>Attendees (paid)</b></p>' + (list.length ? '<table style="border-collapse:collapse;font-size:14px">' + rows + '</table>' : '<p>No confirmed students for this class.</p>') +
    (pending.length ? '<p style="color:#b42318"><b>Still awaiting payment (no link sent):</b> ' + pending.map(function (b) { return esc_(b.name) + ' (' + b.code + ')'; }).join(', ') + '</p>' : '') +
    '<p style="font-size:13px;color:#666">Paid students have been emailed the Meet link' + (out.studentEmails ? ' (' + out.studentEmails + ' sent)' : '') + '.</p>');
  try { out.adminEmail = sendEmail_(settings.notifyEmail, 'Today\'s class: ' + title + ' - ' + list.length + ' students', adminHtml, brand); } catch (e) { console.error('admin summary email', e); }

  const waText = 'TODAY: ' + title + '\n' + when + '\n' + list.length + '/' + sess.capacity + ' confirmed' +
    (sess.meetLink ? '\nMeet: ' + sess.meetLink : '\nNo Meet link set!') +
    (normText_(sess.prepAdmin) ? '\n\nPrepare:\n- ' + normText_(sess.prepAdmin).split('\n').join('\n- ') : '') +
    (list.length ? '\n\nStudents:\n' + list.map(function (b) { return b.name; }).join(', ') : '') +
    (pending.length ? '\n\nUNPAID: ' + pending.map(function (b) { return b.name; }).join(', ') : '');
  try { out.adminWhatsApp = sendWhatsApp_(waText, settings); } catch (e) { console.error('admin summary whatsapp', e); }
  return out;
}

function classDayRun_(rows, settings) {
  const booked = bookedMap_();
  const live = readAll_('Bookings').filter(isLive_);
  return rows.map(function (row) {
    const sess = sessionOut_(row, settings, booked[row.id]);
    const mine = live.filter(function (b) { return b.sessionId === sess.id; });
    return classDayNotify_(sess, settings,
      mine.filter(function (b) { return b.status === 'confirmed'; }),
      mine.filter(function (b) { return b.status === 'pending'; }));
  });
}

// Run setupReminders() once from the Apps Script editor to turn on the daily class-day notifications.
function setupReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReminders').timeBased().everyDays(1).atHour(REMINDER_HOUR).inTimezone(TZ).create();
}

function sendDailyReminders() {
  const settings = getSettings_();
  if (settings.sendReminders === 'no') return;
  const today = today_();
  const rows = readAll_('Sessions').filter(function (s) { return s.date === today && s.status !== 'cancelled'; });
  classDayRun_(rows, settings);
}

// Admin button: send the class-day notifications for one class right now.
function remindNow_(sessionId) {
  const row = readAll_('Sessions').filter(function (s) { return s.id === sessionId; })[0];
  if (!row) throw userError_('That class no longer exists.');
  if (row.status === 'cancelled') throw userError_('This class is cancelled.');
  return { ok: true, result: classDayRun_([row], getSettings_())[0] };
}

function testNotify_() {
  const settings = getSettings_();
  const result = { email: 'skipped (no email set)', whatsapp: 'skipped (no CallMeBot key set)' };
  if (settings.notifyEmail) {
    try { sendEmail_(settings.notifyEmail, 'Test from ' + settings.siteName, '<p>Email notifications are working.</p>', settings.siteName); result.email = 'sent to ' + settings.notifyEmail; }
    catch (e) { result.email = 'failed: ' + e.message; }
  }
  if (settings.callmebotKey) {
    try { result.whatsapp = sendWhatsApp_('Test message from ' + settings.siteName + ': WhatsApp alerts are working.', settings) ? 'sent' : 'failed (check number and key)'; }
    catch (e) { result.whatsapp = 'failed: ' + e.message; }
  }
  return { ok: true, result: result };
}
