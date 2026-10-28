# Sasi Wonder Cakes: setup guide (100% free)

Nothing here needs a credit card.

| Piece | Free service | What it does |
|---|---|---|
| Website | Netlify / GitHub Pages / Cloudflare Pages | Shows the site to students |
| Database + email | Google Sheet + Google Apps Script (your Gmail) | Stores classes and bookings, sends emails |
| WhatsApp | `wa.me` links (+ optional CallMeBot) | See "How WhatsApp works" below |

**One email for everything:** use **yolosolutions01@gmail.com** for this whole project: the Google account that owns the Sheet and the Apps Script (it is also the address the booking emails are sent from), GitHub, and the free host (Netlify, Cloudflare or GitHub Pages). Booking alerts go to the same address by default. You can change it any time under **Settings → Where you get notified**.

**Try it first:** open `index.html` in a browser (or run `python -m http.server 5173` in this folder and visit `http://localhost:5173`). With no backend connected it runs in **demo mode** with sample classes. The admin page is `admin.html`, demo password `admin`.

---

## Step 1. Create the database (2 min)
1. Go to <https://sheets.google.com> and create a **blank spreadsheet**. Name it `Sasi Wonder Cakes`.
2. Menu: **Extensions → Apps Script**.
3. Delete everything in the editor, then paste the full contents of `backend/Code.gs`.
4. Near the top, change `INITIAL_ADMIN_PASSWORD = 'CHANGE_ME'` to a password you will remember. Change `TZ` if you are not in India.
5. Click the **Save** icon.

## Step 2. Publish the backend (3 min)
1. Click **Deploy → New deployment**. Click the gear icon and choose **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
3. Click **Deploy** and **Authorize access**. Choose your Google account. If it says "Google hasn't verified this app", click **Advanced → Go to … (unsafe)**. This is your own script, so it is fine. Allow the permissions. They let it use the Sheet and send mail as you.
4. Copy the **Web app URL**. It ends in `/exec`.

## Step 3. Connect the website (1 min)
Open `js/config.js` and paste the URL:

```js
window.SWC_CONFIG = { API_URL: 'https://script.google.com/macros/s/XXXX/exec' };
```

## Step 4. Put the website online (5 min), pick one
- **Netlify Drop** (easiest): go to <https://app.netlify.com/drop> and drag this whole folder onto the page. You get a free link. You can rename it under *Site settings*.
- **GitHub Pages**: upload the folder to a GitHub repository, then **Settings → Pages → Deploy from branch**.
- **Cloudflare Pages**: connect the same repository, with no build command.

Share the link with students. Your dashboard is at `<your-link>/admin.html`.

## Step 5. First login
1. Open `admin.html` and sign in with the password from Step 1.
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
- **Backup:** your data is in the Google Sheet. Open it any time, or use *File → Download*.

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

The list lives in the **Menu** tab of your Google Sheet, so you can also edit it there.

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
- If you set up an earlier version already, paste the new `Code.gs` and redeploy (Deploy → Manage deployments → New version). The missing sheet columns are added automatically.

## Notifications: what gets sent, and when
| When | To you (email + WhatsApp if you set the CallMeBot key) | To the student (email) |
|---|---|---|
| Student books a paid class | "Awaiting payment": name, email, phone, class, ref | Payment email: amount, your UPI ID, their ref. **No Meet link yet** |
| You tap **Mark paid** | (nothing, you just did it) | "Payment received" with the Google Meet link, what we'll cover, and what to keep ready |
| Student books a free class | New booking: name, email, phone, class | Confirmation with the Meet link right away |
| Morning of the class (7 AM) | Class summary: time, Meet link, **your checklist**, class menu, paid attendee list, and who is still unpaid | "Your class is today" with the Meet link and what to keep ready (**paid students only**) |

Every student must give their own email, because that is where the link goes. One booking is one student and one seat.

**What to keep ready:** in **Settings → Class-day notifications** write the default lists (one item per line): one for students, one for your own checklist. Under **Edit** on any class you can replace them, for example with that class's ingredient list.

**Turn on the 7 AM notifications (one time):** in the Apps Script editor, choose the function `setupReminders` in the dropdown and click **Run**. After that it runs by itself every day. Switch it off any time in Settings. The hour is `REMINDER_HOUR` at the top of `Code.gs`.

**Send them any time:** open a class in the dashboard and press **Send class-day alerts now**. Handy for testing, or if you decide to send them earlier or the trigger isn't set up.

**WhatsApp to students:** the green WhatsApp button next to each student opens a ready-made message with the Meet link and what to keep ready. You press Send.

## Passwords
Students do not create passwords or log in. They only enter name, WhatsApp number and email. This is deliberate: the site never stores a student password. Only you have a password (for the dashboard).

## Changing the backend later
If you edit `Code.gs`, use **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same.

## Free limits (plenty for a class)
Gmail sending is capped at about 100 emails a day through Apps Script. A class of 10 uses about 12 on class day (10 students, your summary and extras), so you are far from the cap. Apps Script and Sheets limits are far above what a baking class needs. Netlify, GitHub Pages and Cloudflare Pages are free for a site this small.

## Look and feel
The student site has a Pondicherry and French patisserie look: a striped bakery awning, a chalkboard "Au programme" card, navy street-sign date plates (like Pondicherry's French street signs), an ochre colonial-wall band, and a fleur-de-lis divider, all in your logo's orange and chocolate. Your logo and the illustrated baker come from your logo PDF and are in `assets/`. To change a colour, edit the variables at the top of `css/style.css`. To change the Instagram link, WhatsApp number, name or tagline, use **Settings** in the dashboard.

## Files
```
index.html        public booking page
admin.html        admin dashboard
assets/           logo, baker illustration and favicon (from your logo PDF)
css/style.css     all styling (colours are the variables at the top)
js/config.js      the one setting you must fill in (API_URL)
js/site.js        public page logic
js/admin.js       dashboard logic
js/api.js         talks to Google (and the demo mode)
backend/Code.gs   paste this into Apps Script
```
