/**
 * Storage Layer - Barrel Exports
 */

// Encryption utilities
export {
  encrypt,
  decrypt,
  deriveKey,
  generateSecureRandom,
  hashValue,
  secureCompare,
  maskSecret,
  type EncryptedData,
} from './encryption.js';

// Token refresh logic
export {
  type OAuthTokens,
  type OAuthConfig,
  type TokenRefreshResult,
  type TokenRefreshHandler,
  shouldRefreshToken,
  calculateExpiresAt,
  registerTokenRefreshHandler,
  getTokenRefreshHandler,
  supportsTokenRefresh,
  refreshTokens,
  getOAuthConfig,
  usesOAuth,
  OAUTH_CONFIGS,
} from './token-refresh.js';

// Secrets manager
export {
  SecretManager,
  createSecretManagerFromEnv,
  importCredentialsFromEnv,
  type BrokerCredentials,
  type CredentialValidationResult,
} from './secrets.js';

// Order submission storage (idempotency)
export {
  OrderSubmissionStore,
  createOrderSubmissionStoreFromEnv,
  createOrderSubmission,
  OrderSubmissionSchema,
  type OrderSubmission,
  type OrderSubmissionStatus,
  type OrderSubmissionStoreConfig,
} from './order-submissions.js';
