/**
 * Sunucu API istemcisi.
 *
 * Buradaki tipler `backend/src/modules/builds/build.dto.ts` ve
 * `backend/src/config/settings.schema.ts` ile ELLE senkron tutulur; ikisi
 * degistiginde bu dosya da guncellenmeli. Hicbir arac bu kaymayi yakalamaz.
 */

/* --- API adresi ----------------------------------------------------------- */

/**
 * API'nin kok adresi. TEK KAYNAK: derleme zamanindaki VITE_API_BASE_URL.
 *
 *   .env.production   ->  bos  =>  goreli yol ("/api/...")
 *                         Arayuz ve API ayni alan adi altinda, ters proxy
 *                         `/api/*` yolunu backend'e yonlendiriyor. CORS yok,
 *                         oturum cerezi SameSite=Lax kalabiliyor.
 *
 *   .env.development  ->  https://ipa-ios.simurgbilisim.com
 *                         Arayuz (5173) CANLI API'ye CORS ile konusur;
 *                         uretim CORS_ORIGINS'i 5173'u listeler ve CSRF
 *                         korumasi backend'in Origin dogrulama katmanindadir
 *                         (bilincli karar, 2026-08-10). Yerel backend ile
 *                         calismak icin .env.local:
 *                             VITE_API_BASE_URL=http://localhost:3000
 *
 * Calisma zamani yapilandirmasi (eski window.__IPA_OTA_CONFIG__ / config.js)
 * KALDIRILDI: uretimde adres zaten goreli, ayarlanacak bir sey yok.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** Goreli API yolunu tam adrese cevirir. */
function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export type BuildStatus = 'active' | 'expired' | 'revoked' | 'purged';

export interface BuildDto {
  id: string;
  token: string;
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: string;
  minOsVersion: string | null;
  platforms: string[];
  originalFilename: string;
  sizeBytes: number;
  sizeLabel: string;
  sha256: string;
  note: string | null;
  createdAt: number;
  expiresAt: number;
  ttlHours: number;
  status: BuildStatus;
  statusLabel: string;
  remainingLabel: string | null;
  hasPassword: boolean;
  viewCount: number;
  installCount: number;
  downloadCount: number;
  installUrl: string | null;
  qrUrl: string | null;
  iconUrl: string | null;
}

export interface AppConfig {
  /**
   * Yalnizca OKUNUR ve panelde HIC GOSTERILMEZ — `fields` listesinde yer
   * almaz. Kaynagi sunucudaki PUBLIC_BASE_URL ortam degiskenidir.
   */
  baseUrl: string;
  defaultTtlHours: number;
  maxTtlHours: number;
  maxUploadMb: number;
  purgeAfterExpiryHours: number;
  siteName: string;
  installNote: string;
  showQrCode: boolean;
  revokePreviousOnUpload: boolean;
  signedUrlTtlMinutes: number;
}

export interface FieldMeta {
  key: keyof AppConfig;
  label: string;
  help: string;
  kind: 'text' | 'number' | 'boolean' | 'textarea';
  unit?: string;
  min?: number;
  max?: number;
  group: 'link' | 'yukleme' | 'gorunum';
}

export interface SettingsResponse {
  values: AppConfig;
  fields: FieldMeta[];
  warnings: string[];
  /**
   * Istekte olmayan ama sunucunun yaptigi degisiklikler (orn. maxTtlHours
   * dusurulunce defaultTtlHours'un kirpilmasi). GET'te her zaman bostur.
   */
  notes: string[];
}

/** Bakim: neyin silinecegini onceden sayar. */
export interface CleanupPreview {
  purgeable: number;
  bytes: number;
}

/** Sure degistirilirken hangi anin uzerine eklenecegi. */
export type TtlBasis = 'upload' | 'now';

/** Yuklemede girilen link ayarlarinin duzenlenmesi. */
export interface BuildPatch {
  ttlHours?: number;
  ttlFrom?: TtlBasis;
  revoked?: boolean;
  note?: string | null;
  /** null = sifre korumasini kaldir. Gonderilmezse mevcut sifre korunur. */
  password?: string | null;
}

export interface SessionInfo {
  authenticated: boolean;
  configured: boolean;
  expiresAt: number | null;
}

export interface UploadResponse {
  build: BuildDto;
  revokedPrevious: number;
  warnings: string[];
}

export interface StatsResponse {
  total: number;
  active: number;
  totalBytes: number;
  activeBytes: number;
  warnings: string[];
}

export class ApiError extends Error {
  readonly status: number;
  /**
   * Hatanin ait oldugu ayar alani (yalnizca PUT /api/settings doner).
   * Panel bu bilgiyle mesaji dogru girdinin altinda gosterir.
   */
  readonly field?: string;

  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    // 'include': API ayri origin'de oldugunda oturum cerezinin gitmesi icin
    // sart. Ayni origin'de de sorunsuz calisir.
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const metin = await response.text();
  let govde: unknown = null;
  if (metin) {
    try {
      govde = JSON.parse(metin);
    } catch {
      govde = null;
    }
  }

