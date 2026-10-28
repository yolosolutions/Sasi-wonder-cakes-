// Admin dashboard
(function () {
  const { $, $$, esc, MONTHS, fmtDateShort, fmtDateLong, fmtRange, fmtPrice, lines, monthKey, monthLabel, parts, waLink, prettyPhone, toast } = SWC;
  const TOKEN = 'swc_admin_token';
  const store = {
    get: () => { try { return localStorage.getItem(TOKEN); } catch (e) { return null; } },
    set: (v) => { try { v ? localStorage.setItem(TOKEN, v) : localStorage.removeItem(TOKEN); } catch (e) {} },
  };

  const S = { settings: {}, sessions: [], bookings: [], menu: [], today: SWC.todayISO(), tab: 'classes', showPast: false, open: new Set(), q: '', mq: '' };
  const dlg = $('#dlg');
  if (API.demo) $('#demo-banner').hidden = false;

  // ---------- api ----------
  async function adm(action, payload) {
    try {
      return await API.call(action, Object.assign({ token: store.get() }, payload));
    } catch (e) {
      if (e.code === 'auth') { signOut(); toast('Please sign in again', 'bad'); }
      throw e;
    }
  }
  async function refresh() {
    const d = await adm('adminGet');
    Object.assign(S, { settings: d.settings, sessions: d.sessions, bookings: d.bookings, menu: d.menu || [], today: d.today || SWC.todayISO() });
    $('#adm-name').textContent = (S.settings.siteName || 'Admin') + ' · Admin';
    document.title = 'Admin – ' + (S.settings.siteName || '');
    render();
  }

  // ---------- login ----------
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; setTimeout(() => $('#pw').focus(), 50); }
  function signOut() { store.set(null); showLogin(); }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const go = $('#login-go'); go.disabled = true; go.textContent = 'Signing in…'; $('#login-err').textContent = '';
    try {
      const r = await API.call('login', { password: $('#pw').value });
      store.set(r.token); $('#pw').value = '';
      await refresh(); $('#login').hidden = true; $('#app').hidden = false;
    } catch (err) { $('#login-err').textContent = err.message; }
    go.disabled = false; go.textContent = 'Sign in';
  });
  $('#logout').onclick = signOut;

  // ---------- tabs ----------
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    S.tab = b.dataset.tab; render();
  });
  function render() {
    $$('#nav button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
    $('#view').innerHTML = S.tab === 'classes' ? classesView() : S.tab === 'students' ? studentsView() : S.tab === 'menu' ? menuView() : settingsView();
    if (S.tab === 'settings') bindSettings();
    if (S.tab === 'students') bindStudents();
    if (S.tab === 'menu') bindMenu();
  }

  // ---------- master menu ----------
  const menuGroups = (filter) => {
    const q = (filter || '').trim().toLowerCase(), cats = [];
    S.menu.forEach((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) return;
      let c = cats.find((x) => x.name === m.category);
      if (!c) { c = { name: m.category, items: [] }; cats.push(c); }
      c.items.push(m);
    });
    return cats;
  };
  function menuView() {
    return `<div class="toolbar"><div><h2>Menu</h2><p class="sub" style="margin:0">Your master list of dishes. Pick from it when you build a class. ${S.menu.length} dishes.</p></div>
      <div class="grp"><input class="search" id="mq" type="search" placeholder="Search dishes" value="${esc(S.mq)}" aria-label="Search dishes"><button class="btn sm" data-act="adddish">+ Add dish</button></div></div>
      <div id="menu-groups"></div>`;
  }
  function bindMenu() {
    const draw = () => {
      const cats = menuGroups(S.mq);
      $('#menu-groups').innerHTML = cats.length ? cats.map((c) => `<div class="panel dish-cat"><h3>${esc(c.name)} <span class="chip">${c.items.length}</span></h3>
        <div class="dish-grid">${c.items.map((m) => `<div class="dish"><span>${esc(m.name)}</span><span class="acts"><button class="btn quiet sm" data-act="editdish" data-id="${m.id}" aria-label="Edit ${esc(m.name)}">Edit</button><button class="btn danger sm" data-act="deldish" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">✕</button></span></div>`).join('')}</div></div>`).join('')
        : '<div class="empty">No dishes found. Click <b>+ Add dish</b>.</div>';
    };
    draw();
    $('#mq').addEventListener('input', (e) => { S.mq = e.target.value; draw(); });
  }
  function dishForm(m) {
    const cats = [...new Set(S.menu.map((x) => x.category))];
    openForm(m ? 'Edit dish' : 'Add a dish', `
      <div class="field"><label for="d-cat">Category</label><input id="d-cat" name="category" list="d-cats" value="${esc(m ? m.category : '')}" placeholder="Pick one or type a new category" autocomplete="off" required>
        <datalist id="d-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label for="d-name">Dish name</label><input id="d-name" name="name" value="${esc(m ? m.name : '')}" placeholder="e.g. Walnut Brownie" required></div>
      <p class="sub" style="margin:0 0 12px">It appears in the dropdown when you build a class, under its category.</p>`,
      async (f) => {
        await adm('saveMenuItem', { id: m ? m.id : undefined, category: f.category.value, name: f.name.value });
        await refresh(); toast(m ? 'Dish updated' : 'Dish added', 'ok');
      }, m ? 'Save dish' : 'Add dish');
  }
  const pickerOptions = () => '<option value="">＋ Add a dish from your menu…</option>' +
    menuGroups('').map((c) => `<optgroup label="${esc(c.name)}">${c.items.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</optgroup>`).join('');

  // ---------- classes ----------
  const byClass = () => { const m = {}; S.bookings.forEach((b) => { (m[b.sessionId] = m[b.sessionId] || []).push(b); }); return m; };
  const statusChip = (x) => x.status === 'cancelled' ? '<span class="chip bad">Cancelled</span>' : x.status === 'closed' ? '<span class="chip warn">Closed</span>' : x.booked >= x.capacity ? '<span class="chip bad">Full</span>' : '<span class="chip ok">Open</span>';

  function classesView() {
    const upcoming = S.sessions.filter((x) => x.date >= S.today && x.status !== 'cancelled');
    const ids = new Set(upcoming.map((x) => x.id));
    const students = S.bookings.filter((b) => ids.has(b.sessionId) && b.status !== 'pending').length;
    const unpaid = S.bookings.filter((b) => ids.has(b.sessionId) && b.status === 'pending' && !b.expired).length;
    const next = upcoming[0];
    const list = S.sessions.filter((x) => S.showPast || x.date >= S.today);
    const bc = byClass();

    let html = `<div class="stats">
      <div class="stat"><small>Upcoming classes</small><b>${upcoming.length}</b></div>
      <div class="stat"><small>Confirmed students</small><b>${students}</b></div>
      <div class="stat ${unpaid ? 'attn' : ''}"><small>Awaiting payment</small><b>${unpaid}</b></div>
      <div class="stat"><small>Next class</small><b style="font-size:1.25rem">${next ? esc(fmtDateShort(next.date)) : '–'}</b><small>${next ? next.booked + ' of ' + next.capacity + ' seats' : 'Nothing scheduled'}</small></div>
    </div>
    <div class="toolbar"><h2>Classes</h2><div class="grp">
      <label style="display:flex;gap:6px;align-items:center;font-size:.9rem"><input type="checkbox" id="past" ${S.showPast ? 'checked' : ''}> Show past</label>
      <button class="btn ghost sm" data-act="single">+ Single class</button>
      <button class="btn sm" data-act="weekends">+ Add weekends</button>
    </div></div>`;

    if (!list.length) html += `<div class="empty">No classes yet. Click <b>Add weekends</b> to create a whole month in one go.</div>`;
    let cur = '';
    list.forEach((x) => {
      const mk = monthKey(x.date);
      if (mk !== cur) { cur = mk; html += `<div class="month-h">${esc(monthLabel(mk))}</div>`; }
      html += sessionRow(x, bc[x.id] || []);
    });
    return html;
  }

  function sessionRow(x, studs) {
    const p = parts(x.date), open = S.open.has(x.id);
    const unpaidN = studs.filter((b) => b.status === 'pending' && !b.expired).length;
    const pct = Math.min(100, Math.round((x.booked / x.capacity) * 100));
    const cls = x.booked >= x.capacity ? 'full' : pct >= 70 ? 'mid' : '';
    let body = '';
    if (open) {
      body = `<div class="sess-body">
        ${SWC.parseDetails(x.details).length ? `<div class="menu-list"><b>Class menu: what we're teaching</b>${SWC.detailsHtml(x.details)}</div>` : `<p class="none">No class menu yet. Open <b>Edit</b> and list what you'll teach, point by point.</p>`}
        ${x.meetLink ? `<div class="meet-row"><span class="meet-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v2.2l3.6-2.4c.7-.5 1.4 0 1.4.8v9.8c0 .8-.7 1.3-1.4.8L16 15.3v2.2a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 17.5v-11z"/></svg></span>
          <div class="meet-txt"><b>Google Meet</b><small>${esc(x.meetLink.replace(/^https?:\/\//, ''))}</small></div>
          <div class="meet-acts"><a class="btn sm" href="${esc(x.meetLink)}" target="_blank" rel="noopener">Open</a><button class="btn quiet sm" type="button" data-act="copymeet" data-link="${esc(x.meetLink)}">Copy link</button></div></div>`
          : `<div class="meet-row warn"><span class="chip bad">No Meet link yet</span><div class="meet-txt"><small>Without a link, students can't join. Add one here or in Settings.</small></div><div class="meet-acts"><button class="btn sm" type="button" data-act="edit" data-id="${x.id}">Add link</button></div></div>`}
        <div class="sess-actions">
          <button class="btn sm" data-act="addstu" data-id="${x.id}">+ Add student</button>
          <button class="btn quiet sm" data-act="edit" data-id="${x.id}">Edit</button>
          ${x.status !== 'cancelled' ? `<button class="btn quiet sm" data-act="remind" data-id="${x.id}" title="Emails students the Meet link and prep list, and sends you the class summary">Send class-day alerts now</button>` : ''}
          ${x.status === 'open' ? `<button class="btn quiet sm" data-act="status" data-s="closed" data-id="${x.id}">Close booking</button>` : ''}
          ${x.status !== 'open' ? `<button class="btn quiet sm" data-act="status" data-s="open" data-id="${x.id}">Reopen</button>` : ''}
          ${x.status !== 'cancelled' ? `<button class="btn danger sm" data-act="status" data-s="cancelled" data-id="${x.id}">Cancel class</button>` : ''}
          ${!studs.length ? `<button class="btn danger sm" data-act="delete" data-id="${x.id}">Delete</button>` : `<button class="btn quiet sm" data-act="copy" data-id="${x.id}">Copy list</button>`}
        </div>
        ${studs.length ? studs.map((b) => stuRow(b, x)).join('') : '<div class="none">No students yet.</div>'}
      </div>`;
    }
    return `<div class="sess ${x.date < S.today ? 'past' : ''}">
      <button class="sess-top" data-toggle="${x.id}" aria-expanded="${open}">
        <div class="date-big"><div class="d"><b>${p.d}</b><small>${MONTHS[p.m - 1].slice(0, 3)}</small></div></div>
        <div class="meta"><b>${esc(SWC.fmtDay(x.date))} · ${esc(fmtRange(x.start, x.end))}</b><small>${esc(x.topic || 'No topic set')}${x.price !== '' ? ' · ' + esc(fmtPrice(x.price)) : ''}</small></div>
        <div class="sess-right">${statusChip(x)}<div class="meter ${cls}"><i style="width:${pct}%"></i></div><small style="color:var(--muted)">${x.booked} / ${x.capacity} seats${unpaidN ? ' · ' + unpaidN + ' unpaid' : ''}</small></div>
      </button>${body}</div>`;
  }

  const payChip = (b, x) => b.status === 'pending'
    ? (b.expired ? '<span class="chip bad">Hold expired</span>' : `<span class="chip warn">Unpaid ${esc(fmtPrice(b.amount || x.price))}</span>`)
    : (parseInt(b.amount, 10) > 0 ? '<span class="chip ok">Paid</span>' : '<span class="chip">Free</span>');

  function stuRow(b, x) {
    const prep = lines(x.prepStudents), unpaid = b.status === 'pending', fee = fmtPrice(b.amount || x.price), upi = S.settings.upiId;
    const msg = unpaid
      ? `Hi ${b.name}, this is ${S.settings.siteName}. Your seat for the online baking class on ${fmtDateLong(x.date)} is reserved but not confirmed yet.\n\nPlease pay ${fee}${upi ? ' to UPI ID ' + upi : ''} with the note ${b.code}, then send the screenshot here. We'll send your Meet link as soon as it's confirmed. 🧁`
      : `Hi ${b.name}, this is ${S.settings.siteName}. Your online baking class is on ${fmtDateLong(x.date)}, ${fmtRange(x.start, x.end)}.` +
        (x.meetLink ? `\n\nJoin on Google Meet: ${x.meetLink}` : '') +
        (prep.length ? `\n\nPlease have ready:\n${prep.map((p) => '- ' + p).join('\n')}` : '') + '\n\nSee you there! 🧁';
    return `<div class="stu"><div class="who"><b>${esc(b.name)} ${payChip(b, x)}</b>
      <small>${esc(prettyPhone(b.phone))} · ${esc(b.email)}</small>${b.note ? `<small>📝 ${esc(b.note)}</small>` : ''}</div>
      <div class="acts">${unpaid ? `<button class="btn sm" data-act="markpaid" data-id="${b.id}">Mark paid</button>` : ''}<a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(b.phone, msg, S.settings.countryCode)}">WhatsApp</a>
      <button class="btn danger sm" data-act="rmstu" data-id="${b.id}" aria-label="Remove ${esc(b.name)}">Remove</button></div></div>`;
  }

  // ---------- students ----------
  function studentsView() {
    return `<div class="toolbar"><h2>Students</h2><div class="grp">
      <input class="search" id="q" type="search" placeholder="Search name or phone" value="${esc(S.q)}" aria-label="Search students">
      <button class="btn ghost sm" data-act="csv">Download CSV</button></div></div><div id="stu-table"></div>`;
  }
  function filteredStudents() {
    const q = S.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    const sess = Object.fromEntries(S.sessions.map((x) => [x.id, x]));
    return S.bookings.filter((b) => sess[b.sessionId]).map((b) => ({ b, x: sess[b.sessionId] }))
      .filter(({ b }) => !q || b.name.toLowerCase().includes(q) || (qd && b.phone.includes(qd)) || b.code.toLowerCase().includes(q))
      .sort((a, c) => (c.x.date + c.b.createdAt).localeCompare(a.x.date + a.b.createdAt));
  }
  function bindStudents() {
    const draw = () => {
      const rows = filteredStudents();
      $('#stu-table').innerHTML = rows.length ? `<table class="tbl stack-sm"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Class</th><th>Payment</th><th>Note</th></tr></thead><tbody>` +
        rows.map(({ b, x }) => `<tr><td><b>${esc(b.name)}</b><br><small style="color:var(--muted)">${esc(b.code)}</small></td>
          <td><a href="${waLink(b.phone, '', S.settings.countryCode)}" target="_blank" rel="noopener">${esc(prettyPhone(b.phone))}</a></td>
          <td>${esc(b.email)}</td>
          <td>${esc(fmtDateShort(x.date))}${x.date < S.today ? ' <span class="chip">past</span>' : ''}</td><td>${payChip(b, x)}</td><td>${esc(b.note)}</td></tr>`).join('') + '</tbody></table>'
        : '<div class="empty">No students found.</div>';
    };
    draw();
    $('#q').addEventListener('input', (e) => { S.q = e.target.value; draw(); });
  }
  const csvCell = (v) => { v = String(v == null ? '' : v); if (/^[=@\t\r]/.test(v) || /^[+-]\D/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  function downloadCsv() {
    const sess = Object.fromEntries(S.sessions.map((x) => [x.id, x]));
    const rows = [['Class date', 'Time', 'Topic', 'Name', 'Phone', 'Email', 'Payment', 'Amount', 'Paid on', 'Note', 'Reference', 'Booked on']];
    S.bookings.filter((b) => sess[b.sessionId]).sort((a, c) => sess[a.sessionId].date.localeCompare(sess[c.sessionId].date)).forEach((b) => {
      const x = sess[b.sessionId];
      rows.push([x.date, fmtRange(x.start, x.end), x.topic, b.name, '+' + b.phone, b.email, b.status === 'pending' ? (b.expired ? 'Hold expired' : 'Unpaid') : (parseInt(b.amount, 10) > 0 ? 'Paid' : 'Free'), b.amount || '', (b.paidAt || '').replace('T', ' '), b.note, b.code, (b.createdAt || '').replace('T', ' ')]);
    });
    const blob = new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'students-' + S.today + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- settings ----------
  function settingsView() {
    const s = S.settings;
    return `<div class="toolbar"><h2>Settings</h2></div>
    <form id="sf">
      <div class="panel"><h3>Where you get notified</h3>
        <p class="sub">You can change these any time. New bookings are sent here, and students message this WhatsApp number.</p>
        <div class="row2">
          <div class="field"><label for="s-wa">WhatsApp number</label><input id="s-wa" name="whatsappNumber" type="tel" value="${esc(s.whatsappNumber)}" placeholder="98765 43210"><span class="hint">Shown on the website for students to message.</span></div>
          <div class="field"><label for="s-mail">Email for booking alerts</label><input id="s-mail" name="notifyEmail" type="text" value="${esc(s.notifyEmail)}" placeholder="you@gmail.com"><span class="hint">Separate several with commas.</span></div>
        </div>
        <div class="field"><label for="s-key">Automatic WhatsApp alerts key <span style="font-weight:400;color:var(--muted)">(optional)</span></label><input id="s-key" name="callmebotKey" type="text" value="${esc(s.callmebotKey)}" autocomplete="off"><span class="hint">Free, via CallMeBot: <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noopener">get your key here</a>. Leave empty to rely on email only.</span></div>
        <button class="btn quiet sm" type="button" data-act="testnotify">Send a test alert</button> <span class="hint" id="test-out"></span>
      </div>
      <div class="panel"><h3>Payments (UPI)</h3>
        <p class="sub">Students pay your UPI ID with GPay, PhonePe or Paytm. You see the money arrive in your own UPI app, then tap <b>Mark paid</b> on that student. Only then do they get the Meet link.</p>
        <div class="row2">
          <div class="field"><label for="s-upi">Your UPI ID</label><input id="s-upi" name="upiId" value="${esc(s.upiId)}" placeholder="yourname@oksbi" autocapitalize="off" autocomplete="off" spellcheck="false"><span class="hint">In GPay: tap your photo, then the UPI IDs under your bank account.</span></div>
          <div class="field"><label for="s-upin">Name shown in the UPI app</label><input id="s-upin" name="upiName" value="${esc(s.upiName)}" placeholder="${esc(s.siteName)}"><span class="hint">Leave empty to use your site name.</span></div>
        </div>
        <div class="field"><label for="s-hold">Hold an unpaid seat for (hours)</label><input id="s-hold" name="holdHours" type="number" min="0" max="720" value="${esc(s.holdHours)}"><span class="hint">After this time an unpaid booking stops blocking the seat. 0 holds it until you remove it.</span></div>
        <div class="upi-test"><div id="upi-qr" class="qr"></div><p class="hint">Test it: scan this QR with GPay on your phone. It should open a payment to you, showing the name above.</p></div>
      </div>
      <div class="panel"><h3>Class defaults</h3>
        <p class="sub">Classes that use the default follow it automatically, so changing the time, price or Meet link here updates the website everywhere. You can still override any single class.</p>
        <div class="row2">
          <div class="field"><label for="s-st">Start time</label><input id="s-st" name="defaultStart" type="time" value="${esc(s.defaultStart)}" required></div>
          <div class="field"><label for="s-en">End time</label><input id="s-en" name="defaultEnd" type="time" value="${esc(s.defaultEnd)}" required></div>
        </div>
        <div class="row2">
          <div class="field"><label for="s-cap">Seats per class</label><input id="s-cap" name="defaultCapacity" type="number" min="1" max="200" value="${esc(s.defaultCapacity)}"></div>
          <div class="field"><label for="s-pr">Price per student (₹)</label><input id="s-pr" name="price" type="number" inputmode="numeric" min="0" step="1" value="${esc(s.price)}" placeholder="1500"><span class="hint">Whole rupees. Enter 0 for a free class.</span></div>
        </div>
        <div class="field"><label for="s-meet">Google Meet link</label><input id="s-meet" name="meetLink" type="url" value="${esc(s.meetLink)}" placeholder="https://meet.google.com/abc-defg-hij"><span class="hint">Only students who book receive it. <a href="https://meet.google.com/new" target="_blank" rel="noopener">Create a Meet link</a>, then paste it here. Give a single class its own link under Edit.</span></div>
      </div>
      <div class="panel"><h3>Class-day notifications</h3>
        <p class="sub">On the morning of each class (7 AM), students get the Meet link and what to keep ready, and you get the full run-down: class details, Meet link, your checklist and the attendee list. One item per line.</p>
        <div class="field"><label for="s-ps">Students should have ready</label><textarea id="s-ps" name="defaultStudentPrep" rows="5">${esc(s.defaultStudentPrep)}</textarea><span class="hint">Also included in the booking confirmation email. Override per class under Edit.</span></div>
        <div class="field"><label for="s-pa">Your checklist before class</label><textarea id="s-pa" name="defaultAdminPrep" rows="5">${esc(s.defaultAdminPrep)}</textarea></div>
        <div class="field"><label for="s-rem">Automatic class-day notifications</label><select id="s-rem" name="sendReminders"><option value="yes" ${s.sendReminders !== 'no' ? 'selected' : ''}>On</option><option value="no" ${s.sendReminders === 'no' ? 'selected' : ''}>Off</option></select><span class="hint">Needs the one-time reminder setup in SETUP.md. You can also send them any time with "Send class-day alerts now" on a class.</span></div>
      </div>
      <div class="panel"><h3>Terms &amp; cancellation</h3>
        <p class="sub">Students must tick a box to accept this when they book. One point per line. It also appears on the Privacy &amp; terms page. <b>This is a starting draft, so please edit it to match your real policy.</b></p>
        <div class="field"><textarea name="policyText" rows="6" aria-label="Terms and cancellation, one point per line">${esc(s.policyText)}</textarea></div>
      </div>
      <div class="panel"><h3>Website text</h3>
        <div class="row2">
          <div class="field"><label for="s-nm">Name</label><input id="s-nm" name="siteName" value="${esc(s.siteName)}"></div>
          <div class="field"><label for="s-tg">Tagline</label><input id="s-tg" name="tagline" value="${esc(s.tagline)}"></div>
        </div>
        <div class="field"><label for="s-ig">Instagram username</label><input id="s-ig" name="instagram" value="${esc(s.instagram)}" placeholder="sasi_wonder_cakes"><span class="hint">Shown as a link in the website footer. Leave empty to hide.</span></div>
        <div class="field"><label for="s-ab">About the class</label><textarea id="s-ab" name="about" rows="4">${esc(s.about)}</textarea></div>
      </div>
      <div class="savebar"><button class="btn" type="submit" id="save-s">Save settings</button><span class="hint" id="save-out"></span></div>
    </form>
    <form id="pf" class="panel"><h3>Change password</h3><p class="sub"></p>
      <div class="row2"><div class="field"><label for="p-cur">Current password</label><input id="p-cur" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="p-new">New password</label><input id="p-new" type="password" autocomplete="new-password" minlength="6" required></div></div>
      <div class="err" id="p-err" role="alert"></div><button class="btn quiet sm" type="submit">Change password</button></form>`;
  }
  function bindSettings() {
    const drawQr = () => {
      const f = $('#sf'), id = f.upiId.value.trim();
      $('#upi-qr').innerHTML = /^[\w.-]{2,64}@[A-Za-z][A-Za-z0-9]{1,30}$/.test(id)
        ? SWC.qrSvg('upi://pay?pa=' + id + '&pn=' + encodeURIComponent(f.upiName.value.trim() || S.settings.siteName) + '&cu=INR')
        : '<small>Enter your UPI ID to see a test QR.</small>';
    };
    ['upiId', 'upiName'].forEach((n) => $('#sf')[n].addEventListener('input', drawQr));
    drawQr();
    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, data = {};
      ['whatsappNumber', 'notifyEmail', 'callmebotKey', 'defaultStart', 'defaultEnd', 'defaultCapacity', 'price', 'meetLink', 'upiId', 'upiName', 'holdHours', 'defaultStudentPrep', 'defaultAdminPrep', 'sendReminders', 'siteName', 'tagline', 'instagram', 'about', 'policyText'].forEach((k) => { data[k] = f[k].value; });
      const b = $('#save-s'); b.disabled = true; b.textContent = 'Saving…';
      try { await adm('saveSettings', { settings: data }); await refresh(); toast('Settings saved', 'ok'); }
      catch (err) { toast(err.message, 'bad'); b.disabled = false; b.textContent = 'Save settings'; }
    });
    $('#pf').addEventListener('submit', async (e) => {
      e.preventDefault(); $('#p-err').textContent = '';
      try { await adm('changePassword', { current: $('#p-cur').value, next: $('#p-new').value }); e.target.reset(); toast('Password changed', 'ok'); }
      catch (err) { $('#p-err').textContent = err.message; }
    });
  }

  // ---------- dialogs ----------
  function openForm(title, html, onSubmit, submitLabel) {
    $('#dlg-title').textContent = title;
    $('#dlg-body').innerHTML = `<form id="df" novalidate>${html}<div class="err" id="fe" role="alert"></div><button class="btn block" type="submit" id="fgo">${submitLabel || 'Save'}</button></form>`;
    dlg.showModal();
    $('#df').addEventListener('submit', async (e) => {
      e.preventDefault(); const go = $('#fgo'), label = go.textContent; go.disabled = true; go.textContent = 'Saving…'; $('#fe').textContent = '';
      try { await onSubmit(e.target); dlg.close(); }
      catch (err) { $('#fe').textContent = err.message; go.disabled = false; go.textContent = label; }
    });
  }
  $('#dlg-x').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  function sessionForm(x) {
    const s = S.settings, edit = !!x;
    x = x || { date: '', start: s.defaultStart, end: s.defaultEnd, topic: '', price: s.price, capacity: s.defaultCapacity, status: 'open', meetLink: s.meetLink, prepStudents: s.defaultStudentPrep, prepAdmin: s.defaultAdminPrep, details: '' };
    openForm(edit ? 'Edit class' : 'Add a class', `
      <div class="field"><label for="x-date">Date</label><input id="x-date" name="date" type="date" value="${esc(x.date)}" required></div>
      <div class="row2"><div class="field"><label for="x-st">Start</label><input id="x-st" name="start" type="time" value="${esc(x.start)}" required></div>
      <div class="field"><label for="x-en">End</label><input id="x-en" name="end" type="time" value="${esc(x.end)}" required></div></div>
      <div class="row2"><div class="field"><label for="x-cap">Seats</label><input id="x-cap" name="capacity" type="number" min="1" value="${esc(x.capacity)}"></div>
      <div class="field"><label for="x-pr">Price per student (₹)</label><input id="x-pr" name="price" type="number" inputmode="numeric" min="0" step="1" value="${esc(x.price)}"></div></div>
      <div class="field"><label for="x-tp">Topic / what we're baking</label><input id="x-tp" name="topic" value="${esc(x.topic)}" placeholder="Eggless chocolate cake"></div>
      <div class="field"><label for="x-pick">Dishes in this class</label>
        <select id="x-pick">${pickerOptions()}</select>
        <div class="dish-chips" id="x-chips" aria-live="polite"></div>
        <div class="add-custom"><input id="x-custom" placeholder="Or type your own point, e.g. Tips for a crinkle top" aria-label="Add your own point"><button class="btn quiet sm" type="button" data-act="addcustom">Add</button></div>
        <details class="adv"><summary>Edit as text</summary>
          <textarea id="x-det" name="details" rows="8" aria-label="Dishes and points, one per line">${esc(x.details)}</textarea>
          <span class="hint">One point per line. A line starting with <b>#</b> is a section title.</span></details>
        <span class="hint">Choosing a dish adds it under its category; tap <b>×</b> on a dish to remove it. Missing a dish? Add it on the <b>Menu</b> page. Students see this list on the website and in their email. <button class="btn quiet sm" type="button" data-act="brownie">Use brownie class example</button></span></div>
      <div class="field"><label for="x-meet">Google Meet link</label><input id="x-meet" name="meetLink" type="url" value="${esc(x.meetLink)}" placeholder="https://meet.google.com/abc-defg-hij"></div>
      <div class="field"><label for="x-ps">Students should have ready <span style="font-weight:400;color:var(--muted)">(one per line, e.g. this class's ingredients)</span></label><textarea id="x-ps" name="prepStudents" rows="5">${esc(x.prepStudents)}</textarea></div>
      <div class="field"><label for="x-pa">Your checklist before class</label><textarea id="x-pa" name="prepAdmin" rows="4">${esc(x.prepAdmin)}</textarea></div>
      <div class="field"><label for="x-status">Status</label><select id="x-status" name="status">
        ${['open', 'closed', 'cancelled'].map((v) => `<option value="${v}" ${x.status === v ? 'selected' : ''}>${{ open: 'Open for booking', closed: 'Booking closed', cancelled: 'Cancelled' }[v]}</option>`).join('')}</select></div>`,
      async (f) => {
        await adm('saveSession', { session: { id: edit ? x.id : undefined, date: f.date.value, start: f.start.value, end: f.end.value, capacity: f.capacity.value, price: f.price.value, topic: f.topic.value, status: f.status.value, meetLink: f.meetLink.value, prepStudents: f.prepStudents.value, prepAdmin: f.prepAdmin.value, details: f.details.value } });
        await refresh(); toast('Class saved', 'ok');
      });
    renderChips();
    $('#x-det').addEventListener('input', renderChips);
    $('#x-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }); // Enter must not save the whole class
  }

  // the dishes of the class being edited, as removable chips grouped by category (the textarea stays the source of truth)
  function renderChips() {
    const ta = $('#x-det'), box = $('#x-chips');
    if (!ta || !box) return;
    const groups = SWC.parseDetails(ta.value);
    box.innerHTML = groups.length
      ? groups.map((g, gi) => `<div class="dc-group">${g.title ? `<div class="dc-title">${esc(g.title)}</div>` : ''}<div class="dc-list">${g.items.map((it, ii) =>
        `<span class="dc-chip">${esc(it)}<button type="button" data-act="rmdish" data-g="${gi}" data-i="${ii}" aria-label="Remove ${esc(it)}">×</button></span>`).join('')}</div></div>`).join('') +
        '<button type="button" class="btn quiet sm" data-act="clearall">Clear all</button>'
      : '<p class="none">No dishes yet. Choose one from the dropdown above.</p>';
  }
  function addCustom() {
    const inp = $('#x-custom'), ta = $('#x-det'), v = inp.value.trim();
    if (!v) return;
    const next = SWC.addDishToDetails(ta.value, 'Also covered', v);
    if (next === null) { toast('"' + v + '" is already in this class'); return; }
    ta.value = next; inp.value = ''; renderChips();
  }

  function weekendsForm() {
    const now = new Date(), opts = [];
    for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); opts.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
    openForm('Add weekends', `
      <p class="sub">Creates a class on every chosen day of the month. Days that already have a class are skipped.</p>
      <div class="field"><label for="w-m">Month</label><select id="w-m" name="month">${opts.map((m) => `<option value="${m}">${esc(monthLabel(m))}</option>`).join('')}</select></div>
      <div class="field"><span class="lbl">Days</span><div class="checks"><label><input type="checkbox" name="d" value="6" checked> Saturday</label><label><input type="checkbox" name="d" value="0"> Sunday</label></div></div>
      <div class="field"><label for="w-t">Topic <span style="font-weight:400;color:var(--muted)">(optional, you can edit each later)</span></label><input id="w-t" name="topic"></div>
      <div class="preview" id="w-prev"></div>`,
      async (f) => {
        const days = $$('input[name=d]:checked', f).map((c) => +c.value);
        const r = await adm('generateWeekends', { month: f.month.value, days, topic: f.topic.value });
        S.showPast = false; await refresh(); toast(r.added ? r.added + ' classes added' : 'Nothing new to add', r.added ? 'ok' : '');
      }, 'Add classes');
    const prev = () => {
      const f = $('#df'), m = f.month.value, days = $$('input[name=d]:checked', f).map((c) => +c.value);
      const have = new Set(S.sessions.map((x) => x.date)), last = new Date(+m.slice(0, 4), +m.slice(5), 0).getDate(), out = [];
      for (let d = 1; d <= last; d++) {
        const iso = m + '-' + String(d).padStart(2, '0');
        if (days.includes(SWC.dow(iso)) && !have.has(iso) && iso >= S.today) out.push(fmtDateShort(iso));
      }
      $('#w-prev').textContent = out.length ? `Will add ${out.length}: ${out.join(', ')}` : 'Nothing new to add for this selection.';
    };
    $('#df').addEventListener('change', prev); prev();
  }

  function studentForm(x) {
    openForm('Add a student', `
      <p class="sub"><b>${esc(fmtDateLong(x.date))}</b>, ${esc(fmtRange(x.start, x.end))}. ${x.capacity - x.booked} seats left.</p>
      <div class="field"><label for="a-n">Name</label><input id="a-n" name="name" required></div>
      <div class="field"><label for="a-p">WhatsApp number</label><input id="a-p" name="phone" type="tel" required></div>
      <div class="field"><label for="a-e">Email</label><input id="a-e" name="email" type="email" required></div>
      <div class="field"><label for="a-nt">Note (optional)</label><input id="a-nt" name="note"></div>`,
      async (f) => {
        await adm('addBooking', { sessionId: x.id, name: f.name.value, phone: f.phone.value, email: f.email.value, note: f.note.value });
        await refresh(); toast('Student added', 'ok');
      }, 'Add student');
  }

  // copy to clipboard; falls back to a hidden textarea where the clipboard API is blocked
  async function copyText(text, doneMsg) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    toast(ok ? doneMsg : 'Could not copy automatically. Please select and copy it by hand.', ok ? 'ok' : 'bad');
  }

  // ---------- clicks ----------
  document.addEventListener('click', async (e) => {
    if (!$('#app') || $('#app').hidden) return;
    const t = e.target.closest('[data-toggle],[data-act]'); if (!t) return;
    const id = t.dataset.id, x = S.sessions.find((s) => s.id === id);
    if (t.dataset.toggle) { const k = t.dataset.toggle; S.open.has(k) ? S.open.delete(k) : S.open.add(k); render(); return; }
    try {
      switch (t.dataset.act) {
        case 'brownie': { const f = $('#df'); if (f.topic.value.trim() && !confirm('Replace the topic and the point-by-point list with the brownie example?')) return; f.topic.value = SWC.BROWNIE.topic; f.details.value = SWC.BROWNIE.details; renderChips(); break; }
        case 'rmdish': {
          const ta = $('#x-det'), groups = SWC.parseDetails(ta.value), g = groups[+t.dataset.g];
          if (g) { const [gone] = g.items.splice(+t.dataset.i, 1); ta.value = SWC.detailsToText(groups); renderChips(); toast('Removed ' + gone); }
          break;
        }
        case 'clearall': { const ta = $('#x-det'); if (ta.value.trim() && confirm('Remove all dishes from this class?')) { ta.value = ''; renderChips(); } break; }
        case 'addcustom': addCustom(); break;
        case 'markpaid': {
          const b = S.bookings.find((q) => q.id === id); t.disabled = true;
          try { await adm('markPaid', { id }); } finally { t.disabled = false; }
          await refresh(); toast(API.demo ? 'Marked paid (demo: no email sent)' : 'Marked paid. ' + b.name + ' has been emailed the Meet link', 'ok'); break;
        }
        case 'copymeet': await copyText(t.dataset.link, 'Meet link copied'); break;
        case 'adddish': dishForm(); break;
        case 'editdish': dishForm(S.menu.find((m) => m.id === id)); break;
        case 'deldish': {
          const m = S.menu.find((q) => q.id === id);
          if (confirm(`Remove "${m.name}" from the menu list?\nClasses that already include it keep it.`)) { await adm('deleteMenuItem', { id }); await refresh(); toast('Dish removed'); }
          break;
        }
        case 'weekends': weekendsForm(); break;
        case 'single': sessionForm(); break;
        case 'edit': sessionForm(x); break;
        case 'addstu': studentForm(x); break;
        case 'csv': downloadCsv(); break;
        case 'status': {
          if (t.dataset.s === 'cancelled' && !confirm('Cancel this class? Students will see it as cancelled, so message them on WhatsApp.')) return;
          await adm('saveSession', { session: Object.assign({}, x, { status: t.dataset.s }) }); await refresh(); toast('Updated', 'ok'); break;
        }
        case 'delete': if (confirm('Delete this class?')) { await adm('deleteSession', { id }); await refresh(); toast('Class deleted'); } break;
        case 'rmstu': {
          const b = S.bookings.find((q) => q.id === id);
          if (confirm('Remove ' + b.name + ' from this class?')) { await adm('removeBooking', { id }); await refresh(); toast('Student removed'); }
          break;
        }
        case 'remind': {
          const mine = S.bookings.filter((b) => b.sessionId === id && !b.expired), n = mine.filter((b) => b.status !== 'pending').length, u = mine.length - n;
          if (!confirm(`Email the Meet link and prep list to ${n} paid student${n === 1 ? '' : 's'}${u ? ` (${u} unpaid will not get it)` : ''}, and send yourself the class summary?`)) return;
          t.disabled = true;
          const r = (await adm('remindNow', { sessionId: id })).result; t.disabled = false;
          toast(r.demo ? 'Demo mode: nothing was sent' : `Sent to ${r.studentEmails} of ${r.students} paid students${r.pending ? ` (${r.pending} unpaid skipped)` : ''}. Your summary: email ${r.adminEmail ? 'sent' : 'not sent'}${r.adminWhatsApp ? ', WhatsApp sent' : ''}`, r.demo || r.adminEmail || r.studentEmails ? 'ok' : 'bad');
          break;
        }
        case 'copy': {
          const list = S.bookings.filter((b) => b.sessionId === id).map((b, i) => `${i + 1}. ${b.name} ${prettyPhone(b.phone)} ${b.email}${b.note ? ' - ' + b.note : ''}`).join('\n');
          await copyText(fmtDateLong(x.date) + '\n' + list, 'List copied'); break;
        }
        case 'testnotify': {
          const out = $('#test-out'); out.textContent = 'Sending…';
          // test uses the saved settings, so ask the admin to save first if the form was edited
          const r = await adm('testNotify'); out.textContent = 'Email: ' + r.result.email + ' · WhatsApp: ' + r.result.whatsapp; break;
        }
      }
    } catch (err) { if (err.code !== 'auth') toast(err.message, 'bad'); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'past') { S.showPast = e.target.checked; render(); }
    if (e.target.id === 'x-pick' && e.target.value) {
      const m = S.menu.find((q) => q.id === e.target.value); e.target.value = '';
      const ta = $('#x-det'), next = m && SWC.addDishToDetails(ta.value, m.category, m.name);
      if (m && next === null) toast(m.name + ' is already in this class');
      else if (m) { ta.value = next; renderChips(); toast('Added ' + m.name, 'ok'); }
    }
  });

  // ---------- boot ----------
  (async function boot() {
    if (!store.get()) return showLogin();
    try { await refresh(); $('#app').hidden = false; }
    catch (e) { if (e.code !== 'auth') { showLogin(); $('#login-err').textContent = e.message; } }
  })();
})();
