import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { getAppSetting, setAppSetting } from './database';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require('../app.json') as {
  expo?: { version?: string; android?: { versionCode?: number } };
};

export const GITHUB_REPO = 'appsonary/sonary_app';
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATER_DOWNLOAD_EVENT = 'SonaryUpdaterDownloadChanged';
const UPDATER_LAST_CHECK_KEY = 'updater_last_check_at';
const UPDATER_SKIPPED_VERSION_KEY = 'updater_skipped_version';
const MIN_VALID_APK_BYTES = 1024 * 1024; // 1 MB

export interface InstalledAppVersion {
  versionName: string;
  versionCode: number;
}

export interface RemoteReleaseInfo {
  versionName: string;
  versionCode: number | null;
  apkName: string;
  apkUrl: string;
  sha256: string | null;
  sizeBytes: number | null;
  releaseNotes: string;
  releaseUrl: string;
}

export type UpdateDownloadStatus = 'idle' | 'downloading' | 'ready' | 'error';

export interface UpdateDownloadState {
  status: UpdateDownloadStatus;
  versionName: string | null;
  versionCode: number | null;
  apkName: string | null;
  apkUrl: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  localUri: string | null;
  progress: number;
  error: string | null;
  sha256Verified: boolean;
  updatedAt: number;
}

export const IDLE_UPDATE_DOWNLOAD_STATE: UpdateDownloadState = {
  status: 'idle',
  versionName: null,
  versionCode: null,
  apkName: null,
  apkUrl: null,
  sha256: null,
  sizeBytes: null,
  releaseNotes: null,
  releaseUrl: null,
  localUri: null,
  progress: 0,
  error: null,
  sha256Verified: false,
  updatedAt: 0,
};

export type UpdateCheckResult =
  | { status: 'throttled'; installed: InstalledAppVersion }
  | { status: 'up_to_date'; installed: InstalledAppVersion; release?: RemoteReleaseInfo }
  | { status: 'update_available'; installed: InstalledAppVersion; release: RemoteReleaseInfo }
  | { status: 'error'; installed: InstalledAppVersion; error: string };

interface NativeUpdaterSpec {
  getInstalledVersion?: () => Promise<{ versionName?: string; versionCode?: number }>;
  canRequestPackageInstalls?: () => Promise<boolean>;
  openInstallPermissionSettings?: () => Promise<void>;
  verifySha256?: (fileUri: string, expectedSha256: string) => Promise<boolean>;
  installApk?: (fileUri: string) => Promise<void>;
  startBackgroundDownload?: (params: {
    apkUrl: string;
    apkName: string;
    versionName: string;
    versionCode: number | null;
    sha256: string | null;
    sizeBytes: number | null;
    releaseNotes: string;
    releaseUrl: string;
  }) => Promise<void>;
  cancelBackgroundDownload?: () => Promise<void>;
  getDownloadState?: () => Promise<Record<string, unknown> | null>;
  clearDownloadState?: () => Promise<void>;
}

function getNativeUpdater(): NativeUpdaterSpec | null {
  if (Platform.OS !== 'android') return null;
  const mod = (NativeModules as Record<string, unknown> | undefined)?.SonaryAppUpdater;
  if (mod && typeof mod === 'object') {
    return mod as NativeUpdaterSpec;
  }
  return null;
}

function getUpdatesDirectory(): string {
  const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  return `${base}updates/`;
}

export function normalizeVersionName(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .trim();
}

