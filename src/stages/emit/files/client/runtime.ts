import { dedent } from "@varavel/vdl-plugin-sdk/utils/strings";

/**
 * Returns the raw shared client runtime source.
 */
export function renderClientRuntimeSource(): string {
  return CLIENT_RUNTIME.trim();
}

const CLIENT_RUNTIME = dedent(/* ts */ `
  /**
   * Context provided to a retry decider.
   */
  export interface RetryDecisionContext {
    /** Current attempt number, starting at 1. */
    attempt: number;
    /** Maximum configured attempts. */
    maxAttempts: number;
    /** Error produced by the current attempt. */
    error: VdlError;
    /** Original input payload. */
    input: unknown;
    /** Resolved procedure metadata, including annotations. */
    proc?: ProcDefinition;
    /** Whether the generated runtime would retry without custom logic. */
    defaultRetryable: boolean;
  }

  /**
   * Controls automatic retry behavior for procedure calls.
   *
   * When a request fails due to network errors, timeouts, or 5xx HTTP status codes,
   * the client can automatically retry using exponential backoff.
   */
  export interface RetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    delayMultiplier: number;
    jitter: number;
    shouldRetry?: (context: RetryDecisionContext) => boolean | Promise<boolean>;
  }

  /**
   * Controls request timeout behavior.
   *
   * If the server does not respond within the configured timeout, the request is aborted
   * and may be retried according to the effective retry configuration.
   */
  export interface TimeoutConfig {
    timeoutMs: number;
  }

  /**
   * A function that adds or modifies headers before each request.
   *
   * Header providers are executed in this order: global, RPC-level, procedure-level.
   * They run before every request attempt, including retries.
   */
  export type HeaderProvider = (
    headers: Record<string, string>,
  ) => void | Promise<void>;

  /**
   * Metadata about the current RPC request, passed to interceptors.
   */
  export interface RequestInfo {
    rpcName: string;
    procName: string;
    input: unknown;
    type: "proc";
    proc?: ProcDefinition;
  }

  /** Final function invoked by the interceptor chain. */
  export type Invoker = (req: RequestInfo) => Promise<Response<unknown>>;

  /** Request interceptor used by generated clients. */
  export type Interceptor = (
    req: RequestInfo,
    next: Invoker,
  ) => Promise<Response<unknown>>;

  /**
   * Minimal interface for a fetch response.
   * Compatible with the standard Fetch API and most polyfills.
   */
  export interface FetchLikeResponse {
    ok: boolean;
    status: number;
    body?: {
      getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(): Promise<void>;
      };
    } | null;
    headers?: {
      get(name: string): string | null;
    };
    json(): Promise<any>;
    text(): Promise<string>;
  }

  /**
   * Minimal interface for a fetch function.
   * Compatible with the standard Fetch API, node-fetch, and most polyfills.
   */
  export type FetchLike = (input: any, init?: any) => Promise<FetchLikeResponse>;

  /**
   * Default retry config: no retries (single attempt).
   */
  const defaultRetryConfig: RetryConfig = {
    maxAttempts: 1,
    initialDelayMs: 0,
    maxDelayMs: 0,
    delayMultiplier: 1,
    jitter: 0.2,
  };

  /**
   * Default timeout: 30 seconds.
   */
  const defaultTimeoutConfig: TimeoutConfig = {
    timeoutMs: 30000,
  };

  /**
   * Adds random jitter to a delay to prevent thundering herd effects.
   */
  function applyJitter(delayMs: number, jitterFactor: number): number {
    if (jitterFactor <= 0) {
      return delayMs;
    }

    const boundedJitter = Math.min(jitterFactor, 1);
    const delta = delayMs * boundedJitter;
    const min = Math.max(0, delayMs - delta);
    const max = delayMs + delta;
    return min + Math.random() * (max - min);
  }

  /**
   * Calculates exponential backoff delay for retry attempts.
   */
  function calculateBackoff(config: RetryConfig, attempt: number): number {
    let delay = config.initialDelayMs;
    for (let index = 1; index < attempt; index += 1) {
      delay *= config.delayMultiplier;
    }
    if (delay > config.maxDelayMs) {
      delay = config.maxDelayMs;
    }
    return applyJitter(delay, config.jitter);
  }

  /**
   * Normalizes retry config input into safe runtime values.
   */
  function normalizeRetryConfig(
    config: Partial<RetryConfig>,
    defaultAttempts = 1,
  ): RetryConfig {
    return {
      maxAttempts: Math.max(1, config.maxAttempts ?? defaultAttempts),
      initialDelayMs: Math.max(0, config.initialDelayMs ?? 0),
      maxDelayMs: Math.max(0, config.maxDelayMs ?? 0),
      delayMultiplier: Math.max(1, config.delayMultiplier ?? 1),
      jitter: Math.max(0, Math.min(1, config.jitter ?? 0.2)),
      ...(config.shouldRetry ? { shouldRetry: config.shouldRetry } : {}),
    };
  }

  /**
   * Normalizes timeout config input into safe runtime values.
   */
  function normalizeTimeoutConfig(config: Partial<TimeoutConfig>): TimeoutConfig {
    return {
      timeoutMs: Math.max(0, config.timeoutMs ?? defaultTimeoutConfig.timeoutMs),
    };
  }

  /**
   * Default maximum response body size: 4 MiB.
   */
  const defaultMaxResponseBodyBytes = 4 * 1024 * 1024;

  /**
   * Reads a response body as text without exceeding the byte cap.
   * Prefers the declared content length when present, then pumps the
   * reader when available and falls back to text() otherwise.
   */
  async function readBoundedText(
    response: FetchLikeResponse,
    maxBytes: number,
  ): Promise<string> {
    const declared = response.headers?.get("content-length");
    if (declared !== undefined && declared !== null && declared !== "") {
      const parsed = Number.parseInt(declared, 10);
      if (Number.isFinite(parsed) && parsed > maxBytes) {
        throw new Error("Response body too large");
      }
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = await response.text();
      if (new TextEncoder().encode(text).length > maxBytes) {
        throw new Error("Response body too large");
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
            throw new Error("Response body too large");
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
   * Internal JSON-RPC client executing VPP-2 procedures.
   *
   * This class handles request execution, retry logic, timeout handling,
   * header providers, and interceptors.
   *
   * Do not instantiate directly. Use the generated client builder.
   *
   * @internal
   */
  class internalClient {
    /** Base URL for all requests (trailing slashes are stripped). */
    private baseURL: string;

    /** The fetch implementation used for HTTP requests. */
    private fetchFn: FetchLike;

    /**
     * Registry of valid procedures.
     * Structure: rpcName -> procName -> ProcDefinition
     * Used to validate requests and fail fast on typos.
     */
    private procDefs: Map<string, Map<string, ProcDefinition>>;

    /** Global header providers applied to all requests. */
    private headerProviders: HeaderProvider[] = [];

    /** Interceptors applied to all requests (in registration order). */
    private interceptors: Interceptor[] = [];

    /** RPC-specific header providers. Key: rpcName. */
    private rpcHeaderProviders: Map<string, HeaderProvider[]> = new Map();

    // ---------------------------------------------------------------------------
    // Global Default Configurations
    // ---------------------------------------------------------------------------

    private globalRetryConf: RetryConfig | null = null;
    private globalTimeoutConf: TimeoutConfig | null = null;
    private maxResponseBodyBytes: number = defaultMaxResponseBodyBytes;
    // ---------------------------------------------------------------------------
    // Per-RPC Default Configurations
    // ---------------------------------------------------------------------------

    private rpcRetryConf: Map<string, RetryConfig> = new Map();
    private rpcTimeoutConf: Map<string, TimeoutConfig> = new Map();

    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------

    /**
     * Creates a new internal client.
     *
     * @throws If required runtime dependencies are missing.
     * @throws If no fetch implementation is available.
     */
    constructor(
      baseURL: string,
      procDefs: ProcDefinition[],
      opts: internalClientOption[],
    ) {
      this.verifyRuntimeDeps();

      this.baseURL = baseURL.replace(/[/]+$/gu, "");
      this.fetchFn = (globalThis.fetch ?? null) as FetchLike;
      this.maxResponseBodyBytes = defaultMaxResponseBodyBytes;
      this.procDefs = new Map();

      const ensureRPC = (rpcName: string) => {
        if (!this.procDefs.has(rpcName)) {
          this.procDefs.set(rpcName, new Map());
        }
      };

      for (const def of procDefs) {
        ensureRPC(def.rpcName);
        this.procDefs.get(def.rpcName)?.set(def.name, def);
      }

      for (const applyOption of opts) {
        applyOption(this);
      }

      if (!this.fetchFn) {
        throw new Error(
          "globalThis.fetch is undefined. Provide a custom fetch with withCustomFetch().",
        );
      }
    }

    /**
     * Verifies that required runtime APIs are available.
     */
    private verifyRuntimeDeps() {
      const missing: string[] = [];

      if (typeof AbortController !== "function") {
        missing.push("AbortController");
      }

      if (missing.length > 0) {
        throw new Error(
          "Missing required runtime dependencies: " +
            missing.join(", ") +
            ". Install the necessary polyfills or use a compatible environment.",
        );
      }
    }

    // ---------------------------------------------------------------------------
    // Configuration Setters (called by builder options)
    // ---------------------------------------------------------------------------

    /** Sets a custom fetch implementation. */
    setFetch(fetchFn: FetchLike): void {
      this.fetchFn = fetchFn;
    }

    /** Adds a global header provider. */
    addHeaderProvider(provider: HeaderProvider): void {
      this.headerProviders.push(provider);
    }

    /** Adds an interceptor to the chain. */
    addInterceptor(interceptor: Interceptor): void {
      this.interceptors.push(interceptor);
    }

    /** Sets the global default retry configuration. */
    setGlobalRetryConfig(conf: RetryConfig): void {
      this.globalRetryConf = normalizeRetryConfig(conf, conf.maxAttempts);
    }

    /** Sets the global default timeout configuration. */
    setGlobalTimeoutConfig(conf: TimeoutConfig): void {
      this.globalTimeoutConf = normalizeTimeoutConfig(conf);
    }

    /** Caps response body bytes accepted per call. Values <= 0 restore the default. */
    setMaxResponseBodyBytes(n: number): void {
      this.maxResponseBodyBytes = n > 0 ? n : defaultMaxResponseBodyBytes;
    }

    // ---------------------------------------------------------------------------
    // Per-RPC Configuration Setters
    // ---------------------------------------------------------------------------

    /** Sets the default retry config for a specific RPC. */
    setRPCRetryConfig(rpcName: string, conf: RetryConfig) {
      this.rpcRetryConf.set(rpcName, conf);
    }

    /** Sets the default timeout config for a specific RPC. */
    setRPCTimeoutConfig(rpcName: string, conf: TimeoutConfig) {
      this.rpcTimeoutConf.set(rpcName, conf);
    }

    /** Adds a header provider for a specific RPC. */
    setRPCHeaderProvider(rpcName: string, provider: HeaderProvider) {
      if (!this.rpcHeaderProviders.has(rpcName)) {
        this.rpcHeaderProviders.set(rpcName, []);
      }
      this.rpcHeaderProviders.get(rpcName)?.push(provider);
    }

    /**
     * Resolves one procedure definition.
     */
    private getProc(
      rpcName: string,
      procName: string,
    ): ProcDefinition | undefined {
      const proc = this.procDefs.get(rpcName)?.get(procName);
      if (!proc) {
        return undefined;
      }
      return cloneProcDefinition(proc);
    }

    /**
     * Resolves the effective retry configuration for a request.
     * Priority: procedure-level > RPC-level > global > built-in defaults.
     */
    private mergeRetryConfig(
      rpcName: string,
      opConf?: RetryConfig,
    ): RetryConfig {
      return {
        ...defaultRetryConfig,
        ...(this.globalRetryConf ?? {}),
        ...(this.rpcRetryConf.get(rpcName) ?? {}),
        ...(opConf ?? {}),
        ...(opConf?.shouldRetry
          ? { shouldRetry: opConf.shouldRetry }
          : this.rpcRetryConf.get(rpcName)?.shouldRetry
            ? { shouldRetry: this.rpcRetryConf.get(rpcName)?.shouldRetry }
          : this.globalRetryConf?.shouldRetry
            ? { shouldRetry: this.globalRetryConf.shouldRetry }
            : {}),
      };
    }

    /**
     * Resolves the effective timeout configuration for a request.
     * Priority: procedure-level > RPC-level > global > built-in defaults.
     */
    private mergeTimeoutConfig(
      rpcName: string,
      opConf?: TimeoutConfig,
    ): TimeoutConfig {
      return {
        ...defaultTimeoutConfig,
        ...(this.globalTimeoutConf ?? {}),
        ...(this.rpcTimeoutConf.get(rpcName) ?? {}),
        ...(opConf ?? {}),
      };
    }

    /**
     * Applies all header providers to a request headers.
     * Order: global providers -> RPC providers -> procedure providers.
     */
    private async applyHeaders(
      rpcName: string,
      headers: Record<string, string>,
      procHeaderProviders: HeaderProvider[],
    ): Promise<void> {
      for (const provider of this.headerProviders) {
        await provider(headers);
      }

      const rpcProviders = this.rpcHeaderProviders.get(rpcName) ?? [];
      for (const provider of rpcProviders) {
        await provider(headers);
      }

      for (const provider of procHeaderProviders) {
        await provider(headers);
      }
    }

    /**
     * Executes the interceptor chain around the provided invoker.
     */
    private async executeChain(
      reqInfo: RequestInfo,
      invoker: Invoker,
    ): Promise<Response<unknown>> {
      let next = invoker;
      for (let index = this.interceptors.length - 1; index >= 0; index -= 1) {
        const current = this.interceptors[index];
        const previousNext = next;
        next = (req) => current(req, previousNext);
      }
      return next(reqInfo);
    }

    /**
     * Evaluates whether the current failure should trigger another attempt.
     */
    private async shouldRetry(
      config: RetryConfig,
      context: RetryDecisionContext,
    ): Promise<boolean> {
      if (!config.shouldRetry) {
        return context.defaultRetryable;
      }

      return await config.shouldRetry(context);
    }

    /**
     * Executes one procedure call with retries, timeout, headers, and interceptors.
     */
    async callProc(
      rpcName: string,
      procName: string,
      input: unknown,
      procHeaderProviders: HeaderProvider[],
      procRetryConf?: RetryConfig,
      procTimeoutConf?: TimeoutConfig,
      procSignal?: AbortSignal,
    ): Promise<Response<any>> {
      if (procSignal?.aborted) {
        return {
          ok: false,
          error: new VdlError({
            message: "Request aborted",
            category: "ClientError",
            code: "ABORTED",
          }),
        };
      }

      const proc = this.getProc(rpcName, procName);
      const reqInfo: RequestInfo = {
        rpcName,
        procName,
        input,
        type: "proc",
        proc,
      };

      const invoker: Invoker = async (req) => {
        if (!proc) {
          return {
            ok: false,
            error: new VdlError({
              message:
                req.rpcName +
                "." +
                req.procName +
                " proc not found in schema",
              category: "ClientError",
              code: "INVALID_PROC",
              details: { rpc: req.rpcName, proc: req.procName },
            }),
          };
        }

        let payload: string;
        try {
          payload = req.input == null ? "{}" : JSON.stringify(req.input);
        } catch (error) {
          return {
            ok: false,
            error: new VdlError({
              message:
                "Failed to encode input for " +
                req.rpcName +
                "." +
                req.procName +
                ": " +
                String(error),
              category: "ClientError",
              code: "ENCODE_INPUT",
            }),
          };
        }

        const retryConf = this.mergeRetryConfig(req.rpcName, procRetryConf);
        const timeoutConf = this.mergeTimeoutConfig(req.rpcName, procTimeoutConf);
        const url = this.baseURL + (proc.path as string);
        let lastError: VdlError | null = null;

        for (let attempt = 1; attempt <= retryConf.maxAttempts; attempt += 1) {
          if (procSignal?.aborted) {
            return {
              ok: false,
              error: new VdlError({
                message: "Request aborted",
                category: "ClientError",
                code: "ABORTED",
              }),
            };
          }

          const abortController = new AbortController();
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const onExternalAbort = () => abortController.abort();
          procSignal?.addEventListener("abort", onExternalAbort);

          try {
            if (timeoutConf.timeoutMs > 0) {
              timeoutId = setTimeout(
                () => abortController.abort(),
                timeoutConf.timeoutMs,
              );
            }

            const headers: Record<string, string> = {
              "content-type": "application/json",
              accept: "application/json",
            };

            try {
              await this.applyHeaders(req.rpcName, headers, procHeaderProviders);
            } catch (error) {
              if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
              }
              procSignal?.removeEventListener("abort", onExternalAbort);
              return { ok: false, error: asError(error) };
            }

            const fetchResponse = await this.fetchFn(url, {
              method: "POST",
              headers,
              body: payload,
              signal: abortController.signal,
            });

            if (!fetchResponse) {
              const error = new VdlError({
                message: "Empty response from transport",
                category: "HTTPError",
                code: "BAD_RESPONSE",
              });
              const canRetry =
                attempt < retryConf.maxAttempts &&
                (await this.shouldRetry(retryConf, {
                  attempt,
                  maxAttempts: retryConf.maxAttempts,
                  error,
                  input,
                  proc,
                  defaultRetryable: true,
                }));

              if (canRetry) {
                lastError = error;
                await sleep(calculateBackoff(retryConf, attempt));
                continue;
              }

              return { ok: false, error };
            }

            if (timeoutId !== undefined) {
              clearTimeout(timeoutId);
            }
            procSignal?.removeEventListener("abort", onExternalAbort);

            if (fetchResponse.status >= 500) {
              const error = new VdlError({
                message:
                  "Unexpected HTTP status: " + String(fetchResponse.status),
                category: "HTTPError",
                code: "BAD_STATUS",
                details: { status: fetchResponse.status },
              });
              const canRetry =
                attempt < retryConf.maxAttempts &&
                (await this.shouldRetry(retryConf, {
                  attempt,
                  maxAttempts: retryConf.maxAttempts,
                  error,
                  input,
                  proc,
                  defaultRetryable: true,
                }));

              if (canRetry) {
                lastError = error;
                await sleep(calculateBackoff(retryConf, attempt));
                continue;
              }

              return { ok: false, error };
            }

            if (!fetchResponse.ok) {
              const error = new VdlError({
                message:
                  "Unexpected HTTP status: " + String(fetchResponse.status),
                category: "HTTPError",
                code: "BAD_STATUS",
                details: { status: fetchResponse.status },
              });
              const canRetry =
                attempt < retryConf.maxAttempts &&
                (await this.shouldRetry(retryConf, {
                  attempt,
                  maxAttempts: retryConf.maxAttempts,
                  error,
                  input,
                  proc,
                  defaultRetryable: false,
                }));

              if (canRetry) {
                lastError = error;
                await sleep(calculateBackoff(retryConf, attempt));
                continue;
              }

              return { ok: false, error };
            }

            try {
              const rawText = await readBoundedText(
                fetchResponse,
                this.maxResponseBodyBytes,
              );
              const json = JSON.parse(rawText) as
                | Response<any>
                | {
                    ok: false;
                    error: {
                      message?: string;
                      category?: string;
                      code?: string;
                      details?: Record<string, unknown>;
                    };
                  };
              if (!json.ok) {
                const error = new VdlError({
                  message: json.error.message ?? "Unknown error",
                  category: json.error.category,
                  code: json.error.code,
                  details: json.error.details,
                });
                const canRetry =
                  attempt < retryConf.maxAttempts &&
                  (await this.shouldRetry(retryConf, {
                    attempt,
                    maxAttempts: retryConf.maxAttempts,
                    error,
                    input,
                    proc,
                    defaultRetryable: false,
                  }));

                if (canRetry) {
                  lastError = error;
                  await sleep(calculateBackoff(retryConf, attempt));
                  continue;
                }

                return { ok: false, error };
              }

              return json;
            } catch (error) {
              const tooLarge =
                String((error as Error)?.message ?? error).includes(
                  "body too large",
                ) ||
                String(error).includes("body too large");
              const decodeError = tooLarge
                ? new VdlError({
                    message: "Response body too large",
                    category: "HTTPError",
                    code: "BODY_TOO_LARGE",
                  })
                : new VdlError({
                    message: "Failed to decode response: " + String(error),
                    category: "ClientError",
                    code: "DECODE_RESPONSE",
                  });
              const canRetry =
                attempt < retryConf.maxAttempts &&
                (await this.shouldRetry(retryConf, {
                  attempt,
                  maxAttempts: retryConf.maxAttempts,
                  error: decodeError,
                  input,
                  proc,
                  defaultRetryable: false,
                }));

              if (canRetry) {
                lastError = decodeError;
                await sleep(calculateBackoff(retryConf, attempt));
                continue;
              }

              return { ok: false, error: decodeError };
            }
          } catch (error) {
            if (timeoutId !== undefined) {
              clearTimeout(timeoutId);
            }
            procSignal?.removeEventListener("abort", onExternalAbort);

            if (procSignal?.aborted) {
              return {
                ok: false,
                error: new VdlError({
                  message: "Request aborted",
                  category: "ClientError",
                  code: "ABORTED",
                }),
              };
            }

            const normalizedError =
              abortController.signal.aborted && timeoutConf.timeoutMs > 0
                ? new VdlError({
                    message: "Request timeout",
                    category: "TimeoutError",
                    code: "REQUEST_TIMEOUT",
                    details: { attempt },
                  })
                : asError(error);

            const canRetry =
              attempt < retryConf.maxAttempts &&
              (await this.shouldRetry(retryConf, {
                attempt,
                maxAttempts: retryConf.maxAttempts,
                error: normalizedError,
                input,
                proc,
                defaultRetryable: true,
              }));

            if (canRetry) {
              lastError = normalizedError;
              await sleep(calculateBackoff(retryConf, attempt));
              continue;
            }

            return { ok: false, error: normalizedError };
          }
        }

        return {
          ok: false,
          error:
            lastError ??
            new VdlError({
              message: "Unknown error",
              category: "ClientError",
              code: "UNKNOWN",
            }),
        };
      };

      return this.executeChain(reqInfo, invoker) as Promise<Response<any>>;
    }
  }

  /**
   * Internal client option applied during client construction.
   */
  type internalClientOption = (client: internalClient) => void;

  /** Creates an option that replaces the fetch implementation. */
  function withFetch(fetchFn: FetchLike): internalClientOption {
    return (client) => client.setFetch(fetchFn);
  }

  /** Creates an option that appends one static global header provider. */
  function withGlobalHeader(key: string, value: string): internalClientOption {
    return (client) =>
      client.addHeaderProvider((headers) => {
        headers[key] = value;
      });
  }

  /** Creates an option that appends one dynamic global header provider. */
  function withHeaderProvider(provider: HeaderProvider): internalClientOption {
    return (client) => client.addHeaderProvider(provider);
  }

  /** Creates an option that appends one interceptor. */
  function withInterceptor(interceptor: Interceptor): internalClientOption {
    return (client) => client.addInterceptor(interceptor);
  }

  /** Creates an option that sets the global retry policy. */
  function withGlobalRetryConfig(conf: RetryConfig): internalClientOption {
    return (client) => client.setGlobalRetryConfig(conf);
  }

  /** Creates an option that sets the global timeout policy. */
  function withGlobalTimeoutConfig(conf: TimeoutConfig): internalClientOption {
    return (client) => client.setGlobalTimeoutConfig(conf);
  }

  /** Creates an option that caps response body bytes accepted per call. */
  function withMaxResponseBodyBytes(n: number): internalClientOption {
    return (client) => client.setMaxResponseBodyBytes(n);
  }

  /**
   * Fluent builder for constructing an internalClient with layered defaults.
   */
  class clientBuilder {
    private readonly baseURL: string;
    private readonly procDefs: ProcDefinition[];
    private readonly opts: internalClientOption[] = [];

    /** Creates a new builder bound to the generated procedure catalog. */
    constructor(baseURL: string, procDefs: ProcDefinition[]) {
      this.baseURL = baseURL;
      this.procDefs = procDefs;
    }

    /** Overrides the fetch implementation used by the internal client. */
    withFetch(fetchFn: FetchLike): clientBuilder {
      this.opts.push(withFetch(fetchFn));
      return this;
    }

    /** Appends one static global header provider. */
    withGlobalHeader(key: string, value: string): clientBuilder {
      this.opts.push(withGlobalHeader(key, value));
      return this;
    }

    /** Appends one dynamic global header provider. */
    withHeaderProvider(provider: HeaderProvider): clientBuilder {
      this.opts.push(withHeaderProvider(provider));
      return this;
    }

    /** Appends one interceptor to the global chain. */
    withInterceptor(interceptor: Interceptor): clientBuilder {
      this.opts.push(withInterceptor(interceptor));
      return this;
    }

    /** Sets the global retry policy default. */
    withGlobalRetryConfig(conf: RetryConfig): clientBuilder {
      this.opts.push(withGlobalRetryConfig(conf));
      return this;
    }

    /** Sets the global timeout policy default. */
    withGlobalTimeoutConfig(conf: TimeoutConfig): clientBuilder {
      this.opts.push(withGlobalTimeoutConfig(conf));
      return this;
    }

    /** Caps response body bytes accepted per call. Values <= 0 restore the default. */
    withMaxResponseBodyBytes(n: number): clientBuilder {
      this.opts.push(withMaxResponseBodyBytes(n));
      return this;
    }

    /** Builds the final internal client instance. */
    build(): internalClient {
      return new internalClient(this.baseURL, this.procDefs, this.opts);
    }
  }
`);
