import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/cli/index.ts',
    'src/testing/skills-test-entry.ts',
    'src/testing/ab-report-test-entry.ts',
    'src/testing/agents-test-entry.ts',
    'src/testing/evidence-routing-test-entry.ts',
    'src/testing/input-routing-ab-entry.ts',
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
