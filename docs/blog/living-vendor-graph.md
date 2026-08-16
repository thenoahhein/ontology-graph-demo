# The Living Vendor Graph

### Giving a context graph an account, a browser, and a memory of where every fact came from

Context graphs give an agent a model of the world. **Agentstead gives the agent a place in it.**

A knowledge graph can tell you that Acme Cloud's Pro plan costs $49/month. It cannot tell you
whether that number came from a marketing page written eighteen months ago or from the billing
screen of a real account five minutes ago. It cannot log in. It cannot receive the verification
email. It cannot come back next week as the same user and check whether anything moved.

This tutorial builds the thing that can. By the end you will have:

* a deterministic SaaS target whose *public* page is deliberately vague and whose *authenticated*
  dashboard is the ground truth,
* an agent with a durable identity — its own mailbox, its own generated credential, its own
  persistent browser profile — that signs itself up and comes back later,
* every observation stored as immutable evidence (raw page read + screenshot) in that agent's
  workspace,
* a temporal graph in Zep where `Pro costs $49` does not get overwritten when the price changes;
  it gets *invalidated*, with a timestamp,
* and a small viewer that draws the dead edge next to the live one, with the evidence behind both.

Everything below is from a real run against a deployed target. The screenshots are the actual
artifacts the agent captured, not mockups, and the graph data is a capture of the live graph.

---

## The three layers

It helps to be precise about which system is responsible for what, because the interesting design
decision in this demo is what we *refused* to build.

| Layer | What it answers |
| --- | --- |
| Ontology / context graph | What exists? How is it related? What is true *now*? |
| Agent framework | What should the agent do next? |
| Agentstead | Who is the agent? What can it access? Can it return later? What did it do? |

Agentstead deliberately does not get nodes, edges, embeddings, or graph queries. The graph stays in
Zep, Graphiti, Neo4j, or the customer's own ontology. Agentstead supplies the durable workspace
identity, the supervised browser, the mailbox, the credentials, the evidence files, and the
activity trail.

That boundary is what makes the story composable. Your graph already knows that a vendor offers
SSO. Agentstead gives your agent the *account* that logged in, verified the claim, noticed when it
changed, and can act on it.

---

## Part 1 — A target that tells the truth only after you log in

Competitive-intelligence demos usually scrape a public pricing page, which is exactly the case
where you do not need an authenticated agent. So the target here is built the other way around.

`GET /pricing` is public and intentionally unhelpful:

![Acme Cloud public pricing page](./images/vendor-pricing-v1.png)

"Starting at $49/month. Contact sales for current limits and feature availability." No seat limit,
no feature list, no version. This is what a crawler sees.

The authenticated dashboard is where the real catalog lives, rendered from a typed, data-driven
catalog with two versions:

```ts
export const CATALOG: Record<PricingVersion, PricingCatalog> = {
  v1: {
    version: 'v1',
    plans: {
      starter: { name: 'Starter', monthlyPrice: 19, seatLimit: 3, features: ['Shared workspace', 'Email support'] },
      pro:     { name: 'Pro',     monthlyPrice: 49, seatLimit: 5, features: ['SSO', 'Audit log'] },
    },
  },
  v2: {
    version: 'v2',
    plans: {
      starter: { name: 'Starter', monthlyPrice: 19, seatLimit: 3, features: ['Shared workspace', 'Email support'] },
      pro:     { name: 'Pro',     monthlyPrice: 69, seatLimit: 10, features: ['SSO', 'Audit log', 'SCIM'] },
    },
  },
};
```

Starter is identical in both versions. That is on purpose: when the diff runs, you want a stable
plan sitting next to the changed one, so you can see that the graph is not simply re-asserting
everything it sees.

The dashboard markup gives every fact a stable ID, plus a JSON blob that is used strictly as a
cross-check (more on why later):

```ts
`<h2 id="plan-${plan.key}-name">${plan.name}</h2>
 <p  id="plan-${plan.key}-price">$${plan.monthlyPrice}/month</p>
 <p  id="plan-${plan.key}-seats">${plan.seatLimit} seats</p>
 <ul id="plan-${plan.key}-features">${plan.features.map((f) => `<li>${f}</li>`).join('')}</ul>`
// ...
`<p id="pricing-version">${catalog.version}</p>
 <script type="application/json" id="plan-json">${json}</script>`
```

