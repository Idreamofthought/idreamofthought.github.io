/**
 * Portus backend — accounts, cloud saves, and a REAL (server-verified) paywall.
 *
 * Why this exists: the game's client-only paywall/save code could be bypassed
 * by anyone with dev tools. This server is the source of truth instead —
 * the browser asks it "am I paid up?" and "what's my saved city?" and the
 * server answers from its own database, never from anything the client claims.
 *
 * Deployment + DNS steps for www.idreamofthought.org are in README.md.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const Stripe = require('stripe');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_.env_FILE';
const SITE_URL = process.env.SITE_URL || 'https://www.idreamofthought.org';
const IS_PROD = process.env.NODE_ENV === 'production';
const DEV_FREE_PLAY = process.env.DEV_FREE_PLAY === 'true';
if (DEV_FREE_PLAY) {
  console.warn('');
  console.warn('⚠️  ⚠️  ⚠️  DEV_FREE_PLAY IS ON — every signup/login gets 24h free access, no payment or email verification needed.');
  console.warn('⚠️  This is for testing ONLY. Remove DEV_FREE_PLAY from your environment variables before going live.');
  console.warn('');
}

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */
const db = new Database(path.join(__dirname, 'portus.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    captain_name TEXT DEFAULT '',
    access_expires_at INTEGER DEFAULT 0,
    email_verified INTEGER DEFAULT 0,
    verify_token_hash TEXT,
    verify_token_expires INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now')*1000)
  );
  CREATE TABLE IF NOT EXISTS saves (
    user_id INTEGER PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s','now')*1000),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    provider TEXT,
    amount_cents INTEGER,
    status TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')*1000)
  );
`);
// Safe migration for databases created before email verification existed —
// ALTER TABLE ADD COLUMN has no "IF NOT EXISTS" in SQLite, so probe first.
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('email_verified')) db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0");
if (!userCols.includes('verify_token_hash')) db.exec("ALTER TABLE users ADD COLUMN verify_token_hash TEXT");
if (!userCols.includes('verify_token_expires')) db.exec("ALTER TABLE users ADD COLUMN verify_token_expires INTEGER");
if (!userCols.includes('reset_token_hash')) db.exec("ALTER TABLE users ADD COLUMN reset_token_hash TEXT");
if (!userCols.includes('reset_token_expires')) db.exec("ALTER TABLE users ADD COLUMN reset_token_expires INTEGER");

/* ------------------------------------------------------------------ */
/* Email (verification) — SMTP via nodemailer, works with any provider */
/* (SendGrid, Postmark, Resend, AWS SES, Mailgun, Gmail...). If SMTP    */
/* isn't configured, verification links are logged to the console      */
/* instead of emailed — handy for local testing, not for production.   */
/* ------------------------------------------------------------------ */
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}
function setVerificationToken(userId) {
  const token = makeToken();
  const expires = Date.now() + 24 * 3600 * 1000;
  db.prepare('UPDATE users SET verify_token_hash=?, verify_token_expires=? WHERE id=?').run(
    hashToken(token), expires, userId
  );
  return token;
}
async function sendVerificationEmail(email, token) {
  const link = `${SITE_URL}/api/verify-email?token=${token}`;
  if (!mailer) {
    console.log(`[SMTP not configured] Verification link for ${email}: ${link}`);
    return;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || `Portus <no-reply@idreamofthought.org>`,
    to: email,
    subject: 'Verify your Portus account',
    text: `Welcome to Portus!\n\nVerify your email to unlock payments:\n${link}\n\nThis link expires in 24 hours. If you didn't sign up, you can ignore this email.`,
    html: `<p>Welcome to Portus!</p><p><a href="${link}">Click here to verify your email</a> and unlock payments.</p><p style="color:#888;font-size:12px;">This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>`,
  });
}

async function sendPasswordResetEmail(email, token) {
  const link = `${SITE_URL}/?reset=${token}`;
  if (!mailer) {
    console.log(`[SMTP not configured] Password reset link for ${email}: ${link}`);
    return;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || `Portus <no-reply@idreamofthought.org>`,
    to: email,
    subject: 'Reset your Portus password',
    text: `Reset your password:\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `<p><a href="${link}">Click here to reset your password</a>.</p><p style="color:#888;font-size:12px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
  });
}

