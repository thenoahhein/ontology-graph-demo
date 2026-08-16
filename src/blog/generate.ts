import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import type { Options } from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import hljs from 'highlight.js/lib/common';

interface TocItem {
  id: string;
  title: string;
  level: 2 | 3;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const markdownPath = resolve(root, 'docs/blog/living-vendor-graph.md');
const outputPath = resolve(root, 'docs/blog/living-vendor-graph.html');
const markdown = await readFile(markdownPath, 'utf8');
const toc: TocItem[] = [];
const usedIds = new Set<string>();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function slugify(value: string): string {
  const base = value.toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'section';
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  usedIds.add(id);
  return id;
}

function codeKind(info: string): 'shell' | 'output' | 'source' {
  const language = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (language === 'bash' || language === 'sh' || language === 'shell') return 'shell';
  if (language === 'text' || language === 'txt' || language === 'console') return 'output';
  return 'source';
}

function codeLabel(kind: ReturnType<typeof codeKind>, language: string): string {
  if (kind === 'shell') return 'shell';
  if (kind === 'output') return 'output';
  return language || 'source';
}

function highlightCode(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language }).value;
  return hljs.highlightAuto(code).value;
}

const options: Options = {
  html: true,
  typographer: true,
  highlight: highlightCode,
};
const md = new MarkdownIt(options);
const env: Record<string, unknown> = {};
const tokens = md.parse(markdown, env);
let title = 'Living Vendor Graph';
let subtitle = 'A practical guide to authenticated vendor observation, evidence capture, and temporal graph memory with Agentstead and Zep.';

function addClass(token: Token, className: string): void {
  const existing = token.attrGet('class');
  token.attrSet('class', existing ? `${existing} ${className}` : className);
}

function inlineTitle(token: Token | undefined): string {
  return token?.content.trim() || '';
}

for (let index = 0; index < tokens.length; index += 1) {
  const token = tokens[index];
  if (!token) continue;
  if (token.type === 'heading_open') {
    const inline = tokens[index + 1];
    const headingText = inlineTitle(inline);
    const level = Number(token.tag.slice(1));
    const id = slugify(headingText);
    token.attrSet('id', id);
    if (level === 2 || level === 3) {
      toc.push({ id, title: headingText, level });
    }
    const step = headingText.match(/^Step (\d+):/i);
    if (step) {
      token.attrSet('data-step', step[1] ?? '');
      addClass(token, 'step-heading');
    }
  }
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
    const nextInline = tokens.slice(index, index + 30).find((candidate) => candidate.type === 'inline');
    if (nextInline?.children?.[1]?.type === 'strong_open') addClass(token, 'lead-list');
  }
}

const firstHeading = tokens.findIndex((token) => token.type === 'heading_open' && token.tag === 'h1');
if (firstHeading >= 0) {
  title = inlineTitle(tokens[firstHeading + 1]) || title;
  const headingEnd = tokens.findIndex((token, index) => index > firstHeading && token.type === 'heading_close');
  if (headingEnd >= 0) {
    const paragraphStart = tokens.findIndex((token, index) => index > headingEnd && token.type === 'paragraph_open');
    if (paragraphStart >= 0 && tokens[paragraphStart + 1]?.type === 'inline') {
      subtitle = inlineTitle(tokens[paragraphStart + 1]) || subtitle;
      const paragraphEnd = tokens.findIndex((token, index) => index > paragraphStart && token.type === 'paragraph_close');
      if (paragraphEnd >= 0) tokens.splice(paragraphStart, paragraphEnd - paragraphStart + 1);
    }
    tokens.splice(firstHeading, headingEnd - firstHeading + 1);
  }
}

const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (fenceTokens, index, renderOptions, renderEnv) => {
  const token = fenceTokens[index];
  if (!token) return '';
  const info = token.info.trim();
  const language = info.split(/\s+/)[0] ?? '';
  const kind = codeKind(info);
  const label = codeLabel(kind, language);
  const highlighted = highlightCode(token.content, language);
  const codeClass = language ? ` class="language-${escapeHtml(language)}"` : '';
  return `<div class="code-block code-${kind}">` +
    `<div class="code-toolbar"><span class="code-label">${escapeHtml(label)}</span>` +
    `<button class="copy-code" type="button">Copy</button></div>` +
    `<pre><code${codeClass}>${highlighted}</code></pre></div>\n`;
};
if (!defaultFence) throw new Error('Markdown fence renderer was not available');

md.renderer.rules.heading_open = (headingTokens, index) => {
  const token = headingTokens[index];
  if (!token) return '';
  const level = token.tag.slice(1);
  const id = token.attrGet('id') ?? 'section';
  const step = token.attrGet('data-step');
  const badge = step ? `<span class="step-badge">${escapeHtml(step)}</span>` : '';
  return `<h${level} id="${escapeHtml(id)}"${token.attrGet('class') ? ` class="${escapeHtml(token.attrGet('class') ?? '')}"` : ''}>` +
    `${badge}<a class="permalink" href="#${escapeHtml(id)}" aria-label="Permalink to this section">#</a>`;
};

