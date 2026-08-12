import { ZepClient, entityFields, type EdgeType, type EntityType } from '@getzep/zep-cloud';
import type { Observation } from './observation.js';

const entityTypes: Record<string, EntityType> = {
  Company: {
    description: 'A vendor company.',
    fields: { name: entityFields.text('The company name.') },
  },
  Product: {
    description: 'A product offered by a company.',
    fields: { name: entityFields.text('The product name.') },
  },
  Plan: {
    description: 'A subscription plan.',
    fields: { name: entityFields.text('The plan name.') },
  },
  Feature: {
    description: 'A plan feature.',
    fields: { name: entityFields.text('The feature name.') },
  },
  Price: {
    description: 'A monthly plan price.',
    fields: { amount: entityFields.integer('The monthly price in whole currency units.') },
  },
  Evidence: {
    description: 'An authenticated observation and its evidence files.',
    fields: {
      url: entityFields.text('The authenticated page URL.'),
      evidence_file_id: entityFields.text('The raw read evidence file ID.'),
      screenshot_file_id: entityFields.text('The screenshot evidence file ID.'),
    },
  },
};

const edgeTypes: Record<string, EdgeType> = {
  OFFERS: {
    description: 'A company offers a product.',
    fields: {},
    sourceTargets: [{ source: 'Company', target: 'Product' }],
  },
  HAS_PLAN: {
    description: 'A product has a subscription plan.',
    fields: {},
    sourceTargets: [{ source: 'Product', target: 'Plan' }],
  },
  HAS_FEATURE: {
    description: 'A plan includes a feature.',
    fields: {},
    sourceTargets: [{ source: 'Plan', target: 'Feature' }],
  },
  HAS_PRICE: {
    description: 'A plan has a monthly price.',
    fields: { monthly_price: entityFields.integer('The monthly price.') },
    sourceTargets: [{ source: 'Plan', target: 'Price' }],
  },
  SUPPORTED_BY: {
    description: 'A plan fact is supported by authenticated evidence.',
    fields: {},
    sourceTargets: [{ source: 'Plan', target: 'Evidence' }],
  },
};

export class ZepSink {
  private readonly client: ZepClient;
  private readonly graphId: string;
  private initialized = false;

  constructor(apiKey: string, graphId: string) {
    this.client = new ZepClient({ apiKey });
    this.graphId = graphId;
  }

  async append(observation: Observation): Promise<void> {
    await this.ensureGraph();
    await this.client.graph.add({
      graphId: this.graphId,
      type: 'json',
      data: JSON.stringify(observation),
      createdAt: observation.observed_at,
      sourceDescription: 'Authenticated Acme Cloud pricing dashboard observation',
      metadata: {
        company: observation.company,
        product: observation.product,
        pricing_version: observation.pricing_version,
        evidence_file_id: observation.source.evidence_file_id,
        screenshot_file_id: observation.source.screenshot_file_id,
      },
    });
  }

  async search(query: string): Promise<unknown> {
    await this.ensureGraph();
    return this.client.graph.search({
      graphId: this.graphId,
      query,
      scope: 'auto',
      returnRawResults: true,
    });
  }

  private async ensureGraph(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.client.graph.get(this.graphId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.client.graph.create({
        graphId: this.graphId,
        name: 'Living Vendor Graph',
        description: 'Temporal Acme Cloud competitive intelligence graph.',
        timeZone: 'UTC',
      });
    }
    await this.client.graph.setOntology(entityTypes, edgeTypes, { graphIds: [this.graphId] });
    this.initialized = true;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404;
}