/* ------------------------------------------------------------------ */
/* Stripe webhook — MUST use the raw body for signature verification,  */
/* so this is mounted before express.json() touches the request body. */
/* ------------------------------------------------------------------ */
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature check failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = Number(session.client_reference_id);
    if (userId) {
      grantHours(userId, 1);
      db.prepare(
        `INSERT OR IGNORE INTO payments (id,user_id,provider,amount_cents,status) VALUES (?,?,?,?,?)`
      ).run(session.id, userId, 'stripe', session.amount_total || 100, 'completed');
    }
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* Keyed by IP by default. Behind a reverse proxy (nginx, Render,      */
/* Railway, etc.) set TRUST_PROXY=1 in .env so req.ip reflects the     */
/* real client IP instead of the proxy's — otherwise every request     */
/* looks like it comes from one IP and legitimate users get limited    */
/* together.                                                            */
/* ------------------------------------------------------------------ */
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

function jsonRateLimitHandler(req, res) {
  res.status(429).json({ error: 'Too many requests — please wait a bit and try again.' });
}

// Brute-force / mass-signup guard: tight, per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

// Stops someone from hammering Stripe/PayPal's API (and running up your
// account's API usage / triggering their own abuse flags) through us.
const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

// Baseline safety net on everything else under /api — generous enough
// not to bother a normal player, tight enough to blunt a script hammering
// the server. The Stripe/PayPal webhooks are exempted below since those
// requests come from Stripe/PayPal's own servers, not end users, and
// dropping a payment confirmation would be worse than any abuse risk.
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/webhook/')) return next();
  return generalApiLimiter(req, res, next);
});

/* ------------------------------------------------------------------ */
/* Origin check — blocks API calls from copied frontends pointed at    */
/* this backend. Skips GET requests (safe/read-only) and the webhook   */
/* routes (Stripe/PayPal don't send an Origin header matching yours).  */
/* ------------------------------------------------------------------ */
const ALLOWED_ORIGINS = [SITE_URL, 'http://localhost:3000', 'http://localhost:3001'];
app.use('/api/', (req, res, next) => {
  if (req.method === 'GET' || req.path.startsWith('/webhook/')) return next();
  const origin = req.headers.origin || req.headers.referer || '';
  const ok = ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
  if (!ok) {
    return res.status(403).json({ error: 'requests must come from the official site' });
  }
  next();
});

/* ------------------------------------------------------------------ */
/* Auth helpers                                                        */
/* ------------------------------------------------------------------ */
function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}
function setAuthCookie(res, token) {
  res.cookie('portus_token', token, {
    httpOnly: true,
    secure: IS_PROD, // requires HTTPS in production — your host's Let's Encrypt cert covers this
    sameSite: 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}
function requireAuth(req, res, next) {
  const token = req.cookies.portus_token;
  if (!token) return res.status(401).json({ error: 'not logged in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'session expired, please log in again' });
  }
}
function grantHours(userId, hours) {
  const user = db.prepare('SELECT access_expires_at FROM users WHERE id=?').get(userId);
  const base = Math.max(Date.now(), user?.access_expires_at || 0);
  const newExpiry = base + hours * 3600 * 1000;
  db.prepare('UPDATE users SET access_expires_at=? WHERE id=?').run(newExpiry, userId);
  return newExpiry;
}

/* ------------------------------------------------------------------ */
/* Account routes                                                      */
/* ------------------------------------------------------------------ */
app.post('/api/signup', authLimiter, async (req, res) => {
  const { email, password, captainName } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'email and a password of 6+ characters are required' });
  }
  const normEmail = String(email).toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(normEmail);
  if (existing) return res.status(409).json({ error: 'an account with that email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, captain_name) VALUES (?,?,?)')
    .run(normEmail, hash, captainName || '');
  const userId = info.lastInsertRowid;
  const token = signToken({ id: userId, email: normEmail });
  setAuthCookie(res, token);

  if (DEV_FREE_PLAY) {
    db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(userId);
    grantHours(userId, 24);
    console.warn(`[DEV_FREE_PLAY] Auto-verified and granted 24h free access to ${normEmail}`);
  } else {
    const verifyToken = setVerificationToken(userId);
    try { await sendVerificationEmail(normEmail, verifyToken); }
    catch (e) { console.error('Failed to send verification email:', e.message); }
  }

  res.json({ ok: true, email: normEmail });
});

app.post('/api/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const normEmail = String(email || '').toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(normEmail);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'wrong email or password' });
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  if (DEV_FREE_PLAY) {
    db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(user.id);
    grantHours(user.id, 24);
    console.warn(`[DEV_FREE_PLAY] Auto-verified and granted 24h free access to ${user.email}`);
  }
  res.json({ ok: true, email: user.email });
});

