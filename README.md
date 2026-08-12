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

Bootstrapping. This commit is a minimal deployable skeleton so Railway can detect the
project; the demo is being built on top of it.

## Layout (planned)

- `src/vendor/` — the deterministic vendor target app: public pricing page, private
  authenticated dashboard, two pricing versions, and an admin endpoint that flips versions.
- `src/orchestrator/` — the research agent: Agentstead signup, email verification,
  credential fill, dashboard read, evidence file, and Zep episode ingestion.

## Local

```bash
npm install
npm run dev     # vendor target on http://localhost:3000
```

`GET /healthz` is the Railway healthcheck.
