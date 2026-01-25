/**
 * Encryption utilities for secure credential storage
 *
 * Uses AES-256-GCM for authenticated encryption.
 * The encryption key is derived from a master password using PBKDF2.
 */

import * as crypto from 'crypto';

// Encryption constants
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

export interface EncryptedData {
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded encrypted data */
  data: string;
  /** Base64-encoded authentication tag */
  authTag: string;
  /** Base64-encoded salt used for key derivation */
  salt: string;
}

/**
 * Derive an encryption key from a password using PBKDF2
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt plaintext using AES-256-GCM
 *
 * @param plaintext - The string to encrypt
 * @param password - The password to derive the encryption key from
 * @returns Encrypted data with IV, auth tag, and salt
 */
export function encrypt(plaintext: string, password: string): EncryptedData {
  // Generate random IV and salt
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);

  // Derive key from password
  const key = deriveKey(password, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    data: encrypted,
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM
 *
 * @param encryptedData - The encrypted data object
 * @param password - The password to derive the decryption key from
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong password or tampered data)
 */
export function decrypt(encryptedData: EncryptedData, password: string): string {
  // Decode from base64
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const salt = Buffer.from(encryptedData.salt, 'base64');
  const authTag = Buffer.from(encryptedData.authTag, 'base64');

  // Derive key from password
  const key = deriveKey(password, salt);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt
  let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a cryptographically secure random string
 */
export function generateSecureRandom(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash a value using SHA-256 (for non-reversible storage like audit logs)
 */
export function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Securely compare two strings in constant time to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Mask a secret for safe logging (shows only first and last 2 chars)
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) {
    return '****';
  }
  return `${secret.slice(0, 2)}${'*'.repeat(Math.min(secret.length - 4, 20))}${secret.slice(-2)}`;
}
