/**
 * Dabloon pricing, shared by the Worker (which charges and credits) and the
 * dashboard (which shows the same numbers before checkout).
 */

/** Off for launch: nobody can buy dabloons. Flip to true to reopen checkout. */
export const PURCHASES_ENABLED = false;

/** 1 dabloon per USD cent: 100 per $1 (so the 100-dabloon referral ≈ $1). */
export const DABLOONS_PER_CENT = 1;
/** Purchase bounds, in cents. */
export const MIN_USD_CENTS = 100; // $1
export const MAX_USD_CENTS = 50000; // $500

/** Bigger purchases earn extra dabloons. First matching tier wins. */
export const BONUS_TIERS = [
  { minUsdCents: 10000, percent: 10 }, // $100 or more
  { minUsdCents: 2000, percent: 5 }, // $20 or more
];

export function bonusPercent(usdCents: number): number {
  return BONUS_TIERS.find((t) => usdCents >= t.minUsdCents)?.percent ?? 0;
}

/** Dabloons credited for a purchase, bonus included (rounded down). */
export function dabloonsFor(usdCents: number): number {
  const base = usdCents * DABLOONS_PER_CENT;
  return base + Math.floor((base * bonusPercent(usdCents)) / 100);
}
