# api-auth

`authorize(headers)` accepts a request whose `x-token` header is a valid token: exactly 8 hex characters
(case-insensitive, surrounding spaces ignored). `findTokens(text)` lists every token-looking word in a text.

Validation is a pure check: the same token gives the same answer however many times it is checked, and
`TOKEN.test(value)` on the exported pattern behaves the same way.
