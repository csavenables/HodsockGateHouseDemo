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

function printResult(label, result) {
  console.info(`[bench:${label}] samples=${result.samples}`);
  if (result.assetFetchMedianMs !== null) {
    console.info(`[bench:${label}] asset_fetch_ms median=${result.assetFetchMedianMs.toFixed(1)}`);
  }
  if (result.decodeInitMedianMs !== null) {
    console.info(`[bench:${label}] decode_init_ms median=${result.decodeInitMedianMs.toFixed(1)}`);
  }
  console.info(`[bench:${label}] first_frame_ms median=${result.firstFrameMedianMs.toFixed(1)}`);
  if (result.introCompleteMedianMs !== null) {
    console.info(`[bench:${label}] intro_complete_ms median=${result.introCompleteMedianMs.toFixed(1)}`);
  }
  if (result.steadyStateFrameMsMedian !== null) {
    console.info(
      `[bench:${label}] steady_state_frame_ms median=${result.steadyStateFrameMsMedian.toFixed(2)} (~${(
        1000 / result.steadyStateFrameMsMedian
      ).toFixed(1)} fps)`,
    );
  }
}

async function run() {
  const samples = parseArg('samples', '5');
  const host = parseArg('host', '127.0.0.1');
  const port = parseArg('port', '4173');
  const baseUrl = parseArg('url', null) ?? undefined;

  const desktop = await runStartupBench({
    samples,
    host,
    port,
    url: baseUrl,
    mobileProfile: false,
  });
  printResult('desktop', desktop);

  const mobile = await runStartupBench({
    samples,
    host,
    port,
    url: baseUrl,
    mobileProfile: true,
  });
  printResult('mobile', mobile);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bench:startup:matrix] failed: ${message}`);
  process.exitCode = 1;
});
