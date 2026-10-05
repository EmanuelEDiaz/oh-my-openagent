/** A whole value that is a token. */
export const TOKEN = /^[a-f0-9]{8}$/gi

/** Token-looking words inside a longer text. */
export const TOKEN_ANYWHERE = /\b[a-f0-9]{8}\b/gi