export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersionName(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersionName(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isNewerRelease(
  installed: InstalledAppVersion,
  remote: Pick<RemoteReleaseInfo, 'versionName' | 'versionCode'>
): boolean {
  if (
    typeof remote.versionCode === 'number' &&
    Number.isInteger(remote.versionCode) &&
    remote.versionCode > 0 &&
    installed.versionCode > 0
  ) {
    if (remote.versionCode !== installed.versionCode) {
      return remote.versionCode > installed.versionCode;
    }
  }
  return compareSemver(remote.versionName, installed.versionName) > 0;
}

export function isTrustedGitHubUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host === 'githubusercontent.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

export async function getInstalledAppVersion(): Promise<InstalledAppVersion> {
  const fallback: InstalledAppVersion = {
    versionName: appJson?.expo?.version || '1.0.0',
    versionCode: appJson?.expo?.android?.versionCode || 1,
  };
  const nativeMod = getNativeUpdater();
  if (!nativeMod?.getInstalledVersion) {
    return fallback;
  }
  try {
    const info = await nativeMod.getInstalledVersion();
    return {
      versionName: info?.versionName || fallback.versionName,
      versionCode:
        typeof info?.versionCode === 'number' && info.versionCode > 0
          ? info.versionCode
          : fallback.versionCode,
    };
  } catch {
    return fallback;
  }
}

async function fetchJsonWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number = 8000,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (timer && typeof (timer as any).unref === 'function') {
    (timer as any).unref();
  }
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SonaryProUpdater/1.0',
        ...(headers || {}),
      },
    });
    if (!response.ok) {
      return { ok: false, status: response.status, data: null };
    }
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function parseLatestManifest(raw: unknown, repo: string): RemoteReleaseInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const versionName = normalizeVersionName(String(obj.versionName || ''));
  const apkUrl = typeof obj.apkUrl === 'string' ? obj.apkUrl.trim() : '';
  if (!versionName || !isTrustedGitHubUrl(apkUrl)) return null;

  const rawCode = Number(obj.versionCode);
  const versionCode = Number.isInteger(rawCode) && rawCode > 0 ? rawCode : null;
  const rawSize = Number(obj.sizeBytes);
  const sizeBytes = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null;
  const sha256 =
    typeof obj.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(obj.sha256.trim())
      ? obj.sha256.trim().toLowerCase()
      : null;

  return {
    versionName,
    versionCode,
    apkName: typeof obj.apkName === 'string' && obj.apkName ? obj.apkName : `sonary-pro-v${versionName}.apk`,
    apkUrl,
    sha256,
    sizeBytes,
    releaseNotes: typeof obj.releaseNotes === 'string' ? obj.releaseNotes.trim() : '',
    releaseUrl:
      typeof obj.releaseUrl === 'string' && isTrustedGitHubUrl(obj.releaseUrl)
        ? obj.releaseUrl
        : `https://github.com/${repo}/releases/latest`,
  };
}

function parseGitHubApiRelease(raw: unknown, repo: string): RemoteReleaseInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.draft === true) return null;

  const versionName = normalizeVersionName(String(obj.tag_name || obj.name || ''));
  const assets = Array.isArray(obj.assets) ? obj.assets : [];
  const apkAssets = assets.filter(
    (a): a is Record<string, unknown> =>
      Boolean(a && typeof a === 'object' && typeof (a as any).name === 'string' && (a as any).name.toLowerCase().endsWith('.apk'))
  );
  if (!versionName || apkAssets.length === 0) return null;

  const preferredAsset =
    apkAssets.find((a) => String(a.name).toLowerCase().includes('release')) ||
    apkAssets.find((a) => !String(a.name).toLowerCase().includes('debug')) ||
    apkAssets[0];

  const apkUrl = typeof preferredAsset.browser_download_url === 'string' ? preferredAsset.browser_download_url.trim() : '';
  if (!isTrustedGitHubUrl(apkUrl)) return null;

  const rawSize = Number(preferredAsset.size);
  return {
    versionName,
    versionCode: null,
    apkName: String(preferredAsset.name),
    apkUrl,
    sha256: null,
    sizeBytes: Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null,
    releaseNotes: typeof obj.body === 'string' ? obj.body.trim() : '',
    releaseUrl:
      typeof obj.html_url === 'string' && isTrustedGitHubUrl(obj.html_url)
        ? obj.html_url
        : `https://github.com/${repo}/releases/latest`,
  };
}

export interface CheckForUpdateOptions {
  force?: boolean;
  repo?: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}

