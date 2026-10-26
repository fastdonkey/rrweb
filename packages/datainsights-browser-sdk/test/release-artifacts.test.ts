import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';

import { dataInsightsBuildMetadata } from '../buildMetadata';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const packageRoot = path.resolve(__dirname, '..');

describe('DataInsights release artifacts', () => {
  beforeAll(async () => {
    await build({ configFile: path.resolve(packageRoot, 'vite.config.ts') });
  });

  it('injects exact SDK and rrweb version/commit metadata', async () => {
    const metadata = dataInsightsBuildMetadata();
    expect(metadata).toMatchObject({
      sdkVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      rrwebVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      rrwebCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
    });
    const bundle = await readFile(
      path.resolve(packageRoot, 'dist/datainsights-browser-sdk.js'),
      'utf8',
    );
    expect(bundle).toContain(metadata.sdkVersion);
    expect(bundle).toContain(metadata.rrwebVersion);
    expect(bundle).toContain(metadata.rrwebCommit);
  });

  it('publishes an external serializer worker and required package documentation', async () => {
    await expect(
      stat(path.resolve(packageRoot, 'dist/serialization.worker.js')),
    ).resolves.toMatchObject({ size: expect.any(Number) });
    const packageJson = JSON.parse(
      await readFile(path.resolve(packageRoot, 'package.json'), 'utf8'),
    );
    expect(packageJson.files).toEqual(
      expect.arrayContaining(['dist', 'umd', 'README.md', 'LICENSE', 'NOTICE']),
    );
  });

  it('does not embed long-lived credentials or internal ingest addresses', async () => {
    const artifacts = await Promise.all(
      [
        'dist/datainsights-browser-sdk.js',
        'dist/datainsights-browser-sdk.cjs',
        'umd/datainsights-browser-sdk.js',
        'dist/serialization.worker.js',
      ].map((file) => readFile(path.resolve(packageRoot, file), 'utf8')),
    );
    const releaseText = artifacts.join('\n');
    expect(releaseText).not.toMatch(/BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/);
    expect(releaseText).not.toMatch(/https?:\/\/(ingest|api)\.internal\./i);
    expect(releaseText).not.toMatch(/appSecret\s*[:=]\s*['"][^'"]+/i);
    expect(releaseText).not.toMatch(/securityKey\s*[:=]\s*['"][^'"]+/i);
  });
});
