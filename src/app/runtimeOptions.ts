export interface RuntimeOptions {
  sceneId: string;
  embed: boolean;
  autorotateOverride: boolean | null;
  mobileProfileOverride: boolean | null;
  controlsVisible: boolean;
  replayButtonVisible: boolean;
  annotate: boolean;
  parentOrigin: string | null;
}

function parseBooleanFlag(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }
  if (value === '1' || value.toLowerCase() === 'true') {
    return true;
  }
  if (value === '0' || value.toLowerCase() === 'false') {
    return false;
  }
  return null;
}

function parseOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return null;
  }
}

export function readRuntimeOptions(search: string, defaultSceneId = 'hodsock-gatehouse'): RuntimeOptions {
  const params = new URLSearchParams(search);
  const sceneId = params.get('scene') ?? defaultSceneId;
  const embedDefault = sceneId === defaultSceneId;
  const embed = parseBooleanFlag(params.get('embed')) ?? embedDefault;
  const controlsVisible = parseBooleanFlag(params.get('controls')) ?? !embed;
  const replayButtonVisible = parseBooleanFlag(params.get('replayButton')) ?? false;
  return {
    sceneId,
    embed,
    autorotateOverride: parseBooleanFlag(params.get('autorotate')),
    mobileProfileOverride: parseBooleanFlag(params.get('mobileProfile')),
    controlsVisible,
    replayButtonVisible,
    annotate: parseBooleanFlag(params.get('annotate')) ?? false,
    parentOrigin: parseOrigin(params.get('parentOrigin')),
  };
}
