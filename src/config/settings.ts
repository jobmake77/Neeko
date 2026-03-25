import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';

interface NeekoConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  defaultModel?: string;
  neekoDataDir?: string;
}

const conf = new Conf<NeekoConfig>({
  projectName: 'neeko',
  defaults: {
    qdrantUrl: 'http://localhost:6333',
    defaultModel: 'claude-sonnet-4-6',
    neekoDataDir: join(homedir(), '.neeko'),
  },
});

export const settings = {
  get<K extends keyof NeekoConfig>(key: K): NeekoConfig[K] {
    return conf.get(key);
  },
  set<K extends keyof NeekoConfig>(key: K, value: NeekoConfig[K]): void {
    conf.set(key, value);
  },
  getAll(): NeekoConfig {
    return conf.store;
  },
  getDataDir(): string {
    return conf.get('neekoDataDir') ?? join(homedir(), '.neeko');
  },
  getPersonaDir(slug: string): string {
    return join(settings.getDataDir(), 'personas', slug);
  },
};
