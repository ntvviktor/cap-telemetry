import { trace, context, SpanStatusCode, Span, Context } from "@opentelemetry/api";
import * as asyncHooks from 'async_hooks';
import cds from "@sap/cds";

// ============================================================================
// APPROACH 1: Stack Sampling Tracer (Non-Invasive)
// ============================================================================

interface Sample {
  ts: number;
  stack: string[];
  asyncId: number;
}

interface TraceEvent {
  kind: 'START' | 'END';
  ts: number;
  name: string;
}

class CAPStackSamplingTracer {
  private interval: NodeJS.Timeout | null = null;
  private samples: Map<number, Sample[]> = new Map();
  private activeSpans: Map<number, Map<string, Span>> = new Map();
  private samplingIntervalMs: number;
  private tracer = trace.getTracer('cap-stack-sampling');
  private asyncHook: asyncHooks.AsyncHook;
  private currentAsyncId: number = 0;
  private excludePatterns: RegExp[];
  private enabled: boolean = false;

  constructor(options: {
    samplingIntervalMs?: number;
    excludePatterns?: RegExp[];
  } = {}) {
    this.samplingIntervalMs = options.samplingIntervalMs || 50;
    this.excludePatterns = options.excludePatterns || [
      /node_modules/,
      /internal\//,
      /async_hooks/,
      /^Object\./,
      /^Promise\./,
      /^process\./
    ];

    this.asyncHook = asyncHooks.createHook({
      init: (asyncId) => {
        this.currentAsyncId = asyncId;
      },
      before: (asyncId) => {
        this.currentAsyncId = asyncId;
      },
      after: (asyncId) => {
        this.currentAsyncId = asyncId;
      },
      destroy: (asyncId) => {
        this.flushAsyncContext(asyncId);
      }
    });
  }

  start(): void {
    if (this.enabled) return;
    
    this.asyncHook.enable();
    this.enabled = true;
    
    this.interval = setInterval(() => {
      this.captureStackSample();
    }, this.samplingIntervalMs);

    console.log(`✅ CAP Stack Sampling Tracer started (${this.samplingIntervalMs}ms interval)`);
  }

  stop(): void {
    if (!this.enabled) return;
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.asyncHook.disable();
    this.enabled = false;

    // Flush all contexts
    this.activeSpans.forEach((_, asyncId) => {
      this.flushAsyncContext(asyncId);
    });

    console.log('🛑 CAP Stack Sampling Tracer stopped');
  }

  private captureStackSample(): void {
    const error = new Error();
    const stack = error.stack?.split('\n').slice(2) || [];
    
    const functionNames = stack
      .map(line => this.extractFunctionName(line))
      .filter(name => name && !this.shouldExclude(name));

    if (functionNames.length === 0) return;

    const sample: Sample = {
      ts: Date.now(),
      stack: functionNames,
      asyncId: this.currentAsyncId
    };

    if (!this.samples.has(this.currentAsyncId)) {
      this.samples.set(this.currentAsyncId, []);
    }
    this.samples.get(this.currentAsyncId)!.push(sample);

    this.processSamples(this.currentAsyncId);
  }

