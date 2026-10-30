// Small helpers shared by the public site and the admin dashboard.
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // dates are plain "YYYY-MM-DD" strings, never Date-with-timezone, so nothing shifts by a day.
  const parts = (iso) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) });
  const dow = (iso) => { const p = parts(iso); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); };
  const monthKey = (iso) => iso.slice(0, 7);
  const monthLabel = (key) => MONTHS[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4);
  const fmtDay = (iso) => DAYS[dow(iso)];
  const fmtDateShort = (iso) => DAYS[dow(iso)].slice(0, 3) + ' ' + parts(iso).d + ' ' + MONTHS[parts(iso).m - 1].slice(0, 3);
  const fmtDateLong = (iso) => fmtDay(iso) + ', ' + parts(iso).d + ' ' + MONTHS[parts(iso).m - 1] + ' ' + parts(iso).y;
  const fmtTime = (t) => {
    if (!t) return '';
    const h = +t.slice(0, 2), m = t.slice(3, 5);
    return (h % 12 || 12) + (m === '00' ? '' : ':' + m) + ' ' + (h < 12 ? 'AM' : 'PM');
  };
  const fmtRange = (s, e) => {
    const a = fmtTime(s), b = fmtTime(e);
    // "2 - 4 PM" when both share AM/PM
    return a.slice(-2) === b.slice(-2) ? a.slice(0, -3) + ' – ' + b : a + ' – ' + b;
  };
  const todayISO = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // price is stored as a whole number of rupees ("1500"); blank = not set, 0 = free. Indian digit grouping.
  const fmtPrice = (p) => {
    if (p === '' || p == null) return '';
    const n = parseInt(p, 10);
    if (!n) return 'Free';
    const s = String(n), head = s.slice(0, -3), tail = s.slice(-3);
    return '₹' + (head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + tail;
  };
  const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

  // A class's "what you'll learn": a line starting with # is a section title, every other line is a bullet.
  const parseDetails = (t) => {
    const out = []; let cur = null;
    String(t || '').split('\n').map((s) => s.trim().replace(/^[-•*]\s+/, '')).filter(Boolean).forEach((line) => {
      const m = /^#+\s*(.*)$/.exec(line);
      if (m) { cur = { title: m[1], items: [] }; out.push(cur); return; }
      if (!cur) { cur = { title: '', items: [] }; out.push(cur); }
      cur.items.push(line);
    });
    return out;
  };
  const detailsHtml = (t) => parseDetails(t).map((g) =>
    (g.title ? '<h4>' + esc(g.title) + '</h4>' : '') + '<ul>' + g.items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul>').join('');

  // Starter content for the first class. Used by the demo data and the "Use brownie example" button.
  const BROWNIE = {
    topic: 'Brownies: egg & eggless',
    details: ['# Recipes', 'Egg-based brownie', 'Eggless brownie',
      '# Flavours & variations', 'Double chocolate', 'Triple chocolate', 'Nuts', 'Nutella', 'Biscoff', 'Oreo', 'Kitkat', 'Walnut',
      '# Complementary recipes', 'Dark chocolate ganache', 'Milk chocolate ganache', 'White chocolate ganache', 'Caramel'].join('\n'),
  };

  // Insert a dish under its category title in a class's details text. Returns null if it is already listed.
  const detailsToText = (groups) => groups.filter((g) => g.items.length).map((g) => (g.title ? '# ' + g.title + '\n' : '') + g.items.join('\n')).join('\n');
  const addDishToDetails = (text, category, name) => {
    const groups = parseDetails(text);
    const g = groups.find((x) => x.title.toLowerCase() === category.toLowerCase());
    if (g && g.items.some((i) => i.toLowerCase() === name.toLowerCase())) return null;
    if (g) g.items.push(name); else groups.push({ title: category, items: [name] });
    return detailsToText(groups);
  };

  // Starter master list (from the Sasi Wonder Cakes menu PDF). worker/index.mjs has the same list as MENU_SEED.
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

  // QR code (SVG) of any text, e.g. a UPI payment link. Library: js/vendor/qrcode.min.js
  const qrSvg = (text) => {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { return ''; }
  };

  // phone numbers: keep digits, add the default country code to 10-digit numbers
  const waNumber = (n, cc) => {
    let d = String(n || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    if (d.length === 10) d = (cc || '91') + d;
    return d;
  };
  const waLink = (number, text, cc) => {
    const n = waNumber(number, cc);
    return n ? 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '') : '';
  };
  const prettyPhone = (n) => {
    const d = String(n || '').replace(/\D/g, '');
    return d.length === 12 && d.startsWith('91') ? '+91 ' + d.slice(2, 7) + ' ' + d.slice(7) : d ? '+' + d : '';
  };

  // ---------- messages ----------
  // Cards that stack, stay long enough to read (longer text stays longer, errors longest), pause while the mouse or a
  // finger is on them, and close with the x. The countdown is a CSS animation on the thin bar, so there are no timers.
  function toast(msg, kind) {
    kind = kind === 'ok' || kind === 'bad' ? kind : 'info';
    msg = String(msg || '');
    let box = $('#toasts');
    if (!box) {
      box = document.createElement('div'); box.id = 'toasts';
      box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-relevant', 'additions');
      document.body.appendChild(box);
    }
    // A modal window sits above everything else on the page, so while one is open the cards are shown inside it.
    // There it is a banner at the top of the window (it pushes the content down instead of covering it).
    const host = Array.from(document.querySelectorAll('dialog[open]')).pop() || document.body;
    const inWindow = host !== document.body;
    box.classList.toggle('in-window', inWindow);
    if (box.parentNode !== host) { if (inWindow) host.insertBefore(box, host.firstChild); else host.appendChild(box); }
    const ms = Math.min(16000, Math.max(kind === 'bad' ? 8000 : 5000, 3500 + msg.length * (kind === 'bad' ? 90 : 65)));
    const same = Array.from(box.children).find((t) => t.dataset.msg === msg && t.dataset.kind === kind && !t.classList.contains('out'));
    if (same) { // the same message again: keep one card and start its countdown over
      const bar = same.querySelector('.bar');
      bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; bar.style.animationDuration = ms + 'ms';
      return;
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.dataset.msg = msg; el.dataset.kind = kind;
    el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    el.innerHTML = '<span class="ti" aria-hidden="true">' + (kind === 'ok' ? '✓' : kind === 'bad' ? '!' : 'i') + '</span><span class="tx"></span>' +
      '<button type="button" aria-label="Dismiss message">×</button><i class="bar" style="animation-duration:' + ms + 'ms"></i>';
    el.querySelector('.tx').textContent = msg;
    const close = () => { if (el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    el.querySelector('button').onclick = close;
    el.querySelector('.bar').addEventListener('animationend', close);
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
  }

  // when a window closes, the cards it was holding go back to the page so they are not lost with it
  document.addEventListener('close', (e) => { const b = $('#toasts'); if (b && e.target.contains && e.target.contains(b)) { b.classList.remove('in-window'); document.body.appendChild(b); } }, true);

  // A proper question box instead of the browser's plain one. Resolves to true (yes) or false (no / Esc / click outside).
  // opts: { title, text, yes, no, danger }  (danger = the yes button is red and "no" is the focused, safe choice)
  function ask(opts) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog'); d.className = 'ask'; d.setAttribute('aria-labelledby', 'ask-t');
      d.innerHTML = '<div class="ask-body"><h2 id="ask-t"></h2><p class="ask-text"></p><div class="ask-row">' +
        '<button type="button" class="btn quiet" data-v="0"></button><button type="button" class="btn' + (opts.danger ? ' bad' : '') + '" data-v="1"></button></div></div>';
      d.querySelector('h2').textContent = opts.title || 'Are you sure?';
      const p = d.querySelector('.ask-text'); if (opts.text) p.textContent = opts.text; else p.remove();
      d.querySelector('[data-v="0"]').textContent = opts.no || 'Cancel';
      d.querySelector('[data-v="1"]').textContent = opts.yes || 'Yes';
      let done = false;
      const finish = (v) => { if (done) return; done = true; d.close(); d.remove(); resolve(v); };
      d.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) finish(b.dataset.v === '1'); else if (e.target === d) finish(false); });
      d.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
      document.body.appendChild(d); d.showModal();
      d.querySelector(opts.danger ? '[data-v="0"]' : '[data-v="1"]').focus();
    });
  }

  window.SWC = { $, $$, esc, MONTHS, parts, dow, monthKey, monthLabel, fmtDay, fmtDateShort, fmtDateLong, fmtTime, fmtRange, fmtPrice, lines, parseDetails, detailsHtml, detailsToText, addDishToDetails, qrSvg, MENU_SEED, BROWNIE, todayISO, waNumber, waLink, prettyPhone, toast, ask };
})();
