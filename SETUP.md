# Sasi Wonder Cakes: setup guide (100% free)

Nothing here needs a credit card.

| Piece | Free service | What it does |
|---|---|---|
| Website + backend | Cloudflare Workers (from GitHub) | Shows the site and answers its requests at `/api` |
| Database | Cloudflare D1 (SQL) | Stores classes, bookings, menu and settings |
| Email | Gmail, through a tiny Google Apps Script relay | Sends the booking, payment and class-day emails |
| WhatsApp | `wa.me` links (+ optional CallMeBot) | See "How WhatsApp works" below |

**One email for everything:** use **yolosolutions01@gmail.com** for this whole project: Cloudflare, GitHub and the Google account that sends the emails. Booking alerts go to the same address by default. You can change it any time under **Settings → Where you get notified**.

**Try it first:** open `index.html` in a browser (or run `python -m http.server 5173` in this folder and visit `http://localhost:5173`) after emptying `API_URL` in `js/config.js`. With no backend connected it runs in **demo mode** with sample classes. The admin page is `admin.html`, demo password `admin`.

**Why not keep everything in a Google Sheet?** An earlier version did. Google Apps Script answers in 2 to 3 seconds, which made the class list slow. D1 answers in a few milliseconds, sits in the same Cloudflare account as the website, and is only reachable through the Worker (it has no public address of its own).

---

## Step 1. Create the database (3 min)
1. Cloudflare dashboard → **Storage & databases → D1 SQLite Database → Create database**. Name it `sasi-wonder-cakes-db`, leave the location on automatic.
2. Copy its **Database ID** into the `database_id` line of `wrangler.jsonc` (already done for the live site).
3. Open the database's **Console** tab, paste the whole of `backend/schema.sql`, and click **Execute**. (The file has no comments on purpose: the Console squashes pasted text onto one line, and a comment would hide everything after it.) The **Tables** tab then lists `settings`, `sessions`, `bookings`, `menu`, `tokens` and `limits`. It is safe to run the file again; it never deletes anything.

## Step 2. Put the website and backend online (5 min)
Cloudflare Workers, connected to the GitHub repo, hosts both the pages and the backend. Every push to `main` redeploys by itself. The full click-by-click is in [PRODUCTION.md](PRODUCTION.md). `wrangler.jsonc` already names the Worker (`worker/index.mjs`), the database, and the 7 AM schedule.

## Step 3. Set up the Gmail relay (5 min)
Cloudflare cannot send email on the free plan, so a small Google script sends it from your Gmail. It stores nothing and only sends what the Worker hands it, and only when the secret matches.
1. Make a secret: run `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` and keep the result. (Any long random text works.)
2. Go to <https://script.google.com> (signed in as yolosolutions01@gmail.com) → **New project**. Delete the starter code and paste all of `backend/mail-relay.gs`.
3. On the one line `const MAIL_SECRET = 'CHANGE_ME';` replace CHANGE_ME with your secret (edit just that line by hand; do not use find-and-replace). **Save**.
4. **Deploy → New deployment** → gear icon → **Web app**. **Execute as: Me**, **Who has access: Anyone**. **Deploy**, then **Authorize access** (on "Google hasn't verified this app" choose **Advanced → Go to … (unsafe)**; it is your own script). Allow the permissions; they let it send mail as you.
5. Copy the **Web app URL** (ends in `/exec`).

## Step 4. Give the Worker its three secrets (3 min)
Cloudflare dashboard → **Workers & Pages → sasi-wonder-cakes → Settings → Variables and Secrets → Add**. For each, choose type **Secret** (not "Text", or a later deploy can erase it), then **Deploy**:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | the password for your first sign-in (change it in the dashboard afterwards) |
| `MAIL_RELAY_URL` | the Web app URL from Step 3 |
| `MAIL_SECRET` | the same secret you put in the relay script |

Nobody, including this repository, ever sees these values.

