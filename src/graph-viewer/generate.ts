import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface GraphNode {
  uuid: string;
  name: string;
  labels?: string[];
}

interface GraphEdge {
  uuid: string;
  name: string;
  fact: string;
  source_node_name: string;
  target_node_name: string;
  validAt?: string;
  invalidAt?: string;
  episodes?: string[];
  attributes?: { reference_time?: string };
}

interface GraphEpisode {
  uuid: string;
  content: string;
}

interface GraphCapture {
  graphId: string;
  capturedAt: string;
  edges: GraphEdge[];
  nodes: GraphNode[];
  episodes: GraphEpisode[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const inputPath = process.argv[2] ?? resolve(root, 'docs/graph-capture.json');
const outputPath = process.argv[3] ?? resolve(root, 'docs/graph-viewer.html');
const capture = JSON.parse(await readFile(inputPath, 'utf8')) as GraphCapture;
const captureJson = JSON.stringify(capture).replaceAll('<', '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Living Vendor Graph</title>
  <script src="https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js"></script>
  <script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js"></script>
  <script src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: #121a2e;
      --panel-soft: #18233c;
      --text: #edf3ff;
      --muted: #9eacc8;
      --blue: #65b9ff;
      --green: #55ddb0;
      --amber: #ffc766;
      --dead: #71809d;
      --line: #2b3b5f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 25% 0%, #192b52 0, var(--bg) 45%);
      color: var(--text);
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    header {
      padding: 28px 34px 20px;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow { color: var(--green); font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 5px 0 7px; font-size: 30px; letter-spacing: -.03em; }
    .boundary { color: var(--muted); margin: 0; max-width: 920px; }
    .boundary strong { color: var(--text); }
    .meta { color: var(--muted); font-size: 12px; margin-top: 12px; }
    main { display: grid; grid-template-columns: minmax(600px, 1fr) 390px; gap: 18px; padding: 18px; }
    .card { background: rgba(18, 26, 46, .9); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 45px rgba(0,0,0,.2); }
    .graph-card { min-height: 700px; overflow: hidden; }
    .card-title { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; }
    .card-title h2 { margin: 0; font-size: 14px; }
    .hint { color: var(--muted); font-size: 12px; }
    #graph { height: 650px; width: 100%; }
    aside { display: flex; flex-direction: column; gap: 18px; }
    .detail { padding: 18px; min-height: 270px; }
    .detail h2 { margin: 0 0 12px; font-size: 18px; }
    .empty { color: var(--muted); }
    .fact { color: var(--text); font-size: 16px; font-weight: 700; margin-bottom: 14px; }
    dl { display: grid; grid-template-columns: 100px 1fr; gap: 7px 10px; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; }
    code { color: #c9dcff; font-size: 11px; }
    .evidence { padding: 18px; }
    .evidence h2 { margin: 0 0 12px; font-size: 14px; }
    .evidence img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 9px; margin-top: 12px; }
    .legend { display: flex; gap: 14px; padding: 0 18px 16px; color: var(--muted); font-size: 12px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
    .dot.current { background: var(--green); }
    .dot.dead { background: var(--dead); }
    @media (max-width: 1050px) {
      main { grid-template-columns: 1fr; }
      aside { display: grid; grid-template-columns: 1fr 1fr; }
      .evidence { grid-column: 1 / -1; }
    }
    @media (max-width: 700px) {
      header { padding: 22px 18px 16px; }
      main { padding: 10px; }
      aside { display: flex; }
      .graph-card { min-height: 560px; }
      #graph { height: 510px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">Frozen live capture · Zep graph</div>
    <h1>Living Vendor Graph</h1>
    <p class="boundary"><strong>Agentstead</strong> = identity, authenticated access, and evidence. <strong>Zep</strong> = what’s true, and when.</p>
    <div class="meta" id="meta"></div>
  </header>
  <main>
    <section class="card graph-card">
      <div class="card-title"><h2>Entity graph</h2><span class="hint">Click any relationship for temporal provenance</span></div>
      <div id="graph"></div>
      <div class="legend"><span><span class="dot current"></span>Current</span><span><span class="dot dead"></span>Superseded · dashed</span></div>
    </section>
    <aside>
      <section class="card detail">
        <h2>Edge detail</h2>
        <div id="detail" class="empty">Select an edge to inspect the fact and its evidence.</div>
      </section>
      <section class="card evidence">
        <h2>Authenticated evidence</h2>
        <div id="evidence" class="empty">The observation screenshot appears here when an edge is selected.</div>
      </section>
    </aside>
  </main>
  <script>
    const capture = ${captureJson};
    const assetRoot = '/home/ubuntu/graph-viewer-assets/';
    const episodeById = new Map(capture.episodes.map((episode) => [episode.uuid, episode]));
    const nodeByName = new Map(capture.nodes.map((node) => [node.name, node]));
    const edgeById = new Map(capture.edges.map((edge) => [edge.uuid, edge]));
    const meta = document.getElementById('meta');
    meta.textContent = capture.graphId + ' · ' + capture.nodes.length + ' nodes · ' + capture.edges.length + ' edges · captured ' + new Date(capture.capturedAt).toLocaleString();

    function observationFor(edge) {
      const reference = edge.attributes && edge.attributes.reference_time;
      const candidates = (edge.episodes || []).map((id) => episodeById.get(id)).filter(Boolean);
      const selected = candidates.find((episode) => {
        try { return reference && JSON.parse(episode.content).observed_at.startsWith(reference.slice(0, 19)); } catch { return false; }
      }) || candidates[0];
      if (!selected) return null;
      try { return JSON.parse(selected.content); } catch { return null; }
    }
    function formatTime(value) {
      return value ? new Date(value).toLocaleString() : 'Present';
    }
    function esc(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function showEdge(edge) {
      const observation = observationFor(edge);
      const source = observation && observation.source;
      document.getElementById('detail').className = '';
      document.getElementById('detail').innerHTML =
        '<div class="fact">' + esc(edge.fact) + '</div>' +
        '<dl>' +
        '<dt>Relation</dt><dd>' + esc(edge.name) + '</dd>' +
        '<dt>Valid from</dt><dd>' + esc(formatTime(edge.validAt)) + '</dd>' +
        '<dt>Invalidated</dt><dd>' + esc(formatTime(edge.invalidAt)) + '</dd>' +
        '<dt>Reference</dt><dd>' + esc(edge.attributes?.reference_time || '—') + '</dd>' +
        '<dt>Dashboard</dt><dd><a href="' + esc(source?.url || '#') + '" target="_blank" rel="noreferrer">' + esc(source?.url || '—') + '</a></dd>' +
        '<dt>Workspace</dt><dd><code>' + esc(source?.workspace_id || '—') + '</code></dd>' +
        '<dt>Evidence</dt><dd><code>' + esc(source?.evidence_file_id || '—') + '</code></dd>' +
        '<dt>Screenshot</dt><dd><code>' + esc(source?.screenshot_file_id || '—') + '</code></dd>' +
        '</dl>';
      const evidence = document.getElementById('evidence');
      if (source?.screenshot_file_id) {
        const version = observation.pricing_version;
        evidence.className = '';
        evidence.innerHTML = '<div><strong>v' + esc(version.replace(/^v/, '')) + ' authenticated dashboard</strong></div><img src="' + assetRoot + (version === 'v1' ? 'v1-dashboard.png' : 'v2-dashboard.png') + '" alt="Authenticated ' + esc(version) + ' dashboard">';
      } else {
        evidence.className = 'empty';
        evidence.textContent = 'No episode evidence was found for this edge.';
      }
    }

    const elements = [
      ...capture.nodes.map((node) => ({ data: { id: node.uuid, label: node.name, kind: node.labels?.[0] || 'Value' } })),
      ...capture.edges.map((edge) => {
        const source = nodeByName.get(edge.source_node_name);
        const target = nodeByName.get(edge.target_node_name);
        return { data: { id: edge.uuid, source: source?.uuid, target: target?.uuid, label: edge.name, dead: edge.invalidAt ? 'true' : 'false', focal: edge.name === 'HAS_PRICE' && (edge.target_node_name === '$49' || edge.target_node_name === '$69') ? 'true' : 'false' } };
      }).filter((edge) => edge.data.source && edge.data.target),
    ];
    const cy = cytoscape({
      container: document.getElementById('graph'),
      elements,
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 32, rankSep: 105, edgeSep: 20, padding: 35 },
      style: [
        { selector: 'node', style: { 'background-color': '#24385f', 'border-color': '#65b9ff', 'border-width': 1.5, color: '#edf3ff', label: 'data(label)', 'font-size': 12, 'text-wrap': 'wrap', 'text-max-width': 105, 'text-valign': 'center', 'text-halign': 'center', width: 86, height: 48, shape: 'round-rectangle' } },
        { selector: 'node[kind = "Company"]', style: { 'background-color': '#245b62', 'border-color': '#55ddb0', width: 115, height: 58, 'font-size': 14, 'font-weight': 700 } },
        { selector: 'node[kind = "Plan"]', style: { 'background-color': '#263f72', 'border-color': '#65b9ff', width: 105, height: 54, 'font-size': 14, 'font-weight': 700 } },
        { selector: 'node[label = "$49"]', style: { 'background-color': '#3b3f52', 'border-color': '#71809d', 'border-style': 'dashed', 'border-width': 2 } },
        { selector: 'node[label = "$69"]', style: { 'background-color': '#345844', 'border-color': '#55ddb0', 'border-width': 3, 'font-size': 15, 'font-weight': 800 } },
        { selector: 'edge', style: { 'curve-style': 'bezier', 'line-color': '#55ddb0', 'target-arrow-color': '#55ddb0', 'target-arrow-shape': 'triangle', width: 2, label: 'data(label)', color: '#b8c8e8', 'font-size': 9, 'text-background-color': '#121a2e', 'text-background-opacity': 0.9, 'text-background-padding': 2, 'text-rotation': 'autorotate' } },
        { selector: 'edge[dead = "true"]', style: { 'line-color': '#71809d', 'target-arrow-color': '#71809d', 'line-style': 'dashed', opacity: 0.55 } },
        { selector: 'edge[focal = "true"]', style: { width: 4, 'font-size': 11 } },
      ],
    });
    cy.on('tap', 'edge', (event) => showEdge(edgeById.get(event.target.id())));
    const focal = capture.edges.find((edge) => edge.name === 'HAS_PRICE' && edge.target_node_name === '$69');
    if (focal) showEdge(focal);
  </script>
</body>
</html>
`;

await writeFile(outputPath, html);
console.log(`Generated ${outputPath}`);
