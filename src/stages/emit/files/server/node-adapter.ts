import { newGenerator } from "@varavel/gen";
import type { PluginOutputFile } from "@varavel/vdl-plugin-sdk";
import { dedent } from "@varavel/vdl-plugin-sdk/utils/strings";
import { formatImportPath } from "../../../../shared/imports";
import { renderTypeScriptFile } from "../../../../shared/render-ts-file";
import type { GeneratorContext } from "../../../model/types";

/**
 * Emits the Node.js server adapter used by the generated server target.
 */
export function generateNodeAdapterFile(
  context: GeneratorContext,
): PluginOutputFile {
  const g = newGenerator().withSpaces(2);

  g.line(
    `import type { HTTPAdapter, Server } from ${JSON.stringify(formatImportPath("../server", context.options.importExtension))};`,
  );
  g.line('import type { IncomingMessage, ServerResponse } from "node:http";');
  g.break();
  g.raw(NODE_ADAPTER.trim());

  return {
    path: "adapters/node.ts",
    content: renderTypeScriptFile(g.toString()),
  };
}

const NODE_ADAPTER = dedent(/* ts */ `
  /**
   * Default maximum request body size: 4 MiB.
   */
  const defaultMaxBodyBytes = 4 * 1024 * 1024;

  /**
   * Error message used when a request body exceeds the configured cap.
   */
  const BODY_TOO_LARGE_MESSAGE = "Request body too large";

  /**
   * NodeAdapter implements HTTPAdapter for Node.js HTTP environments.
   *
   * This adapter works with Node.js \`IncomingMessage\` and \`ServerResponse\` objects
   * used by Express, Fastify, native \`http.createServer\`, and similar frameworks.
   *
   * It supports JSON body parsing (manual buffering or pre-parsed by middleware)
   * and connection close detection for procedure cancellation.
   */
  export class NodeAdapter implements HTTPAdapter {
    private readonly req: IncomingMessage;
    private readonly res: ServerResponse;
    private readonly parsedBody: unknown;
    private readonly maxBodyBytes: number;
    private bodyPromise: Promise<unknown> | null;
    private readonly closeCallbacks: Array<() => void>;
    private closed: boolean;

    /**
     * Creates a new NodeAdapter.
     *
     * @param req - The Node.js IncomingMessage (request)
     * @param res - The Node.js ServerResponse
     * @param parsedBody - Optional pre-parsed body (from Express body-parser, etc.)
     * @param maxBodyBytes - Optional request body cap. Values <= 0 restore the 4 MiB default.
     */
    constructor(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown, maxBodyBytes: number = defaultMaxBodyBytes) {
      if (!req) {
        throw new Error("NodeAdapter requires a non-null request");
      }
      if (!res) {
        throw new Error("NodeAdapter requires a non-null response");
      }

      this.req = req;
      this.res = res;
      this.parsedBody = parsedBody;
      this.maxBodyBytes = maxBodyBytes > 0 ? maxBodyBytes : defaultMaxBodyBytes;
      this.bodyPromise = null;
      this.closeCallbacks = [];
      this.closed = false;

      req.on("aborted", () => {
        this.closed = true;
        for (const callback of this.closeCallbacks) {
          callback();
        }
      });

      res.on("close", () => {
        if (!this.res.writableFinished) {
          this.closed = true;
          for (const callback of this.closeCallbacks) {
            callback();
          }
        }
      });

      if (parsedBody === undefined) {
        this.startBodyBuffering();
      }
    }

    /** Starts buffering the request body immediately. */
    private startBodyBuffering(): void {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.req.removeAllListeners("data");
        this.req.removeAllListeners("end");
        rejectBody(error);
      };

      let rejectBody: (error: Error) => void = () => {};

      this.bodyPromise = new Promise<unknown>((resolve, reject) => {
        rejectBody = reject;

        this.req.on("data", (chunk: Buffer) => {
          if (settled) {
            return;
          }
          total += chunk.length;
          if (total > this.maxBodyBytes) {
            fail(new Error(BODY_TOO_LARGE_MESSAGE));
            return;
          }
          chunks.push(chunk);
        });

        this.req.on("end", () => {
          if (settled) {
            return;
          }
          settled = true;
          try {
            const bodyString = Buffer.concat(chunks).toString("utf-8");
            if (!bodyString || bodyString.trim() === "") {
              resolve({});
              return;
            }

            resolve(JSON.parse(bodyString));
          } catch (error) {
            reject(new Error("Failed to parse JSON body: " + String(error)));
          }
        });

        this.req.on("error", (error) => {
          fail(error as Error);
        });
      });
    }

    /**
     * Returns the parsed JSON request body, or {} for missing bodies.
     * Bodies beyond the cap throw before any handler runs.
     */
    async json(): Promise<unknown> {
      if (this.parsedBody !== undefined) {
        if (this.parsedBody === null) {
          return {};
        }
        return this.parsedBody;
      }

      return this.bodyPromise ?? {};
    }

    /** Writes the full JSON response body and ends the response. */
    send(body: string): void {
      if (this.closed || this.res.writableEnded) {
        return;
      }

      if (!this.res.headersSent) {
        this.res.setHeader("Content-Type", "application/json");
      }
      this.res.write(body);
      if (!this.res.writableEnded) {
        this.res.end();
      }
    }

    /** Registers a callback for when the underlying connection closes. */
    onClose(callback: () => void): void {
      this.closeCallbacks.push(callback);
      if (this.closed) {
        callback();
      }
    }
  }

  /**
   * Extracts RPC and procedure names from a URL path.
   *
   * @param url - The request URL (e.g., "/rpc/Service/Echo")
   * @param prefix - Optional path prefix to strip (e.g., "/rpc")
   * @returns Object with rpcName and procName, or null if parsing fails
   */
  function parseNodeRpcPath(
    url: string,
    prefix?: string,
  ): { rpcName: string; procName: string } | null {
    let pathname = url.split("?")[0] ?? url;

    if (prefix) {
      const normalizedPrefix = prefix.startsWith("/") ? prefix : "/" + prefix;
      if (pathname.startsWith(normalizedPrefix)) {
        pathname = pathname.slice(normalizedPrefix.length);
      }
    }

    const segments = pathname.replace(/^\\/+|\\/+$/gu, "").split("/");
    if (segments.length < 2) {
      return null;
    }

    const procName = segments.pop();
    const rpcName = segments.pop();
    if (!rpcName || !procName) {
      return null;
    }

    return { rpcName, procName };
  }

  /**
   * Options for createNodeHandler.
   */
  export interface NodeHandlerOptions {
    /**
     * URL path prefix to strip before parsing RPC/procedure names.
     * Example: "/rpc" or "/api/v1"
     */
    prefix?: string;
  }

  /**
   * Creates a Node.js HTTP request handler for a VDL HTTP RPC server.
   *
   * Mount it under the RPC base path; segments below the mount point must be
   * /{rpc}/{procedure} using the VPP-2 lowerFirst transport form.
   * Only POST requests route to procedures (anything else gets 405).
   * Paths without exactly two segments get 404.
   *
   * @param server - The VDL Server instance
   * @param createContext - Optional function to create the context (props) from req/res
   * @param options - Handler options including path prefix
   * @returns An async function that handles Node.js HTTP requests
   */
  export function createNodeHandler<T = unknown>(
    server: Server<T>,
    createContext?: (req: IncomingMessage, res: ServerResponse) => T | Promise<T>,
    options?: NodeHandlerOptions,
  ): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    if (!server) {
      throw new Error("createNodeHandler requires a non-null Server");
    }

    const prefix = options?.prefix;

    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method !== "POST") {
        if (!res.headersSent) {
          res.writeHead(405, {
            "Content-Type": "application/json",
            Allow: "POST",
          });
        }

        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "method not allowed, use POST",
            },
          }),
        );
        return;
      }

      const parsed = parseNodeRpcPath(req.url ?? "/", prefix);
      if (!parsed) {
        if (!res.headersSent) {
          res.writeHead(404, { "Content-Type": "application/json" });
        }

        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: "Not found",
            },
          }),
        );
        return;
      }

      const reqWithBody = req as IncomingMessage & { body?: unknown };
      const adapter = new NodeAdapter(
        req,
        res,
        reqWithBody.body,
        server.getMaxRequestBodyBytes(),
      );

      let props: T;
      try {
        props = createContext
          ? await createContext(req, res)
          : (undefined as T);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }

        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "CONTEXT_ERROR",
              message: "Internal server error",
            },
          }),
        );
        return;
      }

      try {
        await server.handleRequest(
          props,
          parsed.rpcName,
          parsed.procName,
          adapter,
        );
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }

        if (!res.writableEnded) {
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "Internal server error",
              },
            }),
          );
        }
      }
    };
  }
`);