## Step 5. First login
1. Open `/admin` and sign in with the `ADMIN_PASSWORD` from Step 4.
2. **Settings** tab: fill in your WhatsApp number, your email for alerts, the **price per student** (whole rupees, e.g. `1500`) and your **Google Meet link**. Save.
   - To get a Meet link, open <https://meet.google.com/new> and choose *Create a meeting for later*. Paste the link into Settings. You can give a single class its own link under **Edit**.
   - The Meet link is never shown on the public site. Students receive it only after they book (on screen and by email).
3. Go to **Settings → Send a test alert** to check that email arrives.
4. **Classes** tab: click **+ Add weekends**, choose the month and days, and you are live.
5. Change the password under **Settings → Change password**.

---

## Day-to-day
- **Change notification number or email:** Settings → Where you get notified. It applies immediately, with no redeploy.
- **Change class time, price or Meet link:** Settings → Class defaults updates every class using the default. Edit a single class to give it its own time, price or link.
- **See who's coming:** Classes tab → click a date. The **Students** tab searches everyone and downloads a CSV.
- **Cancel or close a class:** open it and use *Close booking* or *Cancel class*. Then WhatsApp the students with the green buttons.
- **Backup:** in Cloudflare open the database → **Settings → Time Travel** to go back to any minute in the last 30 days. For a file copy, run `npx wrangler d1 export sasi-wonder-cakes-db --remote --output backup.sql` once a month. The **Students** tab can also download a CSV.

## Install it as an app (iPhone and Android)
The site works like an app: it gets its own icon on the home screen, opens full screen with no browser bars, and shows a friendly page if the connection drops. It costs nothing and there is no app store.

- **Your dashboard:** open `<your-link>/admin`, then add it to the home screen. The icon is labelled **Sasi Admin**.
- **The student site:** the same steps from the main page give an icon labelled **Sasi Cakes**.
- **iPhone (use Safari):** tap the **Share** button (square with an arrow) at the bottom, scroll down, tap **Add to Home Screen**, then **Add**. The **Install app** button on the page shows these steps too.
- **Android (Chrome):** tap **Install app** on the page (it appears when the phone allows it), or open the Chrome menu and choose **Install app** / **Add to Home screen**.
- **Updates:** nothing to do. The app always loads the newest version of the site when you are online.
- **Good to know:** bookings, payments and the live dashboard need the internet. Offline, the app shows an "You are offline" page, never old class or student data.
- **iPhone alerts:** the **Alerts** button (pop-up alerts for new bookings) does not work on iPhone yet, because Apple only allows that through a different system (push messages). On iPhone, keep the Gmail app's notifications on for the booking emails.

The files behind this: `manifest.webmanifest` and `admin.webmanifest` (name, colours, icons), `sw.js` (the service worker), `offline.html`, `js/install.js` (the Install button), and the icons in `assets/icons/`.

## Live updates (no reloading)
The dashboard and the class page update the moment something is saved, with no reloading and no extra service to sign up for.
- **How:** every open page keeps a WebSocket connection to a small Cloudflare **Durable Object** (the "live room", `worker/room.mjs`). After each save the Worker tells the room, and the room tells every connected page that something changed. Only a counter is sent, never names or emails; the page then asks the normal API for the data. While nothing is happening the room sleeps and costs nothing. Durable Objects are free on Cloudflare's free plan (the SQLite kind, which `wrangler.jsonc` already asks for).
- **Safety net:** if the connection drops (poor mobile signal, an old browser), the page reconnects by itself and meanwhile keeps checking every 15 seconds (30 on the class page), so nothing is ever missed. The room accepts 100 connections at once; further pages just use the checking.
- **New booking while the dashboard is open:** a message such as "New booking: Priya · Sat 7 Nov" appears and the lists update. It will not redraw while you are typing, have a form open, or are on the Settings or Menu pages, so you never lose what you are typing.
- **Tab in the background:** the tab title shows how many new bookings arrived, like "(2) Admin – Sasi Wonder Cakes".
- **Desktop alerts:** the **Alerts** button at the top turns on pop-up alerts from your browser, even when the tab is in the background. You must leave the dashboard tab open. For alerts when it is closed, use email (the Gmail app on your phone).
- **Students:** the seats-left counts on the class page update on their own, so nobody books a seat that has just gone.

