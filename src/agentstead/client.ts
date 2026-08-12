import { randomUUID } from 'node:crypto';

export interface Workspace {
  id: string; name: string; slug: string; email: string; status: string;
  mailbox_status?: string; browser_profile_status?: string;
  approval_required?: string[]; archived_at?: string | null;
  released_at?: string | null; created_at: string;
}
export interface Identity {
  id: string; workspace_id: string; display_name: string; email_address: string; created_at: string;
}
export interface Credential {
  id: string; workspace_id: string; label: string; username: string | null;
  site: string; status: string; last_used_at: string | null; inserted_at: string;
}
export interface BrowserSession {
  id: string; workspace_id: string; status: string; expires_at: string;
  remaining_seconds: number; closed_at: string | null; replayed: boolean; reused: boolean;
}
export interface PageNavigation { url: string; title: string; session_id: string; }
export interface PageAction { session_id: string; origin: string; selector?: string; }
export interface PageReadSelector { selector: string; found: boolean; text?: string; }
export interface PageFrame { selector: string; name: string; url: string; }
export interface PageRead {
  session_id: string; url: string; title: string; selectors: PageReadSelector[]; frames: PageFrame[];
}
export interface PageWait { url: string; title: string; found: boolean; waited_ms: number; }
export interface PageScreenshot { image_base64: string; bytes: number; url: string; title: string; }
export interface MailLink {
  url: string; text: string; confidence: string; host?: string; matches_sender_domain?: boolean;
}
export interface MailExtraction {
  codes: Array<{ value: string; confidence: string; kind: string }>; links: MailLink[];
}
export interface MailMessage { message_id: string; from: string; subject: string; text: string; }
export interface MailWaitResult {
  message: MailMessage | null; extraction: MailExtraction; timed_out: boolean;
  source: 'activity_event' | 'provider_poll' | null; diagnostics: unknown;
}
export interface WorkspaceFile {
  id: string; workspace_id: string; path: string; content_type: string;
  size_bytes: number; checksum: string; inserted_at: string;
}
export interface Fill { selector: string; value: string; }
export interface CredentialFill { field: 'username' | 'password'; selector: string; }

export class AgentsteadError extends Error {
  readonly status: number;
  readonly type: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  constructor(message: string, status: number, problem: { type?: string; title?: string; detail?: string }) {
    super(message);
    this.name = 'AgentsteadError';
    this.status = status;
    this.type = problem.type ?? null;
    this.title = problem.title ?? null;
    this.detail = problem.detail ?? null;
  }
}

interface CreateWorkspaceOptions { approvalRequired?: string[]; idempotencyKey?: string; }
interface CreateCredentialInput {
  label: string; site: string; username?: string; secret?: string;
  generate?: boolean; secretLength?: number;
}
interface ConnectBrowserOptions {
  ttlSeconds?: number; reuse?: boolean; solveCaptchas?: boolean;
  captchaImageSelector?: string; captchaInputSelector?: string;
  proxies?: boolean | string[]; idempotencyKey?: string;
}
interface RequestOptions {
  method?: string; body?: Record<string, unknown>; idempotent?: boolean; idempotencyKey?: string;
}

