#!/usr/bin/env node
import process from 'node:process';
import { runStartupBench } from './lib/startup-bench.mjs';

function parseArg(name, fallback = null) {
  for (let index = process.argv.length - 2; index >= 0; index -= 1) {
    if (process.argv[index] === `--${name}`) {
      return process.argv[index + 1];
    }
  }
  return fallback;
}

async function run() {
  const results = await runStartupBench({
    samples: parseArg('samples', '5'),
    host: parseArg('host', '127.0.0.1'),
    port: parseArg('port', '4173'),
    url: parseArg('url', null) ?? undefined,
  });

  console.info(`[bench] samples=${results.samples}`);
  if (results.assetFetchMedianMs !== null) {
    console.info(`[bench] asset_fetch_ms median=${results.assetFetchMedianMs.toFixed(1)}`);
  }
  if (results.decodeInitMedianMs !== null) {
    console.info(`[bench] decode_init_ms median=${results.decodeInitMedianMs.toFixed(1)}`);
  }
  console.info(`[bench] first_frame_ms median=${results.firstFrameMedianMs.toFixed(1)}`);
  if (results.introCompleteMedianMs !== null) {
    console.info(`[bench] intro_complete_ms median=${results.introCompleteMedianMs.toFixed(1)}`);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bench] failed: ${message}`);
  process.exitCode = 1;
});
