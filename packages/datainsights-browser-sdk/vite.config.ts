import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import type { Plugin } from 'vite';

import config from '../../vite.config.default';

const baseConfig = config(
  path.resolve(__dirname, 'src/browser-entry.ts'),
  'DataInsights',
  {
    fileName: 'datainsights-browser-sdk',
  },
);

function exposeFacadeAsUmdGlobal(): Plugin {
  return {
    name: 'datainsights-facade-umd-global',
    enforce: 'post',
    closeBundle() {
      for (const file of [
        'dist/datainsights-browser-sdk.umd.cjs',
        'dist/datainsights-browser-sdk.umd.min.cjs',
        'umd/datainsights-browser-sdk.js',
        'umd/datainsights-browser-sdk.min.js',
      ]) {
        const absolute = path.resolve(__dirname, file);
        const source = readFileSync(absolute, 'utf8');
        writeFileSync(
          absolute,
          source.replace(
            'g["DataInsights"] = f();',
            'g["DataInsights"] = f().DataInsights;',
          ),
        );
      }
    },
  };
}

export default defineConfig((environment) =>
  mergeConfig(baseConfig(environment), {
    build: {
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
    plugins: [exposeFacadeAsUmdGlobal()],
  }),
);
