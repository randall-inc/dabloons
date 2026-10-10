import { render } from "@react-email/components";
import { SignInCode } from "./emails/sign-in-code.tsx";

/**
 * Sends the branded sign-in code email through Resend. The idempotency key
 * (Neon's event id) makes Neon's webhook retries send it once.
 */
export async function sendSignInCode(
  apiKey: string,
  opts: { to: string; code: string; expiresAt?: string; idempotencyKey: string },
  now = Date.now()
) {
  const left = opts.expiresAt ? Date.parse(opts.expiresAt) - now : NaN;
  const expiresInMinutes = Number.isFinite(left) ? Math.max(1, Math.round(left / 60_000)) : 5;
  const html = await render(SignInCode({ code: opts.code, expiresInMinutes }));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": opts.idempotencyKey,
    },
    body: JSON.stringify({
      from: "Dabloons <login@mail.dabloons.net>",
      to: [opts.to],
      subject: `${opts.code} is your Dabloons code`,
      html,
      text: `Your Dabloons sign-in code is ${opts.code}. It works for ${expiresInMinutes} minutes. If you didn't try to sign in, you can ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
