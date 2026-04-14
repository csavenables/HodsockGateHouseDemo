function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function runStartupBench(options = {}) {
  const samples = Math.max(1, Number.parseInt(String(options.samples ?? 5), 10));
  const host = options.host ?? '127.0.0.1';
  const port = String(options.port ?? '4173');
  const pageUrl =
    options.url ??
    `http://${host}:${port}/?scene=hodsock-gatehouse&embed=1&controls=0&replayButton=0`;

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'Playwright is required for bench:startup. Install it with `npm i -D playwright` and run `npx playwright install chromium`.',
    );
  }

  const { preview } = await import('vite');
  const previewServer = await preview({
    preview: {
      host,
      port: Number.parseInt(port, 10),
      strictPort: true,
    },
    logLevel: 'silent',
  });

  try {
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

    return {
      samples,
      assetFetchMedianMs: fetchMs.length > 0 ? median(fetchMs) : null,
      decodeInitMedianMs: decodeMs.length > 0 ? median(decodeMs) : null,
      firstFrameMedianMs: median(firstFrame),
      introCompleteMedianMs: introComplete.length > 0 ? median(introComplete) : null,
    };
  } finally {
    await previewServer.close();
    await new Promise((resolve) => {
      previewServer.httpServer.close(() => resolve(undefined));
    });
  }
}
