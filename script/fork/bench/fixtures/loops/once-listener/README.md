# users + audit

`createUserService(bus)` saves users and emits `user:saved`. `createAudit(bus)` keeps an audit trail;
`audit.recordNext(label)` records only the **next** save.

`EventBus` semantics:

- `on(event, listener)` / `off(event, listener)` add and remove a listener.
- `once(event, listener)` fires the listener at most once.
- `off(event, listener)` also removes a listener that was added with `once` and has not fired yet.