md.renderer.rules.image = (imageTokens, index, renderOptions, renderEnv, self) => {
  const token = imageTokens[index];
  if (!token) return '';
  const src = token.attrGet('src') ?? '';
  const alt = token.attrGet('alt') ?? token.content;
  return `<figure class="image-frame"><button class="zoom-image" type="button" aria-label="Zoom image">` +
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"></button>` +
    `<figcaption>${escapeHtml(alt)}</figcaption></figure>`;
};

const article = md.renderer.render(tokens, options, env);
const wordCount = markdown.replace(/[`*_#>[\]()-]/g, ' ').split(/\s+/).filter(Boolean).length;
const readingMinutes = Math.max(1, Math.ceil(wordCount / 220));
const tocHtml = toc.map((item) =>
  `<a class="toc-link toc-level-${item.level}" href="#${escapeHtml(item.id)}" data-target="${escapeHtml(item.id)}">${escapeHtml(item.title)}</a>`,
).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} · Technical Guide</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --surface-soft: #edf1f4;
      --text: #18232e;
      --muted: #63717d;
      --faint: #8d9aa4;
      --line: #d8e0e6;
      --accent: #0a746d;
      --accent-soft: #d7f0ec;
      --link: #075f8f;
      --code-bg: #17232b;
      --code-text: #e7f0f4;
      --code-output: #101b21;
      --shadow: 0 20px 55px rgba(23, 40, 52, .09);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #101719;
        --surface: #172124;
        --surface-soft: #1e2d31;
        --text: #e7f0ef;
        --muted: #a5b7b7;
        --faint: #738788;
        --line: #304246;
        --accent: #62d4c4;
        --accent-soft: #173d3b;
        --link: #7fc9f0;
        --code-bg: #0b1114;
        --code-text: #e3eeee;
        --code-output: #0b1215;
        --shadow: 0 20px 60px rgba(0, 0, 0, .22);
      }
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 16px/1.78 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    a { color: var(--link); }
    .masthead {
      padding: 76px 24px 62px;
      background: linear-gradient(135deg, var(--surface) 0%, var(--surface-soft) 100%);
      border-bottom: 1px solid var(--line);
    }
    .masthead-inner, .page-grid { max-width: 1240px; margin: 0 auto; }
    .masthead-inner { padding: 0 24px; }
    .eyebrow {
      color: var(--accent);
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1, h2, h3, h4 { color: var(--text); line-height: 1.18; letter-spacing: -.025em; }
    .masthead h1 { max-width: 850px; margin: 13px 0 14px; font-size: clamp(2.5rem, 6vw, 5rem); }
    .subtitle { max-width: 760px; margin: 0; color: var(--muted); font-size: clamp(1.1rem, 2vw, 1.35rem); line-height: 1.5; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px 20px; margin-top: 26px; color: var(--faint); font-size: .85rem; }
    .page-grid { display: grid; grid-template-columns: 210px minmax(0, 75ch); gap: clamp(34px, 7vw, 90px); align-items: start; padding: 58px 24px 100px; }
    .toc { position: sticky; top: 28px; max-height: calc(100vh - 56px); overflow: auto; padding: 14px 0; }
    .toc-title { margin: 0 0 12px; color: var(--faint); font-size: .7rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .toc-link { display: block; padding: 5px 12px; border-left: 2px solid transparent; color: var(--muted); font-size: .78rem; line-height: 1.35; text-decoration: none; }
    .toc-level-3 { padding-left: 25px; font-size: .74rem; }
    .toc-link:hover, .toc-link.active { border-color: var(--accent); color: var(--accent); }
    article { min-width: 0; }
    article > p:first-of-type { font-size: 1.12rem; }
    article h2 { position: relative; margin: 3.5em 0 1rem; padding-top: 1.1rem; border-top: 1px solid var(--line); font-size: clamp(1.65rem, 3vw, 2.25rem); }
    article h3 { position: relative; margin: 2.8em 0 .8rem; font-size: 1.38rem; }
    article h2:first-of-type { margin-top: 0; }
    article p { margin: 1.1em 0; }
    article strong { color: var(--text); }
    article ul, article ol { padding-left: 1.45rem; }
    article li { padding-left: .25rem; margin: .45rem 0; }
    article li::marker { color: var(--accent); font-weight: 700; }
    .permalink { position: absolute; left: -1.55rem; color: var(--faint); font-size: .75em; font-weight: 500; opacity: 0; text-decoration: none; }
    h2:hover .permalink, h3:hover .permalink, .permalink:focus { opacity: 1; }
    .step-heading { display: flex; align-items: center; gap: 12px; border-top: 0; margin-top: 3.8em; padding-top: 1.8rem; }
    .step-badge { display: inline-grid; flex: 0 0 auto; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; background: var(--accent); color: var(--bg); font-size: .9rem; font-weight: 850; letter-spacing: 0; }
    .step-heading .permalink { position: static; order: 3; margin-left: auto; }
    blockquote { margin: 1.5rem 0; padding: 1rem 1.3rem; border-left: 4px solid var(--accent); background: var(--accent-soft); }
    table { width: 100%; margin: 1.6rem 0; border-collapse: collapse; font-size: .91rem; line-height: 1.5; }
    th, td { padding: .75rem .8rem; border: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: var(--surface-soft); color: var(--text); font-size: .8rem; letter-spacing: .03em; }
    .lead-list { display: grid; gap: 12px; padding: 0; list-style: none; }
    .lead-list > li { margin: 0; padding: 16px 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: 0 5px 16px rgba(23, 40, 52, .04); }
    .lead-list > li p { margin: 0; }
    .code-block { margin: 1.5rem 0; overflow: hidden; border: 1px solid #30464f; border-radius: 10px; background: var(--code-bg); box-shadow: var(--shadow); }
    .code-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid #30464f; color: #9db0b7; font: 700 .68rem/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; }
    .copy-code { padding: 5px 9px; border: 1px solid #587079; border-radius: 5px; background: transparent; color: #d8e8eb; cursor: pointer; font: inherit; letter-spacing: 0; text-transform: none; }
    .copy-code:hover { border-color: var(--accent); color: var(--accent); }
    pre { margin: 0; padding: 17px 18px 19px; overflow-x: auto; color: var(--code-text); font: .84rem/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; tab-size: 2; }
    pre code { white-space: pre; }
    .code-output pre { background: var(--code-output); color: #b9d2d4; }
    .hljs-comment, .hljs-quote { color: #82959c; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #ff9fbe; }
    .hljs-string, .hljs-doctag, .hljs-regexp { color: #b9e58d; }
    .hljs-title, .hljs-section, .hljs-name { color: #8dd9f3; }
    .hljs-number, .hljs-symbol, .hljs-bullet { color: #e8c181; }
    .image-frame { margin: 2rem 0; }
    .zoom-image { display: block; width: 100%; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; cursor: zoom-in; box-shadow: var(--shadow); }
    .zoom-image img { display: block; width: 100%; height: auto; }
    figcaption { padding: 10px 3px 0; color: var(--muted); font-size: .78rem; line-height: 1.4; }
    .lightbox { position: fixed; z-index: 10; inset: 0; display: grid; place-items: center; padding: 5vh 5vw; background: rgba(5, 10, 12, .86); }
    .lightbox[hidden] { display: none; }
    .lightbox img { max-width: 100%; max-height: 90vh; object-fit: contain; border-radius: 8px; box-shadow: 0 20px 80px rgba(0,0,0,.5); }
    .lightbox-close { position: absolute; top: 20px; right: 24px; border: 0; background: transparent; color: white; font-size: 2rem; cursor: pointer; }
    @media (max-width: 1100px) { .page-grid { display: block; max-width: 850px; } .toc { display: none; } }
    @media (max-width: 620px) { body { font-size: 15px; } .masthead { padding: 48px 18px 42px; } .masthead-inner, .page-grid { padding-left: 18px; padding-right: 18px; } .page-grid { padding-top: 35px; } .permalink { display: none; } table { display: block; overflow-x: auto; white-space: nowrap; } .code-toolbar { padding-left: 10px; padding-right: 10px; } pre { padding-left: 12px; padding-right: 12px; font-size: .78rem; } }
  </style>
</head>
<body>
  <header class="masthead">
    <div class="masthead-inner">
      <div class="eyebrow">Technical guide · authenticated research</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
      <div class="meta"><a href="https://github.com/thenoahhein/ontology-graph-demo">Source repository</a><span>${wordCount.toLocaleString()} words · ${readingMinutes} min read</span></div>
    </div>
  </header>
  <div class="page-grid">
    <nav class="toc" aria-label="Table of contents"><p class="toc-title">On this page</p>${tocHtml}</nav>
    <article>${article}</article>
  </div>
  <div class="lightbox" hidden role="dialog" aria-modal="true" aria-label="Image preview">
    <button class="lightbox-close" type="button" aria-label="Close image preview">×</button>
    <img alt="">
  </div>
  <script>
    const lightbox = document.querySelector('.lightbox');
    const lightboxImage = lightbox.querySelector('img');
    const closeLightbox = () => { lightbox.hidden = true; lightboxImage.removeAttribute('src'); };
    document.querySelectorAll('.zoom-image').forEach((button) => button.addEventListener('click', () => {
      const image = button.querySelector('img');
      lightboxImage.src = image.src;
      lightboxImage.alt = image.alt;
      lightbox.hidden = false;
    }));
    document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (event) => { if (event.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLightbox(); });
    document.querySelectorAll('.copy-code').forEach((button) => button.addEventListener('click', async () => {
      const code = button.closest('.code-block').querySelector('code').innerText;
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, 1300);
      } catch {
        button.textContent = 'Select manually';
      }
    }));
    const links = [...document.querySelectorAll('.toc-link')];
    const headings = links.map((link) => document.getElementById(link.dataset.target)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.toggle('active', link.dataset.target === visible.target.id));
    }, { rootMargin: '-12% 0px -72% 0px', threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
  </script>
</body>
</html>
`;

await writeFile(outputPath, html);
console.log(`Generated ${outputPath}`);
