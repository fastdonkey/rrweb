import { existsSync } from 'node:fs';

import { EventType, IncrementalSource } from '@rrweb/types';
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

    const initialPage = await page.evaluate(() => ({
      consentVisible: Boolean(document.querySelector('.recording-consent')),
      modules: [
        '#plan-choice',
        '#product-features',
        '#claims-guide',
        '#faq',
        '#insurance-form',
        '.purchase-bar',
      ].map((selector) => Boolean(document.querySelector(selector))),
      imagesAreLocal: [...document.images].every((image) =>
        ['127.0.0.1', 'localhost'].includes(new URL(image.currentSrc).hostname),
      ),
    }));
    expect(initialPage).toEqual({
      consentVisible: true,
      modules: [true, true, true, true, true, true],
      imagesAreLocal: true,
    });

    await page.click('#consent-recording');
    await page.waitForFunction(
      () => (window as any).DataInsights.getDebugInfo().state === 'recording',
    );
    await page.waitForSelector('.recording-consent', { hidden: true });
    await page.click('#start-insurance');
    const initialNoticeGate = await page.evaluate(() => ({
      items: document.querySelectorAll('[data-insurance-notice]').length,
      remaining: document.querySelector('#notice-confirmation-status')
        ?.textContent,
      submitDisabled: (
        document.querySelector('#submit-policy') as HTMLButtonElement
      ).disabled,
    }));
    expect(initialNoticeGate.items).toBe(5);
    expect(initialNoticeGate.remaining).toContain('还需确认 5 项');
    expect(initialNoticeGate.submitDisabled).toBe(true);

    await page.click('[data-insurance-notice="application-notice"]');
    await page.waitForSelector('#insurance-notice-modal:not([hidden])');
    const noticeContentDimensions = await page.$eval(
      '#insurance-notice-content',
      (element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }),
    );
    expect(noticeContentDimensions.scrollHeight).toBeGreaterThan(
      noticeContentDimensions.clientHeight,
    );
    expect(
      await page.$eval(
        '#confirm-insurance-notice',
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true);
    await page.click('#close-insurance-notice');
    expect(
      await page.$eval(
        '[data-insurance-notice="application-notice"]',
        (button) => button.getAttribute('data-confirmed'),
      ),
    ).toBe('false');

    const noticeCodes = [
      'health-disclosure',
      'application-notice',
      'policy-terms',
      'exemption-clauses',
      'privacy-authorization',
    ];
    for (const code of noticeCodes) {
      await page.click(`[data-insurance-notice="${code}"]`);
      await page.waitForSelector('#insurance-notice-modal:not([hidden])');
      const dimensions = await page.$eval(
        '#insurance-notice-content',
        (element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }),
      );
      expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
      expect(
        await page.$eval(
          '#confirm-insurance-notice',
          (button) => (button as HTMLButtonElement).disabled,
        ),
      ).toBe(true);
      await page.$eval('#insurance-notice-content', (element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll'));
      });
      await page.waitForFunction(
        () =>
          !(
            document.querySelector(
              '#confirm-insurance-notice',
            ) as HTMLButtonElement
          ).disabled,
      );
      await page.click('#confirm-insurance-notice');
      const confirmationState = await page.evaluate((noticeCode) => {
        const button = document.querySelector('#confirm-insurance-notice');
        const bounds = button?.getBoundingClientRect();
        return {
          code: noticeCode,
          modalHidden: document
            .querySelector('#insurance-notice-modal')
            ?.hasAttribute('hidden'),
          confirmed: document
            .querySelector(`[data-insurance-notice="${noticeCode}"]`)
            ?.getAttribute('data-confirmed'),
          confirmDisabled: (button as HTMLButtonElement | null)?.disabled,
          hitTarget:
            bounds &&
            document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            )?.id,
        };
      }, code);
      expect(confirmationState, code).toMatchObject({
        modalHidden: true,
        confirmed: 'true',
      });
    }
    const completedNoticeGate = await page.evaluate(() => ({
      confirmed: document.querySelectorAll(
        '.insurance-notice-item.is-confirmed',
      ).length,
      status: document.querySelector('#notice-confirmation-status')
        ?.textContent,
      submitDisabled: (
        document.querySelector('#submit-policy') as HTMLButtonElement
      ).disabled,
      confirmationOrder: [
        ...document.querySelectorAll('[data-confirmation-order]'),
      ]
        .sort(
          (left, right) =>
            Number(left.getAttribute('data-confirmation-order')) -
            Number(right.getAttribute('data-confirmation-order')),
        )
        .map((element) => element.getAttribute('data-insurance-notice')),
    }));
    expect(completedNoticeGate).toEqual({
      confirmed: 5,
      status: expect.stringContaining('已完成全部阅读确认'),
      submitDisabled: false,
      confirmationOrder: noticeCodes,
    });
    await page.click('[data-insurance-notice="health-disclosure"]');
    await page.$eval('#insurance-notice-content', (element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(
      () =>
        !(
          document.querySelector(
            '#confirm-insurance-notice',
          ) as HTMLButtonElement
        ).disabled,
    );
    await page.click('#confirm-insurance-notice');
    expect(
      await page.$$eval('[data-confirmation-order]', (elements) =>
        elements
          .sort(
            (left, right) =>
              Number(left.getAttribute('data-confirmation-order')) -
              Number(right.getAttribute('data-confirmation-order')),
          )
          .map((element) => element.getAttribute('data-insurance-notice')),
      ),
    ).toEqual(noticeCodes);

    await page.click('#plan-premium');
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight / 2),
    );
    await page.click('#coverage-details');
    await page.waitForSelector('#coverage-modal:not([hidden])');
    await page.click('#close-coverage-modal');
    await page.type('#policy-holder-name', '本地保险测试用户', { delay: 120 });
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

    type RecordedEvent = {
      type: EventType;
      timestamp: number;
      data: { source?: IncrementalSource; text?: string };
    };
    const recordings = (await fetch(`${demo.origin}/recordings`).then((value) =>
      value.json(),
    )) as Array<{
      recordingId: string;
      batches: Array<{ events: RecordedEvent[] }>;
    }>;
    expect(recordings).toHaveLength(1);
    const serialized = JSON.stringify(recordings);
    expect(serialized).toContain('本地保险测试用户');
    expect(serialized).toContain('13800138000');
    expect(serialized).toContain('110101199001010011');
    expect(serialized).toContain('500000');
    expect(serialized).toContain('premium');
    expect(serialized).toContain('policy-submit');
    expect(serialized).toContain('insurance-notices-confirmed');
    expect(serialized).toContain('health-disclosure');
    expect(serialized).not.toContain('NeverRecordInsurancePassword!');
    expect(serialized).not.toContain('同意并继续');
    const recordedEvents = recordings[0].batches.flatMap(
      (batch) => batch.events,
    );
    const noticesConfirmedEvents = recordedEvents.filter(
      (event) =>
        event.type === EventType.Custom &&
        (event.data as { tag?: string }).tag === 'insurance-notices-confirmed',
    );
    expect(noticesConfirmedEvents).toHaveLength(1);
    expect(noticesConfirmedEvents[0].data).toEqual({
      tag: 'insurance-notices-confirmed',
      payload: {
        noticeVersion: 'local-insurance-notices-v1',
        documentCodes: [
          'application-notice',
          'policy-terms',
          'health-disclosure',
          'exemption-clauses',
          'privacy-authorization',
        ],
        confirmationOrder: noticeCodes,
      },
    });
    const containsRecordingConsentElement = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const node = value as {
        attributes?: { class?: string };
        childNodes?: unknown[];
      };
      if (node.attributes?.class?.split(/\s+/).includes('recording-consent')) {
        return true;
      }
      return node.childNodes?.some(containsRecordingConsentElement) ?? false;
    };
    const fullSnapshots = recordedEvents.filter(
      (event) => event.type === EventType.FullSnapshot,
    ) as Array<RecordedEvent & { data: { node?: unknown } }>;
    expect(fullSnapshots).not.toHaveLength(0);
    expect(
      fullSnapshots.some((event) =>
        containsRecordingConsentElement(event.data.node),
      ),
    ).toBe(false);
    const nameInputEvents = recordedEvents.filter(
      (event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input &&
        typeof event.data.text === 'string' &&
        '本地保险测试用户'.startsWith(event.data.text),
    );
    expect(nameInputEvents.length).toBeGreaterThanOrEqual(4);
    expect(
      nameInputEvents.at(-1)!.timestamp - nameInputEvents[0].timestamp,
    ).toBeGreaterThanOrEqual(300);

    await page.goto(
      `${demo.origin}/replay/${encodeURIComponent(recordings[0].recordingId)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      () =>
        (window as any).__REPLAY_READY__ === true ||
        Boolean((window as any).__REPLAY_ERROR__),
      { timeout: 20_000 },
    );
    const replayError = await page.evaluate(
      () => (window as any).__REPLAY_ERROR__ ?? null,
    );
    if (replayError) throw new Error(replayError);
    await page.waitForSelector('#replay-root .rr-player');
    const playerUi = await page.evaluate(() => ({
      hasController: Boolean(document.querySelector('.rr-controller')),
      hasProgress: Boolean(
        document.querySelector(
          '[role="slider"][aria-label="Playback position"]',
        ),
      ),
      speeds: [...document.querySelectorAll('.rr-controller__btns button')]
        .map((button) => button.textContent?.trim())
        .filter((text) => /^\d+(?:\.\d+)?x$/.test(text ?? '')),
      paused:
        (window as any).__REPLAY_PLAYER__?.getReplayer().service.state.value ===
        'paused',
      skipInactive: (document.querySelector('#skip') as HTMLInputElement | null)
        ?.checked,
    }));
    expect(playerUi).toEqual({
      hasController: true,
      hasProgress: true,
      speeds: ['0.75x', '1x', '2x', '4x', '8x'],
      paused: true,
      skipInactive: false,
    });
    const pausedFrameText = await page.evaluate(() => {
      const iframe = document.querySelector('#replay-root iframe');
      return (iframe as HTMLIFrameElement)?.contentDocument?.body.textContent;
    });
    expect(pausedFrameText).toContain('众民保普惠百万医疗险');

    await page.click('.rr-controller__btns button');
    await page.waitForFunction(
      () => (window as any).__REPLAY_FINISHED__ === true,
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
        confirmedNotices: replayDocument.querySelectorAll(
          '.insurance-notice-item.is-confirmed',
        ).length,
        noticeStatus: replayDocument.querySelector(
          '#notice-confirmation-status',
        )?.textContent,
        scriptExecuted: (window as any).__REPLAY_SCRIPT_EXECUTED__ === true,
      };
    });
    expect(replay).toEqual({
      sandbox: 'allow-same-origin',
      name: '本地保险测试用户',
      amount: '500000',
      success: expect.stringContaining('投保信息已提交'),
      confirmedNotices: 5,
      noticeStatus: expect.stringContaining('已完成全部阅读确认'),
      scriptExecuted: false,
    });
    expect(nonLocalRequests).toEqual([]);
    await page.close();
  });
});
