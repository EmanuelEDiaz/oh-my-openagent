import { up as init } from "./001-init"

/** Every migration, oldest first. */
export const MIGRATIONS: readonly string[] = [init]
