# Living Vendor Graph demo runbook

This runbook walks through the two pieces of the demo:

1. Acme Cloud is a deliberately incomplete public website with the ground truth
   behind authentication.
2. The orchestrator uses Agentstead to return to a durable browser identity,
   capture authenticated evidence, and compare observations over time.

## 1. Configure the vendor target

Copy the example environment:

```bash
cp .env.example .env
```

For a local vendor target, use:

```bash
PORT=3100
DATA_DIR=./.data
PUBLIC_BASE_URL=http://127.0.0.1:3100
SIGNUP_SHARED_SECRET=choose-a-signup-secret
ADMIN_SECRET=choose-an-admin-secret
AGENTMAIL_API_KEY=...
```

`PUBLIC_BASE_URL` must be reachable by the browser that opens verification
links. For a deployed target, use its Railway HTTPS URL. For local development
with a real Browserbase session, use a public tunnel URL instead of
`127.0.0.1`.

`VENDOR_MAILBOX_ID` is optional. If it is absent, the target creates/reuses an
AgentMail sender inbox using a stable client ID and logs the selected inbox.

Start the target:

```bash
npm run build
npm start
curl http://127.0.0.1:3100/healthz
```

## 2. Run the offline graph path

The file sink requires no external graph account:

```bash
export DATA_DIR="$PWD/.data"
export VENDOR_BASE_URL=http://127.0.0.1:3100
export SINK_MODE=file

npm run diff
```

The normal `observe` command still needs an Agentstead API key, because it
creates or resumes a workspace and uses its browser/mail/files APIs.

## 3. Configure Agentstead

Set the branded variables explicitly:

```bash
export AGENTSTEAD_API_URL=https://agentstead.sh
export AGENTSTEAD_API_KEY=...
export SIGNUP_SHARED_SECRET=...
export VENDOR_BASE_URL=https://your-vendor-target.example
```

The client also accepts the legacy `AGENT_WORKSPACES_API_URL` and
`AGENT_WORKSPACES_API_KEY` names. The client never receives a CDP URL; all
browser work goes through supervised page primitives.

Run one observation:

```bash
npm run observe
```

The first run creates a workspace and waits for `ready`. It then:

1. Opens a reusable supervised browser session.
2. Reads `/account` to check for an existing login.
3. If no credential exists, signs up through `/signup?secret=...`, creates an
   origin-bound generated credential, waits for Acme's verification mail, and
   opens the extracted verification link.
4. If a credential already exists, fills `/login` server-side instead of
   creating another account.
5. Reads all plan selectors and the JSON fallback from `/dashboard`.
6. Saves the raw read payload and screenshot under unique timestamped
   workspace-file paths.
7. Appends the structured observation to the local JSONL ledger.
8. Sends it to Zep if the Zep sink is selected.
9. Closes the browser session so the next run proves persistent context.

Workspace names are passed through to AgentMail display names, so keep them
free of characters that AgentMail rejects, such as `:`.

Workspace ID, credential ID, vendor URL, and ledger location are stored in
`DATA_DIR/orchestrator.json`.

## 4. Flip the catalog and observe again

```bash
export ADMIN_SECRET=...
npm run flip -- v2
npm run observe
npm run diff
```

The first observation contains Pro `$49/month`, 5 seats, and two features.
The second contains Pro `$69/month`, 10 seats, and SCIM. Starter remains
unchanged, so the diff shows a stable plan alongside the changed edge.

The admin endpoint is:

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" \
  http://127.0.0.1:3100/admin/pricing-version

curl -X POST -H "x-admin-secret: $ADMIN_SECRET" \
  -H 'content-type: application/json' \
  -d '{"version":"v2"}' \
  http://127.0.0.1:3100/admin/pricing-version
```

## 5. Optional Zep Cloud

The repository pins `@getzep/zep-cloud` to `3.26.0`. With:

```bash
export SINK_MODE=zep
export ZEP_API_KEY=...
export ZEP_GRAPH_ID=<Agentstead workspace id>
```

the sink creates the graph if necessary, sets the declared ontology, and calls
`client.graph.add` with the JSON observation and its explicit observation
timestamp. The local JSONL ledger is still written first and remains the
source for `diff`.

Zep processes episodes and extracts graph facts asynchronously. `diff` polls
for the expected price facts before rendering the search results; if the
timeout expires, it prints a processing notice and renders whatever edges are
available. When extending the ontology, avoid Zep-reserved field names such as
`name`, `summary`, and `created_at`; this demo uses `company_name`,
`product_name`, `plan_name`, and `feature_name` instead.

`ZEP_GRAPH_VIEWER_URL` is optional. If your Zep deployment gives you a viewer
URL template, set for example:

```bash
export ZEP_GRAPH_VIEWER_URL='https://app.getzep.com/graphs/{graphId}'
```

The exact viewer host is deployment-specific; the demo does not assume one.
