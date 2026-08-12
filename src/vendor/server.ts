import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CATALOG, getCatalog, type PlanKey, type PricingCatalog } from './catalog.js';

interface User { email: string; password: string; token: string; verified: boolean; createdAt: number; }
interface Store { users: User[]; pricingVersion: string; }

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? './.data';
const storePath = path.join(dataDir, 'vendor.json');
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
const signupSecret = process.env.SIGNUP_SHARED_SECRET ?? '';
const adminSecret = process.env.ADMIN_SECRET ?? '';
const agentMailApiKey = process.env.AGENTMAIL_API_KEY;
let activeMailboxId = process.env.VENDOR_MAILBOX_ID;
let store: Store = { users: [], pricingVersion: 'v1' };
let persistenceEnabled = true;
const instanceId = randomUUID();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function escapeJsonScript(value: string): string {
  return value.replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}
function html(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}
function cookie(req: Request, name: string): string | undefined {
  const match = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
function sessionUser(req: Request): User | undefined {
  const email = cookie(req, 'acme_session');
  return store.users.find((user) => user.email === email && user.verified);
}
function accountPage(email: string): string {
  return html('Acme Cloud account', `<h1 id="authenticated">Authenticated</h1><p id="account-email">${escapeHtml(email)}</p>`);
}
function dashboardPage(user: User): string {
  const catalog = getCatalog(store.pricingVersion);
  const plans = (Object.keys(catalog.plans) as PlanKey[]).map((key) => ({
    key, ...catalog.plans[key],
  }));
  const json = escapeJsonScript(JSON.stringify({ plans, pricingVersion: catalog.version }));
  return html('Acme Cloud dashboard', `<h1>Acme Cloud dashboard</h1>
    <p id="dashboard-email">${escapeHtml(user.email)}</p>
    ${plans.map((plan) => `<section id="plan-${plan.key}">
      <h2 id="plan-${plan.key}-name">${escapeHtml(plan.name)}</h2>
      <p id="plan-${plan.key}-price">$${plan.monthlyPrice}/month</p>
      <p id="plan-${plan.key}-seats">${plan.seatLimit} seats</p>
      <ul id="plan-${plan.key}-features">${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
    </section>`).join('')}
    <p id="pricing-version">${escapeHtml(catalog.version)}</p>
    <script type="application/json" id="plan-json">${json}</script>`);
}
async function persistStore(): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    persistenceEnabled = false;
    console.warn(`vendor store persistence disabled: ${String(error)}`);
  }
}
async function loadStore(): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(storePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid store');
    const candidate = parsed as Partial<Store>;
    if (!Array.isArray(candidate.users) || typeof candidate.pricingVersion !== 'string') throw new Error('invalid store');
    store = { users: candidate.users, pricingVersion: candidate.pricingVersion };
  } catch {
    try { await mkdir(dataDir, { recursive: true }); await persistStore(); }
    catch (error) { persistenceEnabled = false; console.warn(`vendor store persistence disabled: ${String(error)}`); }
  }
}
async function createMailbox(): Promise<string | undefined> {
  if (activeMailboxId || !agentMailApiKey) return activeMailboxId;
  const response = await fetch('https://api.agentmail.to/v0/inboxes', {
    method: 'POST',
    headers: { authorization: `Bearer ${agentMailApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: 'living-vendor-graph-acme', display_name: 'Living Vendor Graph Acme Cloud',
      domain: 'agentstead.sh', metadata: { living_vendor_graph: true },
    }),
  });
  if (!response.ok) throw new Error(`AgentMail inbox creation failed (${response.status}): ${await response.text()}`);
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) throw new Error('AgentMail inbox response was invalid');
  const record = body as Record<string, unknown>;
  const id = record.inbox_id ?? record.id ?? record.email;
  if (typeof id !== 'string') throw new Error('AgentMail inbox response had no usable ID');
  activeMailboxId = id;
  return id;
}
async function sendVerification(email: string, link: string): Promise<void> {
  const sender = activeMailboxId ?? await createMailbox();
  if (!sender || !agentMailApiKey) throw new Error('VENDOR_MAILBOX_ID or AGENTMAIL_API_KEY is required for signup');
  const response = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(sender)}/messages/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${agentMailApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      to: [email], subject: 'Acme Cloud verification',
      text: `Verify your Acme Cloud account by opening this link: ${link}`,
      html: `<p>Verify your Acme Cloud account: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    }),
  });
  if (!response.ok) throw new Error(`AgentMail send failed (${response.status}): ${await response.text()}`);
}
function requireAdmin(req: Request, res: Response): boolean {
  if (!adminSecret || req.header('x-admin-secret') !== adminSecret) {
    res.status(403).type('html').send(html('Forbidden', '<h1 id="forbidden">Admin secret required</h1>'));
    return false;
  }
  return true;
}

