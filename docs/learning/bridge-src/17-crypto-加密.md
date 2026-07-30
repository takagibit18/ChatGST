# 加密 — RSA 密钥对管理

> 源文件：`bridge/src/crypto.ts`

```typescript
import { generateKeyPairSync, publicEncrypt, privateDecrypt, createHmac, randomBytes, scryptSync, timingSafeEqual, constants } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const KEY_DIR = process.env.GS_PLATFORM_KEYS_DIR || join(homedir(), '.gs_platform', 'keys')
const PRIVATE_KEY_PATH = join(KEY_DIR, 'private.pem')
const PUBLIC_KEY_PATH = join(KEY_DIR, 'public.pem')
const JWT_SECRET_PATH = join(homedir(), '.gs_platform', 'jwt-secret')

let privateKey: string
let publicKey: string
let jwtSecret: string

/** Ensure RSA key pair exists on disk (generate if missing) */
function ensureKeyPair(): void {
  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf-8')
    publicKey = readFileSync(PUBLIC_KEY_PATH, 'utf-8')
    return
  }
  mkdirSync(KEY_DIR, { recursive: true })
  const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  writeFileSync(PRIVATE_KEY_PATH, priv, { mode: 0o600 })
  writeFileSync(PUBLIC_KEY_PATH, pub, { mode: 0o600 })
  privateKey = priv
  publicKey = pub
}

/** Ensure JWT secret exists on disk (generate if missing) */
function ensureJwtSecret(): void {
  if (existsSync(JWT_SECRET_PATH)) {
    jwtSecret = readFileSync(JWT_SECRET_PATH, 'utf-8').trim()
    return
  }
  const dir = join(JWT_SECRET_PATH, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  jwtSecret = randomBytes(32).toString('hex')
  writeFileSync(JWT_SECRET_PATH, jwtSecret, { mode: 0o600 })
}

/** Initialize crypto module (call once at startup) */
export function initCrypto(): void {
  ensureKeyPair()
  ensureJwtSecret()
}

/** Get RSA public key PEM (for client to encrypt passwords) */
export function getPublicKeyPem(): string {
  return publicKey
}

/** Decrypt a base64-encoded RSA-encrypted string with private key.
 *  Uses RSA-OAEP (SHA-256) to match Web Crypto API on the frontend. */
export function decrypt(encryptedBase64: string): string {
  const buffer = Buffer.from(encryptedBase64, 'base64')
  const decrypted = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    buffer,
  )
  return decrypted.toString('utf-8')
}

/** JWT payload interface */
export interface JwtPayload {
  username: string
  role: string
  permissions: string[]
  iat: number
  exp: number
}

/** Sign a JWT (HMAC-SHA256, 8h expiry) */
export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + 8 * 60 * 60 // 8 hours
  const fullPayload: JwtPayload = { ...payload, iat, exp }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

/** Verify a JWT and return payload; returns null if invalid or expired */
export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, signature] = parts
    const expectedSig = createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url')
    if (signature !== expectedSig) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

const PWD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const PWD_LOWER = 'abcdefghijkmnpqrstuvwxyz'
const PWD_DIGITS = '23456789'
const PWD_SPECIALS = '!@#$%^&*?-_'
const PWD_ALL = PWD_UPPER + PWD_LOWER + PWD_DIGITS + PWD_SPECIALS

export { PWD_UPPER, PWD_LOWER, PWD_DIGITS, PWD_SPECIALS, PWD_ALL }

const SCRYPT_KEYLEN = 32
const SCRYPT_COST = 16384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const HASH_PREFIX = '$scrypt$'

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION })
  return `${HASH_PREFIX}${salt.toString('base64')}$${derived.toString('base64')}`
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash.startsWith(HASH_PREFIX)) {
    return password === storedHash
  }
  const parts = storedHash.split('$')
  const saltB64 = parts[2]
  const hashB64 = parts[3]
  if (!saltB64 || !hashB64) return false
  try {
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION })
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function isPasswordHashed(stored: string): boolean {
  return stored.startsWith(HASH_PREFIX)
}

export function validatePasswordStrength(password: string): void {
  if (password.length < 8) throw new Error('密码至少 8 个字符')
  if (!/[A-Z]/.test(password)) throw new Error('密码需包含大写字母')
  if (!/[a-z]/.test(password)) throw new Error('密码需包含小写字母')
  if (!/[0-9]/.test(password)) throw new Error('密码需包含数字')
  if (!/[!@#$%^&*?\-_]/.test(password)) throw new Error('密码需包含特殊字符（!@#$%^&*?-_）')
}

/** Generate a strong random password (guaranteed: upper+lower+digit+special, 12 chars). */
export function generateRandomPassword(length = 12): string {
  const len = Math.max(length, 8)
  const bytes = randomBytes(len)

  // Guarantee at least one char from each class
  const guaranteed = [
    PWD_UPPER[bytes[0] % PWD_UPPER.length],
    PWD_LOWER[bytes[1] % PWD_LOWER.length],
    PWD_DIGITS[bytes[2] % PWD_DIGITS.length],
    PWD_SPECIALS[bytes[3] % PWD_SPECIALS.length],
  ]

  // Fill the rest from the full pool
  const rest: string[] = []
  for (let i = 4; i < len; i++) {
    rest.push(PWD_ALL[bytes[i] % PWD_ALL.length])
  }

  // Shuffle to avoid predictable positions
  const combined = [...guaranteed, ...rest]
  const shuffleBytes = randomBytes(combined.length)
  for (let i = combined.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1)
    ;[combined[i], combined[j]] = [combined[j], combined[i]]
  }

  return combined.join('')
}

```
