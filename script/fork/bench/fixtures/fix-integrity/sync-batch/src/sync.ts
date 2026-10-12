export type Item = { readonly id: string; readonly body: string }
export type Upload = (item: Item) => Promise<void>
export type SyncResult = { readonly uploaded: string[]; readonly failed: { readonly id: string; readonly reason: string }[] }

export async function syncAll(items: readonly Item[], upload: Upload): Promise<SyncResult> {
  const uploaded: string[] = []
  for (const item of items) {
    await upload(item)
    uploaded.push(item.id)
  }
  return { uploaded, failed: [] }
}