And one admin endpoint lets us play the role of the vendor changing its mind:

```bash
curl -X POST "$VENDOR/admin/pricing-version" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H 'content-type: application/json' \
  -d '{"version":"v1"}'
```

It answers with the catalog it just switched to:

```json
{"version":"v1","catalog":{"version":"v1","plans":{"starter":{"name":"Starter","monthlyPrice":19,
"seatLimit":3,"features":["Shared workspace","Email support"]},"pro":{"name":"Pro","monthlyPrice":49,
"seatLimit":5,"features":["SSO","Audit log"]}}}}
```

Signup is guarded by a shared secret, and verification mail is sent through AgentMail, so the
target behaves like a real product: you cannot reach the dashboard without an account, and you
cannot get an account without receiving email.

---

## Part 2 — Giving the agent a place to live

The agent's identity is a workspace. One call creates it; one call waits for it to be real:

```ts
let workspace = state
  ? await client.getWorkspace(state.workspaceId)
  : await client.createWorkspace(`Living Vendor Graph ${Date.now()}`);
if (workspace.status !== 'ready') workspace = await client.waitForWorkspaceReady(workspace.id);

const identity = await client.getIdentity(workspace.id);
// -> lazyaward802@agentstead.sh
```

A ready workspace comes with three things the graph cannot supply for itself: a real inbox at a
real domain, a persistent browser profile, and a credential vault scoped to that identity.

Note the `waitForWorkspaceReady` reassignment — that line is a bug fix, not decoration. Workspace
creation returns immediately with a placeholder `@workspaces.invalid` address while the mailbox is
still being provisioned. Signing up with the pre-ready value gets you an account whose verification
email goes nowhere.

The browser is *supervised*: the client never receives a CDP URL and never drives Playwright
itself. It asks for page operations by name.

```ts
const session = await client.connectBrowser(workspace.id, { reuse: true });
await client.navigatePage(session.id, `${vendor}/signup?secret=${signupSecret}`);
await client.fillPage(session.id, vendor, [{ selector: '#email', value: identity.email_address }]);
await client.waitForSelector(session.id, '#pending', 60_000, vendor);
const read = await client.readPage(session.id, dashboardSelectors(), vendor);
const shot = await client.screenshotPage(session.id, vendor, true);
```

Navigate, fill, click, read, wait, screenshot. Every one of those is an audited, origin-bound
operation rather than arbitrary remote code execution against a browser you happen to be holding
open. The `origin` argument is not cosmetic: it pins the operation to the site you think you are on.

---

## Part 3 — Signing itself up, without ever seeing its own password

Here is the whole signup path:

```ts
await client.navigatePage(sessionId, `${vendor}/signup?secret=${signupSecret}`);
await client.fillPage(sessionId, vendor, [{ selector: '#email', value: email }]);

const credential = await client.createCredential(workspaceId, {
  label: `acme-cloud-${Date.now()}`,
  site: vendor,
  username: email,
  generate: true,          // Agentstead generates it
  secretLength: 24,
});

await client.fillCredential(
  sessionId, credential.id,
  [{ field: 'password', selector: '#password' }],
  '#signup-submit',
);
```

![Acme Cloud signup form](./images/vendor-signup.png)

The interesting call is `fillCredential`. The orchestrator never generates, sees, stores, or logs
the password. It hands Agentstead a credential ID, a field name, and a CSS selector; the secret is
injected server-side, into that origin only, and the form is submitted. The agent's own process
memory never contains the secret, which means a prompt-injected agent cannot leak what it does not
have.

Then the mailbox earns its place:

```ts
await client.waitForSelector(sessionId, '#pending', 60_000, vendor);
const mail = await client.waitForMail(workspaceId, {
  subjectContains: 'Acme Cloud verification',
  timeoutMs: 120_000,
  lookbackMs: 30_000,
});
const link = mail.extraction.links[0]?.url;
await client.navigatePage(sessionId, link);
```

`mail.extraction` matters more than it looks. Agentstead returns structured extractions — links
with confidence scores and a `matches_sender_domain` flag, plus codes for OTP-style flows — so the
agent is not regexing a raw HTML email body and hoping the first `https://` it finds is not a
tracking pixel or an unsubscribe link.

