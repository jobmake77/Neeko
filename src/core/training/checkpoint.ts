import { existsSync } from 'fs';
import { CheckpointItem, readJsonFile, writeJsonFile } from './lightning.js';

interface CheckpointIndex {
  schema_version: 1;
  checkpoints: CheckpointItem[];
}

const EMPTY_INDEX: CheckpointIndex = { schema_version: 1, checkpoints: [] };

export class CheckpointStore {
  constructor(private readonly indexPath: string) {}

  readIndex(): CheckpointIndex {
    return readJsonFile<CheckpointIndex>(this.indexPath, EMPTY_INDEX);
  }

  append(item: CheckpointItem): void {
    const current = this.readIndex();
    current.checkpoints.push(item);
    current.checkpoints.sort((a, b) => a.created_at.localeCompare(b.created_at));
    writeJsonFile(this.indexPath, current);
  }

  latest(track?: CheckpointItem['track']): CheckpointItem | null {
    const current = this.readIndex();
    const list = track ? current.checkpoints.filter((cp) => cp.track === track) : current.checkpoints;
    return list.length ? list[list.length - 1] : null;
  }

  hasAny(): boolean {
    if (!existsSync(this.indexPath)) return false;
    return this.readIndex().checkpoints.length > 0;
  }
}
