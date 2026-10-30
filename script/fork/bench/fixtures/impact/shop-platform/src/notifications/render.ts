/** Fills every `{{name}}`; a placeholder without a value is an error, so no email goes out half-filled. */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name]
      if (value === undefined) throw new Error(`template value missing: ${name}`)
      return value
    })
    .trimEnd()
}
