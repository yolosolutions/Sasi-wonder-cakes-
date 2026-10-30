/**
 * Sasi Wonder Cakes - Gmail relay (Google Apps Script)
 *
 * The website's Worker cannot send email by itself (Cloudflare needs a paid plan and your own domain
 * for that). This tiny script sends the emails from your Gmail instead. It stores nothing and reads
 * nothing: it only sends the messages that the Worker hands it, and only if the secret matches.
 * See SETUP.md, step 3.
 */

// A long random text, the same one you add to the Worker as the MAIL_SECRET secret.
// Make one with:  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
const MAIL_SECRET = 'CHANGE_ME';

const MAX_PER_CALL = 60;

function doGet() {
  return json_({ ok: true, service: 'Sasi Wonder Cakes mail relay' });
}

function doPost(e) {
  try {
    // (a find-and-replace of CHANGE_ME must not touch this line, so it checks the first 6 letters only)
    if (MAIL_SECRET.slice(0, 6) === 'CHANGE' || MAIL_SECRET.length < 16) return json_({ ok: false, error: 'relay secret not set' });
    const req = JSON.parse(e.postData.contents);
    if (!sameText_(String(req.secret || ''), MAIL_SECRET)) return json_({ ok: false, error: 'denied' });
    const msgs = (req.messages || []).slice(0, MAX_PER_CALL);
    const results = msgs.map(function (m) {
      try {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(m.to || ''))) return false;
        MailApp.sendEmail({
          to: String(m.to),
          subject: String(m.subject || '').slice(0, 200),
          htmlBody: String(m.html || '').slice(0, 50000),
          name: String(m.name || 'Sasi Wonder Cakes').slice(0, 100),
        });
        return true;
      } catch (err) {
        console.error(err);
        return false;
      }
    });
    return json_({ ok: true, results: results });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'bad request' });
  }
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
