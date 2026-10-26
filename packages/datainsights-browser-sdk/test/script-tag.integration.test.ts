import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import * as puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const packageRoot = path.resolve(__dirname, '..');
const fixturePath = path.resolve(__dirname, 'html/script-tag.html');
const bundlePath = path.resolve(packageRoot, 'umd/datainsights-browser-sdk.js');

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Test server did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

describe('DataInsights Script Tag', () => {
  let server: Server;
  let origin: string;
  let browser: puppeteer.Browser;

  beforeAll(async () => {
    await build({ configFile: path.resolve(packageRoot, 'vite.config.ts') });
    const [html, bundle] = await Promise.all([
      readFile(fixturePath),
      readFile(bundlePath),
    ]);
    server = createServer((request, response) => {
      if (request.url === '/v1/datainsights-browser-sdk.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(bundle);
        return;
      }
      if (request.url === '/csp.html') {
        response.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'",
        );
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    origin = `http://127.0.0.1:${await listen(server)}`;
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: existsSync(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      )
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('installs one facade without granting consent or starting recording', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/script-tag.html`, { waitUntil: 'networkidle0' });

    expect(
      await page.evaluate(() => ({
        facade: typeof (window as any).DataInsights?.start,
        state: (window as any).DataInsights?.getDebugInfo().state,
      })),
    ).toEqual({ facade: 'function', state: 'initialized' });
    await page.close();
  });

  it('fails closed when no Transport was configured', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/script-tag.html`, { waitUntil: 'networkidle0' });
    const result = await page.evaluate(async () => {
      const sdk = (window as any).DataInsights;
      sdk.consent.grant({ noticeVersion: 'v1', action: 'start-insurance' });
      return sdk.start({ userId: 'policy-user-1' });
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TRANSPORT_NOT_CONFIGURED',
        message: expect.any(String),
      },
    });
    await page.close();
  });

  it('records a real page after consent while excluding the password value', async () => {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      (window as any).DataInsightsTransport = {
        name: 'browser-fixture',
        capability: 'test-only',
        async send(batch: any) {
          return {
            status: 'accepted',
            receipt: {
              persisted: true,
              batchId: batch.batchId,
              recordingId: batch.recordingId,
              sequenceStart: batch.sequenceStart,
              sequenceEnd: batch.sequenceEnd,
              contentHash: batch.contentHash,
            },
          };
        },
      };
    });
    await page.goto(`${origin}/script-tag.html`, { waitUntil: 'networkidle0' });
    const startResult = await page.evaluate(async () => {
      const sdk = (window as any).DataInsights;
      sdk.consent.grant({ noticeVersion: 'v1', action: 'start-insurance' });
      return sdk.start({ userId: 'policy-user-1' });
    });
    expect(startResult.ok, JSON.stringify(startResult)).toBe(true);
    await page.type('#policy-holder', '普通投保人');
    await page.type('#password', 'NeverRecordThisPassword!');
    await page.click('#submit-policy');
    await page.evaluate(() =>
      (window as any).DataInsights.addCustomEvent('policy-submit', {
        policyType: 'health',
      }),
    );
    await page.evaluate(() => (window as any).DataInsights.stop('completed'));

    const persisted = await page.evaluate(async () => {
      const request = indexedDB.open('datainsights-recorder-v1');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction('journal', 'readonly');
      const getAll = transaction.objectStore('journal').getAll();
      const records = await new Promise<unknown[]>((resolve, reject) => {
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      });
      database.close();
      return JSON.stringify(records);
    });
    expect(persisted).toContain('普通投保人');
    expect(persisted).toContain('policy-submit');
    expect(persisted).not.toContain('NeverRecordThisPassword!');
    await page.close();
  });

  it('preserves lifecycle state on duplicate loading and loads under strict CSP', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/csp.html`, { waitUntil: 'networkidle0' });
    const result = await page.evaluate(async () => {
      const sdk = (window as any).DataInsights;
      sdk.consent.grant({ noticeVersion: 'v1', action: 'start-insurance' });
      const script = document.createElement('script');
      script.src = '/v1/datainsights-browser-sdk.js';
      script.dataset.appKey = 'insurance-h5';
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('duplicate load failed'));
        document.head.append(script);
      });
      return {
        state: (window as any).DataInsights.getDebugInfo().state,
        count: Object.keys(window).filter((key) => key === 'DataInsights')
          .length,
      };
    });
    expect(result).toEqual({ state: 'authorized', count: 1 });
    await page.close();
  });
});
