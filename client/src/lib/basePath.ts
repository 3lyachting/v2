const rawBasePath = (import.meta.env.VITE_APP_BASE_PATH as string | undefined) ?? "";

const normalizedBasePath =
  rawBasePath.trim() && rawBasePath !== "/"
    ? `/${rawBasePath.trim().replace(/^\/+|\/+$/g, "")}`
    : "";

export const APP_BASE_PATH = normalizedBasePath;

export function withBasePath(path: string): string {
  if (!APP_BASE_PATH) {
    return path;
  }
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${APP_BASE_PATH}${safePath}`;
}