// Always responds the same way whether or not the account exists —
// otherwise this endpoint becomes a way to check which emails have accounts.
app.post('/api/request-password-reset', authLimiter, async (req, res) => {
  const normEmail = String((req.body || {}).email || '').toLowerCase().trim();
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(normEmail);
  if (user) {
    const token = makeToken();
    db.prepare('UPDATE users SET reset_token_hash=?, reset_token_expires=? WHERE id=?')
      .run(hashToken(token), Date.now() + 3600 * 1000, user.id);
    try { await sendPasswordResetEmail(normEmail, token); }
    catch (e) { console.error('Failed to send reset email:', e.message); }
  }
  res.json({ ok: true });
});

app.post('/api/reset-password', authLimiter, (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'a valid link and a password of 6+ characters are required' });
  }
  const hash = hashToken(String(token));
  const user = db.prepare('SELECT id, reset_token_expires FROM users WHERE reset_token_hash=?').get(hash);
  if (!user || !user.reset_token_expires || user.reset_token_expires < Date.now()) {
    return res.status(400).json({ error: 'that reset link is invalid or expired' });
  }
  const passHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash=?, reset_token_hash=NULL, reset_token_expires=NULL WHERE id=?')
    .run(passHash, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('portus_token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT email, captain_name, access_expires_at, email_verified FROM users WHERE id=?')
    .get(req.user.uid);
  if (!user) return res.status(404).json({ error: 'account not found' });
  res.json({
    email: user.email,
    captainName: user.captain_name,
    accessExpiresAt: user.access_expires_at,
    emailVerified: !!user.email_verified,
  });
});

// Clicked from the email — no auth cookie required, since the token
// itself (unguessable, hashed at rest, 24h expiry) is the proof.
app.get('/api/verify-email', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect(`${SITE_URL}/?verify=missing`);
  const hash = hashToken(String(token));
  const user = db.prepare('SELECT id, verify_token_expires FROM users WHERE verify_token_hash=?').get(hash);
  if (!user || !user.verify_token_expires || user.verify_token_expires < Date.now()) {
    return res.redirect(`${SITE_URL}/?verify=invalid`);
  }
  db.prepare(
    'UPDATE users SET email_verified=1, verify_token_hash=NULL, verify_token_expires=NULL WHERE id=?'
  ).run(user.id);
  res.redirect(`${SITE_URL}/?verify=success`);
});

app.post('/api/resend-verification', authLimiter, requireAuth, async (req, res) => {
  const user = db.prepare('SELECT email, email_verified FROM users WHERE id=?').get(req.user.uid);
  if (!user) return res.status(404).json({ error: 'account not found' });
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });
  const token = setVerificationToken(req.user.uid);
  try { await sendVerificationEmail(user.email, token); }
  catch (e) { console.error('Failed to send verification email:', e.message); return res.status(500).json({ error: 'could not send email right now' }); }
  res.json({ ok: true });
});

// The paywall's real source of truth — the client polls this instead of
// trusting its own in-memory timer.
app.get('/api/session', requireAuth, (req, res) => {
  const user = db.prepare('SELECT access_expires_at FROM users WHERE id=?').get(req.user.uid);
  res.json({ accessExpiresAt: user ? user.access_expires_at : 0, now: Date.now() });
});

/* ------------------------------------------------------------------ */
/* Cloud save routes                                                    */
/* ------------------------------------------------------------------ */
app.get('/api/save', requireAuth, (req, res) => {
  const row = db.prepare('SELECT state_json, updated_at FROM saves WHERE user_id=?').get(req.user.uid);
  if (!row) return res.json({ state: null });
  res.json({ state: JSON.parse(row.state_json), updatedAt: row.updated_at });
});

app.post('/api/save', requireAuth, (req, res) => {
  const state = req.body;
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'missing save state' });
  const json = JSON.stringify(state);
  db.prepare(
    `INSERT INTO saves (user_id, state_json, updated_at) VALUES (?, ?, strftime('%s','now')*1000)
     ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  ).run(req.user.uid, json);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Stripe checkout (card payments)                                     */
/* ------------------------------------------------------------------ */
app.post('/api/checkout/stripe', checkoutLimiter, requireAuth, async (req, res) => {
  const acct = db.prepare('SELECT email_verified FROM users WHERE id=?').get(req.user.uid);
  if (!acct || !acct.email_verified) {
    return res.status(403).json({ error: 'Please verify your email before purchasing a pass.' });
  }
  if (!stripe) return res.status(500).json({ error: 'Stripe is not configured on this server yet' });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Portus — 1 hour pass' },
            unit_amount: 100, // $1.00, in cents
          },
          quantity: 1,
        },
      ],
      client_reference_id: String(req.user.uid), // ties the payment back to this account
      success_url: `${SITE_URL}/?paid=stripe`,
      cancel_url: `${SITE_URL}/?paid=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not start checkout' });
  }
});

