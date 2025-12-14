# Dynatrace Integration Setup Guide

## Overview

This project uses OpenTelemetry to send distributed traces to Dynatrace. The stack-to-trace algorithm captures **all nested function calls** automatically.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Your CAP Application                    │
├─────────────────────────────────────────────────────────────┤
│  Stack Sampling Tracer (cap-tracing.ts)                     │
│  • Captures stack traces every 50ms                          │
│  • Converts to START/END events (stack-to-trace algorithm)  │
│  • Creates OpenTelemetry spans for ALL function calls        │
├─────────────────────────────────────────────────────────────┤
│  CAP Event Tracer (cap-tracing.ts)                          │
│  • Wraps CAP handlers (before/after/on)                      │
│  • Creates semantic spans with clean names                   │
├─────────────────────────────────────────────────────────────┤
│  Auto-Instrumentation                                        │
│  • HTTP requests/responses                                   │
│  • Express middleware                                        │
│  • Database queries (if configured)                          │
├─────────────────────────────────────────────────────────────┤
│  OpenTelemetry SDK                                           │
│  • Batch span processor                                      │
│  • OTLP exporter                                             │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ OTLP/HTTP
                   │
                   ▼
        ┌──────────────────────┐
        │     Dynatrace        │
        │  (OTLP endpoint)     │
        └──────────────────────┘
```

## Prerequisites

1. **Dynatrace Environment**: You need access to a Dynatrace environment
2. **API Token**: Create an API token with "Ingest OpenTelemetry traces" permission

## Installation

### 1. Install Required Packages

```bash
npm install --save \
  @opentelemetry/sdk-node \
  @opentelemetry/api \
  @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/auto-instrumentations-node
```

### 2. Create Dynatrace API Token

1. Go to your Dynatrace environment
2. Navigate to **Settings → Integration → OpenTelemetry**
3. Create a new API token with the following permission:
   - **Ingest OpenTelemetry traces** (`openTelemetryTrace.ingest`)
4. Copy the token

### 3. Set Environment Variables

Create a `.env` file in your project root:

```bash
# Dynatrace Configuration
DYNATRACE_URL=https://{your-environment-id}.live.dynatrace.com
DYNATRACE_TOKEN=dt0c01.YOUR_TOKEN_HERE

# Optional: Service configuration
SERVICE_NAME=bookshop-service
SERVICE_VERSION=1.0.0
NODE_ENV=development
```

**Finding your Dynatrace URL:**
- Look at your browser when logged into Dynatrace
- Format: `https://abc12345.live.dynatrace.com` (SaaS)
- Or your managed URL if using Dynatrace Managed

### 4. Load Environment Variables

Install dotenv (if not already):

```bash
npm install --save dotenv
```

Update your `server-with-dynatrace.ts`:

```typescript
import 'dotenv/config'; // Add this at the very top
import { initOpenTelemetry } from './srv/otel-dynatrace-setup.js';
// ... rest of your code
```

## Usage

### Option 1: Stack Sampling (Captures Everything)

This approach captures **ALL** function calls, including deeply nested ones, using the stack-to-trace algorithm.

```bash
# Start with stack sampling enabled
node server-with-dynatrace.ts
```

**Pros:**
- Captures every function call automatically
- No code changes needed
- Great for debugging complex flows

**Cons:**
- Higher overhead (~5-10% CPU)
- Many spans (can be noisy)

### Option 2: Targeted Instrumentation (Manual)

Instrument only specific functions for lower overhead:

```typescript
import { Traced } from './srv/otel-dynatrace-setup.js';

class BooksService extends cds.ApplicationService {
  async init() {
    // CAP handlers are auto-instrumented by CAPEventTracer
    this.after("READ", "Books", async (books) => {
      if (Array.isArray(books)) {
        await this.processBooksArray(books);
      }
      return books;
    });

    return super.init();
  }

  // Manually trace specific methods with @Traced decorator
  @Traced('BooksService.processBooksArray')
  async processBooksArray(books: any[]): Promise<void> {
    for (const book of books) {
      await this.enrichBookData(book);
    }
  }

  @Traced('BooksService.enrichBookData')
  async enrichBookData(book: any): Promise<void> {
    // Complex business logic here
    console.log('Enriching book:', book.title);
  }
}
```

## Verifying the Integration

### 1. Check Console Output

When starting the server, you should see:

```
✅ OpenTelemetry SDK initialized with Dynatrace exporter
   Service: bookshop-service
   Dynatrace: https://your-env.live.dynatrace.com
✅ CAP Stack Sampling Tracer started (50ms interval)
🎯 Instrumenting CAP services...
   ✓ BooksService
🚀 Server ready with full Dynatrace integration
```

