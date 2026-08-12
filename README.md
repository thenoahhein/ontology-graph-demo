# ontology-graph-demo — Living Vendor Graph

> Context graphs give an agent a model of the world. **Agentstead gives the agent a place in it.**

A competitive-intelligence agent that maintains a *temporal* context graph of vendors
(companies, products, plans, features, prices, evidence) in [Zep/Graphiti](https://help.getzep.com/graphiti/getting-started/overview),
where every fact is grounded in an observation made from a **real, authenticated account**
owned by an [Agentstead](https://github.com/thenoahhein/agent-workspace) workspace.

| Layer | What it answers |
| --- | --- |
| Ontology / context graph | What exists? How is it related? What is true now? |
| Agent framework | What should the agent do next? |
| Agentstead | Who is the agent? What can it access? Can it return later? What did it do? |

## Status

Stage 1 includes the deployable Acme Cloud target app and a small typed Agentstead
HTTP client. The temporal graph orchestrator and Zep/Graphiti integration are stage 2.

## Layout

- `src/vendor/catalog.ts` — versioned Starter and Pro pricing facts.
- `src/vendor/server.ts` — Acme Cloud target app with signup, verification, dashboard,
  persistent session, and guarded pricing-version switching.
- `src/agentstead/client.ts` — minimal typed fetch client for the Agentstead API.
- `src/orchestrator/` — stage 2: Agentstead signup, evidence capture, and graph ingestion.

## Local

```bash
npm install
npm run dev     # vendor target on http://localhost:3000
```

`GET /healthz` is the Railway healthcheck.

Copy `.env.example` to `.env` for local configuration. If `VENDOR_MAILBOX_ID` is
unset and `AGENTMAIL_API_KEY` is available, the target creates a reusable AgentMail
sender inbox at startup. The signup recipient should be an Agentstead workspace
mailbox or another inbox available to the smoke-test operator.
