# Options Trading Copilot

LLM-Assisted Options Trading Copilot - Discipline and time compression for options traders with a compliance-first approach.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Options Trading Copilot                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐  │
│  │   Web UI     │◄───│   API Layer  │◄───│      LLM Agent (MCP)         │  │
│  │  Dashboard   │    │   REST/WS    │    │  Portfolio Review, Analysis  │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────────┘  │
│         │                   │                          │                    │
│         └───────────────────┼──────────────────────────┘                    │
│                             │                                                │
│                             ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Services Layer                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │  │
│  │  │ Risk Engine │  │  Portfolio  │  │  Technical  │  │   Audit     │ │  │
│  │  │ Validation  │  │  Analytics  │  │  Indicators │  │   Logger    │ │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                             │                                                │
│                             ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Adapters Layer                                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │  │
│  │  │   Alpaca    │  │   Tradier   │  │  tastytrade │  │    IBKR     │ │  │
│  │  │   Adapter   │  │   Adapter   │  │   Adapter   │  │   Adapter   │ │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                             │                                                │
│                             ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Storage Layer                                  │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │  │
│  │  │  PostgreSQL │  │    Redis    │  │  Encrypted  │                   │  │
│  │  │  Database   │  │    Cache    │  │   Secrets   │                   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── api/          # REST API endpoints and WebSocket handlers
├── ui/           # Web dashboard frontend components
├── services/     # Business logic (risk engine, portfolio analytics, etc.)
├── adapters/     # Broker-specific implementations
├── storage/      # Database and cache interfaces
└── types/        # Shared TypeScript type definitions
```

## Components

### Web UI (Dashboard)
- Account summary, positions, and orders display
- Chat interface for LLM agent interaction
- Order preview and approval workflow
- Risk configuration settings
- Decision journal for audit review

### API Layer
- RESTful endpoints for portfolio data
- WebSocket support for real-time updates
- Authentication and session management

### LLM Agent
- Portfolio review and analysis
- Trade recommendations with thesis and rationale
- Technical indicator computation
- Risk assessment

### Services Layer
- **Risk Engine**: Pre-trade validation, position limits, concentration checks
- **Portfolio Analytics**: Greeks aggregation, exposure calculation
- **Technical Indicators**: RSI, moving averages, ATR
- **Audit Logger**: Compliance-focused event logging

### Adapters Layer
Unified broker interface supporting:
- Alpaca
- Tradier
- tastytrade
- Interactive Brokers

Each adapter implements:
- `getPositions()` - Fetch open positions
- `getOpenOrders()` - Fetch pending orders
- `getQuote()` - Real-time quotes
- `getOptionChain()` - Option chain data with Greeks
- `placeOrder()` - Order submission with idempotency
- `cancelOrder()` - Order cancellation

### Storage Layer
- **PostgreSQL**: Trade proposals, audit logs, user config
- **Redis**: Option chain cache, rate limit tracking
- **Encrypted Secrets**: Broker credentials (never logged)

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and configure your broker credentials
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run type checking:
   ```bash
   npm run typecheck
   ```
5. Run tests:
   ```bash
   npm run test
   ```
6. Start development server:
   ```bash
   npm run dev
   ```

## Secure Credential Storage

The Options Trading Copilot uses AES-256-GCM encryption to securely store broker API credentials. Credentials are **never logged** and are stored in an encrypted file on disk.

### Initial Setup

1. **Set Master Password**: Add the following to your `.env` file:
   ```bash
   SECRETS_MASTER_PASSWORD=your-secure-password-here
   ```
   The master password must be at least 8 characters. Use a strong, unique password.

2. **Configure Broker Credentials**: You can either:

   **Option A: Import from environment variables (recommended for initial setup)**

   Set your broker credentials in `.env` as shown in `.env.example`, then the system will automatically import and encrypt them on first run.

   **Option B: Programmatic setup**

   ```typescript
   import { createSecretManagerFromEnv } from './storage';

   const secretManager = await createSecretManagerFromEnv();

   // Store Alpaca credentials
   await secretManager.setCredentials({
     brokerType: 'alpaca',
     apiKey: 'your-api-key',
     apiSecret: 'your-api-secret',
     sandbox: true, // Use paper trading
   });

   // Store Tradier credentials (OAuth-based)
   await secretManager.setCredentials({
     brokerType: 'tradier',
     oauth: {
       accessToken: 'your-access-token',
       refreshToken: 'your-refresh-token',
       expiresAt: Date.now() + 86400000, // 24 hours
     },
     accountId: 'your-account-id',
   });
   ```

### Credential Validation

Credentials are validated on startup and whenever they are stored:
- **Alpaca**: Requires `apiKey` and `apiSecret`
- **Tradier**: Requires `accessToken` (OAuth) or `apiKey`
- **tastytrade**: Requires `apiKey` (username) and `apiSecret` (password)
- **IBKR**: Requires `baseUrl` (TWS/Gateway URL)

### OAuth Token Refresh

For OAuth-based brokers (like Tradier), the system automatically handles token refresh:
- Tokens are refreshed 5 minutes before expiration
- Refresh tokens are stored encrypted alongside access tokens
- Failed refreshes are logged (without exposing secrets)

### Security Best Practices

1. **Never commit secrets**: The `.secrets/` directory is excluded from git
2. **Use environment variables for the master password**: Don't hardcode it
3. **Rotate credentials regularly**: Update broker API keys periodically
4. **Clear memory on shutdown**: Call `secretManager.clearMemory()` when done

### Safe Logging

To log credential information without exposing secrets:
```typescript
const safeInfo = secretManager.getSafeCredentialInfo('alpaca');
console.log('Credential info:', safeInfo);
// Output: { brokerType: 'alpaca', hasApiKey: true, apiKeyPrefix: 'PK****56', ... }
```

## Development

- TypeScript with strict mode enabled
- Vitest for testing
- ESLint for code quality
- All broker credentials stored securely, never logged

## License

MIT
