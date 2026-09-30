const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!password || password.length < 8) throw new Error('كلمة مرور النسخة الاحتياطية يجب أن تكون 8 أحرف على الأقل')
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBackup(snapshot: unknown, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const plaintext = encoder.encode(JSON.stringify(snapshot))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return {
    format: 'nexflow-backup-encrypted',
    version: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 310000,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    createdAt: new Date().toISOString(),
  }
}

export async function decryptBackup(payload, password: string) {
  if (payload?.format !== 'nexflow-backup-encrypted') throw new Error('صيغة النسخة المشفرة غير صالحة')
  const salt = fromBase64(String(payload.salt || ''))
  const iv = fromBase64(String(payload.iv || ''))
  const ciphertext = fromBase64(String(payload.ciphertext || ''))
  if (salt.length < 16 || iv.length !== 12 || ciphertext.length < 17) throw new Error('ملف النسخة المشفرة تالف')
  const key = await deriveKey(password, salt)
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource)
    return JSON.parse(decoder.decode(plaintext))
  } catch {
    throw new Error('كلمة مرور النسخة الاحتياطية غير صحيحة أو الملف تالف')
  }
}
