import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build as esbuild } from 'esbuild';
import sveltePreprocess from 'svelte-preprocess';
import { build as viteBuild, defaultClientConditions } from 'vite';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const exampleRoot = path.resolve(packageRoot, 'examples/insurance-product');
const TEST_APP_KEY = 'di_t_cn1_LOCALDEMO1';

const contentType = (pathname) => {
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg'))
    return 'image/jpeg';
  if (pathname.endsWith('.png')) return 'image/png';
  return 'text/html; charset=utf-8';
};

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('The local demo server did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

async function prepareAssets() {
  await viteBuild({ configFile: path.resolve(packageRoot, 'vite.config.ts') });
  const replayEntry = path.resolve(
    repositoryRoot,
    'packages/rrweb/src/replay/index.ts',
  );
  const typesEntry = path.resolve(
    repositoryRoot,
    'packages/types/src/index.ts',
  );
  const result = await esbuild({
    stdin: {
      contents: `export { Replayer } from ${JSON.stringify(
        replayEntry,
      )}; export { ReplayerEvents } from ${JSON.stringify(typesEntry)};`,
      loader: 'ts',
      resolveDir: repositoryRoot,
    },
    bundle: true,
    format: 'iife',
    globalName: 'rrweb',
    loader: { '.css': 'empty' },
    platform: 'browser',
    target: 'es2017',
    write: false,
  });

  const playerBuild = await viteBuild({
    configFile: false,
    root: repositoryRoot,
    resolve: {
      conditions: [...defaultClientConditions],
      alias: [
        {
          find: '@rrweb/replay/dist/style.css',
          replacement: path.resolve(
            repositoryRoot,
            'packages/rrweb/src/replay/styles/style.css',
          ),
        },
        {
          find: '@rrweb/replay',
          replacement: path.resolve(
            repositoryRoot,
            'packages/rrweb/src/replay/index.ts',
          ),
        },
        {
          find: '@rrweb/packer/unpack',
          replacement: path.resolve(
            repositoryRoot,
            'packages/packer/src/unpack.ts',
          ),
        },
      ],
    },
    plugins: [svelte({ preprocess: [sveltePreprocess({ typescript: true })] })],
    build: {
      cssCodeSplit: false,
      target: 'es2017',
      write: false,
      lib: {
        entry: path.resolve(
          repositoryRoot,
          'packages/rrweb-player/src/main.ts',
        ),
        formats: ['iife'],
        name: 'rrwebPlayer',
        fileName: () => 'rrweb-player.js',
      },
    },
  });
  const playerOutput = Array.isArray(playerBuild)
    ? playerBuild.flatMap((output) => output.output)
    : playerBuild.output;
  const playerScript = playerOutput.find(
    (output) => output.type === 'chunk' && output.isEntry,
  );
  const playerStyle = playerOutput.find(
    (output) => output.type === 'asset' && output.fileName.endsWith('.css'),
  );
  if (!playerScript || !playerStyle) {
    throw new Error('The local rrweb-player build did not emit JS and CSS.');
  }

  return {
    rrwebBundle: Buffer.from(result.outputFiles[0].contents),
    playerScript: Buffer.from(playerScript.code),
    playerStyle: Buffer.from(playerStyle.source),
  };
}

async function readAssets({ rrwebBundle, playerScript, playerStyle }) {
  const localImageRoot = path.resolve(exampleRoot, 'assets/zhongan');
  const localImageNames = await readdir(localImageRoot);
  const entries = await Promise.all(
    [
      ['/gp/99440765', path.resolve(exampleRoot, 'index.html')],
      ['/insurance/styles.css', path.resolve(exampleRoot, 'styles.css')],
      ['/insurance/app.js', path.resolve(exampleRoot, 'app.js')],
      [
        '/insurance/interaction-lab.css',
        path.resolve(exampleRoot, 'interaction-lab.css'),
      ],
      [
        '/insurance/interaction-lab.js',
        path.resolve(exampleRoot, 'interaction-lab.js'),
      ],
      [
        '/insurance/iframe-lab.html',
        path.resolve(exampleRoot, 'iframe-lab.html'),
      ],
      [
        '/insurance/pdf-reader.html',
        path.resolve(exampleRoot, 'pdf-reader.html'),
      ],
      ['/insurance/replay.html', path.resolve(exampleRoot, 'replay.html')],
      [
        '/sdk/datainsights-browser-sdk.js',
        path.resolve(packageRoot, 'umd/datainsights-browser-sdk.js'),
      ],
      [
        '/sdk/serialization.worker.js',
        path.resolve(packageRoot, 'dist/serialization.worker.js'),
      ],
      ...localImageNames.map((filename) => [
        `/insurance/assets/zhongan/${filename}`,
        path.resolve(localImageRoot, filename),
      ]),
    ].map(async ([route, filename]) => [route, await readFile(filename)]),
  );
  return new Map([
    ...entries,
    ['/rrweb.js', rrwebBundle],
    ['/player/rrweb-player.js', playerScript],
    ['/player/style.css', playerStyle],
  ]);
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw new Error('Request body is too large.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

export async function startInsuranceDemoServer(options = {}) {
  const replayAssets =
    options.buildAssets === false
      ? {
          rrwebBundle: await readFile(
            path.resolve(repositoryRoot, 'packages/rrweb/umd/rrweb.js'),
          ),
          playerScript: await readFile(
            path.resolve(
              repositoryRoot,
              'packages/rrweb-player/umd/rrweb-player.js',
            ),
          ),
          playerStyle: await readFile(
            path.resolve(
              repositoryRoot,
              'packages/rrweb-player/dist/style.css',
            ),
          ),
        }
      : await prepareAssets();
  const assets = await readAssets(replayAssets);
  const recordings = new Map();
  let origin = '';

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');

      if (pathname === '/favicon.ico') {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (pathname === '/') {
        response.statusCode = 302;
        response.setHeader('Location', '/gp/99440765');
        response.end();
        return;
      }
      if (pathname === '/sdk/config' && request.method === 'GET') {
        if (url.searchParams.get('appKey') !== TEST_APP_KEY) {
          sendJson(response, 404, { error: 'unknown_application' });
          return;
        }
        sendJson(response, 200, {
          appKey: TEST_APP_KEY,
          enabled: true,
          configVersion: 'local-insurance-v1',
          collectorUrls: [origin],
          uploadToken: 'local-short-lived-demo-token',
          expiresAt: '2099-01-01T00:00:00.000Z',
        });
        return;
      }
      if (pathname === '/api/events' && request.method === 'POST') {
        const batch = await readJsonBody(request);
        const existing = recordings.get(batch.recordingId) ?? [];
        if (
          !existing.some((candidate) => candidate.batchId === batch.batchId)
        ) {
          existing.push(batch);
          existing.sort(
            (left, right) => left.sequenceStart - right.sequenceStart,
          );
          recordings.set(batch.recordingId, existing);
        }
        sendJson(response, 200, {
          status: 'accepted',
          receipt: {
            persisted: true,
            batchId: batch.batchId,
            recordingId: batch.recordingId,
            sequenceStart: batch.sequenceStart,
            sequenceEnd: batch.sequenceEnd,
            contentHash: batch.contentHash,
          },
        });
        return;
      }
      const deliveryMatch = pathname.match(
        /^\/api\/recordings\/([^/]+)\/delivery-state$/,
      );
      if (deliveryMatch && request.method === 'GET') {
        const recordingId = decodeURIComponent(deliveryMatch[1]);
        const batches = recordings.get(recordingId) ?? [];
        sendJson(response, 200, {
          recordingId,
          contiguousSequenceEnd: Math.max(
            0,
            ...batches.map((batch) => batch.sequenceEnd),
          ),
          missingRanges: [],
          checkedAt: new Date().toISOString(),
        });
        return;
      }
      if (pathname === '/recordings' && request.method === 'GET') {
        sendJson(
          response,
          200,
          [...recordings.entries()].map(([recordingId, batches]) => ({
            recordingId,
            batches,
          })),
        );
        return;
      }
      if (/^\/replay\/[^/]+$/.test(pathname) && request.method === 'GET') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(assets.get('/insurance/replay.html'));
        return;
      }
      const asset = assets.get(pathname);
      if (asset && request.method === 'GET') {
        response.setHeader('Content-Type', contentType(pathname));
        response.setHeader('Cache-Control', 'no-store');
        response.end(asset);
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    } catch (_error) {
      sendJson(response, 400, { error: 'invalid_local_demo_request' });
    }
  });

  const port = await listen(server, options.port ?? 0);
  origin = `http://127.0.0.1:${port}`;
  return Object.freeze({
    origin,
    recordings,
    close: () => closeServer(server),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const demo = await startInsuranceDemoServer({
    port: Number(process.env.DATAINSIGHTS_DEMO_PORT ?? 4173),
  });
  process.stdout.write(
    `DataInsights insurance demo: ${demo.origin}/gp/99440765\nRecordings: ${demo.origin}/recordings\n`,
  );
  const shutdown = async () => {
    await demo.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