The `lookbackMs` window exists because the verification email frequently arrives *before* the wait
starts. Any real implementation of "wait for mail" needs to look slightly backwards in time, or
you will lose the race on fast providers.

---

## Part 4 — Reading the truth, and refusing to trust it blindly

Once verified, the agent lands on the authenticated dashboard and reads it by selector:

```ts
export function dashboardSelectors(): string[] {
  return [
    '#pricing-version', '#plan-json',
    '#plan-starter-name', '#plan-starter-price', '#plan-starter-seats', '#plan-starter-features',
    '#plan-pro-name', '#plan-pro-price', '#plan-pro-seats', '#plan-pro-features',
  ];
}
```

This is the actual `v1` screenshot the agent took and filed as evidence:

![Authenticated dashboard, v1](./images/v1-authenticated-dashboard.png)

Unstyled and ugly — and that is the point. This image is not a marketing asset, it is the
provenance for a number in a graph.

The parser treats the **visible selectors as authoritative** and the JSON blob as an optional
cross-check. If the JSON is missing or unparseable, the visible parse still wins. If the JSON is
present, well-formed, and *disagrees* with what a human would see on the page, the observation
fails loudly:

```ts
if (!isDashboardData(parsed)) throw new Error('Dashboard JSON blob had an unexpected shape');
if (!dashboardDataMatches(parsed, visible)) {
  throw new Error('Dashboard JSON blob disagreed with visible plan selectors');
}
```

That rule caught a genuinely subtle bug during the first live run. A supervised page read returns
the *text content* of a matched element, so an unordered feature list arrives as one run-on string:

```json
{ "selector": "#plan-pro-features", "found": true, "text": "SSOAudit logSCIM" }
```

Naive equality against `["SSO","Audit log","SCIM"]` fails, and the run aborts on a page that is
perfectly fine. The fix is to compare semantically — normalize whitespace and case, then keep the
structured features once the two sources agree:

```ts
function compactFeatures(features: string[]): string {
  return features.join('').replace(/\s+/g, '').toLowerCase();
}
```

---

## Part 5 — Evidence first, facts second

Before anything reaches the graph, the raw material is written to durable workspace files under
unique, timestamped paths:

```ts
const rawFile        = await client.createFile(workspace.id, rawPath, 'application/json', /* page read */);
const screenshot     = await client.screenshotPage(session.id, vendor, true);
const screenshotFile = await client.createFile(workspace.id, shotPath, 'image/png', screenshot.image_base64);
```

Only then is the structured observation assembled, with the file IDs baked into its provenance:

```json
{
  "observed_at": "2026-08-16T02:22:18.501Z",
  "source": {
    "kind": "authenticated_page",
    "url": "https://ontology-graph-demo-production.up.railway.app/dashboard",
    "workspace_id": "a0d2cde3-354a-479c-b7b4-392150c6a892",
    "evidence_file_id": "8d288735-f022-482f-83a1-6919b5165f07",
    "screenshot_file_id": "31fa45c0-678e-461e-862a-a226b7335767"
  },
  "company": "Acme Cloud",
  "product": "Acme Cloud",
  "plans": [
    { "plan": "Starter", "monthly_price": 19, "seat_limit": 3,  "features": ["Shared workspace", "Email support"] },
    { "plan": "Pro",     "monthly_price": 49, "seat_limit": 5,  "features": ["SSO", "Audit log"] }
  ],
  "pricing_version": "v1"
}
```

Every value in that document is traceable to a file you can download and look at.

**A boundary worth knowing:** Agentstead's activity events intentionally *omit* page-read text and
email bodies. Activity is a trigger stream and an audit trail, not a content store. So the division
of labour is: activity tells you *that* something happened, the orchestrator captures *what* was
seen, workspace files hold the raw proof, and the graph gets the structured copy.

The audit trail is genuinely useful on its own. Here is a real activity stream from a workspace
whose mailbox provisioning failed — you can see exactly which component broke and which one was
fine, without reading a single application log:

```json
{"type":"workspace.created",             "data":{"status":"provisioning"}}
{"type":"mailbox.failed",                "data":{"error_code":"permission_denied","provider":"agentmail"}}
{"type":"browser_profile.ready",         "data":{"provider":"browserbase"}}
{"type":"workspace.provisioning_retry",  "data":{"components":["mailbox"],"enqueued":["mailbox"]}}
{"type":"mailbox.failed",                "data":{"error_code":"permission_denied","provider":"agentmail"}}
```

