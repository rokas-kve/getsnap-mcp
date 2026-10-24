#!/usr/bin/env node
/**
 * getSnap.dev MCP server.
 *
 * Gives an agent eyes. The capture tools return the image itself as an
 * MCP image block rather than a URL, so a model can look at the page it
 * just asked for - "screenshot this and tell me what is broken" works
 * end to end, in one turn, with no fetch step in between.
 *
 * Every tool spends credits against the key in GETSNAP_API_KEY. The
 * cost is stated in each tool description, because an agent deciding
 * whether to call something should be able to see what it will cost.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VERSION = "1.14.3";
const API_KEY = process.env.GETSNAP_API_KEY;
const BASE_URL = process.env.GETSNAP_BASE_URL ?? "https://api.getsnap.dev";

/**
 * A base64 image this large costs more context than it is worth, and
 * some clients reject it outright. Past the ceiling the capture still
 * happened and is still on the CDN, so the tool returns the link and
 * says why - a smaller answer beats a failed one.
 */
const MAX_INLINE_BYTES = 1_500_000;

if (!API_KEY) {
  // stderr, not stdout: stdout is the JSON-RPC channel and anything
  // written there that is not a message corrupts the stream.
  console.error(
    "getsnap-mcp: GETSNAP_API_KEY is not set.\n" +
      "Get a free key (100 captures a month) at https://getsnap.dev\n" +
      'Then add it to your client config, e.g. "env": { "GETSNAP_API_KEY": "sk_live_..." }',
  );
  process.exit(1);
}

type Json = Record<string, unknown>;

