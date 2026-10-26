import path from 'node:path';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import type { Plugin } from 'vite';
import { buildSync } from 'esbuild';

import config from '../../vite.config.default';
import { dataInsightsBuildDefines } from './buildMetadata';

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
      buildSync({
        entryPoints: [
          path.resolve(__dirname, 'src/pipeline/serialization.worker.ts'),
        ],
        outfile: path.resolve(__dirname, 'dist/serialization.worker.js'),
        bundle: true,
        format: 'iife',
        target: 'es2017',
        sourcemap: true,
      });
      copyFileSync(
        path.resolve(__dirname, 'dist/serialization.worker.js'),
        path.resolve(__dirname, 'umd/serialization.worker.js'),
      );
      copyFileSync(
        path.resolve(__dirname, 'dist/serialization.worker.js.map'),
        path.resolve(__dirname, 'umd/serialization.worker.js.map'),
      );
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
    define: dataInsightsBuildDefines(),
    test: {
      // Browser and release suites build into the same package directories.
      // Serializing files prevents parallel Vite builds from deleting each
      // other's dist/umd artifacts while closeBundle is still running.
      fileParallelism: false,
    },
    build: {
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
    plugins: [exposeFacadeAsUmdGlobal()],
  }),
);
