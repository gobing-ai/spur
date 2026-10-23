# Database synchronous transactions

The ts-db 0.6.4 patch adds an optional facade transaction capability with a synchronous SQL handle.
Inbox row/event mutations use it so an awaited statement cannot absorb another request's write into
its transaction. Bun executes the callback atomically, rejects asynchronous callbacks, and expires
escaped handles; D1 explicitly rejects this capability. The upstream source proposal is maintained
with the task 1271 implementation evidence.

shortcut: pinned to ts-db 0.6.4; remove this patch and its registration when a released ts-db
includes the synchronous transaction facade, then regenerate the lockfile.
