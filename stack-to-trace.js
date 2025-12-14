/**
 * Captures the current stack trace as an array of function names
 * @param {number} skipFrames - Number of frames to skip (to exclude this function itself)
 * @returns {string[]} Array of function names from outermost to innermost
 */
function captureStack(skipFrames = 2) {
  const obj = {};
  Error.captureStackTrace(obj);

  return obj.stack
    .split('\n')
    .slice(skipFrames)
    .map(line => {
      const match = line.match(/at\s+([^\s]+)\s+/);
      return match ? match[1] : 'anonymous';
    })
    .reverse();
}

/**
 * Converts stack samples to START/END trace events
 * @param {Array<{ts: number, stack: string[]}>} samples
 * @returns {Array<{kind: string, ts: number, name: string}>}
 */
function convertSamplesToTrace(samples) {
  const events = [];
  let prevStack = [];

  for (const sample of samples) {
    const currStack = sample.stack;
    const currentTs = sample.ts;

    // 1. Find common prefix length
    let commonLen = 0;
    while (
      commonLen < prevStack.length &&
      commonLen < currStack.length &&
      prevStack[commonLen] === currStack[commonLen]
    ) {
      commonLen++;
    }

    // 2. Generate END events (pop from previous stack)
    // Iterate backwards for proper nesting
    for (let i = prevStack.length - 1; i >= commonLen; i--) {
      events.push({ kind: 'END', ts: currentTs, name: prevStack[i] });
    }

    // 3. Generate START events (push to current stack)
    for (let i = commonLen; i < currStack.length; i++) {
      events.push({ kind: 'START', ts: currentTs, name: currStack[i] });
    }

    prevStack = [...currStack];
  }

  return events;
}

// ==========================================
// Example Usage & Testing
// ==========================================

// Example 1: Manual samples (like the C++ test)
console.log('=== Example 1: Manual Samples ===\n');

const samples = [
  { ts: 7.5, stack: ['main'] },
  { ts: 9.1, stack: ['main', 'my_fn', 'my_fn2'] },
  { ts: 9.3, stack: ['main', 'my_fn2', 'my_fn'] },
  { ts: 10.7, stack: ['main'] }
];

const events = convertSamplesToTrace(samples);

console.log(`Generated ${events.length} events:\n`);
events.forEach(e => {
  console.log(`${e.kind.padEnd(5)} @ ${e.ts.toString().padEnd(5)} - ${e.name}`);
});

// Example 2: Capturing real stack traces
console.log('\n=== Example 2: Real Stack Capture ===\n');

function innerFunction() {
  const stack = captureStack();
  console.log('Captured stack:', stack);
  return { ts: performance.now(), stack };
}

function middleFunction() {
  return innerFunction();
}

function outerFunction() {
  return middleFunction();
}

// Capture a sample
const realSample = outerFunction();
console.log('\nSample:', JSON.stringify(realSample, null, 2));

// // Example 3: Simulating a profiler
// console.log('\n=== Example 3: Simulated Profiler ===\n');

// const profilerSamples = [];

// function simulatedWork(duration) {
//   const start = Date.now();
//   while (Date.now() - start < duration) {
//     // Busy wait
//   }
// }

// function recordSample() {
//   profilerSamples.push({
//     ts: performance.now(),
//     stack: captureStack(1) // Skip recordSample itself
//   });
// }

// function taskA() {
//   recordSample();
//   simulatedWork(10);
//   taskB();
//   recordSample();
// }

// function taskB() {
//   recordSample();
//   simulatedWork(10);
//   taskC();
//   recordSample();
// }

// function taskC() {
//   recordSample();
//   simulatedWork(10);
// }

// // Run and profile
// taskA();

// const profilerEvents = convertSamplesToTrace(profilerSamples);
// console.log(`Profiler captured ${profilerSamples.length} samples, generated ${profilerEvents.length} events:\n`);
// profilerEvents.forEach(e => {
//   console.log(`${e.kind.padEnd(5)} @ ${e.ts.toFixed(2).padStart(10)} - ${e.name}`);
// });

// export { captureStack, convertSamplesToTrace };
