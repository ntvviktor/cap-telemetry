import { trace, context, SpanStatusCode, Span, HrTime, Context } from "@opentelemetry/api";

export const tracer = trace.getTracer("bookshop-service", "1.0.0");

export function getActiveSpan() {
  return trace.getSpan(context.active()); // Fixed: context.active() provides the context
}

function processProfileToSpans(profile: any, parentSpan: Span) {
  const tracer = trace.getTracer('legacy-profiler');
  
  // Fixed: Get active context and set parent span
  const activeContext = context.active();
  const spanContext = trace.setSpan(activeContext, parentSpan);
  
  // 1. Reconstruct the "vector<Sample>" from V8 data
  // V8 gives us a compressed tree. We need to map Node IDs to Function Names.
  const nodeMap = new Map<number, string>();
  const parentMap = new Map<number, number>(); // To walk up the stack
  
  function traverse(node: any) {
    nodeMap.set(node.id, node.callFrame.functionName || '(anonymous)');
    if (node.children) {
      node.children.forEach((child: any) => {
        parentMap.set(child.id, node.id);
        traverse(child);
      });
    }
  }
  
  traverse(profile.profile.nodes[0]);
  
  // 2. Build the Linear Samples (The "Interview Input")
  const samples: { ts: number; stack: string[] }[] = [];
  let currentTime = profile.profile.startTime; // Microseconds
  
  // profile.profile.samples contains the leaf node ID for each tick
  // profile.profile.timeDeltas contains the time passed since last tick
  profile.profile.samples.forEach((nodeId: number, index: number) => {
    const timeDelta = profile.profile.timeDeltas[index];
    currentTime += timeDelta;
    
    // Build stack by walking up the tree
    const stack: string[] = [];
    let currentId: number | undefined = nodeId;
    while (currentId !== undefined && nodeMap.has(currentId)) {
      stack.unshift(nodeMap.get(currentId)!); // Push to front to get Outer -> Inner
      currentId = parentMap.get(currentId);
    }
    
    samples.push({ ts: currentTime / 1000, stack }); // Convert to milliseconds
  });
  
  // 3. APPLY YOUR ALGORITHM (The "Common Prefix" Logic)
  // We maintain a map of "Active Spans" so we can end them later.
  // Key = stack depth, Value = Span
  const activeSpans = new Map<number, Span>();
  let prevStack: string[] = [];
  
  samples.forEach((sample) => {
    const currStack = sample.stack;
    const ts = sample.ts; // relative timestamp
    
    // Calculate Common Prefix
    let commonLen = 0;
    while (
      commonLen < prevStack.length &&
      commonLen < currStack.length &&
      prevStack[commonLen] === currStack[commonLen]
    ) {
      commonLen++;
    }
    
    // A. END OLD SPANS (Pop)
    // Close spans that are no longer in the stack
    for (let i = prevStack.length; i > commonLen; i--) {
      if (activeSpans.has(i)) {
        activeSpans.get(i)?.end(millisecondsToHrTime(ts)); // End at current timestamp
        activeSpans.delete(i);
      }
    }
    
    // B. START NEW SPANS (Push)
    // Create spans for new functions
    for (let i = commonLen; i < currStack.length; i++) {
      const fnName = currStack[i];
      // Filter out noise like "(root)" or "(garbage collector)" if needed
      if (fnName === '(root)') continue; 
      
      // Fixed: Pass context as third parameter
      const span = tracer.startSpan(
        fnName as string,  
        {
          startTime: millisecondsToHrTime(ts),
        }, 
        spanContext // Pass the context with parent span
      );
      
      activeSpans.set(i + 1, span); // Use depth as key
    }
    
    prevStack = currStack;
  });
  
  // Cleanup: Close any remaining open spans
  activeSpans.forEach((span) => span.end());
}

// Helper to convert ms number to OTel HrTime
// Fixed: Use the imported HrTime type instead of opentelemetry.HrTime
function millisecondsToHrTime(ms: number): HrTime {
  const seconds = Math.floor(ms / 1000);
  const nanos = Math.round((ms % 1000) * 1e6);
  return [seconds, nanos];
}

export { processProfileToSpans };