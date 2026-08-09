# Portus — server

Backend for the Portus town-builder game: accounts, cloud saves, and a
server-verified $1/hour paywall (card via Stripe, PayPal via PayPal).
Serves the game itself too, from `public/index.html`.

Tested locally end-to-end: signup, login, session check, save/load, and
clean error handling when Stripe/PayPal aren't configured yet all work.
You still need to (1) add real Stripe/PayPal credentials and (2) deploy
it somewhere your domain can point to — I can't do either of those from
here since they require your accounts and your domain's DNS settings.

## 1. Run it locally first

```bash
npm install
cp .env.example .env
# edit .env — at minimum set JWT_SECRET to a random string:
#   openssl rand -hex 32
npm start
```

Visit `http://localhost:3000`. Sign up, and you'll see the game behind
the paywall. Card/PayPal buttons will show a friendly error until you
add real keys (see below) — that's expected, not a bug.

## 2. Get real payment credentials

**Stripe (card payments):**
1. Create a Stripe account at stripe.com, finish business verification.
2. Dashboard → Developers → API keys → copy the **Secret key** into
   `STRIPE_SECRET_KEY`.
3. Dashboard → Developers → Webhooks → Add endpoint:
   `https://www.idreamofthought.org/api/webhook/stripe`, listening for
   `checkout.session.completed`. Copy the **Signing secret** into
   `STRIPE_WEBHOOK_SECRET`.
4. That's it — the $1 charge itself is created dynamically by the server
   (`/api/checkout/stripe`), no dashboard Payment Link needed.

**PayPal:**
1. Create a PayPal Business account at paypal.com.
2. developer.paypal.com → Apps & Credentials → create an app. Start in
   **Sandbox** to test end-to-end without moving real money, then switch
   to **Live** credentials when ready.
3. Copy Client ID / Secret into `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
4. Note: `server.js` picks Sandbox vs Live automatically based on
   `NODE_ENV` (`paypalClient()` near the top of the checkout routes) —
   set `NODE_ENV=production` only once you're using Live credentials.
5. Heads up: `@paypal/checkout-server-sdk` is the package used here and
   PayPal has marked it as no-longer-actively-maintained in favor of
   `@paypal/paypal-server-sdk`. It still works today; worth migrating
   at some point but not urgent.

**Email verification:**
1. Pick any transactional email provider — SendGrid, Postmark, Resend,
   AWS SES, and Mailgun all offer free tiers and all give you SMTP
   credentials, which is what this server uses (`nodemailer`), so any
   of them works without touching the code. A plain Gmail account also
   works for testing (with an "app password", not your real password).
2. Fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and
   `SMTP_FROM` in `.env`.
3. Until you do, verification links are printed to the server console
   instead of emailed — fine for local testing, but real players will
   never see their link, so set this up before launch.
4. New accounts can log in immediately but can't buy a pass until they
   click the link in their verification email (24-hour expiry). A
   "Resend verification email" button appears on the paywall for
   accounts that haven't verified yet.

## 3. Deploy it somewhere

I can't push this to a live server myself — I don't have access to any
hosting account or your domain's DNS. Pick one of these (all support
Node + a persistent disk, needed for the SQLite database file):

**Easiest — a managed platform (Render, Railway, Fly.io):**
1. Push this folder to a GitHub repo.
2. Create a new "Web Service" from that repo on your chosen platform.
3. Build command: `npm install`. Start command: `npm start`.
4. Add all the variables from `.env` in the platform's environment
   variables settings (never commit `.env` itself).
5. Attach a persistent volume/disk for `portus.db` if the platform
   offers one (otherwise your database resets on every redeploy).
6. The platform gives you a URL like `portus-server.onrender.com` —
   that's what you point your domain at next.

**More control — a small VPS (DigitalOcean, Linode, a $5-6/mo droplet):**
1. `git clone` this repo onto the server, `npm install`, set up `.env`.
2. Run it with a process manager so it survives reboots/crashes:
   `npm install -g pm2 && pm2 start server.js --name portus && pm2 save`.
3. Put nginx in front of it as a reverse proxy to `localhost:3000`, and
   use `certbot` (Let's Encrypt) for a free HTTPS certificate — Stripe
   and secure cookies both require HTTPS in production.

## 4. Point www.idreamofthought.org at it

In your domain registrar or DNS provider's dashboard for
`idreamofthought.org`:

- **If using a managed platform:** add a `CNAME` record for `www`
  pointing at the hostname the platform gave you (e.g.
  `portus-server.onrender.com`). Most platforms show you the exact
  record to add once you attach a custom domain in their dashboard.
- **If using a VPS:** add an `A` record for `www` pointing at the
  server's IP address.
- Also decide whether the bare domain (`idreamofthought.org`, no
  `www`) should redirect to `www.idreamofthought.org` — most DNS
  providers/platforms have a one-click option for this.
- DNS changes can take anywhere from a few minutes to a few hours to
  propagate.
- Update `SITE_URL` in `.env` to `https://www.idreamofthought.org`
  once it's live — Stripe/PayPal redirect URLs depend on it being
  correct.

## What's actually secure here vs. what isn't yet

- ✅ Passwords are hashed (bcrypt), never stored in plain text.
- ✅ Payment confirmation happens server-to-server (Stripe webhook,
  PayPal capture) — a player can't grant themselves access by editing
  the page in dev tools.
- ✅ Email verification: signup sends a hashed, 24-hour-expiry token
  by email; purchasing a pass is blocked server-side (403) until the
  account is verified, not just hidden in the UI. Verification tokens
  are hashed at rest, same as passwords, so a database leak alone
  can't be used to verify accounts.
- ✅ Saves are tied to an authenticated account, not guessable IDs.
- ✅ Rate limiting is in place: login/signup allow 8 attempts per IP
  per 15 minutes (blunts brute-force and mass fake-account creation),
  checkout creation allows 10 per IP per 10 minutes (stops someone
  from hammering your Stripe/PayPal API usage), and every other `/api`
  route has a generous 120-per-minute baseline. Stripe/PayPal webhooks
  are exempt since those calls come from Stripe/PayPal's own servers.
  If you deploy behind a reverse proxy or platform load balancer, set
  `TRUST_PROXY=1` in `.env` — otherwise every visitor appears to share
  the proxy's IP and gets rate-limited together.
- ⚠️ The database is a single SQLite file — completely fine at small
  scale, but back it up periodically and consider Postgres if you
  expect real concurrent traffic.
- ⚠️ No password-reset flow yet — worth adding once email is set up,
  since the plumbing (token generation, hashed storage, email sending)
  is now already in place to reuse.