export async function checkForAppUpdate(
  options: CheckForUpdateOptions = {}
): Promise<UpdateCheckResult> {
  const repo = options.repo || GITHUB_REPO;
  const fetchImpl = options.fetchImpl || fetch;
  const nowMs = options.nowMs ?? Date.now();
  const installed = await getInstalledAppVersion();

  if (!options.force) {
    try {
      const lastCheckRaw = await getAppSetting(UPDATER_LAST_CHECK_KEY);
      const lastCheck = lastCheckRaw ? Number(lastCheckRaw) : 0;
      if (Number.isFinite(lastCheck) && lastCheck > 0 && nowMs - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
        return { status: 'throttled', installed };
      }
    } catch {
      // prossegue com a checagem se o banco falhar
    }
  }

  try {
    let release: RemoteReleaseInfo | null = null;

    const manifestUrl = `https://github.com/${repo}/releases/latest/download/latest.json`;
    const manifestRes = await fetchJsonWithTimeout(manifestUrl, fetchImpl).catch(() => null);
    if (manifestRes?.ok) {
      release = parseLatestManifest(manifestRes.data, repo);
    }

    if (!release) {
      const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const apiRes = await fetchJsonWithTimeout(apiUrl, fetchImpl, 8000, {
        Accept: 'application/vnd.github+json',
      });
      if (!apiRes.ok) {
        return {
          status: 'error',
          installed,
          error: `GitHub retornou HTTP ${apiRes.status}.`,
        };
      }
      release = parseGitHubApiRelease(apiRes.data, repo);
    }

    await setAppSetting(UPDATER_LAST_CHECK_KEY, String(nowMs)).catch(() => {});

    if (!release) {
      return { status: 'up_to_date', installed };
    }

    if (!isNewerRelease(installed, release)) {
      return { status: 'up_to_date', installed, release };
    }

    if (!options.force) {
      const skipped = await getAppSetting(UPDATER_SKIPPED_VERSION_KEY).catch(() => null);
      if (skipped && normalizeVersionName(skipped) === normalizeVersionName(release.versionName)) {
        return { status: 'up_to_date', installed, release };
      }
    }

    return { status: 'update_available', installed, release };
  } catch (err) {
    return {
      status: 'error',
      installed,
      error: err instanceof Error ? err.message : 'Falha ao verificar atualizações.',
    };
  }
}

export async function skipAppUpdateVersion(versionName: string): Promise<void> {
  const normalized = normalizeVersionName(versionName);
  if (!normalized) return;
  await setAppSetting(UPDATER_SKIPPED_VERSION_KEY, normalized);
}

function normalizeDownloadState(raw: unknown): UpdateDownloadState {
  if (!raw || typeof raw !== 'object') {
    return { ...IDLE_UPDATE_DOWNLOAD_STATE };
  }
  const obj = raw as Record<string, unknown>;
  const rawStatus = obj.status;
  const status: UpdateDownloadStatus =
    rawStatus === 'downloading' || rawStatus === 'ready' || rawStatus === 'error'
      ? rawStatus
      : 'idle';
  const rawCode = Number(obj.versionCode);
  const rawSize = Number(obj.sizeBytes);
  const rawProgress = Number(obj.progress);
  const rawUpdatedAt = Number(obj.updatedAt);

  return {
    status,
    versionName: typeof obj.versionName === 'string' && obj.versionName ? obj.versionName : null,
    versionCode: Number.isInteger(rawCode) && rawCode > 0 ? rawCode : null,
    apkName: typeof obj.apkName === 'string' && obj.apkName ? obj.apkName : null,
    apkUrl: typeof obj.apkUrl === 'string' && obj.apkUrl ? obj.apkUrl : null,
    sha256: typeof obj.sha256 === 'string' && obj.sha256 ? obj.sha256 : null,
    sizeBytes: Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null,
    releaseNotes: typeof obj.releaseNotes === 'string' ? obj.releaseNotes : null,
    releaseUrl: typeof obj.releaseUrl === 'string' && obj.releaseUrl ? obj.releaseUrl : null,
    localUri: typeof obj.localUri === 'string' && obj.localUri ? obj.localUri : null,
    progress: Number.isFinite(rawProgress) ? Math.min(1, Math.max(0, rawProgress)) : 0,
    error: typeof obj.error === 'string' && obj.error ? obj.error : null,
    sha256Verified: Boolean(obj.sha256Verified),
    updatedAt: Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0 ? rawUpdatedAt : 0,
  };
}

