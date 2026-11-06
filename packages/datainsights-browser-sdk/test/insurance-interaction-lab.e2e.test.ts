import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startInsuranceDemoServer } from '../scripts/insurance-demo.mjs';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('insurance interaction recording lab', () => {
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

  it('records and restores deterministic P1 and P2 interactions', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument(() => {
      (window as any).__GET_USER_MEDIA_CALLS__ = 0;
      if (navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices.getUserMedia = async () => {
          (window as any).__GET_USER_MEDIA_CALLS__ += 1;
          throw new Error('Media permissions are disabled in the local demo.');
        };
      }
    });
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
    await page.click('#consent-recording');
    await page.waitForFunction(
      () => (window as any).DataInsights.getDebugInfo().state === 'recording',
    );

    await page.waitForSelector('#interaction-lab');
    expect(
      await page.$$eval('[data-lab-component]', (nodes) => nodes.length),
    ).toBeGreaterThanOrEqual(10);

    await page.click('[data-lab-tab="claims"]');
    expect(
      await page.$eval('#lab-tab-status', (node) => node.textContent),
    ).toContain('理赔');

    await page.click('[data-lab-accordion="waiting-period"]');
    expect(
      await page.$eval('[data-lab-accordion="waiting-period"]', (node) =>
        node.getAttribute('aria-expanded'),
      ),
    ).toBe('true');

    await page.type('#lab-search', '上海');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(
      await page.$eval('#lab-selected-suggestion', (node) => node.textContent),
    ).toContain('上海');

    await page.click('#lab-slide-next');
    expect(
      await page.$eval('#lab-slide-status', (node) => node.textContent),
    ).toContain('2 / 6');

    await page.click('[data-toast-kind="warning"]');
    await page.waitForSelector('.lab-toast[data-kind="warning"]');
    expect(
      await page.$eval('#lab-toast-summary', (node) => node.textContent),
    ).toContain('1');

    await page.$eval('#lab-virtual-list', (element) => {
      element.scrollTop = 48 * 80;
      element.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-virtual-index="80"]'),
    );
    await page.click('[data-virtual-index="80"]');
    expect(
      await page.$eval('#lab-virtual-selection', (node) => node.textContent),
    ).toContain('081');

    const uploadRoot = await mkdtemp(
      path.join(tmpdir(), 'datainsights-interaction-lab-'),
    );
    const uploadPath = path.join(uploadRoot, 'recording-proof.pdf');
    const privateFileBody = 'PRIVATE_FILE_BODY_MUST_NOT_BE_RECORDED';
    await writeFile(uploadPath, privateFileBody);
    const upload = await page.$('#lab-file');
    await upload!.uploadFile(uploadPath);
    expect(
      await page.$eval('#lab-file-status', (node) => node.textContent),
    ).toContain('recording-proof.pdf');
    await rm(uploadRoot, { recursive: true, force: true });

    await page.waitForSelector('#lab-same-origin-frame');
    const sameOriginFrame = page
      .frames()
      .find((frame) => frame.url().includes('/insurance/iframe-lab.html'));
    expect(sameOriginFrame).toBeDefined();
    await sameOriginFrame!.click('#frame-counter');
    await sameOriginFrame!.type('#frame-input', 'iframe-local-input');
    expect(
      await sameOriginFrame!.$eval('#frame-status', (node) => node.textContent),
    ).toContain('1');

    expect(
      await page.$eval('#lab-cross-origin-frame', (frame) => {
        try {
          return Boolean((frame as HTMLIFrameElement).contentDocument);
        } catch (_error) {
          return false;
        }
      }),
    ).toBe(false);

    const pdfFrame = page
      .frames()
      .find((frame) => frame.url().includes('/insurance/pdf-reader.html'));
    expect(pdfFrame).toBeDefined();
    await pdfFrame!.click('#pdf-next');
    await pdfFrame!.click('[data-pdf-zoom="125"]');
    expect(
      await pdfFrame!.$eval('#pdf-status', (node) => node.textContent),
    ).toContain('第 2 / 3 页 · 125%');

    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.body.style.scrollBehavior = 'auto';
      document
        .querySelector('#lab-signature-canvas')
        ?.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
    const canvas = await page.$('#lab-signature-canvas');
    const canvasBox = await canvas!.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.move(canvasBox!.x + 20, canvasBox!.y + 30);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + 120, canvasBox!.y + 70, {
      steps: 5,
    });
    await page.mouse.up();
    await page.click('#lab-signature-complete');
    expect(
      await page.$eval('#lab-canvas-status', (node) => node.textContent),
    ).toContain('已完成 · 1 条轨迹');

    await page.click('#lab-webgl-start');
    await page.click('#lab-webgl-pause');
    expect(
      await page.$eval('#lab-webgl-status', (node) => node.textContent),
    ).toContain('已暂停');

    await page.click('#lab-media-simulate');
    expect(
      await page.$eval('#lab-media-status', (node) => node.textContent),
    ).toContain('模拟授权完成');
    expect(
      await page.evaluate(() => (window as any).__GET_USER_MEDIA_CALLS__),
    ).toBe(0);

    await page.click('#lab-checkpoint');
    const stopResult = await page.evaluate(() =>
      (window as any).DataInsights.stop('interaction-lab-completed'),
    );
    expect(stopResult).toMatchObject({ ok: true });

    type RecordedEvent = {
      type: number;
      data: { tag?: string; payload?: Record<string, unknown> };
    };
    const recordings = (await fetch(`${demo.origin}/recordings`).then((value) =>
      value.json(),
    )) as Array<{
      recordingId: string;
      batches: Array<{ events: RecordedEvent[] }>;
    }>;
    expect(recordings).toHaveLength(1);
    const serialized = JSON.stringify(recordings);
    expect(serialized).toContain('interaction-lab-checkpoint');
    expect(serialized).toContain('canvas-signature-completed');
    expect(serialized).toContain('recording-proof.pdf');
    expect(serialized).not.toContain(privateFileBody);
    expect(serialized).not.toContain(uploadRoot);
    const customEvents = recordings[0].batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.data.tag?.includes('interaction-lab'));
    expect(customEvents).toEqual([
      expect.objectContaining({
        data: {
          tag: 'interaction-lab-checkpoint',
          payload: {
            selectedTab: 'claims',
            expandedPanelCount: 1,
            activeSlide: 1,
            toastCount: 1,
            selectedVirtualItem: 80,
            canvasStrokeCount: 1,
            canvasCompleted: true,
            webglState: 'paused',
            mediaPermissionState: 'simulated-granted',
          },
        },
      }),
    ]);

    await page.click('#lab-refresh');
    await page.waitForFunction(
      () =>
        (window as any).__INTERACTION_LAB_READY__ === true &&
        document.querySelector('#lab-restore-status')?.textContent ===
          '已恢复上次实验状态',
    );
    const restored = await page.evaluate(() => ({
      tab: document.querySelector('#lab-tab-status')?.textContent,
      accordion: document
        .querySelector('[data-lab-accordion="waiting-period"]')
        ?.getAttribute('aria-expanded'),
      slide: document.querySelector('#lab-slide-status')?.textContent,
      selected: document.querySelector('#lab-virtual-selection')?.textContent,
      file: document.querySelector('#lab-file-status')?.textContent,
    }));
    expect(restored).toEqual({
      tab: '当前页签：理赔',
      accordion: 'true',
      slide: '2 / 6',
      selected: '已选择：模拟医院 081',
      file: '尚未选择文件',
    });

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
    await page.click('.rr-controller__btns button');
    await page.waitForFunction(
      () => (window as any).__REPLAY_FINISHED__ === true,
      { timeout: 20_000 },
    );
    const replayState = await page.evaluate(() => {
      const replayDocument = (
        document.querySelector('#replay-root iframe') as HTMLIFrameElement
      ).contentDocument!;
      return {
        tab: replayDocument.querySelector('#lab-tab-status')?.textContent,
        accordion: replayDocument
          .querySelector('[data-lab-accordion="waiting-period"]')
          ?.getAttribute('aria-expanded'),
        slide: replayDocument.querySelector('#lab-slide-status')?.textContent,
        selected: replayDocument.querySelector('#lab-virtual-selection')
          ?.textContent,
        canvas: replayDocument.querySelector('#lab-canvas-status')?.textContent,
        webgl: replayDocument.querySelector('#lab-webgl-status')?.textContent,
        media: replayDocument.querySelector('#lab-media-status')?.textContent,
      };
    });
    expect(replayState).toMatchObject({
      tab: '当前页签：理赔',
      accordion: 'true',
      slide: '2 / 6',
      selected: '已选择：模拟医院 081',
      canvas: '已完成 · 1 条轨迹',
      webgl: expect.stringContaining('已暂停'),
      media: '模拟授权完成（未调用真实媒体 API）',
    });

    expect(nonLocalRequests).toEqual([]);
  });
});
