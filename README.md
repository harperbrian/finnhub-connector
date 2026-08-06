# Finnhub MCP Connector

A custom [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects Claude to [Finnhub's](https://finnhub.io) live stock market API. It exposes three tools to an MCP client:

- **Real-time quote lookup.** Current price and daily change for a ticker.
- **Company profile lookup.** Company metadata for a ticker.
- **Batch watchlist checker.** Checks a list of tickers and flags any that dropped more than a configurable percentage.

Built in TypeScript and Node.js on the official MCP SDK. It talks to Claude Desktop over stdio and calls Finnhub's REST API with API key authentication.

> **Note:** This is a personal learning project built to practice MCP server development and robust API error handling. I induced or discovered the failure scenarios below during testing.

---

## Why this project exists

Connecting an LLM to an external API is easy when everything works. The real engineering happens when it doesn't. A successful HTTP response is not the same thing as valid data. I built this connector to handle four distinct failure modes cleanly, past the happy path.

## Error handling

| Scenario | HTTP status | How it's handled |
|---|---|---|
| Bad or corrupted API key | `401` | Caught before JSON parsing. Surfaces a specific, actionable error instead of crashing. |
| Rate limit exceeded | `429` | Retries with backoff (3 attempts, 15s apart), logs each attempt, fails the single affected symbol while the rest of the batch completes. |
| Delisted or invalid ticker | `200` ⚠️ | Finnhub returns `200 OK` with every field zeroed instead of an error. Explicit validation catches this and returns a clear message instead of a misleading $0.00 quote. |
| Normal request | `200` | Parsed and returned. |

The third row matters most. Transport-layer success doesn't guarantee application-layer validity. A connector that trusts the HTTP status alone would show a delisted stock as a real $0.00 quote. This one catches it.

### Failure walkthroughs

**401, authentication.** I corrupted the key in `.env` to test the auth path. Finnhub returned `401`. The code caught it before parsing the non-JSON error body and reported a specific cause. I traced it to the bad key value, replaced it from the Finnhub dashboard, and confirmed recovery.

**429, rate limiting.** I sent a 98-symbol batch through the watchlist tool to exceed Finnhub's free-tier limit of 60 calls per minute on purpose. Call 59 hit a `429`. The retry logic attempted 3 backoff retries, logged each one, then failed only that symbol while the other 97 completed. No full-batch crash.

**200 with bad data, a silent failure.** I found this during testing, not by design. A delisted ticker, formerly PNM Resources before Avangrid acquired it, returned `200 OK` with every field zeroed. I added explicit validation to detect and report this instead of returning a misleading quote.

**Project structure.** I originally scaffolded the source files in a `src` subfolder, then flattened the project to a single directory for simplicity. That required updating `tsconfig.json`'s `rootDir` and `include` paths to match. Build configs need to stay in lockstep with the actual file layout.

---

## Tools

| Tool | Description |
|---|---|
| `get_quote` | Real-time quote (price, change, percent) for a single ticker. |
| `get_company_profile` | Company profile and metadata for a ticker. |
| `check_watchlist` | Batch-checks a list of tickers and flags any down more than a configurable threshold (default 2%). |

---

## Setup

Follow these steps in order. No prior experience with APIs is assumed. Each step says exactly what to do and how to confirm it worked. Instructions cover both **Mac** and **Windows**.

### What you'll need first

- **Claude Desktop.** This app runs and talks to this connector. Download it from [claude.ai/download](https://claude.ai/download) for Mac or Windows, install it, and sign in.
- **Node.js**, version 18 or newer. Open a terminal (**Terminal** on Mac, **PowerShell** on Windows) and type `node --version`. A result of `v18.17.0` or higher means you're set. If not, install from [nodejs.org](https://nodejs.org) and pick the **LTS** version.
- **Git.** Check with `git --version`. Mac usually has it built in. On Windows, if it's missing, install from [git-scm.com/download/win](https://git-scm.com/download/win) with the default options.
- **A free Finnhub account.** This is where your API key comes from. The next section walks you through it.

> **Windows note:** if `npm install` fails with an error like "running scripts is disabled on this system," PowerShell is blocking npm's script by default. This is a standard Windows security setting, not a problem with this project. Fix it once with:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```
> Confirm with `Y`, then retry `npm install`.

### Step 1: get your free Finnhub API key

An API key works like a password that lets this program ask Finnhub for stock data. Finnhub gives one out free.

1. Go to [finnhub.io](https://finnhub.io) and click **Get free API key** (or **Sign up**).
2. Create an account with your email and confirm it if asked.
3. Your dashboard shows your API key: a long string of letters and numbers.
4. Copy that key. Keep it private, like a password. Don't paste it into emails, screenshots, or public places.

The free plan allows 60 requests per minute, plenty for this tool.

### Step 2: download the project

Run these three lines one at a time:

```bash
git clone https://github.com/harperbrian/finnhub-connector.git
cd finnhub-connector
npm install
```

The first line copies the project to your computer. The second moves you into the project folder. The third downloads the pieces the project needs to run. This can take a minute. You'll know it's done when you get your normal terminal prompt back.

### Step 3: add your key

The project includes a file called `.env.example` that shows the key format. Make your own copy called `.env` and put your real key in it.

Copy the example file:

- **Mac/Linux:** `cp .env.example .env`
- **Windows:** `copy .env.example .env`

Open the new `.env` file in any text editor. You'll see this line:

```
FINNHUB_API_KEY=your_finnhub_api_key_here
```

Replace `your_finnhub_api_key_here` with the key you copied in Step 1:

```
FINNHUB_API_KEY=abc123yourrealkey456
```

Save the file. Your `.env` file stays on your computer. It never gets uploaded to GitHub, since a `.gitignore` rule blocks it, so your key stays private.

### Step 4: test that it works

Run:

```bash
npm start
```

Success looks like this line:

```
Finnhub MCP connector running — waiting for Claude Desktop...
```

That means your key loaded and the server started. Press `Ctrl+C` to stop it.

If you see `FATAL: FINNHUB_API_KEY is missing` instead, your `.env` file either isn't in the folder or the key line has a typo. Recheck Step 3.

### Step 5: connect it to Claude Desktop

This step tells Claude Desktop how to find and run your server.

**First, find your project's full path.** You'll need it below.

- **Mac/Linux:** inside the project folder, run `pwd`
- **Windows:** inside the project folder, run `cd` with no arguments

**Confirm the path is correct before editing anything.** This catches the most common setup mistake: a path that doesn't point where you think it does.

- **Mac/Linux:** `test -e "$(pwd)/index.ts" && echo "Correct — index.ts found here" || echo "Not found — check your folder"`
- **Windows (PowerShell):** `Test-Path "C:\Users\yourname\finnhub-connector\index.ts"` should print `True`. Replace the path with your own.

If this fails, you're not in the project folder, or it was cloned somewhere other than expected. Run `pwd` (Mac) or `cd` (Windows) again to see where you actually are.

**Then open Claude Desktop's config file.** Create it if it doesn't exist.

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`. Paste that into File Explorer's address bar to jump straight to the folder.

If the file is empty or doesn't exist yet, paste in the full example below using your own path.

If the file already has content in it, don't replace the whole thing. Claude Desktop often creates one automatically with settings like `preferences` or `coworkUserFilesPath` already inside, and replacing the file loses them. Add `mcpServers` as a new top-level key, a sibling to whatever's already there rather than nested inside it. If your file currently looks like this:

```json
{
  "preferences": {
    "sidebarMode": "chat"
  }
}
```

change it to:

```json
{
  "mcpServers": {
    "finnhub": {
      "command": "npx",
      "args": ["tsx", "/your/path/here/finnhub-connector/index.ts"]
    }
  },
  "preferences": {
    "sidebarMode": "chat"
  }
}
```

Note the comma after the `mcpServers` block's closing brace. It's required since another key follows it.

Mac/Linux example, starting from an empty file:

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

Windows example. Note the doubled backslashes (`\\`). JSON treats a single backslash as a special escape character, so a single `\` silently breaks the path:

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

> **Tip for finding the full path:** inside the project folder, run `pwd` (Mac) or `cd` with no arguments (Windows, in PowerShell). It prints the full folder path. Add `/index.ts` (Mac) or `\index.ts` (Windows) to the end.

**Save the file and fully restart Claude Desktop.** Quit it completely, not just the window. On Mac, use the **Claude** menu and **Quit Claude**. On Windows, right-click the Claude icon in the system tray and choose **Quit**, or go to **File** then **Exit**. Reopen it.

The three tools are now available. Because Claude can call them on its own and reason over the results, you can ask in plain English with no commands to memorize. Try these:

**Single lookups**
- "What's Apple's current stock price?"
- "Give me a profile of NVIDIA. What industry is it in and how big is it?"

**Watchlist monitoring**
- "Check my watchlist: AAPL, TSLA, NVDA, MSFT, AMZN. Flag anything down more than 2% today."
- "Here are my holdings: JPM, BAC, GS, MS. Which one is having the worst day?"

**Claude chaining tools and reasoning**
- "Compare Apple and Microsoft's price change today and tell me which is holding up better."
- "Look up Tesla's profile, then check its current price, and tell me if it's trading like a tech stock or a car company today."
- "Check these five tickers and rank them from best to worst performer today: AAPL, GOOGL, META, AMZN, NFLX."
- "What's the average percentage move across my watchlist today, AAPL, MSFT, NVDA, and is the group up or down overall?"

The last group is where an MCP tool earns its keep. None of those prompts required extra code. Claude calls the same three tools multiple times and composes the results: comparing, ranking, averaging, drawing conclusions. Simple, reliable tools paired with a model that handles the orchestration. That's the whole point of the pattern.

---

## Troubleshooting

| Error you see | What it means | Fix |
|---|---|---|
| `FATAL: FINNHUB_API_KEY is missing` | `.env` isn't in the project folder, or the key line is malformed | Confirm `.env` (not `.env.example`) exists at the project root with exactly one line: `FINNHUB_API_KEY=yourkey` |
| `AUTH ERROR 401` | Finnhub rejected the key | Re-copy the key fresh from your Finnhub dashboard instead of retyping it. Some valid Finnhub keys contain repeating-looking character patterns; that alone doesn't mean the key is broken. |
| `Cannot find module '...index.ts'` / `ERR_MODULE_NOT_FOUND` | The path in `claude_desktop_config.json` doesn't match where the project actually lives | Run the path verification command in Step 5, then update the config's `args` path to match exactly |
| `Could not load app settings` / JSON parse error | A syntax mistake in `claude_desktop_config.json`, usually a missing comma or an extra brace | Paste the file's contents into [jsonlint.com](https://jsonlint.com) to find the exact line with the error |
| PowerShell: "running scripts is disabled" | Windows blocks npm's script by default | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, confirm with `Y`, then retry |
| First run shows "npm warn exec ... will be installed" | Normal. The first time, npm downloads a small helper package (`tsx`) before running | Not an error. Only happens once. |

---

## Tech stack

TypeScript, Node.js, MCP SDK (`@modelcontextprotocol/sdk`), Zod for input validation, tsx, Finnhub REST API, stdio transport.

## What this project demonstrates

- API key authentication handling
- HTTP status code discrimination across `401`, `403`, `429`, and `200` with bad data
- Retry and backoff design that degrades gracefully instead of crashing
- Recognizing that transport-layer success doesn't equal application-layer validity

## License

MIT. See [LICENSE](LICENSE).