  if (!response.ok) {
    const mesaj =
      govde && typeof govde === 'object' && 'error' in govde && typeof govde.error === 'string'
        ? govde.error
        : `Istek basarisiz (HTTP ${response.status})`;
    const alan =
      govde && typeof govde === 'object' && 'field' in govde && typeof govde.field === 'string'
        ? govde.field
        : undefined;
    throw new ApiError(mesaj, response.status, alan);
  }

  return govde as T;
}

/* --- Oturum --------------------------------------------------------------- */

export const api = {
  me: () => request<SessionInfo>('/api/auth/me'),

  login: (password: string) =>
    request<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /* --- Surumler ----------------------------------------------------------- */

  listBuilds: (options: { search?: string; onlyActive?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (options.search) q.set('search', options.search);
    if (options.onlyActive) q.set('onlyActive', 'true');
    q.set('limit', String(options.limit ?? 100));
    return request<{ items: BuildDto[]; total: number }>(`/api/builds?${q}`);
  },

  patchBuild: (id: string, patch: BuildPatch) =>
    request<BuildDto>(`/api/builds/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteBuild: (id: string) => request<{ ok: true }>(`/api/builds/${id}`, { method: 'DELETE' }),

  /* --- Ayarlar ------------------------------------------------------------ */

  getSettings: () => request<SettingsResponse>('/api/settings'),

  putSettings: (patch: Partial<AppConfig>) =>
    request<SettingsResponse>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  getStats: () => request<StatsResponse>('/api/stats'),

  previewCleanup: () => request<CleanupPreview>('/api/maintenance/cleanup'),

  runCleanup: () =>
    request<{ purged: number; freedBytes: number }>('/api/maintenance/cleanup', { method: 'POST' }),
};

/* --- Yukleme (ilerleme bildirimli) ---------------------------------------- */

export interface UploadOptions {
  file: File;
  ttlHours?: number;
  note?: string;
  password?: string;
  onProgress?: (yuzde: number, yuklenen: number, toplam: number) => void;
  signal?: AbortSignal;
}

/**
 * fetch() yukleme ilerlemesi bildirmedigi icin XMLHttpRequest kullaniliyor.
 * Buyuk IPA dosyalarinda ilerleme cubugu olmadan arayuz donmus gorunur.
 */
export function uploadIpa(options: UploadOptions): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Alanlar dosyadan ONCE eklenir: sunucu boylece kaydi tek gecisde kurabilir.
    if (options.ttlHours !== undefined) form.append('ttlHours', String(options.ttlHours));
    if (options.note) form.append('note', options.note);
    if (options.password) form.append('password', options.password);
    form.append('file', options.file, options.file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/uploads'));
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        options.onProgress?.(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      }
    });

    xhr.addEventListener('load', () => {
      let govde: unknown = null;
      try {
        govde = JSON.parse(xhr.responseText);
      } catch {
        govde = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(govde as UploadResponse);
        return;
      }
      const mesaj =
        govde && typeof govde === 'object' && 'error' in govde && typeof govde.error === 'string'
          ? govde.error
          : `Yukleme basarisiz (HTTP ${xhr.status})`;
      reject(new ApiError(mesaj, xhr.status));
    });

    xhr.addEventListener('error', () =>
      reject(new ApiError('Sunucuya baglanilamadi. Ag baglantinizi kontrol edin.', 0)),
    );
    xhr.addEventListener('abort', () => reject(new ApiError('Yukleme iptal edildi.', 0)));

    options.signal?.addEventListener('abort', () => xhr.abort());

    xhr.send(form);
  });
}

/* --- Bicimlendirme -------------------------------------------------------- */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const birimler = ['KB', 'MB', 'GB', 'TB'];
  let deger = bytes / 1024;
  let i = 0;
  while (deger >= 1024 && i < birimler.length - 1) {
    deger /= 1024;
    i++;
  }
  return `${deger.toFixed(deger >= 100 ? 0 : 1)} ${birimler[i]}`;
}

const TARIH = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(ms: number): string {
  return TARIH.format(new Date(ms));
}

/** 8760 -> "365 gun", 72 -> "3 gun", 6 -> "6 saat" */
export function formatHours(saat: number): string {
  if (!Number.isFinite(saat) || saat < 1) return '-';
  if (saat < 24) return `${saat} saat`;
  const gun = Math.floor(saat / 24);
  const kalan = saat % 24;
  return kalan ? `${gun} gun ${kalan} saat` : `${gun} gun`;
}
