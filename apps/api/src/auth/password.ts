import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// `promisify` resolves to scrypt's three-argument overload, which has no
// options parameter. The signature is restated here so the cost parameters and
// `maxmem` can be passed.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with Node's built-in scrypt.
 *
 * scrypt is memory-hard and is on the OWASP recommended list, so there is no
 * reason to add a native dependency for it. `argon2` would be a defensible
 * choice too; it is not used here because it compiles native code, which is one
 * more thing to go wrong in a container build for no security benefit at this
 * scale.
 *
 * Parameters are encoded into the stored string, so raising the cost later does
 * not invalidate existing hashes — `verifyPassword` reads the parameters the
 * hash was created with, and the caller can rehash on next successful login.
 */
const N = 2 ** 15; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// scrypt needs 128 * N * r bytes, which for N=2^15, r=8 is ~33 MB — above Node's
// 32 MB default cap. Raised explicitly rather than lowering N, since N is the
// parameter that actually costs an attacker.
const MAX_MEM = 96 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  }));
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltRaw ?? '', 'base64');
  const expected = Buffer.from(hashRaw ?? '', 'base64');
  if (expected.length === 0) return false;

  const derived = (await scryptAsync(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: MAX_MEM,
  }));

  // Constant-time: a length-dependent early return would leak how much of the
  // hash matched.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