/* ------------------------------------------------------------------ */
/* PayPal checkout — built around a real "no-code" Pay Link            */
/* (paypal.com/ncp/payment/...) rather than dynamically-created        */
/* orders. A static link can't carry a per-user ID through to PayPal   */
/* and back, so instead we verify the webhook PayPal sends when the    */
/* link is paid, and match the transaction to an account by the        */
/* payer's email address. Still fully server-verified — nothing here   */
/* trusts the browser.                                                  */
/* ------------------------------------------------------------------ */
const PAYPAL_PAY_LINK = process.env.PAYPAL_PAY_LINK || null;
const PAYPAL_API_BASE = IS_PROD ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function paypalAccessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('could not get PayPal access token');
  return data.access_token;
}

async function verifyPaypalWebhook(req) {
  const token = await paypalAccessToken();
  const body = {
    auth_algo: req.headers['paypal-auth-algo'],
    cert_url: req.headers['paypal-cert-url'],
    transmission_id: req.headers['paypal-transmission-id'],
    transmission_sig: req.headers['paypal-transmission-sig'],
    transmission_time: req.headers['paypal-transmission-time'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: req.body,
  };
  const r = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return data.verification_status === 'SUCCESS';
}

// The frontend calls this the same way it calls /api/checkout/stripe —
// it just hands back a URL to redirect to. The real security gate
// (verified email) still happens here, server-side, before the link
// is even handed out.
app.post('/api/checkout/paypal', checkoutLimiter, requireAuth, async (req, res) => {
  const acct = db.prepare('SELECT email_verified FROM users WHERE id=?').get(req.user.uid);
  if (!acct || !acct.email_verified) {
    return res.status(403).json({ error: 'Please verify your email before purchasing a pass.' });
  }
  if (!PAYPAL_PAY_LINK) {
    return res.status(500).json({ error: 'PayPal is not configured on this server yet' });
  }
  res.json({ url: PAYPAL_PAY_LINK });
});

// PayPal calls this directly (server-to-server) when the Pay Link is
// paid — this is the step that actually grants access, independent of
// whatever happens in the buyer's browser afterward.
app.post('/api/webhook/paypal-link', async (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_WEBHOOK_ID) {
    console.warn('PayPal webhook received but PAYPAL_CLIENT_ID/PAYPAL_WEBHOOK_ID not configured — ignoring.');
    return res.status(500).send('not configured');
  }
  let verified = false;
  try { verified = await verifyPaypalWebhook(req); }
  catch (e) { console.error('PayPal webhook verification error:', e.message); }
  if (!verified) {
    console.warn('PayPal webhook failed signature verification — ignoring.');
    return res.status(400).send('invalid signature');
  }

  const event = req.body;
  // CHECKOUT.ORDER.APPROVED fires once per order and reliably includes
  // the payer's email — that's what we grant access on. (We deliberately
  // don't also grant on PAYMENT.CAPTURE.COMPLETED for the same order,
  // to avoid double-granting an hour for one payment.)
  if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
    const resource = event.resource || {};
    const payerEmail = resource.payer?.email_address;
    const amount = resource.purchase_units?.[0]?.amount;
    const orderId = resource.id;

    if (!payerEmail) {
      console.warn(`PayPal order ${orderId} approved but no payer email in payload — needs manual reconciliation.`);
      return res.json({ received: true });
    }
    if (amount && (amount.currency_code !== 'USD' || Number(amount.value) < 0.99)) {
      console.warn(`PayPal order ${orderId} had unexpected amount ${amount.value} ${amount.currency_code} — skipping auto-grant.`);
      return res.json({ received: true });
    }

    const user = db.prepare('SELECT id FROM users WHERE email=?').get(payerEmail.toLowerCase());
    if (user) {
      grantHours(user.id, 1);
      db.prepare(
        `INSERT OR IGNORE INTO payments (id,user_id,provider,amount_cents,status) VALUES (?,?,?,?,?)`
      ).run(orderId, user.id, 'paypal', Math.round((amount ? Number(amount.value) : 1) * 100), 'completed');
    } else {
      console.warn(`PayPal payment from ${payerEmail} (order ${orderId}) doesn't match any account — needs manual reconciliation.`);
    }
  }
  res.json({ received: true });
});

/* ------------------------------------------------------------------ */
app.listen(PORT, () => console.log(`Portus server listening on port ${PORT}`));
