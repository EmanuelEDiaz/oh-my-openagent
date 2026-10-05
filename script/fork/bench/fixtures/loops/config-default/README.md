# posts

`createPost(input, env)` validates a post against limits and returns it.

Limits come from `DEFAULT_LIMITS` (`maxTags: 10`, `maxTitleLength: 40`), overridden by the environment:

- `MAX_TAGS`, `MAX_TITLE_LENGTH`: integers. `0` is a valid limit (e.g. `MAX_TAGS=0` forbids tags).
- An unset or non-numeric variable keeps the default.
