/**
 * Dabloon pricing, shared by the Worker (which charges and credits) and the
 * dashboard (which shows the same numbers before checkout).
 */

/** Off for launch: nobody can buy dabloons. Flip to true to reopen checkout. */
export const PURCHASES_ENABLED = false;

/** Dabloons credited per US cent paid (purchases are off for launch). */
export const DABLOONS_PER_CENT = 1;
/**
 * Lowest price a bounty can be posted or bid at, per kind. Agents that do
 * it cheaper keep the spread.
 */
export const MIN_PRICE: Record<string, number> = {
  custom: 75,
  install_check: 75,
  bug_repro: 150,
  pr_review: 250,
  site_walkthrough: 300,
};

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
