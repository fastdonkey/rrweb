import { existsSync } from 'node:fs';

import * as puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startInsuranceDemoServer } from '../scripts/insurance-demo.mjs';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('local insurance product recording and replay', () => {
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

  it('records real local interactions only after consent and replays them in a script-disabled sandbox', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    const nonLocalRequests: string[] = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !['127.0.0.1', 'localhost'].includes(url.hostname)
      ) {
        nonLocalRequests.push(request.url());
        void request.abort();
        return;
      }
      void request.continue();
    });

    await page.goto(`${demo.origin}/gp/99440765`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(async () => {
      const result = await (window as any).__BOOTSTRAP_RESULT__;
      return result?.ok === true && (window as any).__INSURANCE_APP_READY__;
    });

    expect(
      await page.evaluate(
        () => (window as any).DataInsights.getDebugInfo().state,
      ),
    ).toBe('initialized');
    expect(
      await fetch(`${demo.origin}/recordings`).then((value) => value.json()),
    ).toEqual([]);

    await page.click('#start-insurance');
    await page.waitForFunction(
      () => (window as any).DataInsights.getDebugInfo().state === 'recording',
    );
    await page.click('#plan-premium');
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight / 2),
    );
    await page.click('#coverage-details');
    await page.waitForSelector('#coverage-modal:not([hidden])');
    await page.click('#close-coverage-modal');
    await page.type('#policy-holder-name', '本地保险测试用户');
    await page.type('#policy-holder-phone', '13800138000');
    await page.type('#policy-holder-id', '110101199001010011');
    await page.type('#insured-amount', '500000');
    await page.type('#service-password', 'NeverRecordInsurancePassword!');
    await page.$eval('#policy-form', (form) =>
      (form as HTMLFormElement).requestSubmit(),
    );
    await page.waitForSelector('#application-success:not([hidden])');

    const stopResult = await page.evaluate(
      () => (window as any).__SUBMIT_RESULT__ ?? null,
    );
    expect(stopResult).toMatchObject({ ok: true });

    const localStores = await page.evaluate(async () => {
      const open = indexedDB.open('datainsights-recorder-v1');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const transaction = database.transaction(
        ['journal', 'outbox'],
        'readonly',
      );
      const read = (store: string) =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = transaction.objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const result = {
        journal: await read('journal'),
        outbox: await read('outbox'),
      };
      database.close();
      return result;
    });
    expect(localStores).toEqual({ journal: [], outbox: [] });

    const recordings = (await fetch(`${demo.origin}/recordings`).then((value) =>
      value.json(),
    )) as Array<{ recordingId: string; batches: unknown[] }>;
    expect(recordings).toHaveLength(1);
    const serialized = JSON.stringify(recordings);
    expect(serialized).toContain('本地保险测试用户');
    expect(serialized).toContain('13800138000');
    expect(serialized).toContain('110101199001010011');
    expect(serialized).toContain('500000');
    expect(serialized).toContain('premium');
    expect(serialized).toContain('policy-submit');
    expect(serialized).not.toContain('NeverRecordInsurancePassword!');

    await page.goto(
      `${demo.origin}/replay/${encodeURIComponent(recordings[0].recordingId)}`,
      { waitUntil: 'networkidle0' },
    );
    await page.waitForFunction(
      () =>
        (window as any).__REPLAY_READY__ === true &&
        (window as any).__REPLAY_FINISHED__ === true,
      { timeout: 20_000 },
    );
    const replay = await page.evaluate(() => {
      const iframe = document.querySelector('#replay-root iframe')!;
      const replayDocument = (iframe as HTMLIFrameElement).contentDocument!;
      return {
        sandbox: iframe.getAttribute('sandbox'),
        name: (
          replayDocument.querySelector(
            '#policy-holder-name',
          ) as HTMLInputElement
        )?.value,
        amount: (
          replayDocument.querySelector('#insured-amount') as HTMLInputElement
        )?.value,
        success: replayDocument.querySelector('#application-success')
          ?.textContent,
        scriptExecuted: (window as any).__REPLAY_SCRIPT_EXECUTED__ === true,
      };
    });
    expect(replay).toEqual({
      sandbox: 'allow-same-origin',
      name: '本地保险测试用户',
      amount: '500000',
      success: expect.stringContaining('投保信息已提交'),
      scriptExecuted: false,
    });
    expect(nonLocalRequests).toEqual([]);
    await page.close();
  });
});
