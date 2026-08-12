export interface PlanFacts {
  name: string;
  monthlyPrice: number;
  seatLimit: number;
  features: string[];
}
export interface PricingCatalog {
  version: string;
  plans: Record<string, PlanFacts>;
}
export const CATALOG: Record<string, PricingCatalog> = {
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
  return CATALOG[version] ?? CATALOG.v1!;
}
