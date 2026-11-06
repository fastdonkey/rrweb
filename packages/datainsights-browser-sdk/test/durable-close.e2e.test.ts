import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startInsuranceDemoServer } from '../scripts/insurance-demo.mjs';
vi.setConfig({ testTimeout: 90000, hookTimeout: 90000 });
describe('durable close in browser', () => {
  let browser: puppeteer.Browser;
  let demo: Awaited<ReturnType<typeof startInsuranceDemoServer>>;
  beforeAll(async () => {
    demo = await startInsuranceDemoServer({ buildAssets: true });
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
    await demo?.close();
  });
  it('queues pagehide close, restores it after reload, and closes the whole Trace only on completed', async () => {
    const page = await browser.newPage();
    let offline = true;
    const seen: { url: string; body: any }[] = [];
    const batches: any[] = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/sdk/v2/capabilities') {
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            tokenRefresh: true,
            closeV2: true,
            reconcileV2: false,
            gzipHttp: false,
          }),
        });
        return;
      }
      if (url.pathname === '/api/events' && request.postData())
        batches.push(JSON.parse(request.postData()!));
      if (
        url.pathname.startsWith('/sdk/v2/') &&
        url.pathname.endsWith('/close')
      ) {
        const body = JSON.parse(request.postData() ?? '{}');
        seen.push({ url: url.pathname, body });
        void request.respond({
          status: offline ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            offline
              ? { code: 'STORAGE_BACKPRESSURE' }
              : { accepted: true, closeId: body.closeId },
          ),
        });
        return;
      }
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !['127.0.0.1', 'localhost'].includes(url.hostname)
      ) {
        void request.abort();
        return;
      }
      void request.continue();
    });
    const start = async () => {
      await page.waitForFunction(() =>
        Boolean((window as any).__INSURANCE_APP_READY__),
      );
      await page.click('#consent-recording');
      await page.waitForFunction(
        () => (window as any).DataInsights.getDebugInfo().state === 'recording',
      );
    };
    const pending = () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open('datainsights-recorder-v1');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise<any[]>((resolve, reject) => {
            const r = db
              .transaction('metadata')
              .objectStore('metadata')
              .getAll();
            r.onsuccess = () =>
              resolve(
                r.result.filter(
                  (v: any) => v.kind === 'recording' || v.kind === 'trace',
                ),
              );
            r.onerror = () => reject(r.error);
          });
        } finally {
          db.close();
        }
      });
    await page.goto(demo.origin + '/gp/99440765', {
      waitUntil: 'networkidle0',
    });
    await start();
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: false }),
      ),
    );
    await page.waitForFunction(
      () => (window as any).DataInsights.getDebugInfo().state === 'authorized',
    );
    const first = await pending();
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe('recording');
    expect(first[0].payload.finalSequence).toBeGreaterThan(0);
    expect(first[0].payload.finalBatchHash).toMatch(/^[0-9a-f]{64}$/);
    const oldClose = first[0].payload,
      trace = oldClose.traceId;
    offline = false;
    await page.reload({ waitUntil: 'networkidle0' });
    await start();
    await page.waitForFunction(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('datainsights-recorder-v1');
        r.onsuccess = () => resolve(r.result);
      });
      const all = await new Promise<any[]>((resolve) => {
        const r = db.transaction('metadata').objectStore('metadata').getAll();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return !all.some((v) => v.kind === 'recording');
    });
    expect(
      seen.filter((v) => v.body.closeId === oldClose.closeId).length,
    ).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => (window as any).DataInsights.stop('completed'));
    // Trigger recovery dispatch if stop joined a startup flight; the queue also retries every 30s.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const deadline = Date.now() + 35000;
    while (
      !seen.some((v) => v.url.includes('/traces/')) &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 100));
    const closed = seen.find((v) => v.url === `/sdk/v2/traces/${trace}/close`);
    expect(closed).toBeDefined();
    expect(closed!.body.recordingIds).toHaveLength(2);
    expect(closed!.body.recordingIds).toContain(oldClose.recordingId);
    expect(
      new Set(
        seen
          .filter((v) => v.body.closeId === oldClose.closeId)
          .map((v) => JSON.stringify(v.body)),
      ).size,
    ).toBe(1);
    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches)
      expect(batch.batchId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    await mkdir('target', { recursive: true });
    await writeFile(
      'target/t26-browser-contract.json',
      JSON.stringify({ batches, closes: seen }),
    );
    await page.close();
  });
});
