// Privacy & terms page: fills in the business name, contact links and the terms from Settings.
(async function () {
  const { $, esc, waLink, prettyPhone, waNumber } = SWC;
  try {
    const s = (await API.call('getPublic')).settings;
    document.querySelectorAll('[data-name]').forEach((el) => { el.textContent = s.siteName || el.textContent; });
    document.title = 'Privacy & terms – ' + (s.siteName || '');
    const wa = waLink(s.whatsappNumber, 'Hi! I have a question about my details.', s.countryCode);
    if (wa) { $('#p-wa').href = wa; $('#p-wa').textContent = prettyPhone(waNumber(s.whatsappNumber, s.countryCode)); $('#p-wa-wrap').hidden = false; }
    const ig = String(s.instagram || '').replace(/^@/, '').replace(/[^\w.]/g, '');
    if (ig) { $('#p-ig').href = 'https://instagram.com/' + ig; $('#p-ig').textContent = '@' + ig; $('#p-ig-wrap').hidden = false; }
    const terms = SWC.lines(s.policyText);
    if (terms.length) $('#p-terms').innerHTML = terms.map((t) => '<li>' + esc(t) + '</li>').join('');
  } catch (e) { /* the page still reads fine without the live details */ }
})();
