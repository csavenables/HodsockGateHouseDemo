#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  combine,
  getInputFormat,
  getOutputFormat,
  MemoryFileSystem,
  MemoryReadFileSystem,
  processDataTable,
  readFile,
  writeFile,
} from '@playcanvas/splat-transform';

const DEFAULT_INPUT_CANDIDATES = [
  'public/scenes/hodsock-gatehouse/splats/HodsockCombined30k.splat',
  'public/scenes/hodsock-gatehouse/splats/HodsockCombined30k.ply',
  'public/scenes/hodsock-gatehouse/splats/HodsockCombined30k.ksplat',
  'public/scenes/hodsock-gatehouse/splats/HodsockCombined30k.spz',
  'public/scenes/hodsock-gatehouse/splats/HodsockCombined30k.sog',
];
const DEFAULT_OUTPUT_ROOT = 'public/scenes/hodsock-gatehouse/splats/sog';

const PRESETS = {
  safe: {
    harmonics: 2,
    opacityThreshold: 0.03,
  },
  balanced: {
    harmonics: 1,
    opacityThreshold: 0.06,
  },
  aggressive: {
    harmonics: 0,
    opacityThreshold: 0.1,
  },
};

function parseArg(name, fallback = null) {
  for (let index = process.argv.length - 2; index >= 0; index -= 1) {
    if (process.argv[index] === `--${name}`) {
      return process.argv[index + 1];
    }
  }
  return fallback;
}

function parseMode(value) {
  if (value === 'bundled' || value === 'lod' || value === 'all') {
    return value;
  }
  throw new Error(`Unsupported mode \"${value}\". Use all, bundled, or lod.`);
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

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveInputPath(inputArg) {
  if (inputArg) {
    return path.resolve(process.cwd(), inputArg);
  }
  for (const candidate of DEFAULT_INPUT_CANDIDATES) {
    const absoluteCandidate = path.resolve(process.cwd(), candidate);
    if (await exists(absoluteCandidate)) {
      return absoluteCandidate;
    }
  }
  throw new Error(
    'No default source asset found. Supply --input <path-to-splat/ply/ksplat/spz/sog> to run SOG conversion.',
  );
}

async function getDirectorySize(directoryPath) {
  if (!(await exists(directoryPath))) {
    return 0;
  }
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(fullPath);
      continue;
    }
    if (entry.isFile()) {
      total += (await fs.stat(fullPath)).size;
    }
  }
  return total;
}

function buildProcessActions(preset) {
  return [
    { kind: 'filterNaN' },
    { kind: 'filterBands', value: preset.harmonics },
    {
      kind: 'filterByValue',
      columnName: 'opacity',
      comparator: 'gt',
      value: preset.opacityThreshold,
    },
  ];
}

function buildTransformOptions(iterationsArg, lodChunkCountArg, lodChunkExtentArg) {
  const iterations = Math.max(1, Number.parseInt(iterationsArg, 10) || 10);
  const lodChunkCount = Math.max(1, Number.parseInt(lodChunkCountArg, 10) || 512);
  const lodChunkExtent = Math.max(1, Number.parseInt(lodChunkExtentArg, 10) || 16);

  return {
    iterations,
    lodSelect: [],
    unbundled: false,
    lodChunkCount,
    lodChunkExtent,
  };
}

async function loadProcessedDataTable(inputPath, options, preset) {
  const inputData = await fs.readFile(inputPath);
  const inputFormat = getInputFormat(inputPath);
  const readFs = new MemoryReadFileSystem();
  readFs.set(inputPath, inputData);

  const dataTables = await readFile({
    filename: inputPath,
    inputFormat,
    options,
    params: [],
    fileSystem: readFs,
  });

  if (!Array.isArray(dataTables) || dataTables.length === 0) {
    throw new Error('No Gaussian splat tables were read from input asset.');
  }

  const actions = buildProcessActions(preset);
  const processed = dataTables
    .map((table) => processDataTable(table, actions))
    .filter((table) => table !== null && table.numRows > 0);

  if (processed.length === 0) {
    throw new Error('All Gaussians were filtered out by the selected preset.');
  }

  return processed.length === 1 ? processed[0] : combine(processed);
}

async function writeMemoryFilesToDisk(memoryFs, targetRoot, keepOnly = null) {
  await fs.mkdir(targetRoot, { recursive: true });
  let bytesWritten = 0;

  for (const [name, data] of memoryFs.results.entries()) {
    if (keepOnly && !keepOnly(name)) {
      continue;
    }
    const outputPath = path.join(targetRoot, name);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(data));
    bytesWritten += data.byteLength;
  }

  return bytesWritten;
}

async function run() {
  const presetName = parseArg('preset', 'balanced');
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset \"${presetName}\". Use safe, balanced, or aggressive.`);
  }

  const mode = parseMode(parseArg('mode', 'all'));
  const inputPath = await resolveInputPath(parseArg('input', null));
  const outputRootArg = parseArg('output-root', DEFAULT_OUTPUT_ROOT);
  const outputRoot = path.resolve(process.cwd(), outputRootArg, presetName);
  const bundledOutputPath = path.join(outputRoot, 'scene.sog');
  const lodOutputRoot = path.join(outputRoot, 'lod');
  const lodMetaOutputPath = path.join(lodOutputRoot, 'lod-meta.json');

  const options = buildTransformOptions(
    parseArg('iterations', '10'),
    parseArg('lod-chunk-count', '512'),
    parseArg('lod-chunk-extent', '16'),
  );

  const started = performance.now();
  const dataTable = await loadProcessedDataTable(inputPath, options, preset);

  if (mode === 'all' || mode === 'bundled') {
    const memoryFs = new MemoryFileSystem();
    const bundledName = 'scene.sog';
    await writeFile(
      {
        filename: bundledName,
        outputFormat: getOutputFormat(bundledName, options),
        dataTable,
        options,
      },
      memoryFs,
    );
    await writeMemoryFilesToDisk(memoryFs, outputRoot, (name) => name === bundledName);
  }

  if (mode === 'all' || mode === 'lod') {
    const memoryFs = new MemoryFileSystem();
    const lodName = 'lod-meta.json';
    await writeFile(
      {
        filename: lodName,
        outputFormat: getOutputFormat(lodName, options),
        dataTable,
        options,
      },
      memoryFs,
    );
    await writeMemoryFilesToDisk(memoryFs, lodOutputRoot);
  }

  const elapsedMs = performance.now() - started;
  const inputSize = (await fs.stat(inputPath)).size;
  const bundledSize = (mode === 'all' || mode === 'bundled') && (await exists(bundledOutputPath))
    ? (await fs.stat(bundledOutputPath)).size
    : 0;
  const lodSize = mode === 'all' || mode === 'lod' ? await getDirectorySize(lodOutputRoot) : 0;

  console.info(
    `[convert:sog] preset=${presetName} mode=${mode} input=${formatBytes(inputSize)} elapsed_ms=${elapsedMs.toFixed(1)}`,
  );
  if (bundledSize > 0) {
    console.info(
      `[convert:sog] bundled=${path.relative(process.cwd(), bundledOutputPath)} size=${formatBytes(
        bundledSize,
      )} reduction=${reductionPercent(inputSize, bundledSize).toFixed(1)}%`,
    );
  }
  if (lodSize > 0) {
    console.info(
      `[convert:sog] lod=${path.relative(process.cwd(), lodMetaOutputPath)} bundle_size=${formatBytes(
        lodSize,
      )} reduction=${reductionPercent(inputSize, lodSize).toFixed(1)}%`,
    );
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[convert:sog] failed: ${message}`);
  process.exitCode = 1;
});
