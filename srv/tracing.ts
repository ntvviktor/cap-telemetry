import { trace, context, SpanStatusCode } from "@opentelemetry/api";

export const tracer = trace.getTracer("bookshop-service", "1.0.0");

export function getActiveSpan() {
  return trace.getActiveSpan();
}

export function loggedMethod(originalMethod: any, _context: any) {

    function replacementMethod(this: any, ...args: any[]) {
        console.log("LOG: Entering method.")
        const result = originalMethod.call(this, ...args);
        console.log("LOG: Exiting method.")
        return result;
    }

    return replacementMethod;
}


export function traceAsyncFn(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const originalMethod = descriptor.value;
  const spanName = propertyKey;

  descriptor.value = async function (this: any, ...args: any[]) {
    return tracer.startActiveSpan(spanName, async (span) => {
      try {
        console.log("LOG: Entering method.");
        const result = await originalMethod.apply(this, args);
        console.log("LOG: Exiting method.");
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });
  };
}

export async function traceAsyncFunction<T>(
  spanName: string,
  fn: () => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }
      const result = await fn();

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Decorator factory for tracing methods
export function Trace(
  spanName?: string,
  getAttributes?: (args: any[]) => Record<string, any>
) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >
  ) {
    const methodName = String(context.name);
    const traceName = spanName || methodName;

    return function (this: This, ...args: Args): Return {
      const result = target.apply(this, args);

      // Handle async methods
      if (result instanceof Promise) {
        return tracer.startActiveSpan(traceName, async (span) => {
          try {
            // Add attributes if provided
            if (getAttributes) {
              const attributes = getAttributes(args);
              Object.entries(attributes).forEach(([key, value]) => {
                span.setAttribute(key, value);
              });
            }

            const resolvedResult = await result;
            span.setStatus({ code: SpanStatusCode.OK });
            return resolvedResult;
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : "Unknown error",
            });
            span.recordException(error as Error);
            throw error;
          } finally {
            span.end();
          }
        }) as Return;
      }

      // Handle sync methods (though we mainly use this for async)
      return result;
    };
  };
}