  private extractFunctionName(line: string): string {
    // Match patterns like:
    // "    at BooksService.processBooksArray (/path/file.ts:123:45)"
    // "    at async BooksService.init (/path/file.ts:123:45)"
    
    const match = line.match(/at\s+(?:async\s+)?([^\s(]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return 'unknown';
  }

  private shouldExclude(name: string): boolean {
    return this.excludePatterns.some(pattern => pattern.test(name));
  }

  private processSamples(asyncId: number): void {
    const samples = this.samples.get(asyncId);
    if (!samples || samples.length < 2) return;

    const prevSample = samples[samples.length - 2];
    const currSample = samples[samples.length - 1];

    const events = this.convertSamplesToEvents(
      prevSample.stack,
      currSample.stack,
      currSample.ts
    );

    this.applyEventsToSpans(asyncId, events);
  }

  private convertSamplesToEvents(
    prevStack: string[],
    currStack: string[],
    currentTs: number
  ): TraceEvent[] {
    const events: TraceEvent[] = [];

    // Find common prefix
    let commonLen = 0;
    while (
      commonLen < prevStack.length &&
      commonLen < currStack.length &&
      prevStack[commonLen] === currStack[commonLen]
    ) {
      commonLen++;
    }

    // Generate END events (reverse order for proper nesting)
    for (let i = prevStack.length - 1; i >= commonLen; i--) {
      events.push({
        kind: 'END',
        ts: currentTs,
        name: prevStack[i]
      });
    }

    // Generate START events
    for (let i = commonLen; i < currStack.length; i++) {
      events.push({
        kind: 'START',
        ts: currentTs,
        name: currStack[i]
      });
    }

    return events;
  }

  private applyEventsToSpans(asyncId: number, events: TraceEvent[]): void {
    if (!this.activeSpans.has(asyncId)) {
      this.activeSpans.set(asyncId, new Map());
    }

    const spans = this.activeSpans.get(asyncId)!;

    for (const event of events) {
      if (event.kind === 'START') {
        const span = this.tracer.startSpan(event.name, {
          startTime: event.ts
        });
        spans.set(event.name, span);

      } else if (event.kind === 'END') {
        const span = spans.get(event.name);
        if (span) {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end(event.ts);
          spans.delete(event.name);
        }
      }
    }
  }

  private flushAsyncContext(asyncId: number): void {
    this.samples.delete(asyncId);
    const spans = this.activeSpans.get(asyncId);
    if (spans) {
      spans.forEach(span => span.end());
      this.activeSpans.delete(asyncId);
    }
  }
}

// ============================================================================
// APPROACH 2: CAP Event Interceptor (Targeted, No Sampling Overhead)
// ============================================================================

class CAPEventTracer {
  private tracer = trace.getTracer('cap-events');

  /**
   * Wraps CAP event handlers with OpenTelemetry spans
   */
  wrapService(service: cds.Service): void {
    const originalBefore = service.before.bind(service);
    const originalAfter = service.after.bind(service);
    const originalOn = service.on.bind(service);

    // Intercept .before() handlers
    service.before = (event: string | string[], entity: string | Function, handler?: Function) => {
      if (typeof entity === 'function') {
        handler = entity as Function;
        entity = '*';
      }

      const wrappedHandler = this.wrapHandler(
        handler!,
        `before:${event}:${typeof entity === 'string' ? entity : 'handler'}`
      );

      return originalBefore(event, entity as any, wrappedHandler);
    };

    // Intercept .after() handlers
    service.after = (event: string | string[], entity: string | Function, handler?: Function) => {
      if (typeof entity === 'function') {
        handler = entity as Function;
        entity = '*';
      }

      const wrappedHandler = this.wrapHandler(
        handler!,
        `after:${event}:${typeof entity === 'string' ? entity : 'handler'}`
      );

      return originalAfter(event, entity as any, wrappedHandler);
    };

    // Intercept .on() handlers
    service.on = (event: string | string[], entity: string | Function, handler?: Function) => {
      if (typeof entity === 'function') {
        handler = entity as Function;
        entity = '*';
      }

      const wrappedHandler = this.wrapHandler(
        handler!,
        `on:${event}:${typeof entity === 'string' ? entity : 'handler'}`
      );

      return originalOn(event, entity as any, wrappedHandler);
    };

    console.log(`✅ CAP Event Tracer installed on service: ${service.name}`);
  }

  private wrapHandler(handler: Function, spanName: string): Function {
    const tracer = this.tracer;

    return async function wrappedHandler(this: any, ...args: any[]) {
      const span = tracer.startSpan(spanName, {
        attributes: {
          'cap.event.name': spanName,
          'cap.handler.async': handler.constructor.name === 'AsyncFunction'
        }
      });

      try {
        const result = await handler.apply(this, args);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error: any) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        span.recordException(error);
        throw error;
      } finally {
        span.end();
      }
    };
  }
}

// ============================================================================
// COMBINED SOLUTION: Best of Both Worlds
// ============================================================================

export class CAPTracingManager {
  private stackSampler: CAPStackSamplingTracer;
  private eventTracer: CAPEventTracer;

  constructor(options?: {
    samplingIntervalMs?: number;
    enableStackSampling?: boolean;
    enableEventTracing?: boolean;
  }) {
    this.stackSampler = new CAPStackSamplingTracer({
      samplingIntervalMs: options?.samplingIntervalMs || 50
    });
    this.eventTracer = new CAPEventTracer();
  }

  /**
   * Start stack sampling (captures ALL function calls)
   */
  startStackSampling(): void {
    this.stackSampler.start();
  }

  /**
   * Stop stack sampling
   */
  stopStackSampling(): void {
    this.stackSampler.stop();
  }

  /**
   * Install event tracing on a CAP service (captures only CAP handlers)
   */
  instrumentService(service: cds.Service): void {
    this.eventTracer.wrapService(service);
  }
}

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

// Singleton instance
let tracingManager: CAPTracingManager | null = null;

export function initCAPTracing(options?: {
  samplingIntervalMs?: number;
  enableStackSampling?: boolean;
  enableEventTracing?: boolean;
}): CAPTracingManager {
  if (!tracingManager) {
    tracingManager = new CAPTracingManager(options);
  }
  return tracingManager;
}

export function getCAPTracing(): CAPTracingManager | null {
  return tracingManager;
}

// ============================================================================
// EXAMPLE: Updated BooksService with Tracing
// ============================================================================

/*
// In your main server file (server.ts):
import { initCAPTracing } from './cap-tracing';

const tracing = initCAPTracing({
  samplingIntervalMs: 50,
  enableStackSampling: true,
  enableEventTracing: true
});

// Option 1: Enable stack sampling (captures EVERYTHING, including nested calls)
tracing.startStackSampling();

// Option 2: Or instrument specific services (targeted, less overhead)
cds.on('served', (services) => {
  Object.values(services).forEach(service => {
    tracing.instrumentService(service);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  tracing.stopStackSampling();
  process.exit(0);
});
*/

/*
// Your BooksService.ts - NO CHANGES NEEDED!
class BooksService extends cds.ApplicationService {
  async init() {
    // These will be automatically traced
    this.before("READ", "Authors", (req) => {
      console.log("Reading Authors...");
      console.log("Query:", req.query);
    });

    this.after("READ", "Books", async (books) => {
      console.log("Whut whut pizza hut ");
      if (Array.isArray(books)) {
        await this.processBooksArray(books);
      }
      return books;
    });

    return super.init();
  }

  // This will also be traced automatically
  async processBooksArray(books: any[]): Promise<void> {
    for (const book of books) {
      console.log("book", book);
    }
  }
}
*/