export function releaseFromDownloadState(
  state: UpdateDownloadState | null | undefined,
  repo: string = GITHUB_REPO
): RemoteReleaseInfo | null {
  if (!state || !state.versionName || !state.apkUrl || !isTrustedGitHubUrl(state.apkUrl)) {
    return null;
  }
  return {
    versionName: state.versionName,
    versionCode: state.versionCode,
    apkName: state.apkName || `sonary-pro-v${state.versionName}.apk`,
    apkUrl: state.apkUrl,
    sha256: state.sha256,
    sizeBytes: state.sizeBytes,
    releaseNotes: state.releaseNotes || '',
    releaseUrl:
      state.releaseUrl && isTrustedGitHubUrl(state.releaseUrl)
        ? state.releaseUrl
        : `https://github.com/${repo}/releases/latest`,
  };
}

export function supportsBackgroundUpdateDownload(): boolean {
  const nativeMod = getNativeUpdater();
  return Boolean(nativeMod && typeof nativeMod.startBackgroundDownload === 'function');
}

export async function getUpdateDownloadState(): Promise<UpdateDownloadState> {
  const nativeMod = getNativeUpdater();
  if (!nativeMod?.getDownloadState) {
    return { ...IDLE_UPDATE_DOWNLOAD_STATE };
  }
  try {
    const raw = await nativeMod.getDownloadState();
    return normalizeDownloadState(raw);
  } catch {
    return { ...IDLE_UPDATE_DOWNLOAD_STATE };
  }
}

export function subscribeUpdateDownload(
  listener: (state: UpdateDownloadState) => void
): () => void {
  const nativeMod = getNativeUpdater();
  if (!nativeMod || typeof NativeEventEmitter !== 'function') {
    return () => {};
  }
  try {
    const emitter = new NativeEventEmitter(nativeMod as any);
    const sub = emitter.addListener(UPDATER_DOWNLOAD_EVENT, (payload: unknown) => {
      listener(normalizeDownloadState(payload));
    });
    return () => {
      sub?.remove?.();
    };
  } catch {
    return () => {};
  }
}

export async function startBackgroundUpdateDownload(release: RemoteReleaseInfo): Promise<void> {
  if (!isTrustedGitHubUrl(release.apkUrl)) {
    throw new Error('URL de download do APK não pertence ao GitHub oficial.');
  }
  const nativeMod = getNativeUpdater();
  if (!nativeMod?.startBackgroundDownload) {
    throw new Error('Download em segundo plano disponível apenas no build Android instalado.');
  }
  await nativeMod.startBackgroundDownload({
    apkUrl: release.apkUrl,
    apkName: release.apkName,
    versionName: release.versionName,
    versionCode: release.versionCode,
    sha256: release.sha256,
    sizeBytes: release.sizeBytes,
    releaseNotes: release.releaseNotes,
    releaseUrl: release.releaseUrl,
  });
}

export async function cancelBackgroundUpdateDownload(): Promise<void> {
  const nativeMod = getNativeUpdater();
  if (nativeMod?.cancelBackgroundDownload) {
    await nativeMod.cancelBackgroundDownload();
  }
}

export async function clearUpdateDownloadState(): Promise<void> {
  const nativeMod = getNativeUpdater();
  if (nativeMod?.clearDownloadState) {
    await nativeMod.clearDownloadState();
  }
}

