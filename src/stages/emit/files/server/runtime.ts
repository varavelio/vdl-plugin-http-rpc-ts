import { dedent } from "@varavel/vdl-plugin-sdk/utils/strings";

/**
 * Returns the raw shared server runtime source.
 */
export function renderServerRuntimeSource(): string {
  return SERVER_RUNTIME.trim();
}

const SERVER_RUNTIME = dedent(/* ts */ `
  /**
   * Any JSON value: the only payload shape adapters and the runtime exchange.
   * Anything else (byte streams, form data, platform objects) is unsupported
   * and rejected by the type system, not detected at runtime.
   */
  export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

  /**
   * HTTPAdapter defines the interface required by the RPC server to handle
   * incoming HTTP requests and write procedure responses.
   *
   * This abstraction allows the server to work with different HTTP frameworks
   * (Express, Fastify, standard http, etc.) while maintaining the same core functionality.
   */
  export interface HTTPAdapter {
    /**
     * Returns the bounded request payload: buffered text, a pre-parsed
     * framework value, or null when the request carries no body.
     * Adapters never interpret the payload; the runtime applies all
     * request policies (empty input, JSON parsing, size re-check).
     * Payloads beyond the configured cap throw before anything is returned.
     */
    readBody(): Promise<JsonValue | null>;

    /**
     * Sends one response with the given status, headers, and body.
     * Adapters apply the triple blindly and close the response as their
     * platform requires. The runtime always decides the three values,
     * so custom adapters need no protocol knowledge to answer correctly.
     */
    send(status: number, headers: Record<string, string>, body: string): void;

    /**
     * Registers a callback to be invoked when the connection is closed by the client.
     * Used to cancel procedure handling when the client disconnects.
     */
    onClose(callback: () => void): void;
  }

  /**
   * Default maximum request body size: 4 MiB.
   */
  const defaultMaxRequestBodyBytes = 4 * 1024 * 1024;

  /**
   * Fallback envelope written when a response cannot be encoded.
   * It stays generic so internals never reach the client.
   */
  const GENERIC_ERROR_ENVELOPE = '{"ok":false,"error":{"message":"Internal error"}}';

  /**
   * HandlerContext is the unified container for all request information and state
   * that flows through the entire request processing pipeline.
   *
   * @typeParam T - The application context type containing dependencies and request-scoped data.
   * @typeParam I - The input payload type for this procedure.
   */
  export class HandlerContext<T, I> {
    /** User-defined container for application dependencies and request data. */
    public props: T;

    /** The request input, already deserialized and typed. */
    public input: I;

    /** Signal for cancellation (client disconnects). */
    public signal: AbortSignal;

    /** Details of the procedure. */
    public readonly proc: ProcDefinition;

    constructor(
      props: T,
      input: I,
      signal: AbortSignal,
      proc: ProcDefinition,
    ) {
      this.props = props;
      this.input = input;
      this.signal = signal;
      this.proc = proc;
    }

    /** RPC service name resolved from the current procedure. */
    get rpcName(): string {
      return this.proc.rpcName;
    }

    /** LowerFirst transport segment for the RPC service. */
    get rpcRoute(): string {
      return this.proc.rpcRoute;
    }

    /** Procedure name resolved from the current proc. */
    get procName(): string {
      return this.proc.name;
    }

    /** VPP-2 transport path for the current procedure. */
    get path(): string {
      return this.proc.path;
    }

    /** Schema annotations preserved for this procedure. */
    get annotations(): Annotation[] {
      return this.proc.annotations;
    }

    /**
     * Reads request input as the expected type.
     * Use it in global middleware and error handlers, where input is unknown.
     */
    inputAs<O>(): O | undefined {
      return inputAs<O>(this.input);
    }
  }

  // -----------------------------------------------------------------------------
  // Middleware Types
  // -----------------------------------------------------------------------------

  /**
   * A handler function for global middleware.
   * At this level, input and output types are unknown.
   *
   * @typeParam T - The application context type (props).
   */
  export type GlobalHandlerFunc<T> = (c: HandlerContext<T, unknown>) => Promise<unknown>;

  /**
   * Middleware that applies to all procedure requests.
   * Wraps the next handler in the chain.
   *
   * @typeParam T - The application context type (props).
   */
  export type GlobalMiddlewareFunc<T> = (next: GlobalHandlerFunc<T>) => GlobalHandlerFunc<T>;

  /**
   * The core logic for a procedure.
   * Receives context with typed input and returns a Promise with typed output.
   *
   * @typeParam T - The application context type (props).
   * @typeParam I - The input payload type.
   * @typeParam O - The output payload type.
   */
  export type ProcHandlerFunc<T, I, O> = (c: HandlerContext<T, I>) => Promise<O>;

  /**
   * Middleware specific to procedures.
   * Can inspect or modify typed input and output.
   *
   * @typeParam T - The application context type (props).
   * @typeParam I - The input payload type.
   * @typeParam O - The output payload type.
   */
  export type ProcMiddlewareFunc<T, I, O> = (next: ProcHandlerFunc<T, I, O>) => ProcHandlerFunc<T, I, O>;

  /**
   * Internal function used to deserialize raw JSON input into typed objects.
   */
  type deserializerFunc = (raw: unknown) => Promise<unknown>;

  /**
   * Custom error handler used to transform arbitrary failures into VdlError responses.
   *
   * @typeParam T - The application context type (props).
   */
  export type ErrorHandlerFunc<T> = (c: HandlerContext<T, unknown>, error: unknown) => VdlError;

  // -----------------------------------------------------------------------------
  // Server Internal Implementation
  // -----------------------------------------------------------------------------

  /**
   * The core server engine used by generated server wrappers.
   *
   * This class manages request routing, middleware execution, input deserialization,
   * error handling, and VPP-2 envelope formatting for procedures.
   *
   * Do not instantiate directly. Use the generated server facade.
   *
   * @typeParam T - The application context type (props) containing dependencies.
   */
  class InternalServer<T> {
    private readonly procDefs: Map<string, Map<string, ProcDefinition>>;
    private readonly procHandlers: Map<string, Map<string, ProcHandlerFunc<T, any, any>>>;
    private readonly globalMiddlewares: GlobalMiddlewareFunc<T>[];
    private readonly rpcMiddlewares: Map<string, GlobalMiddlewareFunc<T>[]>;
    private readonly procMiddlewares: Map<string, Map<string, ProcMiddlewareFunc<T, any, any>[]>>;
    private readonly procDeserializers: Map<string, Map<string, deserializerFunc>>;
    private maxRequestBodyBytes: number = defaultMaxRequestBodyBytes;
    private globalErrorHandler?: ErrorHandlerFunc<T>;
    private readonly rpcErrorHandlers: Map<string, ErrorHandlerFunc<T>>;

    /**
     * Creates a new internal server.
     *
     * @param procDefs - Procedure definitions from the schema.
     */
    constructor(procDefs: ProcDefinition[]) {
      this.procDefs = new Map();
      this.procHandlers = new Map();
      this.globalMiddlewares = [];
      this.rpcMiddlewares = new Map();
      this.procMiddlewares = new Map();
      this.procDeserializers = new Map();
      this.rpcErrorHandlers = new Map();

      const ensureRPC = (rpcName: string) => {
        if (!this.procDefs.has(rpcName)) {
          this.procDefs.set(rpcName, new Map());
          this.procHandlers.set(rpcName, new Map());
          this.rpcMiddlewares.set(rpcName, []);
          this.procMiddlewares.set(rpcName, new Map());
          this.procDeserializers.set(rpcName, new Map());
        }
      };

      for (const def of procDefs) {
        ensureRPC(def.rpcName);
        this.procDefs.get(def.rpcName)?.set(def.name, def);
      }
    }

    /** Registers a global middleware. */
    addGlobalMiddleware(mw: GlobalMiddlewareFunc<T>): void {
      this.globalMiddlewares.push(mw);
    }

    /** Registers an RPC-level middleware. */
    addRPCMiddleware(rpcName: string, mw: GlobalMiddlewareFunc<T>): void {
      this.rpcMiddlewares.get(rpcName)?.push(mw);
    }

    /** Registers a procedure-specific middleware. */
    addProcMiddleware(rpcName: string, procName: string, mw: ProcMiddlewareFunc<T, any, any>): void {
      const rpcMap = this.procMiddlewares.get(rpcName);
      if (!rpcMap) {
        return;
      }

      if (!rpcMap.has(procName)) {
        rpcMap.set(procName, []);
      }

      rpcMap.get(procName)?.push(mw);
    }

    /** Registers a procedure handler with its input deserializer. */
    setProcHandler(
      rpcName: string,
      procName: string,
      handler: ProcHandlerFunc<T, any, any>,
      deserializer: deserializerFunc,
    ): void {
      const rpcHandlers = this.procHandlers.get(rpcName);
      if (!rpcHandlers) {
        throw new Error("Unknown RPC service: " + rpcName);
      }

      if (rpcHandlers.has(procName)) {
        throw new Error("Procedure handler for " + rpcName + "." + procName + " is already registered");
      }

      rpcHandlers.set(procName, handler);
      this.procDeserializers.get(rpcName)?.set(procName, deserializer);
    }

    /** Sets the global error handler. */
    setGlobalErrorHandler(fn: ErrorHandlerFunc<T>): void {
      this.globalErrorHandler = fn;
    }

    /** Sets an RPC-specific error handler. */
    setRPCErrorHandler(rpcName: string, fn: ErrorHandlerFunc<T>): void {
      this.rpcErrorHandlers.set(rpcName, fn);
    }

    /**
     * Caps request body bytes accepted per procedure call.
     * Bodies beyond the cap fail closed with an ok:false envelope before any
     * handler or middleware runs. Values <= 0 restore the 4 MiB default.
     */
    setMaxRequestBodyBytes(n: number): void {
      this.maxRequestBodyBytes = n > 0 ? n : defaultMaxRequestBodyBytes;
    }

    /** Returns the active request body cap for adapter wiring. */
    getMaxRequestBodyBytes(): number {
      return this.maxRequestBodyBytes;
    }

    /**
     * Resolves an incoming RPC segment to its canonical procedure definition.
     * The RPC segment matches the VPP-2 lowerFirst transport form.
     */
    private lookupProc(
      rpcName: string,
      procName: string,
    ): { proc: ProcDefinition; rpcName: string } | undefined {
      for (const [canonicalRPC, procs] of this.procDefs) {
        const proc = procs.get(procName);
        if (proc && (canonicalRPC === rpcName || proc.rpcRoute === rpcName)) {
          return { proc, rpcName: canonicalRPC };
        }
      }

      return undefined;
    }

    /** Handles one incoming procedure request. */
    async handleRequest(props: T, rpcName: string, procName: string, adapter: HTTPAdapter): Promise<void> {
      if (!adapter) {
        throw new Error("HTTPAdapter is required");
      }

      let payload: JsonValue | null;
      try {
        payload = await adapter.readBody();
      } catch (error) {
        this.writeProcResponse(adapter, {
          ok: false,
          error: this.toBodyError(error),
        });
        return;
      }

      let rawInput: unknown;
      if (payload === null || payload === undefined) {
        rawInput = {};
      } else if (typeof payload === "string") {
        if (payload.trim() === "") {
          rawInput = {};
        } else {
          if (new TextEncoder().encode(payload).length > this.maxRequestBodyBytes) {
            this.writeProcResponse(adapter, {
              ok: false,
              error: this.toBodyError(new Error("Request body too large")),
            });
            return;
          }
          try {
            rawInput = JSON.parse(payload);
          } catch (error) {
            this.writeProcResponse(adapter, {
              ok: false,
              error: this.toBodyError(error),
            });
            return;
          }
        }
      } else {
        rawInput = payload;
      }

      const resolved = this.lookupProc(rpcName, procName);
      if (!resolved) {
        this.writeProcResponse(adapter, {
          ok: false,
          error: new VdlError({
            message: "Not found",
            code: "INVALID_PROCEDURE",
            category: "ClientError",
          }),
        });
        return;
      }

      const abortController = new AbortController();
      adapter.onClose(() => abortController.abort());

      const ctx = new HandlerContext<T, unknown>(
        props,
        rawInput,
        abortController.signal,
        cloneProcDefinition(resolved.proc),
      );

      let response: Response<unknown>;
      try {
        const output = await this.handleProcRequest(ctx, resolved.rpcName, resolved.proc.name);
        response = resolved.proc.hasOutput
          ? { ok: true, output }
          : ({ ok: true } as Response<unknown>);
      } catch (error) {
        response = {
          ok: false,
          error: this.resolveErrorHandler(resolved.rpcName)(ctx, error),
        };
      }

      this.writeProcResponse(adapter, response);
    }

    /**
     * Maps body read failures to public envelopes.
     * Oversized bodies fail closed before any handler runs.
     */
    private toBodyError(error: unknown): VdlError {
      if (String((error as Error)?.message ?? error).includes("too large")) {
        return new VdlError({ message: "Request body too large" });
      }

      return new VdlError({
        message: "Invalid request body",
        details: { originalError: String(error) },
      });
    }

    /** Resolves the effective error handler for one RPC service. */
    private resolveErrorHandler(rpcName: string): ErrorHandlerFunc<T> {
      const rpcHandler = this.rpcErrorHandlers.get(rpcName);
      if (rpcHandler) {
        return rpcHandler;
      }

      if (this.globalErrorHandler) {
        return this.globalErrorHandler;
      }

      // Default: sanitized. Internal details never reach the client.
      // VdlError failures (validation, handler errors) pass through untouched.
      // Custom handlers receive the raw error and decide what to expose.
      return (_ctx, error) =>
        error instanceof VdlError
          ? error
          : new VdlError({ message: "Internal error" });
    }

    /** Executes one procedure including all middleware layers. */
    private async handleProcRequest(c: HandlerContext<T, unknown>, rpcName: string, procName: string): Promise<unknown> {
      const baseHandler = this.procHandlers.get(rpcName)?.get(procName);
      const deserialize = this.procDeserializers.get(rpcName)?.get(procName);
      if (!baseHandler || !deserialize) {
        throw new Error(rpcName + "." + procName + " procedure not implemented");
      }

      c.input = await deserialize(c.input);

      let next: GlobalHandlerFunc<T> = (ctx) => baseHandler(ctx as HandlerContext<T, any>);

      const procMws = this.procMiddlewares.get(rpcName)?.get(procName) ?? [];
      if (procMws.length > 0) {
        let procNext = baseHandler;
        for (let index = procMws.length - 1; index >= 0; index -= 1) {
          procNext = procMws[index](procNext);
        }
        next = (ctx) => procNext(ctx as HandlerContext<T, any>);
      }

      const rpcMws = this.rpcMiddlewares.get(rpcName) ?? [];
      for (let index = rpcMws.length - 1; index >= 0; index -= 1) {
        next = rpcMws[index](next);
      }

      for (let index = this.globalMiddlewares.length - 1; index >= 0; index -= 1) {
        next = this.globalMiddlewares[index](next);
      }

      return next(c);
    }

    /**
     * Writes one standard JSON procedure response with HTTP 200 semantics.
     * Encoding failures fall back to a generic envelope.
     */
    private writeProcResponse(adapter: HTTPAdapter, response: Response<unknown>): void {
      const headers = { "Content-Type": "application/json" };
      try {
        adapter.send(200, headers, JSON.stringify(response));
      } catch {
        adapter.send(200, headers, GENERIC_ERROR_ENVELOPE);
      }
    }
  }
`);
