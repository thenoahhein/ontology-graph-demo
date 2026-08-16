import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentsteadClient, type MailWaitResult } from '../agentstead/client.js';
import type { Observation } from '../graph/observation.js';
import { appendToSelectedSinks, selectSinks, type SinkMode } from '../graph/sink.js';
import { FileSink } from '../graph/file-sink.js';
import { ZepSearchTimeoutError } from '../graph/zep-sink.js';
import { dashboardSelectors, parseDashboard } from './dashboard.js';

interface LocalState {
  workspaceId: string;
  credentialId?: string;
  vendorBaseUrl: string;
  ledgerPath: string;
}

const dataDir = process.env.DATA_DIR ?? './.data';
const statePath = path.join(dataDir, 'orchestrator.json');
const vendorBaseUrl = (process.env.VENDOR_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const sinkMode = parseSink(process.env.SINK_MODE ?? 'auto');
const client = new AgentsteadClient();

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !['observe', 'flip', 'diff', 'demo'].includes(command)) {
    throw new Error('Usage: observe | flip <v1|v2> | diff | demo');
  }
  const flags = parseFlags(args);
  if (command === 'observe') await observe(flags.sink);
  if (command === 'flip') await flip(flags.positionals[0]);
  if (command === 'diff') await diff(flags.sink);
  if (command === 'demo') {
    await flip('v1');
    await observe(flags.sink);
    await flip('v2');
    await observe(flags.sink);
    await diff(flags.sink);
  }
}

async function observe(sinkModeOverride?: SinkMode): Promise<void> {
  const state = await loadState();
  const targetBaseUrl = resolveVendorBaseUrl(state);
  let workspace = state
    ? await client.getWorkspace(state.workspaceId)
    : await client.createWorkspace(`Living Vendor Graph ${Date.now()}`);
  if (workspace.status !== 'ready') workspace = await client.waitForWorkspaceReady(workspace.id);
  const identity = await client.getIdentity(workspace.id);
  console.log(`Agentstead workspace ${workspace.id} (${identity.email_address})`);
  const session = await client.connectBrowser(workspace.id, { reuse: true });
  try {
    let loggedIn = await isAuthenticated(session.id, targetBaseUrl);
    let signupAttempted = false;
    let credentialId = state?.credentialId;
    if (!loggedIn) {
      const credentials = await client.listCredentials(workspace.id);
      const existing = credentialId
        ? credentials.find((credential) => credential.id === credentialId)
        : credentials.find((credential) => credential.site === targetBaseUrl);
      if (existing) {
        credentialId = existing.id;
        await login(session.id, credentialId, targetBaseUrl);
        loggedIn = await isAuthenticated(session.id, targetBaseUrl);
        if (!loggedIn) {
          signupAttempted = true;
          credentialId = await signupWithClearError(session.id, identity.email_address, workspace.id, targetBaseUrl);
          loggedIn = await isAuthenticated(session.id, targetBaseUrl);
        }
      } else {
        signupAttempted = true;
        credentialId = await signupWithClearError(session.id, identity.email_address, workspace.id, targetBaseUrl);
        loggedIn = await isAuthenticated(session.id, targetBaseUrl);
      }
    }
    if (!loggedIn) {
      throw new Error(signupAttempted
        ? 'Signup failed: verification completed but vendor account is not authenticated'
        : 'Credential login did not authenticate the vendor account');
    }
    const dashboard = await client.navigatePage(session.id, `${targetBaseUrl}/dashboard`);
    const read = await client.readPage(session.id, dashboardSelectors(), targetBaseUrl);
    const parsed = parseDashboard(read);
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const unique = randomUUID();
    const rawPath = `evidence/${timestamp}-${unique}-dashboard-read.json`;
    const screenshotPath = `evidence/${timestamp}-${unique}-dashboard.png`;
    const rawFile = await client.createFile(workspace.id, rawPath, 'application/json', Buffer.from(JSON.stringify(read, null, 2)).toString('base64'));
    const screenshot = await client.screenshotPage(session.id, targetBaseUrl, true);
    const screenshotFile = await client.createFile(workspace.id, screenshotPath, 'image/png', screenshot.image_base64);
    const observation: Observation = {
      observed_at: new Date().toISOString(),
      source: {
        kind: 'authenticated_page',
        url: dashboard.url,
        workspace_id: workspace.id,
        evidence_file_id: rawFile.id,
        screenshot_file_id: screenshotFile.id,
      },
      company: 'Acme Cloud',
      product: 'Acme Cloud',
      plans: parsed.plans.map((plan) => ({
        plan: plan.name,
        monthly_price: plan.monthlyPrice,
        seat_limit: plan.seatLimit,
        features: plan.features,
      })),
      pricing_version: parsed.pricingVersion,
    };
    await saveState({
      workspaceId: workspace.id,
      credentialId,
      vendorBaseUrl: targetBaseUrl,
      ledgerPath: path.join(dataDir, 'observations.jsonl'),
    });
    const sinks = selectSinks(sinkModeOverride ?? sinkMode, dataDir, workspace.id);
    await appendToSelectedSinks(sinks, observation);
    console.log(`Observed ${observation.pricing_version}; evidence ${rawFile.id}; screenshot ${screenshotFile.id}`);
  } finally {
    await client.closeBrowser(session.id);
  }
}

