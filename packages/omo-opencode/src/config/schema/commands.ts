import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
 "goal",
 "refactor",
 "ulw-execute",
 "stop-continuation",
 "omo-team-merge",
 "omo-resume",
 "remove-ai-slops",
 "hyperplan",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
