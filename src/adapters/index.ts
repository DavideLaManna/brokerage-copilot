/**
 * Adapter Exports
 *
 * Central export point for broker adapters and factory.
 */

export type { BrokerConfig, BrokerAdapterConstructor } from './broker-factory.js';

export {
  registerBrokerAdapter,
  isAdapterRegistered,
  getRegisteredBrokers,
  createBrokerAdapter,
  validateBrokerConfig,
  getBrokerEnvVars,
  createConfigFromEnv,
} from './broker-factory.js';

// Tradier adapter
export { TradierAdapter, createTradierAdapter } from './tradier/index.js';

// Register Tradier adapter with factory
import { registerBrokerAdapter } from './broker-factory.js';
import { createTradierAdapter } from './tradier/index.js';

registerBrokerAdapter('tradier', createTradierAdapter);
