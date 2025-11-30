# Dynatrace Tracing Guide

## Quick Start - 4 Ways to Trace Your Code

### 1️⃣ **Best for Classes: `@TraceClass()` - Trace ALL Methods Automatically**

```typescript
import { TraceClass } from "./tracing.js";

@TraceClass()
class MyService {
  async method1() { ... }  // ✅ Automatically traced
  async method2() { ... }  // ✅ Automatically traced
  method3() { ... }        // ✅ Automatically traced
}
```

**Use when:** You want to trace an entire service/class with minimal code changes.

---

### 2️⃣ **Best for Selective Tracing: `@Trace()` - Trace Specific Methods**

```typescript
import { Trace } from "./tracing.js";

class MyService {
  @Trace()  // Only trace this method
  async importantMethod() { ... }

  @Trace("custom-name")  // Custom trace name
  async criticalOperation() { ... }

  // This method is NOT traced
  async helperMethod() { ... }
}
```

**Use when:** You only want to trace specific important methods.

---

### 3️⃣ **Best for Standalone Functions: `traceFunction()`**

```typescript
import { traceFunction } from "./tracing.js";

// Original function
async function fetchData(id: string) {
  // ... your logic
}

// Wrap it once at module level
const tracedFetchData = traceFunction(fetchData, "fetch-data-operation");

// Use the traced version everywhere
const result = await tracedFetchData("123");
```

**Use when:** You have standalone functions (not in classes).

---

### 4️⃣ **Best for Code Blocks: `withTrace()` - Trace Specific Logic**

```typescript
import { withTrace } from "./tracing.js";

async function complexFunction() {
  // Only trace expensive operation
  const result = await withTrace("expensive-operation", async () => {
    // ... expensive logic here
    return data;
  });

  // Regular untraced code
  const processed = result.map(...);

  return processed;
}
```

**Use when:** You want to trace only specific blocks of code, not entire functions.

---

## How to Apply to Your Existing Codebase

### Step 1: Install Dependencies

```bash
npm install @dynatrace/oneagent-sdk
```

### Step 2: Already Done! ✅
- TypeScript decorators enabled in `tsconfig.json`
- Tracing utilities created in `src/tracing.ts`

### Step 3: Apply to Your Code (Pick Your Style)

#### For Service Classes (Recommended - Fastest)

**Before:**
```typescript
class UserService {
  async getUser(id: string) { ... }
  async updateUser(user: User) { ... }
}
```

**After (Just add 1 line!):**
```typescript
@TraceClass()  // 👈 Add this ONE line
class UserService {
  async getUser(id: string) { ... }
  async updateUser(user: User) { ... }
}
// All methods now traced automatically! 🎉
```

#### For Standalone Functions

**Before:**
```typescript
export async function processOrder(order: Order) { ... }
export async function sendEmail(to: string) { ... }
```

**After:**
```typescript
import { traceFunction } from "./tracing.js";

async function processOrder(order: Order) { ... }
async function sendEmail(to: string) { ... }

// Export traced versions
export const tracedProcessOrder = traceFunction(processOrder, "process-order");
export const tracedSendEmail = traceFunction(sendEmail, "send-email");

// Or use original names
export default traceFunction(processOrder);
```

---

## What You Get in Dynatrace

### Before (Only I/O traced):
```
HTTP Request (200ms)
  └─ Database Query (50ms)
  └─ External API (100ms)
  ??? 50ms unaccounted time ???
```

### After (Complete visibility):
```
HTTP Request (200ms)
  ├─ UserService.fetchUser (80ms)
  │   ├─ Database Query (50ms)
  │   └─ UserService.validateUser (30ms)
  ├─ OrderService.createOrder (120ms)
  │   ├─ OrderService.validateInventory (40ms)
  │   ├─ OrderService.calculateTotal (30ms)
  │   └─ External API (50ms)
  └─ send-email (20ms)
```

---

## Migration Strategy for Large Codebases

### Phase 1: Critical Paths (Week 1)
1. Identify top 5 slowest endpoints
2. Add `@TraceClass()` to their service classes
3. Deploy and verify in Dynatrace

### Phase 2: Service Layer (Week 2)
1. Add `@TraceClass()` to all service classes
2. No code changes needed - just add decorator

### Phase 3: Utilities (Week 3)
1. Wrap standalone utility functions with `traceFunction()`
2. Update imports to use traced versions

### Phase 4: Fine-tuning (Ongoing)
1. Remove `@Trace()` from chatty/fast methods (<5ms)
2. Add custom names for important operations
3. Use `withTrace()` for specific hot paths

---

## Key Benefits

✅ **Zero Implementation Changes** - Your existing code logic remains untouched
✅ **Automatic Nested Call Tracking** - All nested function calls are linked
✅ **Works with Sync & Async** - Handles both automatically
✅ **Error Tracking** - Errors automatically reported to Dynatrace
✅ **Minimal Code Changes** - Usually just 1 line per class
✅ **Type Safe** - Full TypeScript support

---

## Performance Impact

- **Overhead:** <1ms per traced function call
- **Production Safe:** Yes, designed for production use
- **Recommendation:** Trace important business logic, skip trivial getters/setters

---

## Troubleshooting

### Decorators not working?
- Check `tsconfig.json` has `"experimentalDecorators": true`
- Make sure you import from `./tracing.js` (not `.ts`)

### Traces not showing in Dynatrace?
- Ensure Dynatrace OneAgent is installed on your server
- Check OneAgent is running: `systemctl status dynatraceagent`
- Verify environment variables are set

### Want to trace only in production?
```typescript
// Conditional tracing
const TraceInProd = process.env.NODE_ENV === 'production' ? TraceClass : () => (target: any) => target;

@TraceInProd()
class MyService { ... }
```

---

## Examples in This Repo

See `src/main.ts` for working examples of all 4 approaches!

Run the server:
```bash
npm start
```

Then test:
- http://localhost:3000/user/123 - See nested traces
- http://localhost:3000/order - See class-level tracing
- http://localhost:3000/complex - See block-level tracing
