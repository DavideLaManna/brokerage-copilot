#!/usr/bin/env node
/**
 * CLI entry point for the API server
 *
 * Usage: npx ts-node src/api/cli.ts
 */

import 'dotenv/config';
// Import adapters to register them with the factory (side-effect import)
import '../adapters/index.js';
import { createApiServer } from './server.js';
import { BrokerConnectionService } from '../services/broker-connection.js';
import { createSecretManagerFromEnv, importCredentialsFromEnv } from '../storage/secrets.js';
import { createAuditLogServiceFromEnv } from '../services/audit-log.js';
import type { BrokerType } from '../types/broker.js';

async function main(): Promise<void> {
  const port = parseInt(process.env.API_PORT || '3001', 10);

  console.log('Initializing Options Trading Copilot API Server...');

  // Initialize SecretManager
  const secretManager = await createSecretManagerFromEnv();
  if (!secretManager) {
    console.error('Failed to initialize SecretManager. Check SECRETS_MASTER_PASSWORD.');
    process.exit(1);
  }

  await secretManager.initialize();

  // Import credentials from environment variables
  const importedBrokers = await importCredentialsFromEnv(secretManager);
  if (importedBrokers.length > 0) {
    console.log(`Imported credentials for: ${importedBrokers.join(', ')}`);
  }

  // Create connection service
  const connectionService = new BrokerConnectionService(secretManager);

  // Auto-connect to broker if BROKER_PROVIDER is set
  const brokerProvider = process.env.BROKER_PROVIDER as BrokerType | undefined;
  if (brokerProvider) {
    console.log(`Auto-connecting to ${brokerProvider}...`);
    try {
      const result = await connectionService.connect(brokerProvider);
      if (result.success) {
        console.log(`✓ Connected to ${brokerProvider}`);
        if (result.accountSummary) {
          console.log(`  Net Liquidation: $${result.accountSummary.netLiquidation.toLocaleString()}`);
          console.log(`  Buying Power: $${result.accountSummary.buyingPower.toLocaleString()}`);
        }
      } else {
        console.error(`✗ Failed to connect to ${brokerProvider}: ${result.error}`);
      }
    } catch (error) {
      console.error(`✗ Error connecting to ${brokerProvider}:`, error instanceof Error ? error.message : error);
    }
  }

  // Initialize audit log service
  let auditLogService;
  try {
    auditLogService = await createAuditLogServiceFromEnv();
    await auditLogService.initialize();
    console.log('✓ Audit log service initialized');
  } catch (error) {
    console.warn('⚠ Audit log service not initialized:', error instanceof Error ? error.message : error);
  }

  // Create and start API server
  const server = createApiServer(connectionService, port, undefined, undefined, auditLogService);
  await server.start();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await connectionService.disconnectAll();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await connectionService.disconnectAll();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
