import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  AiEncryptionKeyRequiredError,
  AiSecretUnavailableError,
  type EncryptedAiSecret,
} from './ai-types.js';

const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const IV_BYTES = 12;

/** The deployment secret is a 32-byte AES key represented as 64 hex characters. */
function requireKey(raw: string | undefined): Buffer {
  if (raw === undefined || !KEY_PATTERN.test(raw)) {
    throw new AiEncryptionKeyRequiredError();
  }
  return Buffer.from(raw, 'hex');
}

export function hasAiEncryptionKey(raw: string | undefined): boolean {
  return raw !== undefined && KEY_PATTERN.test(raw);
}

export function encryptAiSecret(secret: string, rawKey: string | undefined): EncryptedAiSecret {
  if (secret.trim() === '') throw new AiSecretUnavailableError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', requireKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

export function decryptAiSecret(
  encrypted: EncryptedAiSecret,
  rawKey: string | undefined,
): string {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      requireKey(rawKey),
      Buffer.from(encrypted.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    if (!hasAiEncryptionKey(rawKey)) throw new AiEncryptionKeyRequiredError();
    throw new AiSecretUnavailableError();
  }
}
