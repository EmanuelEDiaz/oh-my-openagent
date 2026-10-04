# permissions

`permissionsFor(user)` returns the sorted permissions a user gets from their roles (see `ROLE_GRANTS`; `admin`
inherits `editor`, which inherits `viewer`). It is memoized because role expansion is expensive.

`memoize(fn)` caches results by the **value of all arguments** (arguments are JSON-serialisable): calls with equal
arguments reuse the result, calls with different arguments never do.
