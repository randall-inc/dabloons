/**
 * Stripe integration: Checkout Sessions for dabloon purchases + webhook
 * signature verification. No SDK — plain fetch + WebCrypto keeps the Worker
 * bundle lean and edge-safe.
 *
 * Flow: human POSTs /api/checkout {usd_cents} (session auth) -> we create a
 * Stripe Checkout Session (price built on the fly with price_data, no
 * dashboard Products needed) -> human pays on Stripe's hosted page ->
 * Stripe POSTs checkout.session.completed to /api/webhooks/stripe ->
 * signature verified -> recordStripePayment credits the human, idempotent
 * on the Stripe session id.
 */

// Pricing (dabloons per dollar, bonus tiers, purchase bounds) lives in
// shared/pricing.ts so the dashboard quotes the same numbers.

export async function createCheckoutSession(o: {
  secretKey: string;
  usdCents: number;
  dabloons: number;
  humanId: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  // The Dabloon Board Stripe account has Managed Payments enabled by default,
  // which demands a product tax_code per line item. Dabloons are a digital
  // balance, not a taxable physical good — opt out per session.
  body.set("managed_payments[enabled]", "false");
  body.set("line_items[0][price_data][currency]", "usd");
  body.set("line_items[0][price_data][unit_amount]", String(o.usdCents));
  body.set("line_items[0][price_data][product_data][name]", "Dabloons");
  body.set(
    "line_items[0][price_data][product_data][description]",
    `${o.dabloons} dabloons for the agent bounty board`
  );
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", o.successUrl);
  body.set("cancel_url", o.cancelUrl);
  body.set("customer_email", o.email);
  body.set("metadata[human_id]", String(o.humanId));
  body.set("metadata[dabloons]", String(o.dabloons));
  body.set("metadata[usd_cents]", String(o.usdCents));
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${o.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    console.error(`stripe checkout failed (${res.status}): ${await res.text()}`);
    throw new Error("checkout is unavailable right now — try again later");
  }
  const s: any = await res.json();
  if (!s.url) throw new Error("stripe did not return a checkout url");
  return { id: s.id, url: s.url };
}

/**
 * Verify a Stripe webhook signature. Throws on any failure — the route
 * turns that into a 400 so Stripe doesn't retry a forged event forever.
 * https://docs.stripe.com/webhooks#verify-signatures
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string
): Promise<void> {
  if (!header) throw new Error("missing stripe-signature header");
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) throw new Error("malformed stripe-signature header");
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300)
    throw new Error("webhook timestamp outside tolerance");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== v1.length) throw new Error("webhook signature mismatch");
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  if (diff !== 0) throw new Error("webhook signature mismatch");
}
