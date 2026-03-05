function normalizeRelativePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

export function resolveRuntimeUrl(path: string): string {
  const relativePath = normalizeRelativePath(path);
  return new URL(relativePath, getRuntimeBaseUrl()).toString();
}

function getRuntimeBaseUrl(): string {
  const configuredBase = import.meta.env.BASE_URL;
  if (configuredBase && configuredBase !== './' && configuredBase !== '.') {
    return new URL(configuredBase, window.location.origin).toString();
  }

  const moduleDirUrl = new URL('.', import.meta.url);
  const pathname = moduleDirUrl.pathname;

  if (pathname.includes('/src/')) {
    return new URL('/', moduleDirUrl).toString();
  }

  if (pathname.includes('/assets/')) {
    return new URL('../', moduleDirUrl).toString();
  }

  return moduleDirUrl.toString();
}
