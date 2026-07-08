#!/usr/bin/env node

// ============================================================
// FINNHUB MCP CONNECTOR
// This file is your MCP server. It exposes tools that Claude
// can call to fetch live stock data from Finnhub.
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load your .env file so FINNHUB_API_KEY is available.
// We build an absolute path to .env based on this file's own
// location on disk, because Claude Desktop launches this server
// from a different working directory than your Terminal does —
// so the old dotenv.config() (with no path) couldn't find it.
// @ts-ignore - import.meta.url is valid at runtime via tsx (ESM), VS Code's checker is overly strict here
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

// ============================================================
// PHASE 3 FAILURE POINT #1 — API KEY LOADING
// If your key is missing or has a stray space, this will
// catch it immediately at startup rather than failing silently
// later. This is deliberate — "fail fast" is good design.
// TO BREAK IT: delete your .env file or corrupt the key name.
// ============================================================
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

if (!FINNHUB_API_KEY) {
  console.error(
    "FATAL: FINNHUB_API_KEY is missing from your .env file. " +
    "Create a .env file in the project root with: FINNHUB_API_KEY=your_key_here"
  );
  process.exit(1); // Stops the server immediately with a clear error message
}

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

// ============================================================
// CREATE THE MCP SERVER
// This is the "container" that holds all your tools.
// Claude Desktop connects to this server and discovers
// what tools are available through it.
// ============================================================
const server = new McpServer({
  name: "finnhub-connector",
  version: "1.0.0",
});

// ============================================================
// HELPER FUNCTION: fetchFinnhub
// All your tools will call this one function to talk to
// Finnhub. Centralizing it means error handling lives in
// one place — key lesson for your troubleshooting writeup.
//
// PHASE 3 FAILURE POINT #2 — AUTH ERRORS (401/403)
// TO BREAK IT: change FINNHUB_API_KEY to "badkey" and
// watch a 401 come back. Note what the error body says.
//
// PHASE 4 FAILURE POINT — RATE LIMITING (429)
// TO BREAK IT: call this in a loop faster than 60/min and
// watch the 429 appear. The retry logic below handles it.
// ============================================================
async function fetchFinnhub(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  // Build the query string — adds your API key + any other params
  const queryParams = new URLSearchParams({
    ...params,
    token: FINNHUB_API_KEY as string, // Your key goes here as a query param
  });

  const url = `${FINNHUB_BASE_URL}${endpoint}?${queryParams}`;

  // --- RETRY LOGIC FOR RATE LIMITING ---
  // If we get a 429 (too many requests), wait and try again
  // up to 3 times before giving up.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 15000; // 15 seconds — safely under 60/min limit

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url);

    // PHASE 3: This is where 401 (bad key) and 403 (not allowed)
    // surface. We check status BEFORE trying to parse JSON because
    // Finnhub sometimes returns plain text on errors, not JSON.
    if (response.status === 401) {
      throw new Error(
        "AUTH ERROR 401: Finnhub rejected your API key. " +
        "Check FINNHUB_API_KEY in your .env file for typos or extra spaces."
      );
    }

    if (response.status === 403) {
      throw new Error(
        "AUTH ERROR 403: Your API key doesn't have permission for this endpoint. " +
        "Check if this endpoint requires a paid Finnhub plan."
      );
    }

    // PHASE 4: Rate limit hit — wait and retry
    if (response.status === 429) {
      if (attempt < MAX_RETRIES) {
        console.error(
          `RATE LIMIT 429: Too many requests. ` +
          `Waiting ${RETRY_DELAY_MS / 1000}s before retry ${attempt}/${MAX_RETRIES - 1}...`
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue; // Try again
      } else {
        throw new Error(
          "RATE LIMIT 429: Hit Finnhub's limit (60 calls/min) and exhausted all retries. " +
          "Slow down your requests or upgrade your Finnhub plan."
        );
      }
    }

    // Any other non-success status
    if (!response.ok) {
      // Finnhub sometimes returns plain text errors — handle both
      let errorBody: string;
      try {
        const json = await response.json();
        errorBody = JSON.stringify(json);
      } catch {
        errorBody = await response.text();
      }
      throw new Error(
        `HTTP ERROR ${response.status}: Finnhub returned an error. Body: ${errorBody}`
      );
    }

    // Success — parse and return the JSON
    return await response.json();
  }
}

