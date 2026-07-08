# Deepening Signals

Reference for the five improvement signals used by `sp:code-improvement`. Each entry defines the
symptom, the diagnostic, the deepening direction, and a concrete example.

These signals are adapted from the deep-module principle (a module's interface should be narrower
than its implementation) and the seam/locality/test-surface heuristics for structural health.

---

## 1. Shallow Module

**Symptom:** A module whose interface is as complex as its implementation. The caller must
understand the module's internals to use it correctly — the abstraction leaks because there is no
abstraction, only a pass-through.

**Diagnostic:**

- Count the exported symbols. Count the non-exported implementation lines.
- If `exported_symbols / implementation_lines ≈ 1` (every line is exported, or the body is a
  single delegation), the module is shallow.
- A wrapper that only forwards to another module is the classic case.

**Deepening direction:** Either collapse it into its caller (inline the delegation) or give it a
real body (move logic from the caller into the module so the interface narrows).

**Example:**

```typescript
// shallow: the service just forwards to the DAO
export class UserService {
    constructor(private dao: UserDao) {}
    getUser(id: string) { return this.dao.findById(id); }      // pass-through
    createUser(data: UserInput) { return this.dao.insert(data); } // pass-through
    updateUser(id: string, data: UserInput) { return this.dao.update(id, data); } // pass-through
}
```

Deepening: move the validation and event emission (currently in the route handler) into the
service, so the service's interface (`createUser`) is narrower than its body (validate → insert →
emit event).

---

## 2. Tight Coupling

**Symptom:** Two modules that must change together. A change to module A forces a coordinated
change to module B. Often caused by shared mutable state, deep relative imports, or a shared
concrete class instead of an interface.

**Diagnostic:**

- Grep for imports of module B inside module A's directory and vice versa (bidirectional).
- Check `git log --oneline` for files in A and B that change in the same commits.
- Look for a concrete class shared across a package boundary (no interface seam).

**Deepening direction:** Introduce a seam — an interface, an event, or a DTO — so A depends on an
abstraction, not B's concrete implementation.

**Example:**

```typescript
// tight: the route handler imports the concrete DAO
import { UserDao } from '@gobing-ai/spur-domain';              // deep relative import across package
router.post('/users', async (c) => {
    const dao = new UserDao(c.env.db);                         // direct construction
    const user = await dao.insert(c.body);                     // no seam
});
```

Deepening: inject a `UserRepository` interface (owned by app, implemented by domain) so the route
handler depends on the abstraction, not the concrete DAO.

---

## 3. Wrong Seam

**Symptom:** The abstraction boundary is in the wrong place. Domain types leak across a transport
seam; a service imports a DAO directly instead of through a repository; config validation lives in
the HTTP layer instead of the config package.

**Diagnostic:**

- Draw the intended layer boundaries (e.g., `apps/server` → `packages/app` → `packages/domain`).
- Grep for imports that cross a boundary in the wrong direction (e.g., `packages/domain` importing
  from `apps/server`, or transport DTOs in `packages/contracts` containing domain types).
- Check for a service that returns a domain entity instead of a DTO.

**Deepening direction:** Move responsibility across the seam so the boundary matches the
dependency direction. Domain types stay in domain; transport DTOs stay in contracts; services
map between them.

**Example:**

```typescript
// wrong seam: a transport DTO contains a domain entity
// packages/contracts/src/users.ts
import { User } from '@gobing-ai/ts-db';                       // domain type in transport contract
export interface UserDto {
    user: User;                                                // domain leak
}
```

Deepening: define `UserDto` with primitive fields in `packages/contracts`; map `User → UserDto`
in the server handler. The contract no longer depends on domain.

---

## 4. Weak Locality

**Symptom:** Related logic is scattered across modules. A single responsibility (e.g., "user
creation") is spread across a route handler, a service, a DAO, a validator, an event emitter, and a
test factory — each with one line of the logic. Reading the feature requires opening six files.

**Diagnostic:**

- Pick a feature (a verb, e.g., "create user"). Grep for the feature name across the scope.
- If the implementation is spread across N files with no single module that owns the full
  flow, locality is weak.
- Check for "co-located by layer" (all routes together, all services together) instead of
  "co-located by feature."

**Deepening direction:** Co-locate by responsibility. Group the route, service, validator, and
event emitter for a feature into one module/directory so the full flow reads top-to-bottom.

**Example:**

```
src/
  routes/users.ts        // 1 line of createUser
  routes/orders.ts       // 1 line of createOrder
  services/users.ts      // 1 line of createUser
  services/orders.ts     // 1 line of createOrder
  dao/users.ts           // 1 line of insert
  dao/orders.ts          // 1 line of insert
```

Deepening: co-locate by feature —

```
src/
  users/
    route.ts             // full createUser flow
    service.ts
    dao.ts
  orders/
    route.ts
    service.ts
    dao.ts
```

---

## 5. Poor Test Surface

**Symptom:** Core logic can only be tested by standing up a large stack — a real database, a server,
a full request cycle. The logic isn't pure; it's entangled with I/O.

**Diagnostic:**

- Try to write a unit test for the core logic (the business rule, not the I/O).
- If the test requires a database, a server, or a mock of a large dependency graph, the test
  surface is poor.
- Look for a function that mixes pure logic with I/O (e.g., `async createUser` that both validates
  AND inserts AND emits an event).

**Deepening direction:** Extract the pure logic into a function with no I/O, and test that. Inject
the I/O (database, event bus) at the boundary.

**Example:**

```typescript
// poor surface: validate + insert + emit are entangled
export async function createUser(input: UserInput, db: Database, events: EventBus) {
    if (!input.email.includes('@')) throw new Error('invalid email');  // pure logic
    const user = await db.insert(input);                              // I/O
    await events.emit('user.created', user);                           // I/O
}
```

Deepening: extract the pure validator —

```typescript
export function validateUser(input: UserInput): void {
    if (!input.email.includes('@')) throw new Error('invalid email');  // pure, trivially testable
}
export async function createUser(input: UserInput, db: Database, events: EventBus) {
    validateUser(input);
    const user = await db.insert(input);
    await events.emit('user.created', user);
}
```

Now `validateUser` has a test surface independent of the stack.

---

## Applying the Signals

- **One module can hit multiple signals.** Record each as a separate candidate.
- **Signals compound.** A shallow module with tight coupling is worse than either alone; bump the
  severity one level.
- **Severity is contextual.** A shallow module in a hot path is `major`; the same module in a
  seldom-touched corner is `advisory`.
- **No signal hit is a good outcome.** Emit "No deepening candidates found in scope" — do not pad.