async function api(path: string, body: Json): Promise<Json> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY! },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    throw new Error(`getSnap returned ${res.status} and a non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    // 402 is the one worth naming: it means the key works and the
    // quota does not, which is a different fix from a bad key.
    const msg = String(parsed.message ?? parsed.error ?? `HTTP ${res.status}`);
    throw new Error(res.status === 402 ? `Out of credits: ${msg}` : `getSnap ${res.status}: ${msg}`);
  }
  return parsed;
}

async function apiGet(path: string): Promise<Json> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "x-api-key": API_KEY! } });
  const parsed = (await res.json()) as Json;
  if (!res.ok) throw new Error(`getSnap ${res.status}: ${String(parsed.message ?? parsed.error)}`);
  return parsed;
}

/** Fetch a rendered capture back so it can be handed to the model. */
async function inlineImage(
  url: string,
  mimeType: string,
): Promise<{ type: "image"; data: string; mimeType: string } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_INLINE_BYTES) return null;
  return { type: "image", data: buf.toString("base64"), mimeType };
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const server = new McpServer({ name: "getsnap", version: VERSION });

// ---------------------------------------------------------------------
// capture_screenshot
// ---------------------------------------------------------------------
server.registerTool(
  "capture_screenshot",
  {
    title: "Capture a screenshot",
    description:
      "Render a URL in a real browser and return the image, so you can see the page. " +
      "Removes cookie banners and ad overlays by default. Costs 1 credit per call. " +
      "Use full_page for the whole scrollable page, or device to emulate a phone or tablet.",
    inputSchema: {
      url: z.string().url().describe("The page to capture"),
      format: z.enum(["png", "jpeg", "webp"]).default("png")
        .describe("jpeg is markedly smaller and usually enough to read a layout"),
      full_page: z.boolean().default(false).describe("Capture the whole scrollable page, not just the viewport"),
      device: z.enum(["desktop", "mobile", "tablet"]).default("desktop"),
      viewport_width: z.number().int().min(320).max(3840).optional(),
      viewport_height: z.number().int().min(200).max(2160).optional(),
      delay: z.number().int().min(0).max(10000).optional().describe("Extra wait in ms after load, for late content"),
      return_image: z.boolean().default(true)
        .describe("false returns only the CDN URL, which keeps a large capture out of the context window"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    const { return_image, format, ...rest } = args;
    const out = await api("/v1/screenshot", { ...rest, format, remove_popups: true, block_ads: true });
    const url = String(out.url);
    const cached = out.cached === true;
    const note = `${url}\n${cached ? "Served from cache - no credit spent." : "1 credit spent."}`;

    if (!return_image) return { content: [{ type: "text" as const, text: note }] };

    const img = await inlineImage(url, MIME[format] ?? "image/png");
    if (!img) {
      return {
        content: [{
          type: "text" as const,
          text: `${note}\n\nThe image was too large to inline (over ${Math.round(MAX_INLINE_BYTES / 1e6)}MB). ` +
            "It is at the URL above. Re-run with format \"jpeg\", a smaller viewport, or full_page off to get it inline.",
        }],
      };
    }
    return { content: [img, { type: "text" as const, text: note }] };
  },
);

// ---------------------------------------------------------------------
// capture_pdf
// ---------------------------------------------------------------------
server.registerTool(
  "capture_pdf",
  {
    title: "Capture a page as PDF",
    description:
      "Render a URL to PDF and return a link to it. Costs 1 credit per call. " +
      "A PDF cannot be shown to you inline - use capture_screenshot if you need to read the page yourself.",
    inputSchema: {
      url: z.string().url().describe("The page to render"),
      full_page: z.boolean().default(true),
      delay: z.number().int().min(0).max(10000).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    const out = await api("/v1/screenshot", { ...args, format: "pdf", remove_popups: true, block_ads: true });
    return {
      content: [{
        type: "text" as const,
        text: `PDF: ${out.url}\n${out.cached === true ? "Served from cache - no credit spent." : "1 credit spent."}`,
      }],
    };
  },
);

// ---------------------------------------------------------------------
// compare_pages
// ---------------------------------------------------------------------
server.registerTool(
  "compare_pages",
  {
    title: "Compare two pages visually",
    description:
      "Capture two URLs and compare them pixel by pixel. Returns a similarity score and an overlay " +
      "image marking what changed, which you can look at. Costs 2 credits - it launches a browser per URL. " +
      "Use for staging against production, or a page before and after a change.",
    inputSchema: {
      before_url: z.string().url(),
      after_url: z.string().url(),
      full_page: z.boolean().default(false),
      threshold: z.number().min(0).max(1).default(0.1)
        .describe("Per-pixel colour tolerance. Higher ignores more, e.g. antialiasing differences."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ before_url, after_url, full_page, threshold }) => {
    const out = await api("/v1/diff", {
      before: { url: before_url, full_page },
      after: { url: after_url, full_page },
      threshold,
    });
    const pct = typeof out.similarity === "number" ? (out.similarity * 100).toFixed(2) : "?";
    const summary =
      `Similarity: ${pct}%\n` +
      `Pixels changed: ${String(out.diff_pixels ?? "?")}\n` +
      `Before: ${String(out.before_url ?? "?")}\nAfter: ${String(out.after_url ?? "?")}\n` +
      `Overlay: ${String(out.diff_url ?? "?")}\n2 credits spent.`;

    const overlay = typeof out.diff_url === "string" ? await inlineImage(out.diff_url, "image/png") : null;
    return overlay
      ? { content: [overlay, { type: "text" as const, text: summary }] }
      : { content: [{ type: "text" as const, text: summary }] };
  },
);

// ---------------------------------------------------------------------
// audit_accessibility
// ---------------------------------------------------------------------
server.registerTool(
  "audit_accessibility",
  {
    title: "Audit a page for accessibility problems",
    description:
      "Run axe-core against a URL in a real browser and return WCAG 2.0/2.1/2.2 violations by severity, " +
      "with the elements responsible. Costs 1 credit per call. " +
      "Returns structured findings rather than an image, so you can act on them directly.",
    inputSchema: {
      url: z.string().url(),
      max_violations: z.number().int().min(1).max(100).default(20)
        .describe("Cap on violations returned, so a bad page does not flood the context"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_violations }) => {
    const out = await api("/v1/audit", { url });
    const violations = Array.isArray(out.violations) ? out.violations : [];
    if (violations.length === 0) {
      return { content: [{ type: "text" as const, text: `No axe-core violations found on ${url}.\n1 credit spent.` }] };
    }
    const shown = violations.slice(0, max_violations) as Array<Record<string, unknown>>;
    const lines = shown.map((v) => {
      const nodes = Array.isArray(v.nodes) ? v.nodes.length : 0;
      return `[${String(v.impact ?? "unknown").toUpperCase()}] ${String(v.id)}: ${String(v.help ?? "")}` +
        ` (${nodes} element${nodes === 1 ? "" : "s"})`;
    });
    const omitted = violations.length - shown.length;
    return {
      content: [{
        type: "text" as const,
        text:
          `${violations.length} violation${violations.length === 1 ? "" : "s"} on ${url}:\n\n` +
          lines.join("\n") +
          (omitted > 0 ? `\n\n... and ${omitted} more (raise max_violations to see them).` : "") +
          "\n\n1 credit spent.",
      }],
    };
  },
);

// ---------------------------------------------------------------------
// check_usage
// ---------------------------------------------------------------------
server.registerTool(
  "check_usage",
  {
    title: "Check remaining credits",
    description: "How many credits are used and remaining on this key this period. Free - spends no credit.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    const out = await apiGet("/v1/usage");
    const used = Number(out.used ?? 0);
    const limit = Number(out.limit ?? 0);
    return {
      content: [{
        type: "text" as const,
        text: `Plan: ${String(out.plan ?? "?")}\nUsed: ${used} of ${limit}\nRemaining: ${Math.max(0, limit - used)}\nPeriod: ${String(out.period ?? "?")}`,
      }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
