/*
 * A small WebSocket server (RFC 6455) on node:http, so the CLI has no
 * WebSocket dependency. It does what the dev MCP needs and no more:
 *
 * - the opening handshake, with a hook to refuse a request (the Origin check);
 * - text messages, fragmented or not, checked as UTF-8;
 * - ping → pong, and the closing handshake;
 * - no extensions (no permessage-deflate), no subprotocols, no binary
 *   messages (closed with 1003).
 *
 * The conformance tests run Node's own WebSocket client (undici) against it.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** A message bigger than this closes the connection with 1009. */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

/** How long a closing connection waits for the peer's close frame. */
const CLOSE_WAIT_MS = 1_000;

/** One open connection. */
export type WsConnection = {
  /** The upgrade request (its headers, URL). */
  readonly request: IncomingMessage;
  /** Sends a text message. Does nothing once the connection is closing. */
  send(text: string): void;
  /** Starts the closing handshake. */
  close(code?: number, reason?: string): void;
  onMessage: ((text: string) => void) | undefined;
  /** Called once, with the close code (1006 when the socket just ended). */
  onClose: ((code: number, reason: string) => void) | undefined;
};

export type WsServerOptions = {
  readonly host: string;
  /** 0 picks a free port. */
  readonly port: number;
  /**
   * Decides on an upgrade request before the handshake: `true` accepts,
   * a number refuses it with that HTTP status.
   */
  readonly accept: (request: IncomingMessage) => true | number;
  readonly onConnection: (connection: WsConnection) => void;
};

export type WsServer = {
  /** The port it listens on. */
  readonly port: number;
  /** Closes every connection (with `code`) and stops listening. */
  close(code?: number, reason?: string): Promise<void>;
};

const OPCODE = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;

