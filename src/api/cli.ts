#!/usr/bin/env node
/**
 * CLI entry point for the API server
 *
 * Usage: npx ts-node src/api/cli.ts
 */

import 'dotenv/config';
import { createApiServer } from './server.js';
import { BrokerConnectionService } from '../services/broker-connection.js';
import { createSecretManagerFromEnv } from '../storage/secrets.js';

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

  // Create connection service
  const connectionService = new BrokerConnectionService(secretManager);

  // Create and start API server
  const server = createApiServer(connectionService, port);
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
