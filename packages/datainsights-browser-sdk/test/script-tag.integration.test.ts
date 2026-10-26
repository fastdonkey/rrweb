import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import * as puppeteer from 'puppeteer';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
  let deliveredBatches: any[] = [];

  beforeAll(async () => {
    await build({ configFile: path.resolve(packageRoot, 'vite.config.ts') });
    const [html, bootstrapHtml, bundle, workerBundle] = await Promise.all([
      readFile(fixturePath),
      readFile(path.resolve(__dirname, 'html/bootstrap.html')),
      readFile(bundlePath),
      readFile(path.resolve(packageRoot, 'dist/serialization.worker.js')),
    ]);
    server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      if (request.url === '/v1/datainsights-browser-sdk.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(bundle);
        return;
      }
      if (request.url === '/v1/serialization.worker.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(workerBundle);
        return;
      }
      if (requestUrl.pathname === '/sdk/config') {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            appKey: requestUrl.searchParams.get('appKey'),
            enabled: true,
            configVersion: 'local-1',
            collectorUrls: [origin],
            uploadToken: 'local-short-lived-token',
            expiresAt: '2099-01-01T00:00:00.000Z',
          }),
        );
        return;
      }
      if (requestUrl.pathname === '/api/events' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const batch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        deliveredBatches.push(batch);
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            status: 'accepted',
            receipt: {
              persisted: true,
              batchId: batch.batchId,
              recordingId: batch.recordingId,
              sequenceStart: batch.sequenceStart,
              sequenceEnd: batch.sequenceEnd,
              contentHash: batch.contentHash,
            },
          }),
        );
        return;
      }
      if (
        requestUrl.pathname.startsWith('/api/recordings/') &&
        requestUrl.pathname.endsWith('/delivery-state')
      ) {
        const recordingId = requestUrl.pathname.split('/')[3];
        const matching = deliveredBatches.filter(
          (batch) => batch.recordingId === recordingId,
        );
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            recordingId,
            contiguousSequenceEnd: Math.max(
              0,
              ...matching.map((batch) => batch.sequenceEnd),
            ),
            missingRanges: [],
            checkedAt: new Date().toISOString(),
          }),
        );
        return;
      }
      if (requestUrl.pathname === '/bootstrap.html') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(bootstrapHtml);
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

  beforeEach(() => {
    deliveredBatches = [];
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
      (window as any).__DELIVERED_BATCHES__ = [];
      (window as any).DataInsightsTransport = {
        name: 'browser-fixture',
        capability: 'test-only',
        async send(batch: any) {
          (window as any).__DELIVERED_BATCHES__.push(batch);
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
    expect(
      await page.evaluate(
        () => (window as any).DataInsights.getDebugInfo().workerFallback,
      ),
    ).toBe(false);
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
      const transaction = database.transaction(
        ['journal', 'outbox'],
        'readonly',
      );
      const readAll = (store: string) =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = transaction.objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const [journal, outbox] = await Promise.all([
        readAll('journal'),
        readAll('outbox'),
      ]);
      database.close();
      return {
        journal,
        outbox,
        delivered: (window as any).__DELIVERED_BATCHES__,
        serializedJournal: JSON.stringify(journal),
        serializedDelivery: JSON.stringify(
          (window as any).__DELIVERED_BATCHES__,
        ),
      };
    });
    expect(persisted.delivered).toHaveLength(1);
    expect(persisted.delivered[0]).toMatchObject({
      schemaVersion: '1.0',
      sequenceStart: 1,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      events: expect.any(Array),
    });
    expect(persisted.serializedDelivery).toContain('普通投保人');
    expect(persisted.serializedDelivery).toContain('policy-submit');
    expect(persisted.serializedDelivery).not.toContain(
      'NeverRecordThisPassword!',
    );
    expect(persisted.journal).toEqual([]);
    expect(persisted.outbox).toEqual([]);
    await page.close();
  });

  it('recovers a previous Recording journal after a page reload', async () => {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      (window as any).__DELIVERED_BATCHES__ = [];
      (window as any).DataInsightsTransport = {
        name: 'reload-recovery-fixture',
        capability: 'test-only',
        async send(batch: any) {
          (window as any).__DELIVERED_BATCHES__.push(batch);
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
    const firstRecordingId = await page.evaluate(async () => {
      const sdk = (window as any).DataInsights;
      sdk.consent.grant({ noticeVersion: 'v1', action: 'start-insurance' });
      const started = await sdk.start({ userId: 'reload-user' });
      return started.value.recordingId;
    });
    await page.type('#policy-holder', '刷新前投保人');
    await page.evaluate(() =>
      (window as any).DataInsights.addCustomEvent('before-reload-marker', {
        step: 'proposal-form',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      const sdk = (window as any).DataInsights;
      sdk.consent.grant({ noticeVersion: 'v1', action: 'start-insurance' });
      await sdk.start({ userId: 'reload-user' });
    });
    await page.waitForFunction(
      (recordingId) =>
        (window as any).__DELIVERED_BATCHES__.some(
          (batch: any) => batch.recordingId === recordingId,
        ),
      { timeout: 8_000 },
      firstRecordingId,
    );

    const recovered = await page.evaluate((recordingId) => {
      const batches = (window as any).__DELIVERED_BATCHES__.filter(
        (batch: any) => batch.recordingId === recordingId,
      );
      return JSON.stringify(batches);
    }, firstRecordingId);
    expect(recovered).toContain('before-reload-marker');
    expect(recovered).toContain('proposal-form');
    await page.close();
  });

  it('bootstraps from AppKey configuration and records only after the host button click', async () => {
    const page = await browser.newPage();
    const requestedUrls: string[] = [];
    page.on('request', (request) => requestedUrls.push(request.url()));
    await page.goto(`${origin}/bootstrap.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(async () => {
      const result = await (window as any).__BOOTSTRAP_RESULT__;
      return result?.ok === true;
    });

    expect(
      await page.evaluate(
        () => (window as any).DataInsights.getDebugInfo().state,
      ),
    ).toBe('initialized');
    expect(deliveredBatches).toHaveLength(0);

    await page.click('#start-insurance');
    await page.waitForFunction(
      () => (window as any).DataInsights.getDebugInfo().state === 'recording',
    );
    await page.type('#bootstrap-policy-holder', '本地真实投保人');
    await page.type('#bootstrap-password', 'NeverRecordBootstrapPassword!');
    const stopResult = await page.evaluate(() =>
      (window as any).DataInsights.stop('completed'),
    );
    const postStop = await page.evaluate(async () => {
      const request = indexedDB.open('datainsights-recorder-v1');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        ['journal', 'outbox'],
        'readonly',
      );
      const readAll = (store: string) =>
        new Promise<unknown[]>((resolve, reject) => {
          const pending = transaction.objectStore(store).getAll();
          pending.onsuccess = () => resolve(pending.result);
          pending.onerror = () => reject(pending.error);
        });
      const [journal, outbox] = await Promise.all([
        readAll('journal'),
        readAll('outbox'),
      ]);
      database.close();
      return {
        debug: (window as any).DataInsights.getDebugInfo(),
        journal,
        outbox,
      };
    });

    expect(
      stopResult,
      JSON.stringify({ stopResult, requestedUrls, postStop }),
    ).toMatchObject({ ok: true });
    expect(
      requestedUrls,
      JSON.stringify({ requestedUrls, postStop }),
    ).toContain(`${origin}/api/events`);
    await vi.waitFor(() => expect(deliveredBatches).toHaveLength(1), {
      timeout: 5_000,
    });
    expect(
      postStop.journal.filter(
        (record: any) => record.appKey === 'di_t_cn1_LOCALDEMO1',
      ),
    ).toEqual([]);
    expect(
      postStop.outbox.filter(
        (record: any) => record.appKey === 'di_t_cn1_LOCALDEMO1',
      ),
    ).toEqual([]);
    const serialized = JSON.stringify(deliveredBatches);
    expect(serialized).toContain('本地真实投保人');
    expect(serialized).not.toContain('NeverRecordBootstrapPassword!');
    expect(deliveredBatches[0]).toMatchObject({
      appKey: 'di_t_cn1_LOCALDEMO1',
      consent: { noticeVersion: 'insurance-notice-v1' },
      identity: { type: 'host', id: 'local-policy-user' },
    });
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
