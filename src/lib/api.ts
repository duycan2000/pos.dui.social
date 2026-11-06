// HTTP client for the Worker. Device token on every call; staff session for back-office calls.
let deviceToken = '';
let staffSession = '';

export function setDeviceToken(t: string) { deviceToken = t; }
export function setStaffSession(t: string) { staffSession = t; }
export function getStaffSession() { return staffSession; }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { session?: string; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (deviceToken) headers.authorization = 'Bearer ' + deviceToken;
  const s = opts.session ?? staffSession;
  if (s) headers['x-staff-session'] = s;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
  } catch {
    throw new ApiError(0, 'Không có kết nối mạng');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Lỗi ${res.status}`);
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/** Download a file from a back-office endpoint (needs our auth headers, so no plain link). */
export async function downloadFile(path: string, filename: string) {
  const headers: Record<string, string> = {};
  if (deviceToken) headers.authorization = 'Bearer ' + deviceToken;
  if (staffSession) headers['x-staff-session'] = staffSession;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, d.error || `Lỗi ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Upload a photo to R2. Resized on the phone first so menus and receipts stay small. */
export async function uploadPhoto(file: File): Promise<string> {
  const blob = await shrink(file, 1280, 0.82);
  const res = await fetch('/api/media', { method: 'POST', headers: { authorization: 'Bearer ' + deviceToken, 'content-type': blob.type }, body: blob });
  const data = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error || 'Tải ảnh thất bại');
  return data.key as string;
}

async function shrink(file: File, max: number, quality: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob((b) => r(b || file), 'image/jpeg', quality));
  } catch {
    return file;
  }
}

export function mediaUrl(key: string | null | undefined) {
  return key ? `/media/${key}` : '';
}
