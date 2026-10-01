import { runDeploymentPreflight } from "./deployment_preflight.js";

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const baseUrl = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ||
  process.env.KEEPGOING_PUBLIC_BASE_URL ||
  "https://keepgoing-mcp.onrender.com";

const result = await runDeploymentPreflight({
  baseUrl,
  requireSellReady: args.has("--sell-ready"),
  requireV12: args.has("--v12"),
  requireToolProfiles: args.has("--tool-profiles"),
  requireGithubWorker: args.has("--github-worker"),
  requireRelayProfiles: args.has("--relay-profiles"),
  requireChallenge: args.has("--challenge"),
  requireWebhook: args.has("--webhook"),
  expectedCommit: [...args].find(arg => arg.startsWith("--commit="))?.slice(9) || null
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
