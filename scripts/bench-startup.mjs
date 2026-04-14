#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

function parseArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function waitForPreviewReady(serverProcess, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const text = String(chunk);
      if (text.includes('Local:') || text.includes('ready in')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Preview server exited early with code ${code ?? 0}.`));
    };
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        cleanup();
        reject(new Error('Timed out waiting for preview server.'));
      }
    }, 200);
    const cleanup = () => {
      clearInterval(timer);
      serverProcess.stdout?.off('data', onData);
      serverProcess.stderr?.off('data', onData);
      serverProcess.off('exit', onExit);
    };
    serverProcess.stdout?.on('data', onData);
    serverProcess.stderr?.on('data', onData);
    serverProcess.on('exit', onExit);
  });
}

async function run() {
  const samples = Math.max(1, Number.parseInt(parseArg('samples', '5'), 10));
  const host = parseArg('host', '127.0.0.1');
  const port = parseArg('port', '4173');
  const pageUrl = parseArg(
    'url',
    `http://${host}:${port}/?scene=hodsock-gatehouse&embed=1&controls=0&replayButton=0`,
  );

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'Playwright is required for bench:startup. Install it with `npm i -D playwright` and run `npx playwright install chromium`.',
    );
  }

  const serverProcess =
    process.platform === 'win32'
      ? spawn(
          'cmd.exe',
          ['/d', '/s', '/c', `npm run preview -- --host ${host} --port ${port} --strictPort`],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
      : spawn('npm', ['run', 'preview', '--', '--host', host, '--port', port, '--strictPort'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
  try {
    await waitForPreviewReady(serverProcess);
    const firstFrame = [];
    const fetchMs = [];
    const decodeMs = [];
    const introComplete = [];

    for (let i = 0; i < samples; i += 1) {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();
      await page.route('**/*', async (route) => {
        const headers = {
          ...route.request().headers(),
          'cache-control': 'no-cache, no-store, max-age=0',
          pragma: 'no-cache',
        };
        await route.continue({ headers });
      });

      let gotFirstFrame = false;
      let gotIntroComplete = false;
      page.on('console', (msg) => {
        const text = msg.text();
        if (!text.startsWith('[perf]')) {
          return;
        }
        if (text.includes('asset_fetch_ms=')) {
          const ff = Number.parseFloat(text.match(/first_frame_ms=([0-9.]+)/)?.[1] ?? 'NaN');
          const af = Number.parseFloat(text.match(/asset_fetch_ms=([0-9.]+)/)?.[1] ?? 'NaN');
          const di = Number.parseFloat(text.match(/decode_init_ms=([0-9.]+)/)?.[1] ?? 'NaN');
          if (Number.isFinite(ff)) {
            firstFrame.push(ff);
            gotFirstFrame = true;
          }
          if (Number.isFinite(af)) {
            fetchMs.push(af);
          }
          if (Number.isFinite(di)) {
            decodeMs.push(di);
          }
        }
        if (text.includes('intro_complete_ms=')) {
          const ic = Number.parseFloat(text.match(/intro_complete_ms=([0-9.]+)/)?.[1] ?? 'NaN');
          if (Number.isFinite(ic)) {
            introComplete.push(ic);
            gotIntroComplete = true;
          }
        }
      });

      await page.goto(`${pageUrl}&benchRun=${i}&cacheBust=${Date.now()}`, { waitUntil: 'domcontentloaded' });
      const waitStart = Date.now();
      while (Date.now() - waitStart < 60000) {
        if (gotFirstFrame && gotIntroComplete) {
          break;
        }
        await sleep(150);
      }

      await context.close();
      await browser.close();
      await sleep(250);
    }

    if (firstFrame.length === 0) {
      throw new Error('No [perf] startup logs were captured. Verify app logs are enabled.');
    }

    console.info(`[bench] samples=${samples}`);
    if (fetchMs.length > 0) {
      console.info(`[bench] asset_fetch_ms median=${median(fetchMs).toFixed(1)}`);
    }
    if (decodeMs.length > 0) {
      console.info(`[bench] decode_init_ms median=${median(decodeMs).toFixed(1)}`);
    }
    console.info(`[bench] first_frame_ms median=${median(firstFrame).toFixed(1)}`);
    if (introComplete.length > 0) {
      console.info(`[bench] intro_complete_ms median=${median(introComplete).toFixed(1)}`);
    }
  } finally {
    serverProcess.kill('SIGTERM');
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bench] failed: ${message}`);
  process.exitCode = 1;
});
