# search queries

`buildQuery(options)` turns search options into a query object, starting from `DEFAULT_QUERY`
(`limit: 20`, no filters, newest first). `status` adds a status filter, `tenant` scopes the query to a tenant (see
`src/tenant.ts`) and `oldestFirst` flips the sort. Every call returns an independent query.