async function isAuthenticated(sessionId: string, targetBaseUrl: string): Promise<boolean> {
  const accountPage = await client.navigatePage(sessionId, `${targetBaseUrl}/account`);
  if (!accountPage.url.startsWith(targetBaseUrl)) return false;
  const accountRead = await client.readPage(sessionId, ['#authenticated'], targetBaseUrl);
  return accountRead.selectors.some((selector) => selector.selector === '#authenticated' && selector.found);
}

async function signupWithClearError(
  sessionId: string, email: string, workspaceId: string, targetBaseUrl: string,
): Promise<string> {
  try {
    return await signup(sessionId, email, workspaceId, targetBaseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Signup failed: ${message}`);
  }
}

async function signup(sessionId: string, email: string, workspaceId: string, targetBaseUrl: string): Promise<string> {
  const signupSecret = process.env.SIGNUP_SHARED_SECRET;
  if (!signupSecret) throw new Error('SIGNUP_SHARED_SECRET is required for the signup path');
  await client.navigatePage(sessionId, `${targetBaseUrl}/signup?secret=${encodeURIComponent(signupSecret)}`);
  await client.fillPage(sessionId, targetBaseUrl, [{ selector: '#email', value: email }]);
  const credential = await client.createCredential(workspaceId, {
    label: `acme-cloud-${Date.now()}`,
    site: targetBaseUrl,
    username: email,
    generate: true,
    secretLength: 24,
  });
  const mailSince = Date.now() - 5_000;
  await client.fillCredential(sessionId, credential.id, [{ field: 'password', selector: '#password' }], '#signup-submit');
  await client.waitForSelector(sessionId, '#pending', 60_000, targetBaseUrl);
  const mail = await client.waitForMail(workspaceId, {
    subjectContains: 'Acme Cloud verification',
    since: mailSince,
    timeoutMs: 120_000,
  });
  const messageTimestamp = mail.message?.timestamp;
  if (mail.message !== null && (messageTimestamp === undefined || !isFreshMessage(messageTimestamp, mailSince))) {
    throw new Error(`Verification email was older than signup boundary (${new Date(mailSince).toISOString()})`);
  }
  const link = mail.extraction.links[0]?.url;
  if (!link) throw new Error(mailFailure(mail));
  await client.navigatePage(sessionId, link);
  return credential.id;
}

function isFreshMessage(timestamp: string, since: number): boolean {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed >= since;
}

async function login(sessionId: string, credentialId: string, targetBaseUrl: string): Promise<void> {
  await client.navigatePage(sessionId, `${targetBaseUrl}/login`);
  await client.fillCredential(sessionId, credentialId, [
    { field: 'username', selector: '#email' },
    { field: 'password', selector: '#password' },
  ], '#login-submit');
  await client.waitForSelector(sessionId, '#authenticated', 30_000, targetBaseUrl);
}

async function flip(version: string | undefined): Promise<void> {
  if (version !== 'v1' && version !== 'v2') throw new Error('flip expects v1 or v2');
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) throw new Error('ADMIN_SECRET is required for flip');
  const state = await loadState();
  const targetBaseUrl = resolveVendorBaseUrl(state);
  const response = await fetch(`${targetBaseUrl}/admin/pricing-version`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-secret': adminSecret },
    body: JSON.stringify({ version }),
  });
  if (!response.ok) throw new Error(`Vendor pricing flip failed (${response.status}): ${await response.text()}`);
  console.log(JSON.stringify(await response.json()));
}

async function diff(sinkModeOverride?: SinkMode): Promise<void> {
  const ledger = new FileSink(dataDir);
  const observations = (await ledger.readAll()).sort((left, right) => left.observed_at.localeCompare(right.observed_at));
  if (observations.length === 0) throw new Error(`No observations found at ${ledger.ledgerPath}`);
  const plans = new Map<string, Observation['plans'][number]>();
  for (const observation of observations) {
    for (const plan of observation.plans) {
      const previous = plans.get(plan.plan);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(plan)) {
        const next = observations.find((candidate) =>
          candidate.observed_at > observation.observed_at &&
          candidate.plans.some((candidatePlan) => candidatePlan.plan === plan.plan &&
            JSON.stringify(candidatePlan) !== JSON.stringify(plan)));
        const until = next?.observed_at ?? 'present';
        console.log(`Acme ${plan.plan} Plan ──costs──> $${plan.monthly_price}/month  valid ${formatDate(observation.observed_at)} → ${formatDate(until)}`);
        console.log(`  seats: ${plan.seat_limit}; features: ${plan.features.join(', ')}; evidence: ${observation.source.evidence_file_id}, screenshot: ${observation.source.screenshot_file_id}`);
        plans.set(plan.plan, plan);
      }
    }
  }
  const requestedSinkMode = sinkModeOverride ?? sinkMode;
  if (process.env.ZEP_API_KEY && requestedSinkMode !== 'file') {
    const state = await loadState();
    const graphId = state?.workspaceId ?? process.env.ZEP_GRAPH_ID;
    if (graphId) {
      const sinks = selectSinks(requestedSinkMode === 'auto' ? 'zep' : requestedSinkMode, dataDir, graphId);
      if (sinks.remote) {
        const latest = observations[observations.length - 1];
        if (!latest) throw new Error('No observations available for Zep search');
        const expectedFacts = latest.plans.map((plan) => ({
          plan: plan.plan,
          monthlyPrice: plan.monthly_price,
        }));
        let result: unknown;
        try {
          result = await sinks.remote.waitForSearch(
            'Acme Cloud',
            (value) => hasZepFacts(value, expectedFacts),
          );
        } catch (error) {
          if (!(error instanceof ZepSearchTimeoutError)) throw error;
          console.log('Zep is still processing; rendering the edges currently available.');
          result = await sinks.remote.search('Acme Cloud');
        }
        console.log('Zep search results:');
        printZepFacts(result);
      }
      if (process.env.ZEP_GRAPH_VIEWER_URL) console.log(`Zep graph viewer: ${process.env.ZEP_GRAPH_VIEWER_URL.replace('{graphId}', graphId)}`);
    }
  }
}

function mailFailure(mail: MailWaitResult): string {
  return mail.timed_out
    ? `Verification email timed out: ${JSON.stringify(mail.diagnostics)}`
    : 'Verification email did not contain an extracted verification link';
}

async function loadState(): Promise<LocalState | undefined> {
  try { return JSON.parse(await readFile(statePath, 'utf8')) as LocalState; }
  catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}
async function saveState(state: LocalState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
function formatDate(value: string): string {
  return value === 'present' ? value : value.slice(0, 10);
}

function resolveVendorBaseUrl(state: LocalState | undefined): string {
  return state?.vendorBaseUrl ?? vendorBaseUrl;
}

function printZepFacts(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    console.log(JSON.stringify(value));
    return;
  }
  const result = value as Record<string, unknown>;
  const edges = arrayValue(result.edges);
  if (edges.length === 0) {
    console.log('  (no Zep edges returned yet)');
    return;
  }
  for (const candidate of edges) {
    if (typeof candidate !== 'object' || candidate === null) {
      console.log(`  ${JSON.stringify(candidate)}`);
      continue;
    }
    const edge = candidate as Record<string, unknown>;
    const fact = typeof edge.fact === 'string' ? edge.fact : typeof edge.name === 'string' ? edge.name : 'Zep edge';
    const validAt = typeof edge.validAt === 'string' ? edge.validAt : 'unknown';
    const invalidAt = typeof edge.invalidAt === 'string' ? edge.invalidAt : 'present';
    const referenceTime = typeof edge.episode_reference_time === 'string'
      ? ` episode_reference_time=${edge.episode_reference_time}`
      : '';
    console.log(`  ${fact} valid ${validAt} → ${invalidAt}${referenceTime}`);
  }
}

function hasZepFacts(value: unknown, expectedFacts: Array<{ plan: string; monthlyPrice: number }>): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const edges = arrayValue((value as Record<string, unknown>).edges);
  const facts = edges.flatMap((edge) => {
    if (typeof edge !== 'object' || edge === null) return [];
    const fact = (edge as Record<string, unknown>).fact;
    return typeof fact === 'string' ? [fact.toLowerCase()] : [];
  });
  return expectedFacts.every(({ plan, monthlyPrice }) => {
    const planText = plan.toLowerCase();
    const amountText = String(monthlyPrice);
    return facts.some((fact) => fact.includes(planText) && fact.includes(amountText));
  });
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseFlags(args: string[]): { positionals: string[]; sink?: SinkMode } {
  const positionals: string[] = [];
  let selectedSink: SinkMode | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.startsWith('--sink=')) selectedSink = parseSink(arg.slice('--sink='.length));
    else if (arg === '--sink') {
      const value = args[index + 1];
      if (!value) throw new Error('--sink requires one of auto, file, or zep');
      selectedSink = parseSink(value);
      index += 1;
    }
    else positionals.push(arg);
  }
  return { positionals, sink: selectedSink };
}

function parseSink(value: string): SinkMode {
  if (value === 'auto' || value === 'file' || value === 'zep') return value;
  throw new Error('--sink must be one of auto, file, or zep');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