### 2. Trigger Some Requests

```bash
# Get books
curl http://localhost:4004/books/Books

# Get authors
curl http://localhost:4004/books/Authors
```

### 3. View Traces in Dynatrace

1. Go to your Dynatrace environment
2. Navigate to **Distributed traces**
3. Filter by service name: `bookshop-service`
4. You should see traces like:

```
GET /books/Books                         [200ms]
├─ before:READ:Authors                   [5ms]
├─ READ query execution                  [50ms]
├─ after:READ:Books                      [100ms]
│  └─ BooksService.processBooksArray     [95ms]
│     ├─ BooksService.enrichBookData     [20ms]
│     ├─ BooksService.enrichBookData     [20ms]
│     └─ BooksService.enrichBookData     [20ms]
└─ HTTP response                         [45ms]
```

## How the Stack-to-Trace Algorithm Works

The stack sampling approach:

1. **Capture**: Every 50ms, capture the current call stack using `Error.captureStackTrace()`
2. **Parse**: Extract function names from stack trace
3. **Compare**: Compare current stack with previous stack
4. **Find Common Prefix**: Determine which functions are still active
5. **Generate Events**:
   - END events for functions that exited (removed from stack)
   - START events for new functions (added to stack)
6. **Create Spans**: Convert events to OpenTelemetry spans with proper parent-child relationships

This is the **exact same algorithm** as the C++ example you studied!

## Performance Tuning

### Adjust Sampling Interval

```typescript
const tracing = initCAPTracing({
  samplingIntervalMs: 100, // Less frequent = lower overhead
});
```

Recommended intervals:
- **Development**: 50ms (high resolution, easier debugging)
- **Production**: 100-200ms (lower overhead)
- **High-traffic**: Disable stack sampling, use manual instrumentation only

### Filtering Noisy Functions

Edit `cap-tracing.ts` to exclude patterns:

```typescript
this.excludePatterns = options.excludePatterns || [
  /node_modules/,
  /internal\//,
  /async_hooks/,
  /^Object\./,
  /^Promise\./,
  /^process\./,
  /console\.log/, // Add custom exclusions
];
```

## Troubleshooting

### No traces in Dynatrace

1. Check your API token has `openTelemetryTrace.ingest` permission
2. Verify the Dynatrace URL is correct
3. Check console for exporter errors
4. Enable debug logging:

```typescript
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
```

### Too many spans

- Increase sampling interval (100ms or 200ms)
- Use exclude patterns to filter noise
- Switch to manual instrumentation only

### Missing nested function calls

- Ensure stack sampling is started BEFORE making requests
- Check exclude patterns aren't filtering your functions
- Verify OpenTelemetry SDK is initialized first

## Architecture Decision: When to Use Which Approach?

| Scenario | Recommended Approach |
|----------|---------------------|
| Development & debugging | Stack sampling (captures everything) |
| Production (low traffic) | Stack sampling (50-100ms interval) |
| Production (high traffic) | CAP Event Tracer + Manual instrumentation |
| Specific performance issue | Stack sampling for affected endpoint only |
| Critical business logic | Manual `@Traced` decorators |

## Example: Hybrid Approach

```typescript
// In server-with-dynatrace.ts
const isProduction = process.env.NODE_ENV === 'production';

const tracing = initCAPTracing({
  samplingIntervalMs: isProduction ? 200 : 50,
});

// Enable stack sampling only for debug endpoints in production
if (!isProduction) {
  tracing.startStackSampling();
} else {
  // In production, only instrument CAP handlers
  cds.on('served', (services) => {
    Object.values(services).forEach(service => {
      tracing.instrumentService(service);
    });
  });

  // Enable stack sampling on-demand via HTTP endpoint
  app.post('/admin/enable-sampling', (req, res) => {
    tracing.startStackSampling();
    setTimeout(() => tracing.stopStackSampling(), 60000); // Auto-stop after 1 min
    res.send('Sampling enabled for 60 seconds');
  });
}
```

## Next Steps

1. Review traces in Dynatrace to understand your application flow
2. Add custom attributes to spans for better filtering
3. Set up alerts based on trace data
4. Create dashboards showing service dependencies
5. Use distributed tracing to identify bottlenecks

## References

- [OpenTelemetry JS Documentation](https://opentelemetry.io/docs/languages/js/)
- [Dynatrace OpenTelemetry Integration](https://docs.dynatrace.com/docs/extend-dynatrace/opentelemetry)
- [CAP Telemetry Plugin](https://cap.cloud.sap/docs/plugins/#telemetry)
