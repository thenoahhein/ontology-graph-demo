export type PlanKey = 'starter' | 'pro';
export type PricingVersion = 'v1' | 'v2';

export interface PlanFacts {
  name: string;
  monthlyPrice: number;
  seatLimit: number;
  features: string[];
}
export interface PricingCatalog {
  version: string;
  plans: Record<PlanKey, PlanFacts>;
}
export const CATALOG: Record<PricingVersion, PricingCatalog> = {
  v1: {
    version: 'v1',
    plans: {
      starter: { name: 'Starter', monthlyPrice: 19, seatLimit: 3, features: ['Shared workspace', 'Email support'] },
      pro: { name: 'Pro', monthlyPrice: 49, seatLimit: 5, features: ['SSO', 'Audit log'] },
    },
  },
  v2: {
    version: 'v2',
    plans: {
      starter: { name: 'Starter', monthlyPrice: 19, seatLimit: 3, features: ['Shared workspace', 'Email support'] },
      pro: { name: 'Pro', monthlyPrice: 69, seatLimit: 10, features: ['SSO', 'Audit log', 'SCIM'] },
    },
  },
};
export function getCatalog(version: string): PricingCatalog {
  return isPricingVersion(version) ? CATALOG[version] : CATALOG.v1;
}
function isPricingVersion(value: string): value is PricingVersion {
  return value === 'v1' || value === 'v2';
}
