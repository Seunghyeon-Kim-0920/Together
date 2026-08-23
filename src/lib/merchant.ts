const CARD_PROVIDER_PREFIX = /^(?:\[(?:revolut|swile|travel\s*wallet|트래블\s*월렛)\]|(?:revolut|swile|travel\s*wallet|트래블\s*월렛))\s*(?:[·•|:—–-]\s*)+/iu;
const IMPORTED_PROVIDER_ID = /^(?:revolut|swile|travelwallet)[-_:]/iu;

/**
 * Hides a card-provider label added by an importer while keeping the stored
 * description untouched. A separator is required so real merchants such as
 * "Revolut Café" are not changed.
 */
export function merchantDisplayName(description: string, expenseId?: string): string {
  if (!expenseId || !IMPORTED_PROVIDER_ID.test(expenseId)) return description;
  const display = description.replace(CARD_PROVIDER_PREFIX, "").trim();
  return display || description;
}

/** Keep the raw imported value when the user submits the unchanged display name. */
export function preserveImportedMerchantDescription(original: string, editedDisplay: string, expenseId?: string): string {
  const edited = editedDisplay.trim();
  return edited === merchantDisplayName(original, expenseId) ? original : edited;
}
