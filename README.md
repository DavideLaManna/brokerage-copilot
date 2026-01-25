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

## Development

- TypeScript with strict mode enabled
- Vitest for testing
- ESLint for code quality
- All broker credentials stored securely, never logged

## License

MIT
