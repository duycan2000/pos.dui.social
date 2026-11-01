// PIN and token hashing with WebCrypto (available in browsers and Workers).
// PIN hashes are cached on devices so login and manager approval work offline.
//
// Workers Free allows 10 ms CPU per request, so the PIN hash is deliberately light (2,000 PBKDF2
// rounds ≈ 0.5 ms). The protection against guessing comes from elsewhere: the server locks a PIN
// after 5 wrong tries (see worker/throttle.ts), and owner/manager PINs must be 6 digits.
// The hash records its round count ("2000$<hex>"), so the cost can be raised later without a reset.

const PBKDF2_ITERATIONS = 2000;
const LEGACY_ITERATIONS = 20000;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b.buffer);
}

async function derive(pin: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations },
    key,
    256,
  );
  return hex(bits);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  return `${PBKDF2_ITERATIONS}$${await derive(pin, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  const [iter, digest] = hash.includes('$') ? hash.split('$') : [String(LEGACY_ITERATIONS), hash];
  const n = parseInt(iter, 10);
  if (!n || !digest) return false;
  return (await derive(pin, salt, n)) === digest;
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Staff: 4–6 digits. Owner and manager: exactly 6 digits (they approve voids, cash-outs and devices). */
export function validPin(pin: string, role: 'owner' | 'manager' | 'staff' = 'staff'): boolean {
  return role === 'staff' ? /^\d{4,6}$/.test(pin) : /^\d{6}$/.test(pin);
}

export function pinRule(role: 'owner' | 'manager' | 'staff'): string {
  return role === 'staff' ? 'PIN 4–6 chữ số' : 'PIN chủ quán/quản lý phải đủ 6 chữ số';
}

/** Owner/manager password (used to register devices). Same hash format as PINs; length is the strength. */
export function validPassword(pw: string): boolean {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 128 && !/^\d+$/.test(pw);
}
export const passwordRule = 'Mật khẩu ít nhất 8 ký tự, không chỉ toàn số';

/** Login name: an email or a simple username, compared in lower case. */
export function normalizeLogin(login: string): string {
  return (login || '').trim().toLowerCase();
}
export function validLogin(login: string): boolean {
  return /^[a-z0-9._@+-]{3,64}$/.test(normalizeLogin(login));
}
