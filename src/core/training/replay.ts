import { appendFileSync, existsSync, readFileSync } from 'fs';
import { LightningTrajectoryV1 } from './lightning.js';

export class ReplayBuffer {
  constructor(private readonly path: string) {}

  append(item: LightningTrajectoryV1): void {
    appendFileSync(this.path, `${JSON.stringify(item)}\n`, 'utf-8');
  }

  readAll(limit = 500): LightningTrajectoryV1[] {
    if (!existsSync(this.path)) return [];
    try {
      const lines = readFileSync(this.path, 'utf-8').split('\n').filter(Boolean);
      return lines
        .slice(Math.max(0, lines.length - limit))
        .map((line) => JSON.parse(line) as LightningTrajectoryV1);
    } catch {
      return [];
    }
  }
}
