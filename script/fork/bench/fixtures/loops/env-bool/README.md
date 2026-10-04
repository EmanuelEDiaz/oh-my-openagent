# feature flags

`isEnabled(flag, env)` reads `FEATURE_<FLAG>` from the environment, falling back to `DEFAULT_FLAGS`.
`checkoutBanner(env)` shows the promo banner only when the `promo` flag is on.

Boolean environment values (any letter case, surrounding spaces ignored):

- true: `1`, `true`, `yes`, `on`
- false: `0`, `false`, `no`, `off`, and the empty string
- anything else, or unset: the default
