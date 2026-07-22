/**
 * webhook-sink.ts — In-test HTTP server for webhook delivery testing.
 *
 * Starts a lightweight Node.js HTTP server on a free port. Playwright tests
 * register a webhook URL pointing at this sink, trigger events, and then
 * inspect the captured requests to verify HMAC-SHA256 signatures, headers,
 * and payload shape.
 *
 * Usage:
 *   const sink = await WebhookSink.start();
 *   // … register sink.url as the webhook target …
 *   const req = await sink.waitForRequest();
 *   sink.stop();
 */

import * as http from 'http';
import * as crypto from 'crypto';

export interface CapturedRequest {
  /** The full parsed JSON payload */
  body: Record<string, unknown>;
  /** Raw request body string (used for signature verification) */
  rawBody: string;
  /** All HTTP request headers */
  headers: Record<string, string | string[] | undefined>;
  /** HTTP method */
  method: string;
  /** Response status code that the sink returned */
  respondedWith: number;
}

export interface WebhookSinkOptions {
  /**
   * Fixed port to bind on. When omitted the OS assigns a free ephemeral port.
   */
  port?: number;
  /**
   * Status code the sink should respond with. Defaults to 200.
   * Set to 500 to test retry/dead-letter behaviour.
   */
  responseStatus?: number;
  /**
   * Maximum number of requests to capture before automatically closing.
   * Defaults to Infinity (server stays open until stop() is called).
   */
  maxCaptures?: number;
}

/**
 * A pending waiter: holds both resolve and reject so that stop() can
 * properly clean up without leaving dangling promise chains.
 */
interface Waiter {
  resolve: (req: CapturedRequest) => void;
  reject: (err: Error) => void;
}

export class WebhookSink {
  private server: http.Server;
  private captured: CapturedRequest[] = [];
  private waiters: Waiter[] = [];
  readonly url: string;
  private responseStatus: number;
  private maxCaptures: number;

  private constructor(
    server: http.Server,
    port: number,
    responseStatus: number,
    maxCaptures: number,
  ) {
    this.server = server;
    this.url = `http://127.0.0.1:${port}/webhook`;
    this.responseStatus = responseStatus;
    this.maxCaptures = maxCaptures;
  }

  /**
   * Start the sink server. Resolves once the server is listening.
   */
  static start(opts: WebhookSinkOptions = {}): Promise<WebhookSink> {
    const { port = 0, responseStatus = 200, maxCaptures = Infinity } = opts;

    return new Promise((resolve, reject) => {
      const server = http.createServer();
      let sink: WebhookSink;

      server.on('request', (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405).end();
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(rawBody);
          } catch {
            // body stays empty
          }

          const captured: CapturedRequest = {
            body,
            rawBody,
            headers: req.headers as Record<string, string | string[] | undefined>,
            method: req.method ?? 'POST',
            respondedWith: sink.responseStatus,
          };

          sink.captured.push(captured);

          // Wake up the oldest pending waiter immediately
          if (sink.waiters.length > 0) {
            const waiter = sink.waiters.shift()!;
            // Remove from captured since we're handing it directly to the waiter
            const idx = sink.captured.indexOf(captured);
            if (idx !== -1) sink.captured.splice(idx, 1);
            waiter.resolve(captured);
          }

          res.writeHead(sink.responseStatus, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              received: true,
              count: sink.captured.length,
            }),
          );

          if (sink.captured.length >= sink.maxCaptures) {
            sink.stop();
          }
        });
      });

      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : port;
        sink = new WebhookSink(server, boundPort, responseStatus, maxCaptures);
        resolve(sink);
      });

      server.on('error', reject);
    });
  }

  /**
   * Resolve when the next HTTP request arrives (or immediately if one is
   * already buffered). Rejects after `timeoutMs` (default 10 s).
   *
   * Requests are consumed in FIFO order — each call to waitForRequest()
   * dequeues exactly one captured request.
   */
  waitForRequest(timeoutMs = 10_000): Promise<CapturedRequest> {
    // If a request is already buffered, return it immediately (consume it)
    if (this.captured.length > 0) {
      return Promise.resolve(this.captured.shift()!);
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Remove this waiter from the queue
        const idx = this.waiters.findIndex((w) => w.resolve === resolveWrapped);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`WebhookSink: timed out waiting for request after ${timeoutMs}ms`));
      }, timeoutMs);

      const resolveWrapped = (req: CapturedRequest) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(req);
      };

      const rejectWrapped = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };

      this.waiters.push({ resolve: resolveWrapped, reject: rejectWrapped });
    });
  }

  /**
   * Return all currently buffered (unconsumed) requests without consuming them.
   */
  requests(): CapturedRequest[] {
    return [...this.captured];
  }

  /**
   * Clear the captured request buffer.
   */
  clear(): void {
    this.captured = [];
  }

  /**
   * Change the HTTP response status the sink returns for future requests.
   * Use 500 to simulate a failing endpoint for retry tests.
   */
  setResponseStatus(status: number): void {
    this.responseStatus = status;
  }

  /**
   * Verify the HMAC-SHA256 signature on a captured request.
   *
   * The signature scheme (matching delivery.ts):
   *   signature = HMAC-SHA256(JSON.stringify(payload), webhookSecret)
   *   header    = X-Webhook-Signature
   *
   * We verify against rawBody because JSON.stringify(payload) === rawBody
   * (the server sends `body: JSON.stringify(payload)`).
   */
  static verifySignature(captured: CapturedRequest, secret: string): boolean {
    const signatureHeader = captured.headers['x-webhook-signature'];
    if (!signatureHeader || typeof signatureHeader !== 'string') return false;

    const expected = crypto.createHmac('sha256', secret).update(captured.rawBody).digest('hex');

    // Timing-safe comparison — must be same byte length
    if (signatureHeader.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  }

  /**
   * Stop the server. Safe to call multiple times.
   * Any pending waitForRequest() calls are rejected immediately.
   */
  stop(): void {
    // Reject all pending waiters so their promises settle cleanly
    const stopError = new Error('WebhookSink: server stopped');
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.reject(stopError);
    }
    try {
      this.server.closeAllConnections?.();
      this.server.close();
    } catch {
      // Ignore if already closed
    }
  }
}
