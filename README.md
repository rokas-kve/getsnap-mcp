# getsnap-mcp

Official [MCP](https://modelcontextprotocol.io) server for
[getSnap.dev](https://getsnap.dev). Gives Claude and other agents the
ability to capture a web page, compare two pages and audit one for
accessibility.

The capture tools return **the image itself**, not a link to it. A model
can look at the page it just asked for, so "screenshot this and tell me
what's broken" works in a single turn.

## Install

No install step. Your client runs it with `npx`.

Get a free API key at [getsnap.dev](https://getsnap.dev) — 100 captures
a month, no card.

### Claude Code

```bash
claude mcp add getsnap --env GETSNAP_API_KEY=sk_live_... -- npx -y getsnap-mcp
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "getsnap": {
      "command": "npx",
      "args": ["-y", "getsnap-mcp"],
      "env": { "GETSNAP_API_KEY": "sk_live_..." }
    }
  }
}
```

The same block works in any client that speaks MCP over stdio.

## Tools

| Tool | Credits | Returns |
|---|---|---|
| `capture_screenshot` | 1 | The image, inline |
| `capture_pdf` | 1 | A link — a PDF can't be shown to a model |
| `compare_pages` | 2 | Similarity score + the diff overlay, inline |
| `audit_accessibility` | 1 | WCAG violations by severity |
| `check_usage` | 0 | Credits used and remaining |

Cookie banners and ad overlays are removed by default on captures.
Cached responses cost nothing and say so.

### Things worth knowing

**Large images are not inlined.** Past about 1.5 MB the capture still
happened and is still on the CDN, so the tool returns the link and says
why. A `full_page` capture of a long page will usually hit this — pass
`format: "jpeg"` or `full_page: false` to get it inline instead.

**Every capture spends a credit**, so each tool description states its
cost. An agent deciding whether to call something should be able to see
what it will cost before it does.

**`compare_pages` costs 2**, because it launches a browser per URL.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `GETSNAP_API_KEY` | yes | — |
| `GETSNAP_BASE_URL` | no | `https://api.getsnap.dev` |

Without a key the server exits immediately with a message explaining
where to get one, rather than starting and failing on first use.

## Examples

Once connected, ask your agent in plain language:

- *"Screenshot stripe.com on mobile and tell me if anything overlaps."*
- *"Compare our staging site against production and show me what moved."*
- *"Audit example.com for accessibility and list the critical failures."*
- *"How many getSnap credits do I have left?"*

## Links

- [API documentation](https://getsnap.dev/docs/)
- [Pricing](https://getsnap.dev/screenshot-api-pricing.html)
- [Node SDK](https://www.npmjs.com/package/getsnap) · [Python SDK](https://pypi.org/project/getsnap/)

## Versioning

This package versions independently of the getSnap REST API and the
Node and Python SDKs. It shared their number until 1.14.3, when it
moved out of the API monorepo into this repository; from here it moves
on its own schedule.

MIT licensed. Issues to support@getsnap.dev.
