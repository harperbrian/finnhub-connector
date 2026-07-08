# Finnhub MCP Connector

A custom [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects Claude to [Finnhub's](https://finnhub.io) live stock-market API. It exposes three tools to an MCP client:

- **Real-time quote lookup** — current price and daily change for a ticker
- **Company profile lookup** — company metadata for a ticker
- **Batch watchlist checker** — checks a list of tickers and flags any that have dropped more than a configurable percentage

Built in TypeScript/Node.js on the official MCP SDK, communicating with Claude Desktop over stdio and calling Finnhub's REST API with API-key authentication.

> **Note:** This is a personal learning project built to practice MCP server development and, deliberately, robust API error handling. The failure scenarios below were intentionally induced (or discovered) during testing.

---

## Why this project exists

Connecting an LLM to an external API is easy when everything works. The interesting engineering is in what happens when it *doesn't* — and specifically, in recognizing that a successful HTTP response is **not** the same as valid data. This connector was built to handle four distinct failure modes cleanly, not just the happy path.

## Error handling — the actual point

| Scenario | HTTP status | How it's handled |
|---|---|---|
| **Bad / corrupted API key** | `401` | Caught before JSON parsing; surfaced as a specific, actionable error instead of crashing. |
| **Rate limit exceeded** | `429` | Retry-with-backoff (3 attempts, 15s apart), logged per attempt; fails the *single* affected symbol gracefully while the rest of the batch completes. |
| **Delisted / invalid ticker** | `200` ⚠️ | The subtle one: Finnhub returns `200 OK` with all fields **zeroed** rather than an error. Explicit validation detects this pattern and returns a clear message instead of a misleading `$0.00` quote. |
| **Normal request** | `200` | Parsed and returned. |

The third row is the one that matters most: **transport-layer success doesn't guarantee application-layer validity.** A connector that trusts the HTTP status alone would have surfaced a delisted stock as a real $0.00 quote. This one catches it.

### Failure walkthroughs

**401 — Authentication.** I corrupted the key in `.env` to test the auth path. Finnhub returned `401`; the code caught it before attempting to parse the (non-JSON) error body and reported a specific cause. Root-caused to the bad key value, replaced from the Finnhub dashboard, confirmed recovery.

**429 — Rate limiting.** I sent a 98-symbol batch through the watchlist tool to intentionally exceed Finnhub's free-tier limit of 60 calls/minute. Call #59 hit a `429`; the retry logic attempted 3 backoff retries, logged each, then failed *only that symbol* while the other 97 completed — no full-batch crash.

**200-with-bad-data — Silent failure.** Discovered during testing, not engineered. A delisted ticker (formerly PNM Resources, acquired by Avangrid) returned `200 OK` with every field zeroed. Added explicit validation to detect and report this instead of returning a misleading quote.

**Project structure.** Originally scaffolded with source files in a `src/` subfolder; later flattened to a single-directory layout for simplicity. This required updating `tsconfig.json`'s `rootDir` and `include` paths to match — a reminder that build configs need to stay in lockstep with actual file layout, not just get written once and forgotten.

---

## Tools

| Tool | Description |
|---|---|
| `get_quote` | Real-time quote (price, change, %) for a single ticker. |
| `get_company_profile` | Company profile / metadata for a ticker. |
| `check_watchlist` | Batch-checks a list of tickers; flags any down more than a configurable threshold (default 2%). |

---

## Setup

Follow these steps in order. No prior experience with APIs is assumed — each step says exactly what to do and how to tell it worked. Instructions cover both **Mac** and **Windows**.

### What you'll need first

- **Claude Desktop.** This is the app that actually runs and talks to this connector — download it from [claude.ai/download](https://claude.ai/download) for Mac or Windows, install it, and sign in.
- **Node.js** version 18 or newer.
  - Open a terminal (**Terminal** on Mac, **PowerShell** on Windows) and type `node --version`. If you see `v18.17.0` or higher, you're set. If not, install from [nodejs.org](https://nodejs.org) — pick the **LTS** version.
- **Git.** Check with `git --version`.
  - Mac usually has it built in. On Windows, if it's missing, install from [git-scm.com/download/win](https://git-scm.com/download/win) using the default options.
- **A free Finnhub account** — this is where your API key comes from. The next section walks you through it.

> **Windows note:** if `npm install` fails with an error like *"running scripts is disabled on this system,"* PowerShell is blocking npm's script by default — a standard Windows security setting, not a problem with this project. Fix it once with:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```
> Confirm with `Y`, then retry `npm install`.

### Step 1 — Get your free Finnhub API key

An "API key" is like a password that lets this program ask Finnhub for stock data. Finnhub gives one out free.

1. Go to [finnhub.io](https://finnhub.io) and click **Get free API key** (or **Sign up**).
2. Create an account with your email and confirm it if asked.
3. After you log in, you land on your **Dashboard**. Your API key is shown there — a long string of letters and numbers.
4. Copy that key. Keep it private, like a password — don't paste it into emails, screenshots, or public places.

The free plan allows 60 requests per minute, which is plenty for this tool.

### Step 2 — Download the project

In your terminal, run these three lines one at a time:

```bash
git clone https://github.com/harperbrian/finnhub-connector.git
cd finnhub-connector
npm install
```

- The first line copies the project to your computer.
- The second moves you into the project folder.
- The third downloads the pieces the project needs to run. This can take a minute; it's done when you get your normal terminal prompt back.

### Step 3 — Add your key

The project includes a file called `.env.example` that shows the key format. You'll make your own copy called `.env` and put your real key in it.

Copy the example file:

- **Mac/Linux:** `cp .env.example .env`
- **Windows:** `copy .env.example .env`

Now open the new `.env` file in any text editor. You'll see this line:

```
FINNHUB_API_KEY=your_finnhub_api_key_here
```

Replace `your_finnhub_api_key_here` with the key you copied in Step 1, so it looks like:

```
FINNHUB_API_KEY=abc123yourrealkey456
```

Save the file. **Your `.env` file stays on your computer only — it is never uploaded to GitHub** (a `.gitignore` rule blocks it), so your key stays private.

### Step 4 — Test that it works

Run:

```bash
npm start
```

**Success looks like this line appearing:**

```
Finnhub MCP connector running — waiting for Claude Desktop...
```

That means your key loaded and the server started. Press `Ctrl+C` to stop it.

If you instead see `FATAL: FINNHUB_API_KEY is missing`, your `.env` file either isn't in the folder or the key line has a typo. Recheck Step 3.

### Step 5 — Connect it to Claude Desktop

This last step tells the Claude Desktop app how to find and run your server.

**First, find your project's full path** (you'll need it below):

- **Mac/Linux:** inside the project folder, run `pwd`
- **Windows:** inside the project folder, run `cd` with no arguments

**Then open Claude Desktop's config file** (create it if it doesn't exist):

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json` — paste that into File Explorer's address bar to jump straight to the folder.

**Paste in the config, using your own path from above.**

Mac/Linux example:

```json
{
  "mcpServers": {
    "finnhub": {
      "command": "npx",
      "args": ["tsx", "/Users/yourname/finnhub-connector/index.ts"]
    }
  }
}
```

Windows example — note the **doubled backslashes** (`\\`). This is required because JSON treats a single backslash as a special escape character; a single `\` will silently break the path:

```json
{
  "mcpServers": {
    "finnhub": {
      "command": "npx",
      "args": ["tsx", "C:\\Users\\yourname\\finnhub-connector\\index.ts"]
    }
  }
}
```

> **Tip for finding the full path:** in your terminal, inside the project folder, run `pwd` (Mac) or `cd` with no arguments (Windows, in PowerShell) — it prints the full folder path. Add `/index.ts` (Mac) or `\index.ts` (Windows) to the end.

**Save the file and fully restart Claude Desktop.** Quit it completely — not just closing the window. On Mac, use the **Claude** menu → **Quit Claude**. On Windows, right-click the Claude icon in the system tray and choose **Quit**, or go to **File** → **Exit**. Then reopen it.

The three tools will now be available. Try asking:

- *"What's Apple's current stock price?"*
- *"Check my watchlist: AAPL, TSLA, NVDA — flag anything down more than 2% today."*

---

## Tech stack

TypeScript · Node.js · MCP SDK (`@modelcontextprotocol/sdk`) · Zod (input validation) · tsx · Finnhub REST API · stdio transport

## What this project demonstrates

- API-key authentication handling
- HTTP status-code discrimination (`401` / `403` / `429` / `200`-with-bad-data)
- Retry / backoff design that degrades gracefully instead of crashing
- Recognizing that transport-layer success ≠ application-layer validity

## License

MIT — see [LICENSE](LICENSE).
