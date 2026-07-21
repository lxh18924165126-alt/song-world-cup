export function normalizeBasePath(baseUrl: string): string {
  const normalized = baseUrl.trim();
  if (!normalized || normalized === "/") return "";
  if (!normalized.startsWith("/")) throw new Error("应用基路径必须以 / 开头");
  return normalized.replace(/\/+$/g, "");
}

export function joinBasePath(path: string, basePath: string): string {
  if (!path.startsWith("/")) throw new Error("应用内路径必须以 / 开头");
  if (!basePath) return path;
  return path === "/" ? `${basePath}/` : `${basePath}${path}`;
}

export function stripBasePath(pathname: string, basePath: string): string | null {
  if (!basePath) return pathname;
  if (pathname === basePath || pathname === `${basePath}/`) return "/";
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : null;
}

const APP_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);

export const routerBasename = APP_BASE_PATH || "/";

export function appPath(path: string): string {
  return joinBasePath(path, APP_BASE_PATH);
}

export function appRelativePath(pathname: string): string | null {
  return stripBasePath(pathname, APP_BASE_PATH);
}
