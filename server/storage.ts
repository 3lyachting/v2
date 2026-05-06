// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function isForgeConfigured() {
  return Boolean(ENV.forgeApiUrl && ENV.forgeApiKey);
}

function getLocalStorageRoot() {
  return path.resolve(process.cwd(), ".local-storage");
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  if (!isForgeConfigured()) {
    const fullPath = path.join(getLocalStorageRoot(), key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const payload = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as any);
    await writeFile(fullPath, payload);
    return { key, url: `/manus-storage/${key}` };
  }
  const { forgeUrl, forgeKey } = getForgeConfig();

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

/**
 * Supprime l’objet stocké (fichier local ou, si Forge est configuré, tentative via l’API).
 * En cas d’échec côté Forge (endpoint inconnu ou indisponible), un avertissement est logué
 * sans faire échouer l’appel : la ligne en base peut quand même être supprimée ensuite.
 */
export async function storageDelete(relKey: string): Promise<void> {
  const key = normalizeKey(relKey);
  if (!isForgeConfigured()) {
    const fullPath = path.join(getLocalStorageRoot(), key);
    try {
      await unlink(fullPath);
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
    return;
  }
  const { forgeUrl, forgeKey } = getForgeConfig();
  try {
    const presignUrl = new URL("v1/storage/presign/delete", forgeUrl + "/");
    presignUrl.searchParams.set("path", key);
    const presignResp = await fetch(presignUrl, {
      headers: { Authorization: `Bearer ${forgeKey}` },
    });
    if (presignResp.ok) {
      const body = (await presignResp.json().catch(() => ({}))) as { url?: string };
      if (body.url) {
        const delResp = await fetch(body.url, { method: "DELETE" });
        if (delResp.ok) return;
      }
    }
  } catch {
    /* try fallback */
  }
  try {
    const delUrl = new URL("v1/storage/delete", forgeUrl + "/");
    delUrl.searchParams.set("path", key);
    const resp = await fetch(delUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${forgeKey}` },
    });
    if (resp.ok) return;
  } catch {
    /* ignore */
  }
  console.warn(`[storage] Remote delete not completed (object may remain on bucket): ${key}`);
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  if (!isForgeConfigured()) {
    return `/manus-storage/${normalizeKey(relKey)}`;
  }
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}
