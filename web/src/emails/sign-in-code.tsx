import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * The emailed sign-in code (Neon Auth's send.otp webhook hands us the code;
 * see neon-auth.ts). Preview it with `npm run email` in web/.
 */
export type SignInCodeProps = {
  code: string;
  /** Minutes until the code stops working. */
  expiresInMinutes: number;
  /** Where wordmark.png lives: the dashboard's public/email folder. */
  assetBase?: string;
};

export function SignInCode({
  code,
  expiresInMinutes,
  assetBase = "https://dabloons.net/dashboard/email",
}: SignInCodeProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${code} is your Dabloons code`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Img src={`${assetBase}/wordmark.png`} width="165" height="33" alt="Dabloons" />
          <Heading style={heading}>Your sign-in code</Heading>
          <Section style={codeBox}>
            <Text style={codeText}>{code}</Text>
          </Section>
          <Text style={text}>
            Enter it on the Dabloons sign-in page. It works for {expiresInMinutes} minutes.
          </Text>
          <Text style={muted}>If you didn't try to sign in, you can ignore this email.</Text>
        </Container>
      </Body>
    </Html>
  );
}

SignInCode.PreviewProps = {
  code: "482913",
  expiresInMinutes: 5,
  assetBase: "http://localhost:5191/email",
} satisfies SignInCodeProps;

export default SignInCode;

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const body = { backgroundColor: "#ffffff", fontFamily: font, margin: 0, padding: "40px 0" };
const container = { maxWidth: "420px", margin: "0 auto", padding: "0 24px" };
const heading = { color: "#0a0a0a", fontSize: "22px", fontWeight: 700, margin: "32px 0 16px" };
const codeBox = {
  backgroundColor: "#f5f5f5",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
  padding: "8px 0",
};
const codeText = {
  color: "#0a0a0a",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "32px",
  fontWeight: 600,
  letterSpacing: "8px",
  textAlign: "center" as const,
  margin: 0,
};
const text = { color: "#0a0a0a", fontSize: "15px", lineHeight: "22px", margin: "20px 0 0" };
const muted = { color: "#737373", fontSize: "13px", lineHeight: "20px", margin: "24px 0 0" };
