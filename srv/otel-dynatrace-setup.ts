/**
 * OpenTelemetry + Dynatrace Setup for CAP
 *
 * This configures OpenTelemetry to export traces to Dynatrace using OTLP.
 * Your existing stack sampling in cap-tracing.ts will automatically send spans to Dynatrace.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Enable OpenTelemetry diagnostic logging (optional, helpful for debugging)
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

/**
 * Initialize OpenTelemetry SDK with Dynatrace configuration
 */
export function initOpenTelemetry(config: {
  dynatraceUrl: string;      // e.g., "https://{your-environment-id}.live.dynatrace.com"
  dynatraceToken: string;    // API token with "Ingest OpenTelemetry traces" permission
  serviceName?: string;
  serviceVersion?: string;
  enableAutoInstrumentation?: boolean;
}): NodeSDK {

  const {
    dynatraceUrl,
    dynatraceToken,
    serviceName = 'bookshop-service',
    serviceVersion = '1.0.0',
    enableAutoInstrumentation = true
  } = config;

  // Configure OTLP exporter for Dynatrace
  const traceExporter = new OTLPTraceExporter({
    url: `${dynatraceUrl}/api/v2/otlp/v1/traces`,
    headers: {
      Authorization: `Api-Token ${dynatraceToken}`,
    },
  });

  // Create resource with service information
  const resource = Resource.default().merge(
    new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment': process.env.NODE_ENV || 'development',
    })
  );

  // Initialize SDK
  const sdk = new NodeSDK({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(traceExporter, {
        maxQueueSize: 1000,
        scheduledDelayMillis: 1000,
      })
    ],
    instrumentations: enableAutoInstrumentation
      ? [
          getNodeAutoInstrumentations({
            // Fine-tune auto-instrumentation
            '@opentelemetry/instrumentation-http': {
              enabled: true,
            },
            '@opentelemetry/instrumentation-express': {
              enabled: true,
            },
            '@opentelemetry/instrumentation-fs': {
              enabled: false, // Can be noisy
            },
          }),
        ]
      : [],
  });

  // Start the SDK
  sdk.start();
  console.log('✅ OpenTelemetry SDK initialized with Dynatrace exporter');
  console.log(`   Service: ${serviceName}`);
  console.log(`   Dynatrace: ${dynatraceUrl}`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => console.log('🛑 OpenTelemetry SDK shut down'))
      .catch((error) => console.error('Error shutting down OpenTelemetry SDK', error))
      .finally(() => process.exit(0));
  });

  return sdk;
}

/**
 * Alternative: Manual instrumentation helper for specific functions
 * Use this to wrap critical business logic functions with spans
 */
import { trace, context, Span, SpanStatusCode } from '@opentelemetry/api';

export function traceFunction<T extends (...args: any[]) => any>(
  fn: T,
  spanName?: string
): T {
  const tracer = trace.getTracer('manual-instrumentation');

  return (async function tracedFunction(...args: any[]) {
    const name = spanName || fn.name || 'anonymous';
    const span = tracer.startSpan(name, {
      attributes: {
        'code.function': fn.name,
        'code.namespace': fn.constructor?.name,
      }
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await fn(...args);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }) as T;
}

/**
 * Decorator for tracing class methods (TypeScript experimental decorators)
 */
export function Traced(spanName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const tracer = trace.getTracer('method-tracing');

    descriptor.value = async function (...args: any[]) {
      const name = spanName || `${target.constructor.name}.${propertyKey}`;
      const span = tracer.startSpan(name);

      return context.with(trace.setSpan(context.active(), span), async () => {
        try {
          const result = await originalMethod.apply(this, args);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error: any) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          throw error;
        } finally {
          span.end();
        }
      });
    };

    return descriptor;
  };
}
