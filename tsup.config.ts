import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/cli/index.ts',
    'src/testing/skills-test-entry.ts',
    'src/testing/ab-report-test-entry.ts',
    'src/testing/agents-test-entry.ts',
    'src/testing/evidence-routing-test-entry.ts',
    'src/testing/evidence-layer-test-entry.ts',
    'src/testing/corpus-plan-test-entry.ts',
    'src/testing/global-merge-test-entry.ts',
    'src/testing/shard-distillation-test-entry.ts',
    'src/testing/training-seed-test-entry.ts',
    'src/testing/training-strategy-test-entry.ts',
    'src/testing/input-routing-ab-entry.ts',
    'src/testing/kimi-stability-entry.ts',
    'src/testing/kimi-stability-suite-entry.ts',
    'src/testing/dynamic-scaling-test-entry.ts',
    'src/testing/routing-decision-test-entry.ts',
    'src/testing/pk-aggregate-test-entry.ts',
    'src/testing/chat-orchestrator-test-entry.ts',
  ],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  esbuildOptions(options) {
    options.conditions = ['module'];
  },
});
