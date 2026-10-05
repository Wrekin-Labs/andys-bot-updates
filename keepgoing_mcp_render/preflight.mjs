import { runDeploymentPreflight } from "./deployment_preflight.js";

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--") && !arg.includes("=")));
const releaseArg = process.argv.slice(2).find((arg) => arg.startsWith("--release="));
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
  requireWebhook: args.has("--webhook"),
  requireChallenge: args.has("--challenge"),
  expectedRelease: releaseArg ? releaseArg.slice("--release=".length) : null
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