export class AgentsteadClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  constructor(options: { apiKey?: string; apiUrl?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.AGENTSTEAD_API_KEY ??
      process.env.AGENT_WORKSPACES_API_KEY ?? '';
    this.apiUrl = (options.apiUrl ?? process.env.AGENTSTEAD_API_URL ??
      process.env.AGENT_WORKSPACES_API_URL ?? 'https://agentstead.sh').replace(/\/$/, '');
  }

  createWorkspace(name: string, options: CreateWorkspaceOptions = {}): Promise<Workspace> {
    return this.requestEnvelope('/v1/workspaces', {
      method: 'POST', idempotent: true, idempotencyKey: options.idempotencyKey,
      body: { name, approval_required: options.approvalRequired ?? [] },
    });
  }
  getWorkspace(id: string): Promise<Workspace> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(id)}`);
  }
  getIdentity(id: string): Promise<Identity> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(id)}/identity`);
  }
  async waitForWorkspaceReady(id: string, timeoutMs = 120_000, intervalMs = 1_000): Promise<Workspace> {
    const deadline = Date.now() + timeoutMs;
    let workspace = await this.getWorkspace(id);
    while (workspace.status !== 'ready' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      workspace = await this.getWorkspace(id);
    }
    if (workspace.status !== 'ready') throw new Error(`Workspace ${id} did not become ready (status: ${workspace.status})`);
    return workspace;
  }
  createCredential(workspaceId: string, input: CreateCredentialInput): Promise<Credential> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(workspaceId)}/credentials`, {
      method: 'POST',
      body: {
        label: input.label, site: input.site, username: input.username,
        secret: input.secret, generate: input.generate, secret_length: input.secretLength,
      },
    });
  }
  listCredentials(workspaceId: string): Promise<Credential[]> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(workspaceId)}/credentials`);
  }
  fillCredential(sessionId: string, credentialId: string, fills: CredentialFill[],
    submitSelector?: string, frameOrigin?: string): Promise<{ credential_id: string; session_id: string }> {
    return this.requestEnvelope(`/v1/browser-sessions/${encodeURIComponent(sessionId)}/credential-fills`, {
      method: 'POST', body: { credential_id: credentialId, fills, submit_selector: submitSelector, frame_origin: frameOrigin },
    });
  }
  connectBrowser(workspaceId: string, options: ConnectBrowserOptions = {}): Promise<BrowserSession> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(workspaceId)}/browser-sessions`, {
      method: 'POST', idempotent: true, idempotencyKey: options.idempotencyKey,
      body: {
        ttl_seconds: options.ttlSeconds ?? 900, reuse: options.reuse ?? false,
        access_mode: 'supervised', solve_captchas: options.solveCaptchas ?? true,
        captcha_image_selector: options.captchaImageSelector,
        captcha_input_selector: options.captchaInputSelector, proxies: options.proxies,
      },
    });
  }
  closeBrowser(sessionId: string): Promise<void> {
    return this.request(`/v1/browser-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).then(() => undefined);
  }
  navigatePage(sessionId: string, url: string): Promise<PageNavigation> {
    return this.requestEnvelope(`/v1/browser-sessions/${encodeURIComponent(sessionId)}/page-navigations`, { method: 'POST', body: { url } });
  }
  fillPage(sessionId: string, origin: string, fills: Fill[], submitSelector?: string, frameOrigin?: string): Promise<PageAction> {
    return this.requestEnvelope(`/v1/browser-sessions/${encodeURIComponent(sessionId)}/page-fills`, {
      method: 'POST', body: { origin, fills, submit_selector: submitSelector, frame_origin: frameOrigin },
    });
  }
  clickPage(sessionId: string, origin: string, selector: string): Promise<PageAction> {
    return this.requestEnvelope(`/v1/browser-sessions/${encodeURIComponent(sessionId)}/page-clicks`, { method: 'POST', body: { origin, selector } });
  }
  readPage(sessionId: string, selectors: string[], origin?: string): Promise<PageRead> {
    return this.requestEnvelope(`/v1/browser-sessions/${encodeURIComponent(sessionId)}/page-reads`, { method: 'POST', body: { selectors, origin } });
  }
  waitForSelector(sessionId: string, selector: string, timeoutMs?: number, origin?: string): Promise<PageWait> {
    return this.requestEnvelope(`/v1/browser-sessions/${encodeURIComponent(sessionId)}/page-waits`, { method: 'POST', body: { selector, timeout_ms: timeoutMs, origin } });
  }
  screenshotPage(sessionId: string, origin?: string, fullPage = false): Promise<PageScreenshot> {
    return this.requestEnvelope(`/v1/browser-sessions/${encodeURIComponent(sessionId)}/page-screenshots`, { method: 'POST', body: { origin, full_page: fullPage } });
  }
  waitForMail(workspaceId: string, options: {
    from?: string; subjectContains?: string; since?: number; timeoutMs?: number; lookbackMs?: number;
  } = {}): Promise<MailWaitResult> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(workspaceId)}/mail/wait`, {
      method: 'POST', body: {
        from: options.from, subject_contains: options.subjectContains, since: options.since,
        timeout_ms: options.timeoutMs, lookback_ms: options.lookbackMs,
      },
    });
  }
  createFile(workspaceId: string, path: string, contentType: string, contentBase64: string): Promise<WorkspaceFile> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, {
      method: 'POST', body: { path, content_type: contentType, content_base64: contentBase64 },
    });
  }
  listFiles(workspaceId: string): Promise<WorkspaceFile[]> {
    return this.requestEnvelope(`/v1/workspaces/${encodeURIComponent(workspaceId)}/files`);
  }
  async downloadFile(workspaceId: string, fileId: string): Promise<Uint8Array> {
    const response = await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  private async requestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const body: unknown = await this.request(path, options).then((response) => response.json());
    if (!isEnvelope<T>(body)) throw new Error(`Agentstead response did not contain a data envelope for ${path}`);
    return body.data;
  }
  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    if (!this.apiKey) throw new Error('AGENTSTEAD_API_KEY is required');
    const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${this.apiKey}` });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.idempotent) headers.set('Idempotency-Key', options.idempotencyKey ?? randomUUID());
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: options.method ?? 'GET', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.ok) return response;
    const problem = await parseProblem(response);
    throw new AgentsteadError(problem.detail ?? problem.title ?? `Agentstead request failed (${response.status})`, response.status, problem);
  }
}

function isEnvelope<T>(value: unknown): value is { data: T } {
  return typeof value === 'object' && value !== null && 'data' in value;
}
async function parseProblem(response: Response): Promise<{ type?: string; title?: string; detail?: string }> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const source = typeof record.type === 'string' || typeof record.title === 'string' || typeof record.detail === 'string'
        ? record : typeof record.error === 'object' && record.error !== null ? record.error as Record<string, unknown> : {};
      return {
        type: typeof source.type === 'string' ? source.type : undefined,
        title: typeof source.title === 'string' ? source.title : undefined,
        detail: typeof source.detail === 'string' ? source.detail : undefined,
      };
    }
  } catch { return { detail: text || undefined }; }
  return { detail: text || undefined };
}
