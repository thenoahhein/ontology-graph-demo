export interface ObservationSource {
  kind: 'authenticated_page';
  url: string;
  workspace_id: string;
  evidence_file_id: string;
  screenshot_file_id: string;
}

export interface ObservedPlan {
  plan: string;
  monthly_price: number;
  seat_limit: number;
  features: string[];
}

export interface Observation {
  observed_at: string;
  source: ObservationSource;
  company: string;
  product: string;
  plans: ObservedPlan[];
  pricing_version: string;
}
