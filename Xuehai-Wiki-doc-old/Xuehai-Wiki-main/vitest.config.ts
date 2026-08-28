import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // The CLI template is a generated copy of this source tree; running its
      // tests here would double every result and report failures against files
      // nobody edits directly.
      'packages/*/template/**',
    ],
    // The first test to render Markdown pays for Shiki loading its grammars and
    // themes, which takes several seconds. That cost is real and one-off — it is
    // amortised across the whole build — so the timeout has to accommodate it
    // rather than the default 5s failing the first test to arrive.
    testTimeout: 30_000,
    // Hooks get their own budget, and the suites that build a search index do
    // that work in beforeAll. At ~8s it sits uncomfortably close to the 10s
    // default whenever the machine is busy, which makes for a flaky CI.
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
