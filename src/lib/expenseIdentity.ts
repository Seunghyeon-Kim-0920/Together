/** Preserve the same opaque identity across export, forwarding, and reimport. */
export function publicExpenseId(ledgerId: string, expenseId: string): string {
  if (/^shared-[0-9a-f]{16}$/.test(expenseId)) return expenseId;
  return legacyPublicExpenseId(ledgerId, expenseId);
}

/** v1.3.1 hashed an already shared id again while importing a share file.
 * Keep this exact algorithm only for matching those existing local rows. */
export function legacyPublicExpenseId(ledgerId: string, expenseId: string): string {
  const value = `${ledgerId}\u0000${expenseId}`;
  let left = 0x811c9dc5; let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
    right ^= right >>> 13;
  }
  return `shared-${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}
