// Our one wrapper around Playwright's `page.webmcp` (M4a decision 15), so a
// change in Playwright's experimental WebMCP API touches this file only.
import type { Page } from '@playwright/test';

/** A tool as the browser lists it. */
export type ListedTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
  annotations?: { readOnly?: boolean; consequential?: boolean; untrustedContent?: boolean };
};

/** The tools the page has registered through WebMCP. */
export async function listTools(page: Page): Promise<ListedTool[]> {
  return page.webmcp.tools();
}

/** A tool call's outcome and how long it took, as the agent side sees it. */
export type Called =
  | { ok: true; value: unknown; ms: number }
  | { ok: false; error: string; ms: number };

/** Calls a tool the way an agent would; a failed call comes back as `ok: false`. */
export async function callTool(page: Page, name: string, input: object): Promise<Called> {
  const t0 = Date.now();
  try {
    const value: unknown = await page.webmcp.callTool(name, input);
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}
