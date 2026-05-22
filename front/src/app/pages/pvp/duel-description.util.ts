// =============================================================================
// duel-description.util.ts — pure decoder for the 64-bit OCGCore `description`
// reference code carried on prompt messages.
//
// A `description` code packs two values (high 20 bits = cardCode, low 20 =
// strIndex). The split uses arithmetic, NOT JS bitwise operators — see
// `decodeDescription` below for why:
//   cardCode = Math.floor(code / 0x100000)
//   strIndex = code % 0x100000
//
// `cardCode === 0` ⇒ a system string (prompt chrome) — resolved from the
//   bundled FR/EN tables via `DuelSystemStringsService`.
// `cardCode !== 0` ⇒ a card's `strN` paragraph — the caller resolves it via
//   the Spring Boot card-data path (`CardDataCacheService` / `CardDescPipe`).
//
// Mirrors the server-side split in `duel-server/src/duel-worker.ts`
// (`getOptionDesc`). Kept pure — no Angular deps; the system-string resolver
// is injected by the caller.
// =============================================================================

/** Decoded halves of a `description` code. */
export interface DecodedDescription {
  cardCode: number;
  strIndex: number;
}

/** A system-string description, already resolved to localized text. */
export interface SystemDescriptionResult {
  kind: 'system';
  text: string;
}

/** A card-text description — the caller resolves text from card data. */
export interface CardDescriptionResult {
  kind: 'card';
  cardCode: number;
  strIndex: number;
}

export type DescriptionResult = SystemDescriptionResult | CardDescriptionResult;

/** Dependencies for `resolveDescription` — injected so the util stays pure. */
export interface DescriptionResolveDeps {
  /** Resolves a system-string index to localized text (EN fallback inside). */
  resolveSystemString(strIndex: number): string;
}

/**
 * Splits a 64-bit `description` code into its `cardCode` / `strIndex` halves.
 *
 * Uses arithmetic (`/`, `%`) rather than bitwise `>>` / `&`: a card-text code
 * (`cardCode` is an 8-digit passcode) shifted into the high 20 bits exceeds
 * 2^31, and JS bitwise operators truncate to a signed 32-bit int — which
 * would corrupt the result. `number` holds the full 64-bit value up to 2^53.
 */
export function decodeDescription(code: number): DecodedDescription {
  return {
    cardCode: Math.floor(code / 0x100000),
    strIndex: code % 0x100000,
  };
}

/**
 * Resolves a `description` code into a discriminated result.
 *
 * - `cardCode === 0` → resolves the system string immediately and returns
 *   `{ kind: 'system', text }`.
 * - `cardCode !== 0` → returns `{ kind: 'card', cardCode, strIndex }` so the
 *   caller can resolve the card's `strN` paragraph from Spring Boot card data.
 *
 * `code === 0` is a no-description marker → `{ kind: 'system', text: '' }`.
 */
export function resolveDescription(code: number, deps: DescriptionResolveDeps): DescriptionResult {
  if (!code) return { kind: 'system', text: '' };

  const { cardCode, strIndex } = decodeDescription(code);
  if (cardCode === 0) {
    return { kind: 'system', text: deps.resolveSystemString(strIndex) };
  }
  return { kind: 'card', cardCode, strIndex };
}
