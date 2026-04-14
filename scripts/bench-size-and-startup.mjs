#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { runStartupBench } from './lib/startup-bench.mjs';

const DEFAULT_SPLAT_DIR = 'public/scenes/hodsock-gatehouse/splats';

function parseArg(name, fallback = null) {
  for (let index = process.argv.length - 2; index >= 0; index -= 1) {
    if (process.argv[index] === `--${name}`) {
      return process.argv[index + 1];
    }
  }
  return fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function reductionPercent(inputSize, outputSize) {
  if (inputSize <= 0 || outputSize <= 0) {
    return 0;
  }
  return (1 - outputSize / inputSize) * 100;
}

async function fileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

async function directorySize(directoryPath) {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        total += await directorySize(fullPath);
      } else if (entry.isFile()) {
        total += (await fs.stat(fullPath)).size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function run() {
  const samples = Number.parseInt(parseArg('samples', '5'), 10);
  const splatDir = path.resolve(process.cwd(), parseArg('splat-dir', DEFAULT_SPLAT_DIR));

  const sourceSplat = await fileSize(path.join(splatDir, 'HodsockCombined30k.splat'));
  const runtimeKsplat = await fileSize(path.join(splatDir, 'HodsockCombined30k.ksplat'));
  const balancedSog = await fileSize(path.join(splatDir, 'sog', 'balanced', 'scene.sog'));
  const balancedLodBundle = await directorySize(path.join(splatDir, 'sog', 'balanced', 'lod'));

  const baseline = sourceSplat > 0 ? sourceSplat : Math.max(runtimeKsplat, balancedSog, balancedLodBundle);

  console.info('[size] hodsock asset snapshot');
  if (sourceSplat > 0) {
    console.info(`[size] source_splat=${formatBytes(sourceSplat)}`);
  }
  if (runtimeKsplat > 0) {
    console.info(
      `[size] runtime_ksplat=${formatBytes(runtimeKsplat)} reduction_vs_source=${reductionPercent(
        baseline,
        runtimeKsplat,
      ).toFixed(1)}%`,
    );
  }
  if (balancedSog > 0) {
    console.info(
      `[size] sog_balanced=${formatBytes(balancedSog)} reduction_vs_source=${reductionPercent(
        baseline,
        balancedSog,
      ).toFixed(1)}%`,
    );
  }
  if (balancedLodBundle > 0) {
    console.info(
      `[size] sog_balanced_lod_bundle=${formatBytes(
        balancedLodBundle,
      )} reduction_vs_source=${reductionPercent(baseline, balancedLodBundle).toFixed(1)}%`,
    );
  }

  const bench = await runStartupBench({
    samples: Number.isFinite(samples) && samples > 0 ? samples : 5,
    host: parseArg('host', '127.0.0.1'),
    port: parseArg('port', '4173'),
    url: parseArg('url', null) ?? undefined,
  });
  console.info(`[bench] samples=${bench.samples}`);
  if (bench.assetFetchMedianMs !== null) {
    console.info(`[bench] asset_fetch_ms median=${bench.assetFetchMedianMs.toFixed(1)}`);
  }
  if (bench.decodeInitMedianMs !== null) {
    console.info(`[bench] decode_init_ms median=${bench.decodeInitMedianMs.toFixed(1)}`);
  }
  console.info(`[bench] first_frame_ms median=${bench.firstFrameMedianMs.toFixed(1)}`);
  if (bench.introCompleteMedianMs !== null) {
    console.info(`[bench] intro_complete_ms median=${bench.introCompleteMedianMs.toFixed(1)}`);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bench:size-and-startup] failed: ${message}`);
  process.exitCode = 1;
});
