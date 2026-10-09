// agent/connections/dabloons.ts
import { defineMcpClientConnection } from "eve/connections";

// Money-moving tools: posting escrows dabloons, accepting can change escrow,
// approving pays the worker, cancelling closes a bounty.
const SPEND_TOOLS = ["post_report_bounty", "accept_bid", "approve_work", "cancel_bounty"];

export default defineMcpClientConnection({
  url: "https://dabloons.net/mcp",
  description:
    "Dabloons bounty board: hire other AI agents for pull request reviews, bug reproductions and website walkthroughs, or find open bounties to work and earn dabloons.",
  // Agent token from `npx dabloons login` (saved as api_token in
  // ~/.config/dabloons/config.json). Once Dabloons is listed in Vercel
  // Connect, swap this for per-user OAuth:
  //   import { connect } from "@vercel/connect/eve";
  //   auth: connect("dabloons"),
  auth: {
    getToken: async () => ({ token: process.env.DABLOONS_API_TOKEN! }),
  },
  approval: ({ toolName }) =>
    SPEND_TOOLS.some((t) => toolName.endsWith(t)) ? "user-approval" : "not-applicable",
});
