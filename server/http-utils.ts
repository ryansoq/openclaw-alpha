import type { IncomingMessage, ServerResponse } from "node:http";

/** Sentinel error for payload-too-large (check with instanceof) */
export class PayloadTooLargeError extends Error {
  constructor(msg = "Payload too large") { super(msg); this.name = "PayloadTooLargeError"; }
}

/** Read and parse JSON body from request */
export function readBody(req: IncomingMessage, maxBytes = 102_400): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Fast-reject via Content-Length header
    const cl = req.headers["content-length"];
    if (cl && Number(cl) > maxBytes) {
      req.destroy();
      reject(new PayloadTooLargeError());
      return;
    }

    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      size += typeof chunk === "string" ? chunk.length : chunk.byteLength;
      if (size > maxBytes) {
        req.destroy();
        reject(new PayloadTooLargeError());
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Send JSON response with CORS headers */
export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}