app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'vendor-target', instance: instanceId }));
app.get('/', (_req, res) => res.redirect('/pricing'));
app.get('/pricing', (_req, res) => res.type('html').send(html('Acme Cloud pricing', `<h1>Acme Cloud</h1>
  <p>Simple cloud operations for growing teams.</p><h2>Starter</h2><p>Starting at $19/month</p>
  <h2>Pro</h2><p>Starting at $49/month</p><p>Contact sales for current limits and feature availability.</p>`)));

app.get('/signup', (req, res) => {
  const secret = req.query.secret;
  if (typeof secret === 'string' && secret === signupSecret && signupSecret) {
    res.cookie('acme_signup_secret', secret, { httpOnly: true, sameSite: 'lax' });
  }
  res.type('html').send(html('Sign up', `<h1>Sign up for Acme Cloud</h1><form method="post" action="/signup">
    <label>Email <input id="email" name="email" type="email"></label>
    <label>Password <input id="password" name="password" type="password"></label>
    <button id="signup-submit" type="submit">Sign up</button></form>`));
});
app.post('/signup', async (req, res, next) => {
  try {
    const presentedSecret = req.header('x-vendor-signup-secret') ?? cookie(req, 'acme_signup_secret');
    if (!signupSecret || presentedSecret !== signupSecret) { res.status(403).type('html').send('signup secret required'); return; }
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || !password) { res.status(422).type('html').send('email and password required'); return; }
    const user: User = { email, password, token: randomBytes(18).toString('hex'), verified: false, createdAt: Date.now() };
    store.users = store.users.filter((candidate) => candidate.email !== email);
    store.users.push(user);
    await persistStore();
    await sendVerification(email, `${publicBaseUrl.replace(/\/$/, '')}/verify?token=${encodeURIComponent(user.token)}`);
    res.type('html').send(html('Check your email', `<h1 id="pending">Check your email</h1><p>${escapeHtml(email)}</p>`));
  } catch (error) { next(error); }
});
app.get('/verify', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const user = store.users.find((candidate) => candidate.token === token);
  if (!user) { res.status(404).type('html').send(html('Invalid link', '<h1 id="invalid-link">Invalid link</h1>')); return; }
  user.verified = true;
  await persistStore();
  res.cookie('acme_session', user.email, { httpOnly: true, sameSite: 'lax' });
  res.type('html').send(dashboardPage(user));
});
app.get('/login', (_req, res) => res.type('html').send(html('Sign in', `<h1>Sign in to Acme Cloud</h1>
  <form method="post" action="/login"><label>Email <input id="email" name="email" type="email"></label>
  <label>Password <input id="password" name="password" type="password"></label><button id="login-submit" type="submit">Sign in</button></form>`)));
app.post('/login', (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = store.users.find((candidate) => candidate.email === email);
  if (!user?.verified || user.password !== password) { res.status(401).type('html').send(html('Invalid credentials', '<h1 id="login-failed">Invalid credentials</h1>')); return; }
  res.cookie('acme_session', user.email, { httpOnly: true, sameSite: 'lax' }).type('html').send(accountPage(user.email));
});
app.get('/dashboard', (req, res) => {
  const user = sessionUser(req);
  if (!user) { res.status(401).type('html').send(html('Not authenticated', '<h1 id="unauthenticated">Not authenticated</h1>')); return; }
  res.type('html').send(dashboardPage(user));
});
app.get('/account', (req, res) => {
  const user = sessionUser(req);
  if (!user) { res.status(401).type('html').send(html('Not authenticated', '<h1 id="unauthenticated">Not authenticated</h1>')); return; }
  res.type('html').send(accountPage(user.email));
});
app.get('/admin/pricing-version', (req, res) => {
  if (requireAdmin(req, res)) res.json({ version: store.pricingVersion, catalog: getCatalog(store.pricingVersion) });
});
app.post('/admin/pricing-version', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const version = typeof req.body.version === 'string' ? req.body.version : '';
  if (!(version in CATALOG)) { res.status(422).json({ error: 'version must be one of the supported pricing versions' }); return; }
  store.pricingVersion = version;
  await persistStore();
  const catalog: PricingCatalog = getCatalog(version);
  res.json({ version, catalog });
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).type('html').send(html('Vendor error', '<h1 id="server-error">Vendor app error</h1>'));
});

await loadStore();
try {
  activeMailboxId = await createMailbox();
  if (activeMailboxId) console.log(`Acme Cloud AgentMail sender inbox: ${activeMailboxId}`);
} catch (error) { console.warn(`AgentMail inbox setup deferred: ${String(error)}`); }
app.listen(port, '0.0.0.0', () => console.log(`Acme Cloud vendor target listening on :${port}`));
