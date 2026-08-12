import type { Observation } from './observation.js';
import { FileSink } from './file-sink.js';
import { ZepSink } from './zep-sink.js';

export type SinkMode = 'auto' | 'file' | 'zep';

export interface ObservationSink {
  append(observation: Observation): Promise<void>;
}

export interface SelectedSinks {
  ledger: FileSink;
  remote?: ZepSink;
  mode: 'file' | 'zep';
}

export function selectSinks(mode: SinkMode, dataDir: string, graphIdOverride?: string): SelectedSinks {
  const ledger = new FileSink(dataDir);
  if (mode === 'file') return { ledger, mode: 'file' };
  if (mode === 'zep' && !process.env.ZEP_API_KEY) {
    throw new Error('ZEP_API_KEY is required when --sink zep is selected');
  }
  if (mode === 'auto' && !process.env.ZEP_API_KEY) return { ledger, mode: 'file' };
  const graphId = graphIdOverride ?? process.env.ZEP_GRAPH_ID;
  if (!graphId) {
    throw new Error('ZEP_GRAPH_ID is required when the Zep sink is selected; use the Agentstead workspace ID');
  }
  const apiKey = process.env.ZEP_API_KEY;
  if (!apiKey) throw new Error('ZEP_API_KEY is required when the Zep sink is selected');
  return { ledger, remote: new ZepSink(apiKey, graphId), mode: 'zep' };
}

export async function appendToSelectedSinks(
  sinks: SelectedSinks,
  observation: Observation,
): Promise<void> {
  await sinks.ledger.append(observation);
  if (sinks.remote) await sinks.remote.append(observation);
}