Finally, the observation is appended to a local JSONL ledger *and* sent to the graph. The ledger is
append-only and is always written first; the graph is a consumer, not the system of record.

---

## Part 6 — Handing it to a temporal graph

The Zep sink declares an ontology before it writes anything:

```ts
const entityTypes = {
  Company: { fields: { company_name: entityFields.text('The company name.') } },
  Plan:    { fields: { plan_name:    entityFields.text('The plan name.') } },
  Price:   { fields: { amount:       entityFields.integer('The monthly price in whole currency units.') } },
  Evidence: { fields: {
    url:                entityFields.text('The authenticated page URL.'),
    evidence_file_id:   entityFields.text('The raw read evidence file ID.'),
    screenshot_file_id: entityFields.text('The screenshot evidence file ID.'),
  } },
  // Product, Feature ...
};

const edgeTypes = {
  HAS_PRICE:    { fields: { monthly_price: entityFields.integer('The monthly price.') },
                  sourceTargets: [{ source: 'Plan', target: 'Price' }] },
  SUPPORTED_BY: { sourceTargets: [{ source: 'Plan', target: 'Evidence' }] },
  // OFFERS, HAS_PLAN, HAS_FEATURE ...
};
```

> **Gotcha.** Zep reserves a set of field names — `name`, `summary`, `created_at`, `uuid`,
> `group_id` and friends. Declaring an entity field called `name` fails with
> `name cannot use a reserved name`. Hence `company_name`, `plan_name`, `feature_name`.

Ingestion is one call, and the only critical argument is the timestamp:

```ts
await this.client.graph.add({
  graphId: this.graphId,               // = the Agentstead workspace ID
  type: 'json',
  data: JSON.stringify(observation),
  createdAt: observation.observed_at,  // when it was TRUE, not when we uploaded it
  sourceDescription: 'Authenticated Acme Cloud pricing dashboard observation',
  metadata: { pricing_version, evidence_file_id, screenshot_file_id, /* ... */ },
});
```

Using the Agentstead workspace ID as the graph namespace is a small decision with a nice property:
one durable research agent, one graph, and every fact in it is attributable to evidence files that
live in the same workspace.

Extraction is asynchronous. Immediately after `graph.add` returns, a search may show nothing but an
unprocessed episode, so the CLI polls for the facts it expects and degrades gracefully instead of
lying:

```ts
try {
  result = await sink.waitForSearch('Acme Cloud', (value) => hasZepFacts(value, expectedFacts));
} catch (error) {
  if (!(error instanceof ZepSearchTimeoutError)) throw error;
  console.log('Zep is still processing; rendering the edges currently available.');
  result = await sink.search('Acme Cloud');
}
```

Match on plan name and price *amount*, not on an exact sentence. Zep writes facts in natural
language, and `The Pro plan costs $49 per month.` is a generated string, not a template you control:

```ts
facts.some((fact) => fact.includes(planText) && fact.includes(amountText));
```

---

## Part 7 — Change the world, then come back

Now the vendor changes its mind:

```bash
npm run flip -- v2
```

Notice what does *not* change. The public page still says the same thing it said before:

![Acme Cloud public pricing page, unchanged after the flip](./images/vendor-pricing-v2.png)

Still "Starting at $49/month". A public-page crawler would report *no change at all*. This is the
entire reason the authenticated path exists.

The agent observes again. Between the two observations the browser session was **closed** — the
first run ends with `closeBrowser(session.id)` in a `finally` block. The second run opens a brand
new session against the same durable profile, checks `/account`, finds itself already
authenticated, and skips signup entirely:

```ts
const accountPage = await client.navigatePage(session.id, `${vendor}/account`);
const accountRead = await client.readPage(session.id, ['#authenticated'], vendor);
loggedIn = accountRead.selectors.some((s) => s.selector === '#authenticated' && s.found);
// -> true, in a new session, with no second signup, no second credential, no second email
```

That is continuity: not a cookie jar the orchestrator is babysitting, but an identity the agent can
return to. It reads the dashboard again:

![Authenticated dashboard, v2](./images/v2-authenticated-dashboard.png)

`$69/month`, `10 seats`, `SCIM` — and a second evidence pair filed in the same workspace.

---

## Part 8 — The payoff: a fact that dies with a timestamp

Here is the whole point of using a temporal graph rather than a key-value store. The old price is
not overwritten. It is still there, marked dead, with the moment it stopped being true:

```text
Pro –HAS_PRICE→ $49   "The Pro plan costs $49 per month."
                      validAt   2026-08-16T02:22:18.501Z
                      invalidAt 2026-08-16T02:22:34Z

Pro –HAS_PRICE→ $69   "The Pro plan costs $69 per month."
                      validAt   2026-08-16T02:22:34Z
                      invalidAt —
```

Nothing in the orchestrator computed that invalidation. It sent two timestamped observations; Zep
worked out that the second superseded the first.

The repository includes a small static viewer (`npm run graph:view`) that renders a frozen capture
of the live graph. Superseded edges are drawn grey and dashed, current edges solid:

![The Living Vendor Graph viewer](./images/graph-viewer-full.png)

Clicking the dead `$49` edge resolves the episode it came from and shows the provenance — the
authenticated URL, the workspace, both evidence file IDs, and the screenshot the agent took at the
moment the fact was true:

![Clicking the superseded $49 edge](./images/graph-viewer-superseded-49.png)

The renderer's temporal styling is driven directly off the graph's own validity interval, which is
about as much code as it should be:

```ts
{ dead: edge.invalidAt ? 'true' : 'false' }
// edge[dead = "true"] -> grey, dashed, faded
```

That is the visual payoff promised at the start: `Acme Pro Plan ──costs──> $49/month` valid for
sixteen seconds of demo time, then `$69/month` valid to the present, and one click away from the
screenshot of the account page that proves it.

---

## Run it twice: what the graph does and does not guarantee

Being honest about a live run is more useful than a clean fiction, and running the identical
sequence twice is where the interesting caveat lives.

In the run shown above, both observations recorded the seat limit correctly — the v2 evidence file
plainly contains `"seat_limit": 10`, and the screenshot says `10 seats`. But Zep's extraction
produced a `HAS_SEAT_LIMIT` edge only for `5`, and never created the `10` edge, so that fact was
never superseded. Price and pricing version were invalidated correctly; the seat limit was not.

So I ran the whole thing again — same code, same target, same two-observation sequence, a different
workspace and a fresh graph. This time the extractor made *different* choices:

```text
Pro –HAS_PRICE→ $49         invalidAt 2026-08-16T03:17:41Z   (superseded, as before)
Pro –HAS_PRICE→ $69         current
Pro –HAS_SEAT_LIMIT→ 10     current      <- appeared this time
                                         <- and no HAS_SEAT_LIMIT→5 edge was created at all
Starter –HAS_SEAT_LIMIT→ 3  current      <- also new; absent from the first run
```

The second run also produced a duplicate, partly mislabelled version edge: alongside the correct
`PRICING_VERSION → v1` (invalidated at `03:17:41Z`), it created a `HAS_PRICING_VERSION` edge whose
target node is `v1` but whose fact text reads "Acme Cloud uses pricing version v2."

Two runs, identical structured input, two different graphs. That is the property to design around:
what gets promoted from an episode to an edge is not guaranteed to be exhaustive or stable, even
when the episode payload is complete, typed, and unambiguous. A declared ontology biases extraction;
it does not make it deterministic.

What *is* deterministic is the layer underneath. The CLI's `diff` is computed from the append-only
ledger, not from the graph, so it reads the same both times:

```text
Acme Starter Plan ──costs──> $19/month  valid 2026-08-16 → present
  seats: 3; features: Shared workspace, Email support; evidence: d1c0865d-…, screenshot: 8dc23c0c-…
Acme Pro Plan ──costs──> $49/month  valid 2026-08-16 → 2026-08-16
  seats: 5; features: SSO, Audit log; evidence: d1c0865d-…, screenshot: 8dc23c0c-…
Acme Pro Plan ──costs──> $69/month  valid 2026-08-16 → present
  seats: 10; features: SSO, Audit log, SCIM; evidence: 185d1e37-…, screenshot: 4bec7261-…
```

