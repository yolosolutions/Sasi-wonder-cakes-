// API client. With an API_URL it talks to the Google Apps Script backend (backend/Code.gs).
// Without one it runs a DEMO backend stored in this browser's localStorage so you can try everything.
// Code.gs is the source of truth; the demo mirrors its rules (capacity, duplicates, defaults, private fields).
(function () {
  const url = (window.SWC_CONFIG || {}).API_URL;
  const demo = !url;

  function fail(message, code) { const e = new Error(message); e.code = code || 'error'; return e; }

  async function remote(action, payload) {
    let res;
    try {
      // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action }, payload)) });
    } catch (e) {
      throw fail('Could not reach the server. Please check your internet and try again.', 'network');
    }
    let data;
    try { data = await res.json(); } catch (e) { throw fail('The server sent an unexpected reply. Please try again.', 'server'); }
    if (!data.ok) throw fail(data.error || 'Something went wrong.', data.code);
    return data;
  }

  // ---------------- demo backend ----------------
  const KEY = 'swc_demo_v5';
  const DEFAULTS = {
    siteName: 'Sasi Wonder Cakes', tagline: 'Live online baking classes from our Pondicherry kitchen',
    about: 'Sasi Wonder Cakes is a home bakery in Pondicherry. Join our live weekend classes on Google Meet, bake along from your own kitchen, ask questions as you go, and keep the recipes.',
    defaultStart: '14:00', defaultEnd: '17:00', defaultCapacity: '10', price: '1500', meetLink: 'https://meet.google.com/abc-defg-hij',
    whatsappNumber: '6379293492', instagram: 'sasi_wonder_cakes', notifyEmail: 'yolosolutions01@gmail.com', callmebotKey: '', upiId: 'sasi@oksbi', upiName: '', holdHours: '24',
    defaultStudentPrep: 'A phone, tablet or laptop with a stable internet connection\nThe ingredients and tools listed for the class\nA clean counter where the camera can see your hands\nJoin 5 minutes early',
    defaultAdminPrep: 'Open the Meet link and test your camera and microphone\nLay out demo ingredients and tools\nOpen the attendee list below\nShare the recipe or ingredient list with students if not already sent',
    sendReminders: 'yes', countryCode: '91',
  };
  const PUBLIC_KEYS = ['siteName', 'tagline', 'about', 'defaultStart', 'defaultEnd', 'defaultCapacity', 'price', 'whatsappNumber', 'instagram', 'countryCode'];
  const rid = (p) => p + Math.random().toString(16).slice(2, 10);
  const norm = (t) => SWC.lines(String(t == null ? '' : t).replace(/\r\n?/g, '\n')).join('\n');
  const normDetails = (t) => String(t == null ? '' : t).replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim().replace(/^[-•*]\s+/, '')).filter(Boolean).join('\n').slice(0, 3000);

  function cleanPrice(v) {
    const s = String(v == null ? '' : v).replace(/[₹,\s]/g, '');
    if (s === '') return '';
    if (!/^\d{1,7}$/.test(s)) throw fail('Price must be a whole number of rupees, like 1500.');
    return String(parseInt(s, 10));
  }
  function cleanMeet(v) {
    const s = String(v == null ? '' : v).trim();
    if (s && !/^https:\/\/meet\.google\.com\/\S+$/.test(s)) throw fail('Paste a Google Meet link like https://meet.google.com/abc-defg-hij');
    return s;
  }

  function seed() {
    const db = { settings: Object.assign({}, DEFAULTS), sessions: [], bookings: [], password: 'admin', menu: [] };
    Object.keys(SWC.MENU_SEED).forEach((cat) => SWC.MENU_SEED[cat].forEach((name) => db.menu.push({ id: rid('m'), category: cat, name })));
    const now = new Date();
    for (let mo = 0; mo < 2; mo++) {
      const y = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      const last = new Date(y.getFullYear(), y.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= last; d++) {
        const dt = new Date(y.getFullYear(), y.getMonth(), d);
        if (dt.getDay() !== 6) continue; // one class per weekend: Saturday
        const iso = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        if (iso < SWC.todayISO()) continue;
        db.sessions.push({ id: rid('s'), date: iso, start: '', end: '', topic: '', price: '', capacity: '', status: 'open', meetLink: '', prepStudents: '', prepAdmin: '', details: '' });
      }
    }
    // the first class is the brownie class
    if (db.sessions[0]) Object.assign(db.sessions[0], SWC.BROWNIE);
    const names = ['Anitha R', 'Meena K', 'Priya S', 'Divya M', 'Kavya P'];
    if (db.sessions[0]) names.forEach((nm, i) => db.bookings.push({ id: rid('b'), code: 'SWC-DEMO' + i, sessionId: db.sessions[0].id, name: nm, phone: '919' + String(800000000 + i * 1111111).slice(0, 9), email: nm.split(' ')[0].toLowerCase() + '@example.com', seats: 1, note: i === 2 ? 'First time baking' : '', createdAt: SWC.todayISO() + 'T10:00', status: i === 4 ? 'pending' : 'confirmed', amount: '1500', paidAt: i === 4 ? '' : SWC.todayISO() + 'T11:00', expires: '' }));
    return db;
  }
  const load = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch (e) {} const d = seed(); save(d); return d; };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };

  // full (private) view of a class; use pub() before sending to the public site
  const effective = (s, st, booked) => ({
    id: s.id, date: s.date, start: s.start || st.defaultStart, end: s.end || st.defaultEnd, topic: s.topic,
    price: s.price || st.price, capacity: parseInt(s.capacity, 10) || parseInt(st.defaultCapacity, 10) || 10,
    status: s.status || 'open', booked: booked || 0,
    meetLink: s.meetLink || st.meetLink, prepStudents: s.prepStudents || st.defaultStudentPrep, prepAdmin: s.prepAdmin || st.defaultAdminPrep,
    details: s.details || '',
  });
  const pub = (s) => { const o = Object.assign({}, s); delete o.meetLink; delete o.prepStudents; delete o.prepAdmin; return o; };
  // confirmed bookings, and pending ones whose hold has not run out, hold a seat
  const isLive = (b) => b.status === 'confirmed' || (b.status === 'pending' && (!b.expires || Number(b.expires) > Date.now()));
  const bookedMap = (db) => { const m = {}; db.bookings.forEach((b) => { if (isLive(b)) m[b.sessionId] = (m[b.sessionId] || 0) + 1; }); return m; };
  const upiUri = (st, amount, note) => 'upi://pay?pa=' + st.upiId + '&pn=' + encodeURIComponent(st.upiName || st.siteName) + '&am=' + parseInt(amount, 10) + '.00&cu=INR&tn=' + encodeURIComponent(note);
  const paymentInfo = (st, b) => ({ amount: parseInt(b.amount, 10) || 0, upiId: st.upiId, payeeName: st.upiName || st.siteName, note: b.code, uri: st.upiId ? upiUri(st, b.amount, b.code) : '', holdHours: parseInt(st.holdHours, 10) || 0 });
  const sortSess = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);

  function createBooking(db, p, isAdmin) {
    const st = db.settings;
    const name = String(p.name || '').trim();
    const email = String(p.email || '').trim().toLowerCase();
    if (name.length < 2) throw fail('Please enter your name.');
    const phone = SWC.waNumber(p.phone, st.countryCode);
    if (phone.length < 11 || phone.length > 15) throw fail('Please enter a valid WhatsApp number.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('Please enter a valid email. Your class link is sent there.');
    const row = db.sessions.find((s) => s.id === p.sessionId);
    if (!row) throw fail('This class is no longer available.');
    const booked = bookedMap(db)[row.id] || 0;
    const sess = effective(row, st, booked);
    if (!isAdmin) {
      if (sess.status === 'cancelled') throw fail('This class has been cancelled.');
      if (sess.status === 'closed') throw fail('Booking is closed for this class.');
      if (sess.date < SWC.todayISO()) throw fail('This class has already happened.');
    }
    if (sess.capacity - booked <= 0) throw fail('Sorry, this class is full.');
    if (db.bookings.some((b) => b.sessionId === sess.id && isLive(b) && (SWC.waNumber(b.phone, st.countryCode) === phone || String(b.email).toLowerCase() === email))) throw fail('You are already booked for this class with this number or email.');
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = 'SWC-' + Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
    // a paid class holds the seat as "pending" until the admin marks the payment received; free classes and admin-added students are confirmed
    const fee = parseInt(sess.price, 10) || 0, needsPay = fee > 0 && !isAdmin, hold = parseInt(st.holdHours, 10) || 0, nowStr = new Date().toISOString().slice(0, 16);
    const booking = { id: rid('b'), code, sessionId: sess.id, name, phone, email, seats: 1, note: String(p.note || '').trim().slice(0, 300), createdAt: nowStr, status: needsPay ? 'pending' : 'confirmed',
      amount: fee ? String(fee) : '', paidAt: fee && !needsPay ? nowStr : '', expires: needsPay && hold > 0 ? String(Date.now() + hold * 3600000) : '' };
    db.bookings.push(booking);
    sess.booked = booked + 1;
    return { booking, session: sess, settings: st };
  }

  const demoHandlers = {
    getPublic() {
      const db = load(); const bm = bookedMap(db); const today = SWC.todayISO();
      const settings = {}; PUBLIC_KEYS.forEach((k) => { settings[k] = db.settings[k]; });
      return { ok: true, settings, sessions: db.sessions.filter((s) => s.date >= today).sort(sortSess).map((s) => pub(effective(s, db.settings, bm[s.id]))) };
    },
    register(p) {
      const db = load(); const r = createBooking(db, p, false); save(db);
      console.info('[demo] would email the admin and', r.booking.email, 'about', r.booking.name);
      const pending = r.booking.status === 'pending';
      return { ok: true, booking: { code: r.booking.code, name: r.booking.name, email: r.booking.email, status: r.booking.status }, session: pub(r.session),
        meetLink: pending ? '' : r.session.meetLink, payment: pending ? paymentInfo(r.settings, r.booking) : null };
    },
    login(p) { if (p.password !== load().password) throw fail('Wrong password.'); return { ok: true, token: 'demo' }; },
    adminGet() {
      const db = load(); const bm = bookedMap(db);
      return { ok: true, settings: db.settings, today: SWC.todayISO(), sessions: db.sessions.slice().sort(sortSess).map((s) => effective(s, db.settings, bm[s.id])), bookings: db.bookings.map((b) => Object.assign({}, b, { expired: b.status === 'pending' && !isLive(b) })), menu: db.menu };
    },
    saveMenuItem(p) {
      const db = load();
      const name = String(p.name || '').replace(/^[-•*#\s]+/, '').replace(/\s+/g, ' ').trim();
      let category = String(p.category || '').replace(/^[#\s]+/, '').replace(/\s+/g, ' ').trim();
      if (name.length < 2 || name.length > 80) throw fail('Please enter a dish name (2 to 80 characters).');
      if (!category || category.length > 40) throw fail('Please choose a category, or type a new one (up to 40 characters).');
      const same = db.menu.find((m) => m.category.toLowerCase() === category.toLowerCase());
      if (same) category = same.category;
      if (db.menu.some((m) => m.id !== p.id && m.category.toLowerCase() === category.toLowerCase() && m.name.toLowerCase() === name.toLowerCase())) throw fail('"' + name + '" is already in ' + category + '.');
      if (p.id) { const m = db.menu.find((x) => x.id === p.id); if (!m) throw fail('That dish no longer exists.'); m.category = category; m.name = name; }
      else db.menu.push({ id: rid('m'), category, name });
      save(db); return { ok: true, menu: db.menu };
    },
    deleteMenuItem(p) { const db = load(); db.menu = db.menu.filter((m) => m.id !== p.id); save(db); return { ok: true, menu: db.menu }; },
    saveSettings(p) {
      const db = load();
      Object.keys(DEFAULTS).forEach((k) => {
        if (!(k in p.settings)) return;
        let v = String(p.settings[k] == null ? '' : p.settings[k]).trim();
        if (k === 'defaultCapacity') v = String(Math.max(1, parseInt(v, 10) || 10));
        if ((k === 'defaultStart' || k === 'defaultEnd') && !/^\d{2}:\d{2}$/.test(v)) throw fail('Please enter the time like 14:00');
        if (k === 'price') v = cleanPrice(v);
        if (k === 'meetLink') v = cleanMeet(v);
        if (k === 'upiId' && v && !/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,30}$/.test(v)) throw fail('That UPI ID does not look right. It looks like name@bank, for example sasi@oksbi.');
        if (k === 'holdHours') v = String(Math.min(720, Math.max(0, parseInt(v, 10) || 0)));
        if (k === 'defaultStudentPrep' || k === 'defaultAdminPrep') v = norm(v);
        db.settings[k] = v;
      });
      save(db); return { ok: true, settings: db.settings };
    },
    changePassword(p) {
      const db = load();
      if (p.current !== db.password) throw fail('Current password is wrong.');
      if (String(p.next || '').length < 6) throw fail('New password must be at least 6 characters.');
      db.password = p.next; save(db); return { ok: true };
    },
    saveSession(p) {
      const db = load(); const st = db.settings; const s = p.session;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) throw fail('Please choose a date.');
      const start = s.start || st.defaultStart, end = s.end || st.defaultEnd;
      if (end <= start) throw fail('End time must be after the start time.');
      const cap = Math.max(1, parseInt(s.capacity, 10) || parseInt(st.defaultCapacity, 10) || 10);
      const price = cleanPrice(s.price), meet = cleanMeet(s.meetLink), ps = norm(s.prepStudents), pa = norm(s.prepAdmin);
      const rec = {
        date: s.date, start: start === st.defaultStart ? '' : start, end: end === st.defaultEnd ? '' : end, topic: String(s.topic || '').trim(),
        price: price === st.price ? '' : price, capacity: cap === (parseInt(st.defaultCapacity, 10) || 10) ? '' : cap,
        status: ['open', 'closed', 'cancelled'].includes(s.status) ? s.status : 'open',
        meetLink: meet === st.meetLink ? '' : meet, prepStudents: ps === norm(st.defaultStudentPrep) ? '' : ps, prepAdmin: pa === norm(st.defaultAdminPrep) ? '' : pa,
        details: normDetails(s.details),
      };
      if (s.id) { const i = db.sessions.findIndex((x) => x.id === s.id); if (i < 0) throw fail('That class no longer exists.'); db.sessions[i] = Object.assign({ id: s.id }, rec); }
      else db.sessions.push(Object.assign({ id: rid('s') }, rec));
      save(db); return { ok: true };
    },
    generateWeekends(p) {
      const db = load(); const m = /^(\d{4})-(\d{2})$/.exec(p.month || '');
      if (!m) throw fail('Please choose a month.');
      const days = (p.days || [6, 0]).map(Number);
      if (!days.length) throw fail('Pick at least one day.');
      const have = new Set(db.sessions.map((s) => s.date)); const last = new Date(+m[1], +m[2], 0).getDate(); let added = 0;
      for (let d = 1; d <= last; d++) {
        const date = m[1] + '-' + m[2] + '-' + String(d).padStart(2, '0');
        if (!days.includes(SWC.dow(date)) || have.has(date) || date < SWC.todayISO()) continue;
        db.sessions.push({ id: rid('s'), date, start: '', end: '', topic: String(p.topic || '').trim(), price: '', capacity: '', status: 'open', meetLink: '', prepStudents: '', prepAdmin: '', details: '' }); added++;
      }
      save(db); return { ok: true, added };
    },
    deleteSession(p) {
      const db = load();
      if (db.bookings.some((b) => b.sessionId === p.id)) throw fail('This class has students. Cancel the class instead, or remove the students first.');
      db.sessions = db.sessions.filter((s) => s.id !== p.id); save(db); return { ok: true };
    },
    markPaid(p) {
      const db = load(); const b = db.bookings.find((x) => x.id === p.id);
      if (!b) throw fail('That booking no longer exists.');
      if (b.status === 'confirmed') return { ok: true };
      const row = db.sessions.find((x) => x.id === b.sessionId);
      if (row && !isLive(b)) { const sess = effective(row, db.settings, bookedMap(db)[row.id] || 0); if (sess.booked >= sess.capacity) throw fail('The hold on this seat ran out and the class is full now. Raise the seats or remove someone first.'); }
      b.status = 'confirmed'; b.paidAt = new Date().toISOString().slice(0, 16); b.expires = '';
      save(db); console.info('[demo] would email', b.email, 'the Meet link'); return { ok: true };
    },
    addBooking(p) { const db = load(); const r = createBooking(db, p, true); save(db); return { ok: true, booking: r.booking }; },
    removeBooking(p) { const db = load(); db.bookings = db.bookings.filter((b) => b.id !== p.id); save(db); return { ok: true }; },
    remindNow(p) {
      const db = load(); const s = db.sessions.find((x) => x.id === p.sessionId);
      if (!s) throw fail('That class no longer exists.');
      if (s.status === 'cancelled') throw fail('This class is cancelled.');
      const mine = db.bookings.filter((b) => b.sessionId === s.id && isLive(b)), n = mine.filter((b) => b.status === 'confirmed').length;
      return { ok: true, result: { students: n, pending: mine.length - n, studentEmails: 0, adminEmail: false, adminWhatsApp: false, demo: true } };
    },
    testNotify() { return { ok: true, result: { email: 'demo mode: nothing was sent', whatsapp: 'demo mode: nothing was sent' } }; },
  };

  async function call(action, payload) {
    payload = payload || {};
    if (!demo) return remote(action, payload);
    await new Promise((r) => setTimeout(r, 120)); // feel like a network call
    const fn = demoHandlers[action];
    if (!fn) throw fail('Unknown action');
    return fn(payload);
  }

  window.API = { demo, call, resetDemo() { try { localStorage.removeItem(KEY); } catch (e) {} } };
})();
