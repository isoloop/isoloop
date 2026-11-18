/*
 * MCP's stdio transport: one JSON-RPC message per line, UTF-8, no embedded
 * newlines. Only messages go to stdout; logs go to stderr.
 */

/** Splits a byte stream into lines and parses each as JSON. */
export async function readMessages(
  input: AsyncIterable<string | Uint8Array>,
  onMessage: (message: unknown) => void,
  onParseError: () => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let carry = '';
  const line = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      onParseError();
      return;
    }
    onMessage(message);
  };
  for await (const chunk of input) {
    carry += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let nl = carry.indexOf('\n');
    while (nl >= 0) {
      line(carry.slice(0, nl));
      carry = carry.slice(nl + 1);
      nl = carry.indexOf('\n');
    }
  }
  line(carry + decoder.decode());
}

/** One message as a line. `JSON.stringify` escapes newlines inside strings. */
export const frame = (message: unknown): string => `${JSON.stringify(message)}\n`;
