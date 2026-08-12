import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Observation } from './observation.js';

export class FileSink {
  readonly ledgerPath: string;

  constructor(dataDir = process.env.DATA_DIR ?? './.data') {
    this.ledgerPath = path.join(dataDir, 'observations.jsonl');
  }

  async append(observation: Observation): Promise<void> {
    await mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await appendFile(this.ledgerPath, `${JSON.stringify(observation)}\n`, 'utf8');
  }

  async readAll(): Promise<Observation[]> {
    try {
      const text = await readFile(this.ledgerPath, 'utf8');
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Observation);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