export async function cleanupCachedUpdateApks(
  options: { preserveActive?: boolean } = {}
): Promise<void> {
  const preserveActive = options.preserveActive !== false;
  let preservedFileName: string | null = null;

  if (preserveActive) {
    const activeState = await getUpdateDownloadState();
    if (activeState.status === 'downloading') {
      return;
    }
    if (activeState.status === 'ready' && activeState.versionName && activeState.localUri) {
      const installed = await getInstalledAppVersion();
      if (
        isNewerRelease(installed, {
          versionName: activeState.versionName,
          versionCode: activeState.versionCode,
        })
      ) {
        const parts = activeState.localUri.split('/');
        preservedFileName = parts[parts.length - 1] || null;
      } else {
        await clearUpdateDownloadState().catch(() => {});
      }
    }
  }

  const updatesDir = getUpdatesDirectory();
  if (!updatesDir) return;
  try {
    const dirInfo = await FileSystem.getInfoAsync(updatesDir);
    if (!dirInfo.exists) return;
    const files = await FileSystem.readDirectoryAsync(updatesDir);
    for (const file of files) {
      if (preservedFileName && file === preservedFileName) {
        continue;
      }
      if (file.endsWith('.apk') || file.endsWith('.part')) {
        await FileSystem.deleteAsync(`${updatesDir}${file}`, { idempotent: true });
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

export async function canRequestPackageInstalls(): Promise<boolean> {
  const nativeMod = getNativeUpdater();
  if (!nativeMod?.canRequestPackageInstalls) return true;
  return nativeMod.canRequestPackageInstalls();
}

export async function openInstallPermissionSettings(): Promise<void> {
  const nativeMod = getNativeUpdater();
  if (nativeMod?.openInstallPermissionSettings) {
    await nativeMod.openInstallPermissionSettings();
  }
}

export interface DownloadUpdateResult {
  localUri: string;
  sha256Verified: boolean;
}

export async function downloadUpdateApk(
  release: RemoteReleaseInfo,
  onProgress?: (ratio: number) => void,
  options?: {
    onResumableCreated?: (resumable: FileSystem.DownloadResumable) => void;
    shouldAbort?: () => boolean;
  }
): Promise<DownloadUpdateResult> {
  if (!isTrustedGitHubUrl(release.apkUrl)) {
    throw new Error('URL de download do APK não pertence ao GitHub oficial.');
  }

  const updatesDir = getUpdatesDirectory();
  const dirInfo = await FileSystem.getInfoAsync(updatesDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(updatesDir, { intermediates: true });
  }

  await cleanupCachedUpdateApks({ preserveActive: false });

  const safeName = release.apkName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'sonary-update.apk';
  const partUri = `${updatesDir}${safeName}.part`;
  const finalUri = `${updatesDir}${safeName}`;

  const resumable = FileSystem.createDownloadResumable(
    release.apkUrl,
    partUri,
    {},
    (progressData) => {
      if (progressData.totalBytesExpectedToWrite > 0 && onProgress) {
        const ratio = Math.min(
          1,
          Math.max(0, progressData.totalBytesWritten / progressData.totalBytesExpectedToWrite)
        );
        onProgress(ratio);
      }
    }
  );
  options?.onResumableCreated?.(resumable);

  let downloadResult: FileSystem.FileSystemDownloadResult | undefined;
  try {
    downloadResult = await resumable.downloadAsync();
  } catch (err) {
    await FileSystem.deleteAsync(partUri, { idempotent: true });
    throw err;
  }

  if (options?.shouldAbort?.()) {
    await FileSystem.deleteAsync(partUri, { idempotent: true });
    throw new Error('Download da atualização cancelado.');
  }

  if (!downloadResult || downloadResult.status < 200 || downloadResult.status >= 300) {
    await FileSystem.deleteAsync(partUri, { idempotent: true });
    throw new Error(`Falha ao baixar APK (HTTP ${downloadResult?.status ?? 'erro'}).`);
  }

  const info = await FileSystem.getInfoAsync(partUri);
  if (!info.exists || info.size < MIN_VALID_APK_BYTES) {
    await FileSystem.deleteAsync(partUri, { idempotent: true });
    throw new Error('Arquivo APK baixado parece inválido ou corrompido.');
  }

  await FileSystem.deleteAsync(finalUri, { idempotent: true });
  await FileSystem.moveAsync({ from: partUri, to: finalUri });

  let sha256Verified = false;
  if (release.sha256) {
    const nativeMod = getNativeUpdater();
    if (nativeMod?.verifySha256) {
      const ok = await nativeMod.verifySha256(finalUri, release.sha256);
      if (!ok) {
        await FileSystem.deleteAsync(finalUri, { idempotent: true });
        throw new Error('Falha na verificação de integridade SHA-256 do APK.');
      }
      sha256Verified = true;
    }
  }

  return { localUri: finalUri, sha256Verified };
}

export async function installUpdateApk(
  localUri: string
): Promise<'installed' | 'permission_required'> {
  const nativeMod = getNativeUpdater();
  if (!nativeMod?.installApk) {
    throw new Error('Instalador nativo disponível apenas no build Android instalado.');
  }
  const allowed = await canRequestPackageInstalls();
  if (!allowed) {
    return 'permission_required';
  }
  await nativeMod.installApk(localUri);
  return 'installed';
}
