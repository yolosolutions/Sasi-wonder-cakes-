// Public booking page
(function () {
  const { $, esc, fmtDateLong, fmtRange, fmtPrice, monthKey, monthLabel, parts, waLink } = SWC;
  const CACHE = 'swc_pub_cache_v4';

  const state = { settings: {}, sessions: [], month: null };
  const dlg = $('#dlg');

  if (API.demo) $('#demo-banner').hidden = false;

  // ---------- load ----------
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE)); } catch (e) { return null; } }
  function writeCache(d) { try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch (e) {} }

  async function load(silent) {
    try {
      const d = await API.call('getPublic');
      state.settings = d.settings; state.sessions = d.sessions;
      writeCache({ settings: d.settings, sessions: d.sessions });
      render();
    } catch (e) {
      if (!silent || !state.sessions.length) {
        $('#cards').innerHTML = '<div class="empty" style="grid-column:1/-1">' + esc(e.message) + '<br><br><button class="btn ghost sm" id="retry">Try again</button></div>';
        $('#retry').onclick = () => load();
      }
    }
  }

  // ---------- render ----------
  function render() {
    const s = state.settings;
    document.title = (s.siteName || 'Baking Classes') + ' – Live Online Baking Classes from Pondicherry';
    $('#brand-name').textContent = s.siteName || '';
    $('#foot-name').textContent = s.siteName || '';
    $('#tagline').textContent = s.tagline || '';
    $('#fact-time').textContent = fmtRange(s.defaultStart, s.defaultEnd);
    const hasPrice = s.price !== '' && s.price != null;
    $('#fact-price-row').hidden = !hasPrice;
    $('#fact-price').textContent = hasPrice ? fmtPrice(s.price) + (parseInt(s.price, 10) > 0 ? ' per student' : '') : '';
    $('#about-sec').hidden = !s.about; $('#about').textContent = s.about || '';
    const wa = waLink(s.whatsappNumber, 'Hi! I have a question about the baking class.', s.countryCode);
    ['#hero-wa', '#about-wa', '#foot-wa'].forEach((id) => { $(id).hidden = !wa; if (wa) $(id).href = wa; });
    const ig = String(s.instagram || '').replace(/^@/, '').replace(/[^\w.]/g, '');
    ['#about-ig', '#foot-ig'].forEach((id) => { $(id).hidden = !ig; if (ig) $(id).href = 'https://instagram.com/' + ig; });

    const months = [...new Set(state.sessions.map((x) => monthKey(x.date)))];
    if (!months.includes(state.month)) state.month = months[0] || null;
    $('#months').innerHTML = months.map((m) =>
      '<button class="tab" role="tab" data-m="' + m + '" aria-selected="' + (m === state.month) + '">' + esc(monthLabel(m)) + '</button>').join('');
    $('#months').hidden = months.length < 2;
    renderCards();
  }

  function seatsInfo(x) {
    const left = Math.max(0, x.capacity - x.booked);
    const pct = Math.min(100, Math.round((x.booked / x.capacity) * 100));
    return { left, pct, cls: left === 0 ? 'full' : pct >= 70 ? 'mid' : '' };
  }

  function renderCards() {
    const list = state.sessions.filter((x) => monthKey(x.date) === state.month);
    if (!list.length) {
      $('#cards').innerHTML = '<div class="empty" style="grid-column:1/-1">No classes are open yet. Please check back soon, or message us on WhatsApp.</div>';
      return;
    }
    $('#cards').innerHTML = list.map((x) => {
      const p = parts(x.date), { left, pct, cls } = seatsInfo(x);
      const cancelled = x.status === 'cancelled', closed = x.status === 'closed';
      const unavailable = cancelled || closed || left === 0;
      const chip = cancelled ? '<span class="chip bad">Cancelled</span>' : closed ? '<span class="chip warn">Booking closed</span>' : left === 0 ? '<span class="chip bad">Full</span>' : left <= 3 ? '<span class="chip warn">Only ' + left + ' left</span>' : '<span class="chip ok">' + left + ' seats left</span>';
      const hasPrice = x.price !== '' && x.price != null;
      return '<article class="card' + (cancelled ? ' off' : '') + '">' +
        '<div class="card-head"><div class="plate" aria-hidden="true"><div class="plate-in"><small>' + SWC.fmtDay(x.date).slice(0, 3) + '</small><b>' + p.d + '</b><small>' + SWC.MONTHS[p.m - 1].slice(0, 3) + '</small></div></div>' +
        '<div><h3>' + SWC.fmtDay(x.date) + '</h3><div class="time">' + esc(fmtRange(x.start, x.end)) + ' · Google Meet</div></div></div>' +
        (x.topic ? '<div class="topic">' + esc(x.topic) + '</div>' : '') +
        (SWC.parseDetails(x.details).length ? '<details class="menu-list"><summary>Au menu: what you\'ll learn</summary>' + SWC.detailsHtml(x.details) + '</details>' : '') +
        (hasPrice ? '<div class="price">' + esc(fmtPrice(x.price)) + (parseInt(x.price, 10) > 0 ? '<small> per student</small>' : '') + '</div>' : '') +
        '<div><div class="seats"><span>' + x.booked + ' of ' + x.capacity + ' booked</span>' + chip + '</div>' +
        '<div class="meter ' + cls + '" role="img" aria-label="' + x.booked + ' of ' + x.capacity + ' seats booked"><i style="width:' + pct + '%"></i></div></div>' +
        '<button class="btn' + (unavailable ? ' quiet' : '') + ' block" data-book="' + x.id + '"' + (unavailable ? ' disabled' : '') + '>' + (unavailable ? 'Not available' : 'Reserve my seat') + '</button>' +
        '</article>';
    }).join('');
  }

  $('#months').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    state.month = b.dataset.m; render();
  });
  $('#cards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-book]'); if (!b || b.disabled) return;
    openBooking(state.sessions.find((x) => x.id === b.dataset.book));
  });

  // ---------- booking dialog ----------
  function openBooking(x) {
    if (!x) return;
    $('#dlg-title').textContent = 'Reserve your seat';
    $('#dlg-body').innerHTML =
      '<p class="sub" style="margin-bottom:16px"><b>' + esc(fmtDateLong(x.date)) + '</b><br>' + esc(fmtRange(x.start, x.end)) + ' on Google Meet' + (x.topic ? ' · ' + esc(x.topic) : '') +
      (x.price !== '' && x.price != null ? '<br>Fee: <b>' + esc(fmtPrice(x.price)) + '</b>' + (parseInt(x.price, 10) > 0 ? ' <small style="color:var(--muted)">· you pay by UPI in the next step</small>' : '') : '') + '</p>' +
      '<form id="bf" novalidate>' +
      '<div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" autocomplete="name" required></div>' +
      '<div class="field"><label for="f-phone">WhatsApp number</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="98765 43210" required></div>' +
      '<div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" inputmode="email" autocomplete="email" required><span class="hint">Your Google Meet link and class-day reminder are sent here.</span></div>' +
      '<div class="field"><label for="f-note">Anything we should know? <span style="font-weight:400;color:var(--muted)">(optional)</span></label><textarea id="f-note" name="note" maxlength="300" placeholder="Allergies, first-time baker, etc."></textarea></div>' +
      '<div class="field consent"><label class="check"><input type="checkbox" name="agree" required><span>I agree to the <a href="#" data-terms>terms &amp; cancellation policy</a> and the <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a>.</span></label>' +
      (SWC.lines(state.settings.policyText).length ? '<div class="terms" id="terms" hidden><ul>' + SWC.lines(state.settings.policyText).map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' : '') + '</div>' +
      '<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div class="err" id="f-err" role="alert"></div>' +
      '<button class="btn block" id="f-go" type="submit">Confirm booking</button></form>';
    dlg.showModal();
    setTimeout(() => $('#f-name').focus(), 50);
    const tl = $('#bf [data-terms]');
    if (tl) tl.addEventListener('click', (e) => { e.preventDefault(); const t = $('#terms'); if (t) t.hidden = !t.hidden; });

    $('#bf').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target, go = $('#f-go'), err = $('#f-err');
      // show the message in a clear box and bring it into view inside the booking window
      const say = (m, field) => { err.textContent = m; err.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); if (field) field.focus({ preventScroll: true }); };
      err.textContent = '';
      const body = { sessionId: x.id, name: f.name.value, phone: f.phone.value, email: f.email.value, note: f.note.value, agree: f.agree.checked, website: f.website.value };
      if (body.name.trim().length < 2) { say('Please enter your name.', f.name); return; }
      if (SWC.waNumber(body.phone, state.settings.countryCode).length < 11) { say('Please enter a valid WhatsApp number.', f.phone); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) { say('Please enter a valid email. Your class link is sent there.', f.email); return; }
      if (!f.agree.checked) { say('Please tick the box to accept the terms and privacy notice.', f.agree); return; }
      go.disabled = true; go.textContent = 'Booking…';
      try {
        const r = await API.call('register', body);
        showSuccess(r);
        load(true);
      } catch (e) {
        say(e.message); go.disabled = false; go.textContent = 'Confirm booking';
        if (e.code !== 'network') load(true);
      }
    });
  }

  function calendarLink(sess, meetLink) {
    const t = (d, h) => d.replace(/-/g, '') + 'T' + h.replace(':', '') + '00';
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent((state.settings.siteName || 'Baking class') + (sess.topic ? ': ' + sess.topic : ' baking class')) +
      '&dates=' + t(sess.date, sess.start) + '/' + t(sess.date, sess.end) + '&location=' + encodeURIComponent(meetLink || 'Google Meet') +
      (meetLink ? '&details=' + encodeURIComponent('Join on Google Meet: ' + meetLink) : '');
  }

  const qrSvg = SWC.qrSvg; // QR code of the UPI payment link
  async function copyText(text, msg) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e2) {} ta.remove();
    }
    SWC.toast(ok ? msg : 'Please select and copy it by hand.', ok ? 'ok' : 'bad');
  }

  // Paid class: the seat is reserved but only confirmed (and the Meet link only sent) once the admin sees the payment.
  function showPayment(r) {
    const s = r.session, b = r.booking, pay = r.payment;
    const when = fmtDateLong(s.date) + ', ' + fmtRange(s.start, s.end);
    // iPhones send every upi:// link to WhatsApp, so they get one button per UPI app instead. (Newer iPads report themselves as a Mac.)
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const phone = ios || /Android/i.test(navigator.userAgent);
    const msg = 'Hi! I have paid ' + fmtPrice(pay.amount) + ' for the online baking class on ' + when + '. Name: ' + b.name + '. Ref: ' + b.code + '. Screenshot attached.';
    const wa = waLink(state.settings.whatsappNumber, msg, state.settings.countryCode);
    // On a phone the QR code is also a button: tapping it opens the UPI link, so the phone offers its UPI apps (GPay, PhonePe, Paytm...).
    const qr = !pay.uri ? '' : (phone && !ios)
      ? '<div class="qr"><a class="qr-link" href="' + esc(pay.uri) + '" aria-label="Pay ' + esc(fmtPrice(pay.amount)) + ' with a UPI app">' + qrSvg(pay.uri) + '</a>' +
        '<small><b>Tap the QR code</b> to choose a UPI app and pay</small></div>'
      : '<div class="qr">' + qrSvg(pay.uri) + '<small>' + (ios ? 'Scan this from another phone with GPay, PhonePe or Paytm' : 'Scan with GPay, PhonePe or Paytm') + '</small></div>';
    // iPhone: each app has its own link start. The part after "?" (UPI ID, name, amount, note) is the same for all of them.
    const IOS_APPS = [['GPay', 'gpay://upi/pay'], ['PhonePe', 'phonepe://pay'], ['Paytm', 'paytmmp://pay']];
    const iosApps = !(ios && pay.uri) ? '' :
      '<div class="upi-apps-box"><p class="hint-sm" style="margin:0 0 8px"><b>Choose your UPI app to pay ' + esc(fmtPrice(pay.amount)) + '</b></p>' +
      '<div class="upi-apps">' + IOS_APPS.map((a) => '<a class="btn ghost" href="' + esc(a[1] + pay.uri.slice(pay.uri.indexOf('?'))) + '">' + a[0] + '</a>').join('') + '</div>' +
      '<p class="hint-sm" style="margin:8px 0 0">If nothing opens, that app is not on this phone. Try another one, or copy the UPI ID below and pay from any app.</p></div>';
    $('#dlg-title').textContent = 'One last step: pay to confirm';
    $('#dlg-body').innerHTML =
      '<div class="pay">' +
      '<p class="sub" style="margin:0">Your seat for <b>' + esc(fmtDateLong(s.date)) + '</b> is reserved, but it is <b>confirmed only after you pay</b>. ' +
      (pay.holdHours ? 'We\'ll hold it for ' + pay.holdHours + ' hours.' : '') + '</p>' +
      '<div class="pay-amt"><small>Amount to pay</small><b>' + esc(fmtPrice(pay.amount)) + '</b></div>' +
      (pay.upiId
        ? (ios ? iosApps : phone ? '<a class="btn block" href="' + esc(pay.uri) + '">Pay ' + esc(fmtPrice(pay.amount)) + ' with GPay / any UPI app</a>' : '') +
          (phone ? '<details class="qr-details"' + (ios ? '' : ' open') + '><summary>' + (ios ? 'QR code (scan it from another phone)' : 'QR code (tap it to pay, or scan it from another phone)') + '</summary>' + qr + '</details>' : qr) +
          '<div class="upi-line"><span>UPI ID</span><b>' + esc(pay.upiId) + '</b><button class="btn quiet sm" type="button" data-copy="' + esc(pay.upiId) + '" data-msg="UPI ID copied">Copy</button></div>' +
          '<div class="upi-line"><span>Payment note</span><b>' + esc(b.code) + '</b><button class="btn quiet sm" type="button" data-copy="' + esc(b.code) + '" data-msg="Note copied">Copy</button></div>' +
          '<p class="hint-sm">Put the note above when you pay, so we can find your payment.</p>'
        : '<p>Please message us on WhatsApp for the payment details.</p>') +
      '<div class="stack">' + (wa ? '<a class="btn wa block" target="_blank" rel="noopener" href="' + wa + '">I\'ve paid: send screenshot on WhatsApp</a>' : '') +
      '<button class="btn quiet block" type="button" id="done">Close</button></div>' +
      '<p class="hint-sm">Once we confirm your payment, the Google Meet link is emailed to <b>' + esc(b.email) + '</b>. Booking reference: <b>' + esc(b.code) + '</b>. Everything is also in your email.</p></div>';
    $('#done').onclick = () => dlg.close();
    $('#dlg-body').querySelectorAll('[data-copy]').forEach((el) => { el.onclick = () => copyText(el.dataset.copy, el.dataset.msg); });
  }

  function showSuccess(r) {
    if (r.payment) return showPayment(r);
    const s = r.session, b = r.booking, link = r.meetLink;
    const when = fmtDateLong(s.date) + ', ' + fmtRange(s.start, s.end);
    const msg = 'Hi! I just booked the online baking class on ' + when + '. Name: ' + b.name + '. Ref: ' + b.code;
    const wa = waLink(state.settings.whatsappNumber, msg, state.settings.countryCode);
    $('#dlg-title').textContent = 'You\'re booked!';
    $('#dlg-body').innerHTML =
      '<div class="success"><div class="big" aria-hidden="true">🎉</div><p class="kicker" style="margin:-6px 0 0">C\'est réservé !</p>' +
      '<p><b>' + esc(when) + '</b><br>Live on Google Meet' + (s.topic ? '<br>' + esc(s.topic) : '') + (s.price !== '' && s.price != null ? '<br>Fee: ' + esc(fmtPrice(s.price)) : '') + '</p>' +
      '<div class="ref">Your booking reference<b>' + esc(b.code) + '</b></div>' +
      '<div class="stack">' +
      (link ? '<a class="btn block" target="_blank" rel="noopener" href="' + esc(link) + '">Open Google Meet link</a>' : '') +
      (wa ? '<a class="btn wa block" target="_blank" rel="noopener" href="' + wa + '">Send confirmation on WhatsApp</a>' : '') +
      '<a class="btn ghost block" target="_blank" rel="noopener" href="' + calendarLink(s, link) + '">Add to calendar</a>' +
      '<button class="btn quiet block" type="button" id="done">Done</button></div>' +
      '<p class="sub" style="margin:0">' + (link ? 'We\'re also emailing the link and what to keep ready to ' : 'We\'ll email the Google Meet link to ') + '<b>' + esc(b.email) + '</b>. You\'ll get a reminder on class day.</p></div>';
    $('#done').onclick = () => dlg.close();
  }

  $('#dlg-x').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  // ---------- go ----------
  const cached = readCache();
  if (cached) { state.settings = cached.settings; state.sessions = cached.sessions.filter((x) => x.date >= SWC.todayISO()); render(); }
  load(!!cached);

  // Seat counts and new classes update by themselves. If the booking window is open, wait until it is closed.
  let stale = false;
  API.watch(() => { if (dlg.open) { stale = true; return; } return load(true); }, 30000);
  dlg.addEventListener('close', () => { if (stale) { stale = false; load(true); } });
})();