// ============================================================
// TOOL #1: get_quote
// Gets the current price of a single stock ticker.
// This is the core tool — test this first.
//
// Example: Ask Claude "What's Apple's current stock price?"
// Claude will call this tool with symbol = "AAPL"
// ============================================================
server.registerTool(
  "get_quote",
  {
    description:
      "Get the current stock quote for a ticker symbol. " +
      "Returns current price, high, low, open, and previous close.",
    inputSchema: z.object({
      symbol: z
        .string()
        .toUpperCase()
        .describe("Stock ticker symbol, e.g. AAPL, TSLA, MSFT"),
    }),
  },
  async ({ symbol }) => {
    try {
      const data = await fetchFinnhub("/quote", { symbol }) as {
        c: number;  // current price
        h: number;  // high
        l: number;  // low
        o: number;  // open
        pc: number; // previous close
        d: number;  // change
        dp: number; // percent change
      };

      // PHASE 3 FAILURE POINT #3 — SILENT BAD DATA
      // Finnhub returns HTTP 200 (success) even for invalid or
      // delisted tickers — it just fills every field with 0
      // instead of returning an error. Without this check, a
      // dead ticker like a delisted stock would silently show
      // "$0.00" instead of telling you the symbol is invalid.
      // TO SEE IT: ask for a delisted ticker, e.g. "PNM"
      if (data.c === 0 && data.h === 0 && data.l === 0) {
        return {
          content: [{
            type: "text",
            text: `No data found for ${symbol}. This usually means the ticker is invalid, delisted, or not covered by Finnhub's free tier.`
          }],
          isError: true,
        };
      }

      // Format a clean human-readable response for Claude to work with
      const result = [
        `📈 ${symbol} Stock Quote`,
        `Current Price: $${data.c}`,
        `Change: $${data.d} (${data.dp}%)`,
        `Today's High: $${data.h}`,
        `Today's Low: $${data.l}`,
        `Open: $${data.o}`,
        `Previous Close: $${data.pc}`,
      ].join("\n");

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      // Surface the error cleanly to Claude instead of crashing
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error fetching quote for ${symbol}: ${message}` }],
        isError: true,
      };
    }
  }
);

// ============================================================
// TOOL #2: get_company_profile
// Gets basic company info for a ticker.
// Good for demonstrating that your connector isn't just
// one trick — shows range of the Finnhub API.
// ============================================================
server.registerTool(
  "get_company_profile",
  {
    description:
      "Get company profile information for a ticker symbol. " +
      "Returns company name, industry, market cap, and exchange.",
    inputSchema: z.object({
      symbol: z
        .string()
        .toUpperCase()
        .describe("Stock ticker symbol, e.g. AAPL, TSLA, MSFT"),
    }),
  },
  async ({ symbol }) => {
    try {
      const data = await fetchFinnhub("/stock/profile2", { symbol }) as {
        name: string;
        finnhubIndustry: string;
        marketCapitalization: number;
        exchange: string;
        ticker: string;
        weburl: string;
      };

      const result = [
        `🏢 ${symbol} Company Profile`,
        `Name: ${data.name}`,
        `Industry: ${data.finnhubIndustry}`,
        `Exchange: ${data.exchange}`,
        `Market Cap: $${(data.marketCapitalization / 1000).toFixed(2)}B`,
        `Website: ${data.weburl}`,
      ].join("\n");

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error fetching profile for ${symbol}: ${message}` }],
        isError: true,
      };
    }
  }
);

// ============================================================
// TOOL #3: check_watchlist
// PHASE 5 TOOL — The "real workflow" story for your resume.
// Takes a list of tickers and flags any that are down
// more than a threshold percentage today.
//
// Example: Ask Claude "Check my watchlist: AAPL, TSLA, NVDA,
// MSFT — flag anything down more than 2% today"
// ============================================================
server.registerTool(
  "check_watchlist",
  {
    description:
      "Check a watchlist of stock tickers and flag any that are down " +
      "more than a specified percentage today. Useful for monitoring positions.",
    inputSchema: z.object({
      symbols: z
        .array(z.string().toUpperCase())
        .describe("Array of ticker symbols to check, e.g. ['AAPL','TSLA','MSFT']"),
      threshold: z
        .number()
        .default(2)
        .describe("Percentage drop threshold to flag. Default is 2%."),
    }),
  },
  async ({ symbols, threshold }) => {
    const results: string[] = [];
    const flagged: string[] = [];

    for (const symbol of symbols) {
      try {
        const data = await fetchFinnhub("/quote", { symbol }) as {
          c: number;
          dp: number;
          d: number;
        };

        // Same silent-bad-data check as get_quote — catch dead
        // tickers here too, so they don't quietly report "$0"
        // in a batch and get missed.
        if (data.c === 0) {
          results.push(`${symbol}: No data found — likely invalid or delisted`);
          continue;
        }

        const line = `${symbol}: $${data.c} (${data.dp > 0 ? "+" : ""}${data.dp}%)`;
        results.push(line);

        if (data.dp <= -threshold) {
          flagged.push(`⚠️  ${symbol} is down ${Math.abs(data.dp).toFixed(2)}% — below your ${threshold}% threshold`);
        }

        // Small delay between calls to stay under the 60/min rate limit
        // This is INTENTIONAL rate-limit hygiene — note it in your writeup
        await new Promise((resolve) => setTimeout(resolve, 1100));

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push(`${symbol}: Error — ${message}`);
      }
    }

    const summary = [
      `📊 Watchlist Check (threshold: -${threshold}%)`,
      "",
      ...results,
      "",
      flagged.length > 0
        ? `🚨 Flagged:\n${flagged.join("\n")}`
        : `✅ Nothing flagged — no positions down more than ${threshold}% today`,
    ].join("\n");

    return {
      content: [{ type: "text", text: summary }],
    };
  }
);

// ============================================================
// START THE SERVER
// This connects your tools to Claude Desktop via stdio
// (standard input/output — Claude Desktop talks to your
// server through this pipe).
// ============================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Finnhub MCP connector running — waiting for Claude Desktop...");
}

main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});