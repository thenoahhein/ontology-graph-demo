import type { PageRead } from '../agentstead/client.js';

export interface DashboardPlan {
  key: string;
  name: string;
  monthlyPrice: number;
  seatLimit: number;
  features: string[];
}

export interface DashboardData {
  plans: DashboardPlan[];
  pricingVersion: string;
}

export function dashboardSelectors(): string[] {
  return [
    '#pricing-version', '#plan-json',
    '#plan-starter-name', '#plan-starter-price', '#plan-starter-seats', '#plan-starter-features',
    '#plan-pro-name', '#plan-pro-price', '#plan-pro-seats', '#plan-pro-features',
  ];
}

export function parseDashboard(read: PageRead): DashboardData {
  if (read.title.trim().toLowerCase() === 'not authenticated') {
    throw new Error(`Vendor dashboard was not authenticated (page title: ${read.title})`);
  }
  const selectors = new Map(read.selectors.map((selector) => [selector.selector, selector]));
  const pricingVersion = requiredText(selectors, '#pricing-version');
  const plans = ['starter', 'pro'].map((key) => ({
    key,
    name: requiredText(selectors, `#plan-${key}-name`),
    monthlyPrice: parsePrice(requiredText(selectors, `#plan-${key}-price`), key),
    seatLimit: parseSeatLimit(requiredText(selectors, `#plan-${key}-seats`), key),
    features: parseFeatures(requiredText(selectors, `#plan-${key}-features`), key),
  }));
  const visible = { plans, pricingVersion };
  const jsonText = selectors.get('#plan-json')?.text?.trim();
  if (!jsonText) return visible;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return visible;
  }
  if (!isDashboardData(parsed)) throw new Error('Dashboard JSON blob had an unexpected shape');
  if (!dashboardDataMatches(parsed, visible)) {
    throw new Error('Dashboard JSON blob disagreed with visible plan selectors');
  }
  return {
    pricingVersion: visible.pricingVersion,
    plans: visible.plans.map((plan) => ({
      ...plan,
      features: parsed.plans.find((candidate) => candidate.key === plan.key)?.features ?? plan.features,
    })),
  };
}

function requiredText(
  selectors: Map<string, { found: boolean; text?: string }>,
  selector: string,
): string {
  const value = selectors.get(selector);
  const text = value?.text?.trim();
  if (!value?.found || !text) throw new Error(`Authenticated dashboard missing usable ${selector}`);
  return text;
}

function parsePrice(value: string, plan: string): number {
  const match = value.match(/\$(\d+(?:\.\d+)?)\s*\/\s*month/i);
  if (!match) throw new Error(`Authenticated dashboard had an invalid ${plan} price`);
  const price = Number(match[1]);
  if (!Number.isFinite(price)) throw new Error(`Authenticated dashboard had an invalid ${plan} price`);
  return price;
}

function parseSeatLimit(value: string, plan: string): number {
  const match = value.match(/(\d+)\s*seats?/i);
  if (!match) throw new Error(`Authenticated dashboard had an invalid ${plan} seat limit`);
  return Number(match[1]);
}

function parseFeatures(value: string, plan: string): string[] {
  const features = value.split(/\s*(?:,|;|\||•|\r?\n)\s*/).map((feature) => feature.trim()).filter(Boolean);
  if (features.length === 0) throw new Error(`Authenticated dashboard had no usable ${plan} features`);
  return features;
}

function isDashboardData(value: unknown): value is DashboardData {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.pricingVersion !== 'string' || !Array.isArray(record.plans)) return false;
  const seen = new Set<string>();
  return record.plans.every((plan) => {
    if (typeof plan !== 'object' || plan === null) return false;
    const candidate = plan as Record<string, unknown>;
    if (typeof candidate.key !== 'string' || seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return typeof candidate.name === 'string' &&
      typeof candidate.monthlyPrice === 'number' &&
      Number.isFinite(candidate.monthlyPrice) &&
      typeof candidate.seatLimit === 'number' &&
      Number.isInteger(candidate.seatLimit) &&
      Array.isArray(candidate.features) &&
      candidate.features.length > 0 &&
      candidate.features.every((feature) => typeof feature === 'string' && feature.length > 0);
  });
}

function dashboardDataMatches(left: DashboardData, right: DashboardData): boolean {
  if (left.pricingVersion !== right.pricingVersion || left.plans.length !== right.plans.length) return false;
  return right.plans.every((plan) => {
    const candidate = left.plans.find((item) => item.key === plan.key);
    return candidate !== undefined &&
      candidate.name === plan.name &&
      candidate.monthlyPrice === plan.monthlyPrice &&
      candidate.seatLimit === plan.seatLimit &&
      compactFeatures(candidate.features) === compactFeatures(plan.features);
  });
}

function compactFeatures(features: string[]): string {
  return features.join('').replace(/\s+/g, '').toLowerCase();
}