## How WhatsApp works (be aware)
WhatsApp's official automatic messaging (Business API) is **paid**. For a zero-cost site, this project does the following:
1. **Student → you:** after booking, a button opens WhatsApp with a ready-made confirmation message to **your** number. The student taps Send. This is official and free.
2. **You → student:** each student in the dashboard has a **WhatsApp** button that opens a pre-filled reminder. One tap, and you press Send.
3. **Automatic alerts to your own WhatsApp (optional):** [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/) is a free, unofficial service. Follow their page once to get a key, then paste it in Settings. It can be unreliable, so email is the dependable channel and WhatsApp is a bonus.

## Your master menu (the dish dropdown)
The **Menu** page in the dashboard is your master list of dishes. The first time you open the dashboard it is filled from your menu PDF: your brownies, brownie tubs, cookies, mini cakes, cakes, premium cakes, muffins and buns and add-ons. It also has the class recipes and flavours (egg and eggless brownie, the ganaches, caramel, Biscoff, Oreo and so on).

- **Add a dish:** Menu → **+ Add dish**. Pick a category from the list, or type a new one to create it.
- **Edit or remove:** use **Edit** or **✕** beside any dish. Removing a dish only takes it out of the dropdown. Classes that already include it keep it.
- **Use it in a class:** open a class → **Edit** → **Dishes in this class** → choose a dish from the dropdown. It's added under its category, and you can add as many as you like.
- **Removed one by mistake?** Every dish shows as a chip with a **×**. Tap the **×** to remove just that dish, or **Clear all** to start again. Type your own extra point in the box below the chips and press **Add**. **Edit as text** shows the same list as plain lines if you prefer typing.

The list is stored in the database; the dashboard's Menu page is the place to edit it.

## The class menu (what you'll teach, point by point)
Each class has a **Dishes in this class** box under **Edit**. Choose dishes from the dropdown, or write one point per line, and start a line with `#` for a section title:

```
# Recipes
Egg-based brownie
Eggless brownie
# Flavours & variations
Double chocolate
Nutella
Biscoff
# Complementary recipes
Dark chocolate ganache
Caramel
```
Students see it on the class card under **What you'll learn** and in their confirmation email. You see it when you open the class in the dashboard, and in your class-day summary. The **Use brownie class example** button in the class form fills in the first brownie class for you.

**Defaults:** classes run 2 – 5 PM, and **Add weekends** ticks only Saturday (one class per weekend). Tick Sunday too if you ever want it. Change the time in Settings.

## Payments (UPI, no payment gateway)
Students pay **your own UPI ID** with GPay, PhonePe or Paytm. There is no gateway, no sign-up, and no fee. UPI can't tell the website by itself that money arrived, so **you confirm each payment by hand**, which takes one tap.

**Set up (2 minutes):** Settings → **Payments (UPI)** → enter your UPI ID (in GPay: tap your photo, then the UPI IDs under your bank account). A test QR appears. **Scan it with GPay on your phone**. It should open a payment to you, showing your name. Set how long to hold an unpaid seat (default 24 hours).

**What the student sees:** after booking a paid class they get a "pay to confirm" screen with the amount, a **Pay with GPay / any UPI app** button (on phones), a **QR code** (for paying from another phone), your UPI ID and a payment note (their booking reference) with copy buttons, and an **I've paid: send screenshot on WhatsApp** button. The same details are emailed.

**What you do:** you get an email (and WhatsApp, if set up) saying *Awaiting payment*. When the money shows in your UPI app, open the class in the dashboard and tap **Mark paid** on that student. They are emailed the Google Meet link right then. The **Awaiting payment** number on the Classes page shows who still owes.

**Good to know**
- The Meet link is never shown or emailed until you mark the student paid, so nobody joins without paying. Free classes (price 0) skip all this.
- An unpaid booking holds its seat for the hold time (default 24 hours), then stops blocking the seat. If the money arrives late, **Mark paid** still works as long as the class isn't full.
- On class day, only paid students get the Meet link, and your summary lists anyone still unpaid.
- Please test the whole thing once with a real ₹1 payment from a friend's phone. Some UPI apps are stricter about payment links to personal UPI IDs. If a button ever fails, the QR code and the copy-able UPI ID always work.