That is the practical argument for keeping evidence and graph as separate layers. The graph is a
queryable, semantic, temporal *view*; the ledger and the workspace files are the record. A missing
edge is a re-extraction problem, not lost data. If your application depends on a specific fact
being present, assert on it and re-ingest rather than trusting that a clean payload yields a clean
edge.

Three other failures from this build are worth passing on, because each cost real debugging time
and none of them is in anyone's docs:

* **Workspace names become mailbox display names.** Naming a workspace
  `Living Vendor Graph 2026-08-16T02:22:18.501Z` caused every mailbox provisioning attempt to fail,
  because AgentMail rejects `:` in a display name. The workspace still came up with a working
  browser profile and a `@workspaces.invalid` address, so the failure surfaced much later as a
  confusing signup bug. `Date.now()` instead of `toISOString()` fixed it.
* **"Wait for mail" needs an explicit lower bound, not a lookback window.** The second run signed up
  again in a workspace whose inbox already held a verification email from ~50 minutes earlier. The
  wait was called with a 30-second `lookback_ms`, and it returned the *stale* message anyway; the
  agent dutifully navigated a dead token and landed on "Invalid link", then failed on an
  unauthenticated dashboard several steps later. Reproduced directly against the API: with
  `lookback_ms: 30000` and no `since`, the wait resolves with a message timestamped 50 minutes ago;
  with an explicit `since`, it correctly times out. The fix is to capture a boundary before
  submitting the form and pass it through — and to reject a message older than that boundary
  instead of trusting the link:

  ```ts
  const mailSince = Date.now() - 5_000;                     // small clock-skew allowance
  await client.fillCredential(sessionId, credential.id, [...], '#signup-submit');
  const mail = await client.waitForMail(workspaceId, {
    subjectContains: 'Acme Cloud verification',
    since: mailSince,
    timeoutMs: 120_000,
  });
  if (mail.message !== null && !isFreshMessage(mail.message.timestamp, mailSince)) {
    throw new Error('Verification email was older than the signup boundary');
  }
  ```

  Any long-lived agent identity hits this eventually. A durable mailbox accumulates history, and
  "the most recent email matching this subject" is not the same question as "the email caused by the
  action I just took."
* **Guessing an SDK's response shape is a waste of an afternoon.** The first version of the
  renderer expected fields like `observations`, `startAt`, and `endAt`. The live response uses
  `edges[].fact`, `validAt`, `invalidAt`, and `episode_reference_time`. One real call answers a
  question that no amount of careful reasoning will.

---

## Run it yourself

```bash
git clone https://github.com/thenoahhein/ontology-graph-demo
cd ontology-graph-demo && npm install && npm run build

# Terminal 1 — the target
npm start

# Terminal 2 — the agent
export AGENTSTEAD_API_KEY=...      # durable identity, browser, mailbox, credentials, files
export ZEP_API_KEY=...             # temporal graph
export SIGNUP_SHARED_SECRET=...    # the target's signup guard
export ADMIN_SECRET=...            # lets you play the vendor
export VENDOR_BASE_URL=https://your-target.example

npm run observe      # signup -> verify -> authenticated read -> evidence -> graph
npm run flip -- v2   # the vendor changes its mind
npm run observe      # new session, same identity, still logged in
npm run diff         # temporal edge story with provenance
npm run graph:view   # render the graph to docs/graph-viewer.html
```

`npm run demo` runs the whole sequence. Without a `ZEP_API_KEY` the local JSONL sink is selected
automatically, so the full flow still works offline apart from the graph.

---

## The takeaway

Every piece of this is boring on its own. An Express app with two pricing versions. A REST client.
A graph SDK. What makes it interesting is what each layer refuses to do.

The graph does not try to own identity, sessions, or secrets. Agentstead does not try to own nodes,
edges, or queries. The orchestrator owns neither — it just moves a well-shaped observation from a
place that can log in to a place that can remember.

> Your graph knows that a vendor offers SSO. Agentstead gives your agent the account that logged
> in, verified the claim, noticed when it changed, and can prove it.

---

*Source: [thenoahhein/ontology-graph-demo](https://github.com/thenoahhein/ontology-graph-demo).
Graph data in the viewer is a capture of a live Zep graph produced by the run described above;
screenshots are the agent's own evidence files and the deployed target.*
