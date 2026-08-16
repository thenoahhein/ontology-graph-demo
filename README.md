# Living Vendor Graph

> Context graphs give an agent a model of the world. **Agentstead gives the agent a place in it.**

Living Vendor Graph is a small competitive-intelligence demo. An agent creates a
durable identity with [Agentstead](https://github.com/thenoahhein/agent-workspace),
signs up for a fake Acme Cloud account, verifies its email, and reads the
authenticated pricing dashboard. It stores the raw page read and screenshot as
workspace evidence, then records timestamped facts in a local JSONL ledger and,
optionally, [Zep Cloud](https://www.getzep.com/).

The demo changes Acme Cloud's Pro plan from `$49/month` to `$69/month`. The
`diff` command turns those observations into a temporal edge story with validity
intervals and provenance.

## The three layers

| Layer | What it answers |
| --- | --- |
| Ontology / context graph | What exists? How is it related? What is true now? |
| Agent framework | What should the agent do next? |
| Agentstead | Who is the agent? What can it access? Can it return later? What did it do? |

Agentstead deliberately does **not** get nodes, edges, embeddings, or graph
queries. The graph remains in Zep, Graphiti, or the customer's own ontology.
Agentstead supplies the durable workspace identity, supervised browser, mailbox,
credentials, evidence files, activity, and approvals.

One important boundary: Agentstead activity events intentionally omit page-read
text and email bodies. Activity and webhooks are triggers and an audit trail.
The orchestrator captures the observation, persists raw evidence as an Agentstead
workspace file, and sends the structured copy to the graph.

## What is included

- `src/vendor/server.ts` — Acme Cloud target SaaS with public pricing, guarded
  signup, AgentMail verification, authenticated dashboard, and admin pricing flips.
- `src/vendor/catalog.ts` — data-driven v1/v2 Starter and Pro catalog.
- `src/agentstead/client.ts` — minimal typed raw HTTP client for the Agentstead API.
- `src/orchestrator/cli.ts` — resumable `observe`, `flip`, `diff`, and `demo` commands.
- `src/graph/observation.ts` — shared observation shape.
- `src/graph/file-sink.ts` — append-only local JSONL ledger.
- `src/graph/zep-sink.ts` — optional Zep Cloud sink using `@getzep/zep-cloud@3.26.0`.
- `docs/DEMO.md` — setup, Railway deployment, and demo runbook.

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no | Vendor HTTP port; defaults to `3000`. |
| `DATA_DIR` | no | JSON store, orchestrator state, and JSONL ledger; defaults to `./.data`. |
| `PUBLIC_BASE_URL` | vendor signup | Public URL that a Browserbase browser can open for `/verify`; use the Railway domain or a public tunnel, not a loopback URL. |
| `SIGNUP_SHARED_SECRET` | vendor signup/observe | Secret accepted by the target signup flow. |
| `ADMIN_SECRET` | flip | Secret sent in `x-admin-secret` to switch pricing versions. |
| `AGENTMAIL_API_KEY` | signup if `VENDOR_MAILBOX_ID` is unset | AgentMail API key used to create an inbox and send verification mail. |
| `VENDOR_MAILBOX_ID` | no | Existing AgentMail sender inbox; if unset, the vendor creates/reuses one by client ID at startup. |
| `AGENTSTEAD_API_URL` | observe | Agentstead API URL; defaults to `https://agentstead.sh`. |
| `AGENTSTEAD_API_KEY` | observe | Agentstead API key. The legacy `AGENT_WORKSPACES_*` names are also accepted. |
| `VENDOR_BASE_URL` | observe/flip | Target URL; defaults to `http://127.0.0.1:3100`. |
| `SINK_MODE` | no | `auto`, `file`, or `zep`; defaults to `auto`. |
| `ZEP_API_KEY` | Zep sink | Enables Zep in `auto`, or is required by `--sink zep`. |
| `ZEP_GRAPH_ID` | Zep sink | Graph namespace, normally the Agentstead workspace ID. |
| `ZEP_GRAPH_VIEWER_URL` | no | Optional viewer URL template containing `{graphId}` for `diff` output. |

The local ledger is always written. If `SINK_MODE=auto` and `ZEP_API_KEY` is
missing, the file sink is selected. Use `SINK_MODE=file` for an explicit
offline run.

Zep ingestion and graph extraction are asynchronous. The `diff` command polls
until the expected price facts appear, then renders their `validAt` and
`invalidAt` intervals; if processing exceeds the timeout, it reports that
Zep is still processing and renders the edges currently available. Zep also
rejects reserved ontology field names such as `name`, `summary`, and
`created_at`, so the demo uses namespaced fields such as `company_name` and
`plan_name`.

## Local commands

```bash
npm install
npm run build
npm run typecheck
npm start
```

In another shell, after setting the environment:

```bash
npm run observe
npm run flip -- v2
npm run observe
npm run diff
```

`npm run demo` performs the full observe → flip → observe → diff sequence.

## Railway deployment

The repository includes `railway.json`. Nixpacks installs dependencies, then
Railway runs:

```text
npm run build
npm start
```

Set `PUBLIC_BASE_URL` to the deployed Railway HTTPS domain. Set the remaining
vendor variables in Railway's service environment. The `/healthz` endpoint is
the configured health check. Attach a persistent Railway volume and point
`DATA_DIR` at it if user/session state and the local ledger must survive
redeploys.

For the full local and hosted flow, see [`docs/DEMO.md`](docs/DEMO.md).

For the technical walkthrough, see [`docs/blog/living-vendor-graph.md`](docs/blog/living-vendor-graph.md)
or the [rendered HTML version](docs/blog/living-vendor-graph.html). Regenerate it with
`npm run blog:view`.