## Notifications: what gets sent, and when
| When | To you (email + WhatsApp if you set the CallMeBot key) | To the student (email) |
|---|---|---|
| Student books a paid class | "Awaiting payment": name, email, phone, class, ref | Payment email: amount, your UPI ID, their ref, and "we check payments within 24 hours". **No Meet link yet** |
| You tap **Mark paid** | (nothing, you just did it) | "Payment received" with the Google Meet link, what we'll cover, and what to keep ready |
| Student books a free class | New booking: name, email, phone, class | Confirmation with the Meet link right away |
| Morning of the class (7 AM) | Class summary: time, Meet link, **your checklist**, class menu, paid attendee list, and who is still unpaid | "Your class is today" with the Meet link and what to keep ready (**paid students only**) |

Every student must give their own email, because that is where the link goes. One booking is one student and one seat.

**What to keep ready:** in **Settings → Class-day notifications** write the default lists (one item per line): one for students, one for your own checklist. Under **Edit** on any class you can replace them, for example with that class's ingredient list.

**The 7 AM notifications** are already on: Cloudflare runs them every day at 07:00 India time (the `crons` line in `wrangler.jsonc`, written in UTC as `30 1 * * *`). Switch them off any time in Settings.

**Send them any time:** open a class in the dashboard and press **Send class-day alerts now**. Handy for testing, or if you decide to send them earlier or the trigger isn't set up.

**WhatsApp to students:** the green WhatsApp button next to each student opens a ready-made message with the Meet link and what to keep ready. You press Send.

## Passwords
Students do not create passwords or log in. They only enter name, WhatsApp number and email. This is deliberate: the site never stores a student password. Only you have a password (for the dashboard).

## Changing the backend later
Edit `worker/index.mjs`, run `node tests/backend.test.mjs`, then push to `main`. Cloudflare redeploys by itself and the address stays the same. New tables or columns go into `backend/schema.sql` and are run in the database Console.

## Free limits (plenty for a class)
- **Email:** Gmail sending through the relay is capped at about 100 emails a day. A class of 10 uses roughly 40 emails over its whole life (payment email, confirmation and class-day reminder for each student, plus your alerts), spread over several days, so you are well under the cap.
- **Cloudflare:** the free plan allows 100,000 Worker requests and 5 million database reads a day, and 100,000 database writes a day. A baking class uses a tiny fraction.

## Look and feel
The student site has a Pondicherry and French patisserie look: a striped bakery awning, a chalkboard "Au programme" card, navy street-sign date plates (like Pondicherry's French street signs), an ochre colonial-wall band, and a fleur-de-lis divider, all in your logo's orange and chocolate. Your logo and the illustrated baker come from your logo PDF and are in `assets/`. To change a colour, edit the variables at the top of `css/style.css`. To change the Instagram link, WhatsApp number, name or tagline, use **Settings** in the dashboard.

## Files
```
index.html        public booking page
admin.html        admin dashboard
privacy.html      privacy notice and terms (text comes from Settings)
404.html          "page not found" page
_headers          security and caching rules (Cloudflare / Netlify)
wrangler.jsonc    tells Cloudflare the project name and the folder to publish
.assetsignore     files Cloudflare must not publish (backend, worker, tests, guides)
manifest.webmanifest, admin.webmanifest, sw.js, offline.html, assets/icons/   the installable app (see "Install it as an app")
worker/index.mjs  the backend: answers /api, talks to the database, sends the emails
worker/room.mjs   the live room (Durable Object) that pushes updates to open pages
tests/            backend tests, run with: node tests/backend.test.mjs
.github/          runs the tests automatically on every push
PRODUCTION.md     go-live checklist
assets/           logo, baker illustration and favicon (from your logo PDF)
css/style.css     all styling (colours are the variables at the top)
js/config.js      where the site sends requests (/api; empty means demo mode)
js/site.js        public page logic
js/admin.js       dashboard logic
js/api.js         talks to the backend (and the demo mode)
backend/schema.sql      the database tables (run once in the D1 Console)
backend/mail-relay.gs   paste this into a Google Apps Script project (Step 3)
```
