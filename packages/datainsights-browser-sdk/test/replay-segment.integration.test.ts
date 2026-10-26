import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const packageRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const fixtureRoot = path.resolve(__dirname, 'fixtures');

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Replay test server did not expose a port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

describe('sandboxed segment replay', () => {
  let browser: puppeteer.Browser;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    await build({
      root: path.resolve(repositoryRoot, 'packages/rrweb'),
      configFile: path.resolve(repositoryRoot, 'packages/rrweb/vite.config.js'),
    });
    const assets = new Map<string, Buffer>([
      [
        '/sandbox-replay.html',
        await readFile(path.resolve(__dirname, 'html/sandbox-replay.html')),
      ],
      [
        '/rrweb.js',
        await readFile(
          path.resolve(repositoryRoot, 'packages/rrweb/umd/rrweb.js'),
        ),
      ],
      [
        '/replay-segments.json',
        await readFile(path.resolve(fixtureRoot, 'replay-segments.json')),
      ],
      [
        '/untrusted-replay.json',
        await readFile(path.resolve(fixtureRoot, 'untrusted-replay.json')),
      ],
    ]);
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const asset = assets.get(pathname);
      if (!asset) {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      response.setHeader(
        'Content-Type',
        pathname.endsWith('.json')
          ? 'application/json'
          : pathname.endsWith('.js')
          ? 'text/javascript'
          : 'text/html',
      );
      response.end(asset);
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
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps Session across segments and starts refresh Recording with a full snapshot', async () => {
    const fixture = JSON.parse(
      await readFile(path.resolve(fixtureRoot, 'replay-segments.json'), 'utf8'),
    );
    expect(fixture.recordings).toHaveLength(2);
    expect(fixture.recordings[0].segments).toHaveLength(2);
    expect(fixture.recordings[0].segments[1]).toMatchObject({
      segmentId: 'segment-2',
      hasFullSnapshot: true,
    });
    expect(fixture.recordings[1]).toMatchObject({
      recordingId: 'recording-refresh-2',
      refreshOf: 'recording-page-1',
      segments: [{ sequenceStart: 1, hasFullSnapshot: true }],
    });
    expect(fixture.sessionId).toBe('session-insurance-1');
  });

  it.each([
    [0, '投保步骤一', false],
    [1, '投保步骤二', true],
  ] as const)(
    'replays segment %s in an exact sandbox and reports gaps',
    async (segment, expectedText, hasGap) => {
      const page = await browser.newPage();
      await page.goto(
        `${origin}/sandbox-replay.html?fixture=replay-segments&segment=${segment}`,
        { waitUntil: 'networkidle0' },
      );
      await page.waitForFunction(
        () => (window as any).__REPLAY_READY__ === true,
      );
      const result = await page.evaluate(() => {
        const iframe = document.querySelector('iframe')!;
        return {
          sandbox: iframe.getAttribute('sandbox'),
          text: iframe.contentDocument?.body.textContent,
          gap: document.querySelector('#gap-warning')?.textContent ?? '',
        };
      });
      expect(result.sandbox).toBe('allow-same-origin');
      expect(result.text).toContain(expectedText);
      expect(Boolean(result.gap)).toBe(hasGap);
      await page.close();
    },
  );

  it('never executes scripts from untrusted replay data', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/sandbox-replay.html?fixture=untrusted-replay`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(() => (window as any).__REPLAY_READY__ === true);
    const result = await page.evaluate(() => {
      const iframe = document.querySelector('iframe')!;
      return {
        sandbox: iframe.getAttribute('sandbox'),
        executed: (window as any).__REPLAY_SCRIPT_EXECUTED__ === true,
        text: iframe.contentDocument?.body.textContent,
      };
    });
    expect(result).toEqual({
      sandbox: 'allow-same-origin',
      executed: false,
      text: expect.stringContaining('不可信回放内容'),
    });
    await page.close();
  });
});
