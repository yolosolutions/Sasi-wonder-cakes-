# Go-live checklist (production)

The website itself is finished and tested. These are the steps that only you can do, in order. Everything is free.

Use **yolosolutions01@gmail.com** for every account below.

## 1. The backend: database, email relay and secrets (15 min) - see SETUP.md steps 1, 3 and 4
- [x] Create the D1 database `sasi-wonder-cakes-db` and run `backend/schema.sql` in its Console (the Database ID is already in `wrangler.jsonc`).
- [ ] Gmail relay: create the Apps Script project from `backend/mail-relay.gs`, put your secret in it, deploy as web app (**Execute as: Me**, **Who has access: Anyone**), and copy its `/exec` URL.
- [ ] Add three **Secret** variables to the Worker (Workers & Pages → sasi-wonder-cakes → Settings → Variables and Secrets): `ADMIN_PASSWORD`, `MAIL_RELAY_URL`, `MAIL_SECRET`.
- Do these before pushing the Worker code. The site and backend are one deployment, so nothing breaks while you set them up.
- Whenever `backend/mail-relay.gs` changes, paste the new code into the Apps Script editor and use Deploy → Manage deployments → pencil → Version: **New version** → Deploy. The link stays the same. Changes to `worker/index.mjs` need nothing: pushing to `main` deploys them.

## 2. Host the website on Cloudflare (5 min)
Cloudflare is the best free choice for a real site: unmetered free traffic for static files, and it applies the security rules in the `_headers` file. GitHub Pages cannot do that, and Netlify's free plan pauses a site when its monthly credits run out.

- [ ] Sign up at <https://dash.cloudflare.com/sign-up> with **yolosolutions01@gmail.com** (no card needed).
- [ ] Dashboard home → **Create app** → **Import a repository** (GitHub).
- [ ] When GitHub opens, make sure the account at the top right is **yolosolutions**. Install the Cloudflare app on it, choose **Only select repositories**, and pick `Sasi-wonder-cakes-`.
- [ ] Back in Cloudflare, pick the repo and fill in the setup form:
  - **Project name:** `sasi-wonder-cakes` (it must match the `name` in `wrangler.jsonc`)
  - **Build command:** leave empty
  - **Deploy command:** `npx wrangler deploy` (the default)
  - **Root directory:** leave empty
- [ ] Click **Deploy**. When it finishes, Cloudflare shows your address, something like `https://sasi-wonder-cakes.<name>.workers.dev`. Every push to `main` redeploys by itself.
- [ ] Optional: **Settings → Domains & Routes** to use your own domain (HTTPS is automatic).
- [x] Live at <https://sasi-wonder-cakes.yolosolutions01-6a6.workers.dev/> (admin at `/admin`). The link-preview tags in `index.html` (`og:url`, `og:image`, `canonical`) use this address.
- [ ] If you later add your own domain, replace that address in those three tags in `index.html` and push.

**If it says "Missing git connection":** Cloudflare found the repo, but its GitHub app is not fully linked yet. On github.com (signed in as `yolosolutions`) go to **Settings → Applications → Installed GitHub Apps → Cloudflare Workers & Pages → Configure**, under **Repository access** add `Sasi-wonder-cakes-`, and save. Then reload the Cloudflare page and start **Create app → Import a repository** again.

The files `wrangler.jsonc` (the project name and which folder to publish) and `.assetsignore` (files that must not be published, such as `backend/`, `tests/` and the `.md` guides) are what make this work. Please don't delete them.

## 3. Set up the dashboard (5 min)
- [ ] Sign in at `/admin.html` and change the password (Settings → Change password).
- [ ] Settings → **Where you get notified**: confirm your WhatsApp number and email. Click **Send a test alert** and check your inbox and spam folder.
- [ ] Settings → **Payments (UPI)**: enter your UPI ID, then scan the test QR with GPay. It should show your name.
- [ ] Settings → **Class defaults**: price, Meet link, seats, time.
- [ ] Settings → **Terms & cancellation**: edit the draft so it matches your real policy.
- [ ] Read `privacy.html` once and change anything that isn't true for you.
- [ ] The 7 AM class-day alerts are automatic (Cloudflare Cron Trigger). To confirm, Worker → Settings → Trigger Events shows the schedule.
- [ ] **Menu** page: check the dish list. **Classes**: Add weekends and edit each class.

## 4. Test it like a student (10 min, do this before sharing the link)
- [ ] Book a class from your phone. Check you got the "Awaiting payment" email, and the student got the payment email.
- [ ] Pay ₹1 from a friend's phone (set the class price to 1 for the test). Check the UPI button and the QR both work.
- [ ] Tap **Mark paid**. Check the student gets the Meet link email.
- [ ] Open the class and tap **Send class-day alerts now**. Check both emails.
- [ ] Set the price back and remove the test bookings.

## What is already protected
- **Passwords and sessions:** the admin password is stored salted and hashed (PBKDF2), only a hash of each sign-in token is stored, sessions expire after 14 days, and 8 wrong tries from one address lock that address for 15 minutes (40 wrong tries from everyone together pause sign-in for everyone).
- **Spam and abuse:** a hidden trap field catches bots; each phone number or email is limited to 4 tries an hour, 60 bookings an hour in total, and 3 unpaid seats at once. Students must tick the terms box, and the time is recorded.
- **Private data:** the Meet link, prep lists, student details and the master menu are never sent to the public site.
- **Injection:** everything typed by students or admins is escaped before it is shown, emailed or put in a CSV.
- **Browser security rules:** `_headers` and a matching rule inside each page block other sites from embedding or injecting into the site, and the pages may talk to no server except the site itself. The API refuses requests that come from another website.
- **Reliability:** the last seat can't be taken twice, even by simultaneous clicks (one database statement checks and books); unpaid holds expire; a failure in the backend emails you (at most once an hour); a booking still succeeds if an email can't be sent.
- **Tests:** `tests/backend.test.mjs` (129 checks, run against a real SQL database) runs automatically on every push through GitHub (the CI tab on the repo).

## Limits to know about
- **Payments are confirmed by you.** UPI cannot tell the website that money arrived without a paid gateway.
- **Email limit:** about 100 emails a day through your Gmail (the relay). A class of 10 uses roughly 40 over its whole life (per student: payment email, confirmation and class-day reminder, plus your alerts), spread over several days, so you are well under it.
- **Speed:** the class list and booking answer in well under a second. Emails are sent a moment later in the background, so the student never waits for them.
- **Sign-in lock:** someone typing wrong passwords gets only their own address locked. If many addresses try at once, sign-in pauses for everyone for 15 minutes.
- **Relay changes** (`backend/mail-relay.gs`) only go live after **Deploy → Manage deployments → Edit → New version**.
- **WhatsApp alerts** use CallMeBot, which is free but unofficial. Email is the dependable alert.
- **Privacy notice and terms** are a plain-language draft, not legal advice.
- **Backups:** D1 Time Travel lets you restore the database to any minute in the last 30 days (database → Settings). Once a month, also run `npx wrangler d1 export sasi-wonder-cakes-db --remote --output backup.sql`.
