/**
 * Complete CAP + OpenTelemetry + Dynatrace Integration
 *
 * This shows how to use your stack-sampling tracer with Dynatrace.
 * All spans (from stack sampling, CAP handlers, and auto-instrumentation)
 * will be sent to Dynatrace.
 */

// STEP 1: Initialize OpenTelemetry FIRST (before any other imports)
import { initOpenTelemetry } from './srv/otel-dynatrace-setup.js';

// Load config from environment variables
const DYNATRACE_URL = process.env.DYNATRACE_URL || 'https://your-env.live.dynatrace.com';
const DYNATRACE_TOKEN = process.env.DYNATRACE_TOKEN || 'your-api-token';

// Initialize OpenTelemetry with Dynatrace
initOpenTelemetry({
  dynatraceUrl: DYNATRACE_URL,
  dynatraceToken: DYNATRACE_TOKEN,
  serviceName: 'bookshop-service',
  serviceVersion: '1.0.0',
  enableAutoInstrumentation: true, // Auto-instrument HTTP, Express, etc.
});

// STEP 2: Now import your CAP modules and tracing
import { initCAPTracing } from './srv/cap-tracing.js';
import cds from '@sap/cds';

// STEP 3: Initialize your stack sampling tracer
const tracing = initCAPTracing({
  samplingIntervalMs: 50, // Sample every 50ms - adjust based on performance needs
});

// STEP 4: Enable stack sampling to capture ALL nested function calls
// This uses the stack-to-trace algorithm you learned from the C++ example
tracing.startStackSampling();
console.log('🔍 Stack sampling enabled - all function calls will be traced');

// STEP 5: Instrument CAP event handlers for clean, semantic span names
cds.on('served', (services) => {
  console.log('🎯 Instrumenting CAP services...');
  Object.values(services).forEach(service => {
    tracing.instrumentService(service);
    console.log(`   ✓ ${service.name}`);
  });
});

// STEP 6: Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  tracing.stopStackSampling();
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  tracing.stopStackSampling();
  process.exit(0);
});

console.log('🚀 Server ready with full Dynatrace integration');
console.log('   - Stack sampling: ENABLED (captures nested functions)');
console.log('   - CAP handlers: Auto-instrumented');
console.log('   - HTTP/Express: Auto-instrumented');
console.log(`   - Exporting to: ${DYNATRACE_URL}`);
