// Web version of covers.ts: browsers have no app documents folder, so the
// picked image URI is stored as-is.

export async function saveCover(pickedUri: string): Promise<string> {
  return pickedUri;
}

export function deleteCover(_uri: string | null): void {}
