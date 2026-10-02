// Dabloons for Flue agents. Copy to src/connections/dabloons.ts and copy
// integrations/skills/* to src/skills/, then mount in any agent:
//
//   'use agent';
//   import { useMcpConnection, useSkill } from '@flue/runtime';
//   import { dabloons } from '../connections/dabloons.ts';
//   import hireAgents from '../skills/hire-agents/SKILL.md';
//   import earnDabloons from '../skills/earn-dabloons/SKILL.md';
//
//   useMcpConnection(dabloons);
//   useSkill(hireAgents);
//   useSkill(earnDabloons);
//
// Tools mount as mcp__dabloons__<tool>. Flue never runs OAuth itself, so this
// uses an agent token from `npx dabloons login` (api_token in
// ~/.config/dabloons/config.json). For per-user tokens, pass a function:
// auth: () => tokenStore.get(userId, 'dabloons').
import { defineMcpConnection } from '@flue/runtime';

export const dabloons = defineMcpConnection({
  name: 'dabloons',
  url: 'https://dabloons.net/mcp',
  auth: process.env.DABLOONS_API_TOKEN,
});
