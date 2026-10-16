import { newGenerator } from "@varavel/gen";
import type { PluginOutputFile } from "@varavel/vdl-plugin-sdk";
import { dedent } from "@varavel/vdl-plugin-sdk/utils/strings";
import { formatImportPath } from "../../../../shared/imports";
import { renderTypeScriptFile } from "../../../../shared/render-ts-file";
import type { GeneratorContext } from "../../../model/types";

/**
 * Emits the Fetch API adapter used by the generated server target.
 */
export function generateFetchAdapterFile(
  context: GeneratorContext,
): PluginOutputFile {
  const g = newGenerator().withSpaces(2);

  g.line(
    `import type { HTTPAdapter, Server } from ${JSON.stringify(formatImportPath("../server", context.options.importExtension))};`,
  );
  g.break();
  g.raw(FETCH_ADAPTER.trim());

  return {
    path: "adapters/fetch.ts",
    content: renderTypeScriptFile(g.toString()),
  };
}

const FETCH_ADAPTER = dedent(/* ts */ `
  /**
   * Default maximum request body size: 4 MiB.
   */
  const defaultMaxBodyBytes = 4 * 1024 * 1024;

  /**
   * Error message used when a request body exceeds the configured cap.
   */
  const BODY_TOO_LARGE_MESSAGE = "Request body too large";

  /**
   * FetchAdapter implements HTTPAdapter for Web Standards environments.
   */
  export class FetchAdapter implements HTTPAdapter {
    private readonly request: Request;
    private body: string;
    private readonly maxBodyBytes: number;
    private readonly closeCallbacks: Array<() => void>;
    private aborted: boolean;

    constructor(request: Request, maxBodyBytes: number = defaultMaxBodyBytes) {
      if (!request) {
        throw new Error("FetchAdapter requires a non-null Request");
      }

      this.request = request;
      this.body = "";
      this.maxBodyBytes = maxBodyBytes > 0 ? maxBodyBytes : defaultMaxBodyBytes;
      this.closeCallbacks = [];
      this.aborted = false;

      request.signal.addEventListener("abort", () => {
        this.aborted = true;
        for (const callback of this.closeCallbacks) {
          callback();
        }
      });
    }

    /**
     * Returns the parsed JSON request body, or {} for missing bodies.
     * Bodies beyond the cap throw before any handler runs.
     */
    async json(): Promise<unknown> {
      const contentType = this.request.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return {};
      }

      const declared = this.request.headers.get("content-length");
      if (declared !== null && declared !== "") {
        const parsed = Number.parseInt(declared, 10);
        if (Number.isFinite(parsed) && parsed > this.maxBodyBytes) {
          throw new Error(BODY_TOO_LARGE_MESSAGE);
        }
      }

      const text = await readBoundedText(this.request, this.maxBodyBytes);
      if (!text || text.trim() === "") {
        return {};
      }

      return JSON.parse(text);
    }

    /** Buffers the full JSON response body. Content-Type is fixed by toResponse. */
    send(body: string): void {
      if (this.aborted) {
        return;
      }

      this.body = body;
    }

    /** Registers a callback for when the request is aborted. */
    onClose(callback: () => void): void {
      this.closeCallbacks.push(callback);
      if (this.aborted) {
        callback();
      }
    }

    /** Builds a buffered JSON response after a procedure completes. */
    toResponse(): Response {
      return new Response(this.body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Reads a request body as text without exceeding the byte cap.
   * Pure Web Standards implementation shared by the fetch adapter.
   */
  async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
    const reader = request.body?.getReader?.();
    if (!reader) {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > maxBytes) {
        throw new Error(BODY_TOO_LARGE_MESSAGE);
      }
      return text;
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          total += value.length;
          if (total > maxBytes) {
            throw new Error(BODY_TOO_LARGE_MESSAGE);
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed.
      }
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(merged);
  }

  /**
   * Extracts RPC and procedure names from a URL path.
   */
  export function parseRpcPath(
    url: string | URL,
    prefix?: string,
  ): { rpcName: string; procName: string } | null {
    const parsedUrl = typeof url === "string" ? new URL(url) : url;
    let pathname = parsedUrl.pathname;

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
   * Options for createFetchHandler.
   */
  export interface FetchHandlerOptions {
    /**
     * URL path prefix to strip before parsing RPC/procedure names.
     * Example: "/rpc" or "/api/v1"
     */
    prefix?: string;
  }

  /**
   * Creates a Fetch API compatible request handler for a VDL HTTP RPC server.
   *
   * Mount it under the RPC base path; segments below the mount point must be
   * /{rpc}/{procedure} using the VPP-2 lowerFirst transport form.
   * Only POST requests route to procedures (anything else gets 405).
   * Paths without exactly two segments get 404.
   *
   * @param server - The VDL Server instance
   * @param createContext - Optional function to create the context (props) from the request
   * @param options - Handler options including path prefix
   * @returns A function that handles Fetch API requests
   */
  export function createFetchHandler<T = unknown>(
    server: Server<T>,
    createContext?: (req: Request) => T | Promise<T>,
    options?: FetchHandlerOptions,
  ): (req: Request) => Promise<Response> {
    if (!server) {
      throw new Error("createFetchHandler requires a non-null Server");
    }

    const prefix = options?.prefix;

    return async (req: Request): Promise<Response> => {
      if (req.method !== "POST") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "method not allowed, use POST",
            },
          }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json",
              Allow: "POST",
            },
          },
        );
      }

      const parsed = parseRpcPath(req.url, prefix);
      if (!parsed) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: "Not found",
            },
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      let props: T;
      try {
        props = createContext ? await createContext(req) : (undefined as T);
      } catch (error) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "CONTEXT_ERROR",
              message: "Internal server error",
            },
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const adapter = new FetchAdapter(
        req,
        server.getMaxRequestBodyBytes(),
      );

      try {
        await server.handleRequest(
          props,
          parsed.rpcName,
          parsed.procName,
          adapter,
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Internal server error",
            },
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return adapter.toResponse();
    };
  }
`);