/** Starts listening. Rejects when the port can't be bound (e.g. `EADDRINUSE`). */
export function listenWs(options: WsServerOptions): Promise<WsServer> {
  const connections = new Set<Connection>();
  const server: Server = createServer((_req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain', upgrade: 'websocket' });
    res.end('WebSocket only\n');
  });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const key = request.headers['sec-websocket-key'];
    const valid =
      request.method === 'GET' &&
      (request.headers.upgrade ?? '').toLowerCase() === 'websocket' &&
      request.headers['sec-websocket-version'] === '13' &&
      typeof key === 'string' &&
      Buffer.from(key, 'base64').length === 16;
    const verdict = valid ? options.accept(request) : 400;
    if (verdict !== true || typeof key !== 'string') {
      socket.end(`HTTP/1.1 ${verdict} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    const acceptKey = createHash('sha1')
      .update(key + GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
    );
    const c = new Connection(request, socket);
    connections.add(c);
    c.closed.then(
      () => connections.delete(c),
      () => connections.delete(c),
    );
    options.onConnection(c);
    if (head.length > 0) c.feed(head);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        port,
        close: async (code = 1001, reason = '') => {
          for (const c of connections) c.close(code, reason);
          await Promise.all([...connections].map((c) => c.closed));
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

class Connection implements WsConnection {
  onMessage: ((text: string) => void) | undefined;
  onClose: ((code: number, reason: string) => void) | undefined;
  readonly closed: Promise<void>;
  #buffer: Buffer = Buffer.alloc(0);
  #fragments: Buffer[] = [];
  #fragmentBytes = 0;
  #closing = false;
  #done = false;
  #resolveClosed!: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #code = 1006;
  #reason = '';

  constructor(
    readonly request: IncomingMessage,
    private readonly socket: Duplex,
  ) {
    this.closed = new Promise((resolve) => (this.#resolveClosed = resolve));
    socket.on('data', (chunk: Buffer) => this.feed(chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.#finish());
  }

  send(text: string): void {
    if (this.#closing) return;
    this.#write(OPCODE.text, Buffer.from(text, 'utf8'));
  }

  close(code = 1000, reason = ''): void {
    if (this.#closing) return;
    this.#closing = true;
    this.#code = code;
    this.#reason = reason;
    const r = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this.#write(OPCODE.close, payload);
    this.#timer = setTimeout(() => this.socket.destroy(), CLOSE_WAIT_MS);
  }

  feed(chunk: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      if (this.#done) return;
      const frame = this.#parse();
      if (frame === undefined) return;
      this.#handle(frame.fin, frame.opcode, frame.payload);
    }
  }

  #parse(): { fin: boolean; opcode: number; payload: Buffer } | undefined {
    const b = this.#buffer;
    if (b.length < 2) return undefined;
    const b0 = b[0] ?? 0;
    const b1 = b[1] ?? 0;
    const fin = (b0 & 0x80) !== 0;
    if ((b0 & 0x70) !== 0) return this.#fail(1002, 'reserved bits set');
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    if (!masked) return this.#fail(1002, 'client frames must be masked');
    let length = b1 & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (b.length < 4) return undefined;
      length = b.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (b.length < 10) return undefined;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_MESSAGE_BYTES)) return this.#fail(1009, 'message too big');
      length = Number(big);
      offset = 10;
    }
    if (length > MAX_MESSAGE_BYTES) return this.#fail(1009, 'message too big');
    if (b.length < offset + 4 + length) return undefined;
    const mask = b.subarray(offset, offset + 4);
    const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
    this.#buffer = b.subarray(offset + 4 + length);
    return { fin, opcode, payload };
  }

  #handle(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode >= 8) {
      if (!fin || payload.length > 125) {
        this.#fail(1002, 'bad control frame');
        return;
      }
      if (opcode === OPCODE.ping) {
        if (!this.#closing) this.#write(OPCODE.pong, payload);
      } else if (opcode === OPCODE.close) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        if (!this.#closing) {
          this.#closing = true;
          this.#code = code;
          this.#reason = reason;
          this.#write(OPCODE.close, payload.subarray(0, 2));
        }
        this.socket.end();
      } else if (opcode !== OPCODE.pong) {
        this.#fail(1002, 'unknown opcode');
      }
      return;
    }
    if (opcode === OPCODE.binary) {
      this.#fail(1003, 'text messages only');
      return;
    }
    if (opcode === OPCODE.text) {
      if (this.#fragments.length > 0) {
        this.#fail(1002, 'new message inside a fragmented one');
        return;
      }
    } else if (opcode === OPCODE.continuation) {
      if (this.#fragments.length === 0) {
        this.#fail(1002, 'continuation without a message');
        return;
      }
    } else {
      this.#fail(1002, 'unknown opcode');
      return;
    }
    this.#fragments.push(payload);
    this.#fragmentBytes += payload.length;
    if (this.#fragmentBytes > MAX_MESSAGE_BYTES) {
      this.#fail(1009, 'message too big');
      return;
    }
    if (!fin) return;
    const whole = Buffer.concat(this.#fragments);
    this.#fragments = [];
    this.#fragmentBytes = 0;
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(whole);
    } catch {
      this.#fail(1007, 'invalid UTF-8');
      return;
    }
    if (!this.#closing) this.onMessage?.(text);
  }

  #fail(code: number, reason: string): undefined {
    this.close(code, reason);
    this.#buffer = Buffer.alloc(0);
    this.#done = true;
    // A protocol error: no need to wait for the peer's close frame.
    this.socket.end();
    return undefined;
  }

  #write(opcode: number, payload: Buffer): void {
    const n = payload.length;
    const header = n < 126 ? Buffer.alloc(2) : n < 0x10000 ? Buffer.alloc(4) : Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    if (n < 126) header[1] = n;
    else if (n < 0x10000) {
      header[1] = 126;
      header.writeUInt16BE(n, 2);
    } else {
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(n), 2);
    }
    if (!this.socket.writable) return;
    this.socket.write(Buffer.concat([header, payload]));
  }

  #finish(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    if (this.#resolved) return;
    this.#resolved = true;
    this.#done = true;
    this.onClose?.(this.#code, this.#reason);
    this.#resolveClosed();
  }

  #resolved = false;
}
