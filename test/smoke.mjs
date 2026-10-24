/**
 * Does the built server actually speak MCP?
 *
 * tsc proves it compiles, which is not the same thing. This starts
 * dist/index.js over stdio with a real MCP client and asserts the
 * handshake completes and every expected tool is advertised - the
 * check that would have caught a broken transport or a tool that
 * failed to register.
 *
 * A capture is not exercised: that needs a live API key and spends a
 * credit, so it stays a manual step.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

const EXPECTED = [
  "capture_screenshot", "capture_pdf", "compare_pages",
  "audit_accessibility", "check_usage",
];

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  // The server exits immediately without a key; this one is never used
  // for a request, only to get past that guard.
  env: { ...process.env, GETSNAP_API_KEY: "sk_live_smoke_test_only" },
});

const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
assert.deepEqual(names, [...EXPECTED].sort(), `tools advertised: ${names.join(", ")}`);

for (const t of tools) {
  assert.ok(t.description && t.description.length > 20, `${t.name} has no useful description`);
  assert.ok(t.inputSchema, `${t.name} has no input schema`);
}

await client.close();
console.log(`ok - handshake completed, ${tools.length} tools advertised with schemas`);
