import { newGenerator } from "@varavel/gen";
import type { PluginOutputFile } from "@varavel/vdl-plugin-sdk";
import { writeDocComment } from "../../../../shared/comments";
import { renderTypeScriptFile } from "../../../../shared/render-ts-file";
import type {
  GeneratorContext,
  ProcDescriptor,
  ServiceDescriptor,
} from "../../../model/types";
import { renderCatalogSource } from "../shared/catalog";
import { renderCoreSource } from "../shared/core";
import { renderClientRuntimeSource } from "./runtime";

/**
 * Emits the generated client target.
 */
export function generateClientFile(
  context: GeneratorContext,
): PluginOutputFile {
  const g = newGenerator().withSpaces(2);

  g.line(
    `import * as vdlTypes from ${JSON.stringify(context.options.typesImport)};`,
  );
  g.break();

  g.raw(renderCatalogSource(context));
  g.break();
  g.raw(renderCoreSource());
  g.break();
  g.raw(renderClientRuntimeSource());
  g.break();
  renderClientFacade(g, context);

  return {
    path: "client.ts",
    content: renderTypeScriptFile(g.toString()),
  };
}

/**
 * Emits the generated public client API and typed proc builders.
 */
function renderClientFacade(
  g: ReturnType<typeof newGenerator>,
  context: GeneratorContext,
): void {
  writeDocComment(g, {
    fallback: "Creates a new VDL HTTP RPC client builder.",
  });
  g.line("export function NewClient(baseURL: string): ClientBuilder {");
  g.block(() => {
    g.line("return new ClientBuilder(baseURL);");
  });
  g.line("}");
  g.break();

  writeDocComment(g, {
    fallback: "Fluent builder for configuring a generated RPC client.",
  });
  g.line("export class ClientBuilder {");
  g.block(() => {
    g.line("private readonly builder: clientBuilder;");
    g.break();

    g.line("constructor(baseURL: string) {");
    g.block(() => {
      g.line("this.builder = new clientBuilder(baseURL, VDLProcs);");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Sets a custom fetch implementation for the generated client.",
    });
    g.line("withCustomFetch(fetchFn: FetchLike): ClientBuilder {");
    g.block(() => {
      g.line("this.builder.withFetch(fetchFn);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Adds a static header that will be sent with every request.",
    });
    g.line("withGlobalHeader(key: string, value: string): ClientBuilder {");
    g.block(() => {
      g.line("this.builder.withGlobalHeader(key, value);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback:
        "Adds a dynamic header provider that runs before every request attempt.",
    });
    g.line("withHeaderProvider(provider: HeaderProvider): ClientBuilder {");
    g.block(() => {
      g.line("this.builder.withHeaderProvider(provider);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Adds an interceptor around generated client execution.",
    });
    g.line("withInterceptor(interceptor: Interceptor): ClientBuilder {");
    g.block(() => {
      g.line("this.builder.withInterceptor(interceptor);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback:
        "Sets the global default retry policy for generated procedures.",
    });
    g.line("withGlobalRetryConfig(conf: RetryConfig): ClientBuilder {");
    g.block(() => {
      g.line("this.builder.withGlobalRetryConfig(conf);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Sets the global default timeout for generated procedures.",
    });
    g.line("withGlobalTimeoutConfig(conf: TimeoutConfig): ClientBuilder {");
    g.block(() => {
      g.line("this.builder.withGlobalTimeoutConfig(conf);");
      g.line("return this;");
    });
    g.line("}");
    g.break();
    writeDocComment(g, {
      fallback: "Sets the global retry policy for generated procedures.",
    });
    g.line("withRetries(config: Partial<RetryConfig>): ClientBuilder {");
    g.block(() => {
      g.line(
        "this.builder.withGlobalRetryConfig(normalizeRetryConfig(config, 3));",
      );
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Sets the global timeout policy for generated procedures.",
    });
    g.line("withTimeout(config: Partial<TimeoutConfig>): ClientBuilder {");
    g.block(() => {
      g.line(
        "this.builder.withGlobalTimeoutConfig(normalizeTimeoutConfig(config));",
      );
      g.line("return this;");
    });
    g.line("}");
    g.break();
    writeDocComment(g, {
      fallback:
        "Caps response body bytes accepted per call. Values <= 0 restore the 4 MiB default.",
    });
    g.line("withMaxResponseBodyBytes(n: number): ClientBuilder {");
    g.block(() => {
      g.line("this.builder.withMaxResponseBodyBytes(n);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Builds the configured client instance.",
    });
    g.line("build(): Client {");
    g.block(() => {
      g.line("return new Client(this.builder.build());");
    });
    g.line("}");
  });
  g.line("}");
  g.break();

  writeDocComment(g, {
    fallback:
      "Main VDL HTTP RPC client exposing typed access to generated procedures.",
  });
  g.line("export class Client {");
  g.block(() => {
    g.line("private readonly intClient: internalClient;");
    g.line("public readonly rpcs: ClientRPCRegistry;");
    g.line("public readonly procs: ProcRegistry;");
    g.break();

    g.line("constructor(intClient: internalClient) {");
    g.block(() => {
      g.line("this.intClient = intClient;");
      g.line("this.rpcs = new ClientRPCRegistry(intClient);");
      g.line("this.procs = new ProcRegistry(intClient);");
    });
    g.line("}");
  });
  g.line("}");
  g.break();

  renderRPCRegistry(g, context);
  renderProcedureRegistry(g, context);
}

/**
 * Emits the top-level RPC registry for the generated client.
 */
function renderRPCRegistry(
  g: ReturnType<typeof newGenerator>,
  context: GeneratorContext,
): void {
  writeDocComment(g, {
    fallback: "Registry exposing every generated HTTP RPC service.",
  });
  g.line("class ClientRPCRegistry {");
  g.block(() => {
    g.line("private readonly intClient: internalClient;");
    g.line("constructor(intClient: internalClient) {");
    g.block(() => {
      g.line("this.intClient = intClient;");
    });
    g.line("}");
    g.break();

    for (const service of context.services) {
      writeDocComment(g, {
        doc: service.doc,
        annotations: service.annotations,
        fallback: `Access the ${service.name} RPC service.`,
      });
      g.line(
        `${service.accessorName}(): Client${service.name}RPC { return new Client${service.name}RPC(this.intClient); }`,
      );
      g.break();
    }
  });
  g.line("}");
  g.break();

  for (const service of context.services) {
    renderRPCClientClass(g, service);
    renderRPCProcedureRegistry(g, service);
  }
}

/**
 * Emits one client-side RPC service accessor with per-RPC configuration.
 */
function renderRPCClientClass(
  g: ReturnType<typeof newGenerator>,
  service: ServiceDescriptor,
): void {
  writeDocComment(g, {
    doc: service.doc,
    annotations: service.annotations,
    fallback: `Client-side access point for the ${service.name} RPC service and its defaults.`,
  });
  g.line(`class Client${service.name}RPC {`);
  g.block(() => {
    g.line("private readonly intClient: internalClient;");
    g.line(`public readonly procs: Client${service.name}Procs;`);
    g.break();

    g.line("constructor(intClient: internalClient) {");
    g.block(() => {
      g.line("this.intClient = intClient;");
      g.line(`this.procs = new Client${service.name}Procs(intClient);`);
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: `Adds a static default header for every ${service.name} request.`,
    });
    g.line(
      `withHeader(key: string, value: string): Client${service.name}RPC {`,
    );
    g.block(() => {
      g.line(
        `this.intClient.setRPCHeaderProvider(${JSON.stringify(service.name)}, (headers) => { headers[key] = value; });`,
      );
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: `Adds a dynamic default header provider for every ${service.name} request.`,
    });
    g.line(
      `withHeaderProvider(provider: HeaderProvider): Client${service.name}RPC {`,
    );
    g.block(() => {
      g.line(
        `this.intClient.setRPCHeaderProvider(${JSON.stringify(service.name)}, provider);`,
      );
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: `Adds an interceptor for every ${service.name} request.`,
    });
    g.line(
      `withInterceptor(interceptor: Interceptor): Client${service.name}RPC {`,
    );
    g.block(() => {
      g.line("this.intClient.addInterceptor(interceptor);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: `Sets the retry policy for procedures in ${service.name}.`,
    });
    g.line(
      `withRetries(config: Partial<RetryConfig>): Client${service.name}RPC {`,
    );
    g.block(() => {
      g.line(
        `this.intClient.setRPCRetryConfig(${JSON.stringify(service.name)}, normalizeRetryConfig(config, 3));`,
      );
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: `Sets the timeout policy for procedures in ${service.name}.`,
    });
    g.line(
      `withTimeout(config: Partial<TimeoutConfig>): Client${service.name}RPC {`,
    );
    g.block(() => {
      g.line(
        `this.intClient.setRPCTimeoutConfig(${JSON.stringify(service.name)}, normalizeTimeoutConfig(config));`,
      );
      g.line("return this;");
    });
    g.line("}");
    g.break();

    for (const procedure of service.procs) {
      writeDocComment(g, {
        doc: procedure.doc,
        annotations: procedure.annotations,
        fallback: `Creates a call builder for ${service.name}.${procedure.name}.`,
      });
      g.line(
        `${procedure.serverMethodName}(): Proc${procedure.rpcName}${procedure.name}Builder { return new Proc${procedure.rpcName}${procedure.name}Builder(this.intClient, ${JSON.stringify(procedure.rpcName)}, ${JSON.stringify(procedure.name)}); }`,
      );
      g.break();
    }
  });
  g.line("}");
  g.break();
}

/**
 * Emits the procedure registry for one RPC service.
 */
function renderRPCProcedureRegistry(
  g: ReturnType<typeof newGenerator>,
  service: ServiceDescriptor,
): void {
  writeDocComment(g, {
    fallback: `Registry exposing every generated procedure builder for ${service.name}.`,
  });
  g.line(`class Client${service.name}Procs {`);
  g.block(() => {
    g.line("private readonly intClient: internalClient;");
    g.line("constructor(intClient: internalClient) {");
    g.block(() => {
      g.line("this.intClient = intClient;");
    });
    g.line("}");
    g.break();

    for (const procedure of service.procs) {
      writeDocComment(g, {
        doc: procedure.doc,
        annotations: procedure.annotations,
        fallback: `Creates a call builder for ${service.name}.${procedure.name}.`,
      });
      g.line(
        `${procedure.serverMethodName}(): Proc${procedure.rpcName}${procedure.name}Builder { return new Proc${procedure.rpcName}${procedure.name}Builder(this.intClient, ${JSON.stringify(procedure.rpcName)}, ${JSON.stringify(procedure.name)}); }`,
      );
      g.break();
    }
  });
  g.line("}");
  g.break();
}

/**
 * Emits the flattened procedure registry.
 */
function renderProcedureRegistry(
  g: ReturnType<typeof newGenerator>,
  context: GeneratorContext,
): void {
  writeDocComment(g, {
    fallback: "Registry exposing every generated procedure builder.",
  });
  g.line("class ProcRegistry {");
  g.block(() => {
    g.line("private readonly intClient: internalClient;");
    g.line("constructor(intClient: internalClient) {");
    g.block(() => {
      g.line("this.intClient = intClient;");
    });
    g.line("}");
    g.break();

    for (const procedure of context.procs) {
      writeDocComment(g, {
        doc: procedure.doc,
        annotations: procedure.annotations,
        fallback: `Creates a call builder for ${procedure.rpcName}.${procedure.name}.`,
      });
      g.line(
        `${procedure.clientMethodName}(): Proc${procedure.rpcName}${procedure.name}Builder { return new Proc${procedure.rpcName}${procedure.name}Builder(this.intClient, ${JSON.stringify(procedure.rpcName)}, ${JSON.stringify(procedure.name)}); }`,
      );
      g.break();
    }
  });
  g.line("}");
  g.break();

  for (const procedure of context.procs) {
    renderProcedureBuilder(g, procedure);
  }
}

/**
 * Returns the runtime type reference used in generated client signatures.
 */
function renderRuntimeTypeReference(typeName?: string): string {
  return typeName ? `vdlTypes.${typeName}` : "Void";
}

/**
 * Returns the runtime helper reference used for validation and hydration.
 */
function renderRuntimeHelperReference(typeName?: string): string {
  return typeName ? `vdlTypes.${typeName}` : "Void";
}

/**
 * Emits one typed procedure builder.
 */
function renderProcedureBuilder(
  g: ReturnType<typeof newGenerator>,
  proc: ProcDescriptor,
): void {
  const inputType = renderRuntimeTypeReference(proc.inputTypeName);
  const outputType = renderRuntimeTypeReference(proc.outputTypeName);
  const inputHelper = renderRuntimeHelperReference(proc.inputTypeName);
  const outputHelper = renderRuntimeHelperReference(proc.outputTypeName);
  const executeSignature = proc.inputTypeName
    ? `async execute(input: ${inputType}): Promise<${outputType}>`
    : `async execute(input: Void = {}): Promise<${outputType}>`;

  g.line(`class Proc${proc.rpcName}${proc.name}Builder {`);
  g.block(() => {
    g.line("private readonly intClient: internalClient;");
    g.line("private readonly rpcName: string;");
    g.line("private readonly procName: string;");
    g.line("private readonly headerProviders: HeaderProvider[] = [];");
    g.line("private retryConfig?: RetryConfig;");
    g.line("private timeoutConfig?: TimeoutConfig;");
    g.line("private signal?: AbortSignal;");
    g.break();

    g.line(
      "constructor(intClient: internalClient, rpcName: string, procName: string) {",
    );
    g.block(() => {
      g.line("this.intClient = intClient;");
      g.line("this.rpcName = rpcName;");
      g.line("this.procName = procName;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Adds a static header to this procedure call.",
    });
    g.line(
      `withHeader(key: string, value: string): Proc${proc.rpcName}${proc.name}Builder {`,
    );
    g.block(() => {
      g.line(
        "this.headerProviders.push((headers) => { headers[key] = value; });",
      );
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback:
        "Adds a dynamic header provider to this procedure call. The provider runs on every attempt, including retries.",
    });
    g.line(
      `withHeaderProvider(provider: HeaderProvider): Proc${proc.rpcName}${proc.name}Builder {`,
    );
    g.block(() => {
      g.line("this.headerProviders.push(provider);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback:
        "Configures retry behavior for this procedure call. The optional shouldRetry callback receives the resolved proc metadata, including annotations.",
    });
    g.line(
      `withRetries(config: Partial<RetryConfig>): Proc${proc.rpcName}${proc.name}Builder {`,
    );
    g.block(() => {
      g.line("this.retryConfig = normalizeRetryConfig(config, 3);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Configures timeout behavior for this procedure call.",
    });
    g.line(
      `withTimeout(config: Partial<TimeoutConfig>): Proc${proc.rpcName}${proc.name}Builder {`,
    );
    g.block(() => {
      g.line("this.timeoutConfig = normalizeTimeoutConfig(config);");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback:
        "Sets an external AbortSignal used to cancel this procedure call.",
    });
    g.line(
      `withSignal(signal: AbortSignal): Proc${proc.rpcName}${proc.name}Builder {`,
    );
    g.block(() => {
      g.line("this.signal = signal;");
      g.line("return this;");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      doc: proc.doc,
      annotations: proc.annotations,
      fallback: `Executes ${proc.rpcName}.${proc.name}.`,
    });
    g.line(`${executeSignature} {`);
    g.block(() => {
      g.line(`const validationError = ${inputHelper}.validate(input);`);
      g.line("if (validationError !== null) {");
      g.block(() => {
        g.line(
          'throw new VdlError({ message: validationError, code: "INVALID_INPUT", category: "ValidationError" });',
        );
      });
      g.line("}");
      g.line(
        "const rawResponse = await this.intClient.callProc(this.rpcName, this.procName, input, this.headerProviders, this.retryConfig, this.timeoutConfig, this.signal);",
      );
      g.line("if (!rawResponse.ok) {");
      g.block(() => {
        g.line("throw rawResponse.error;");
      });
      g.line("}");
      g.line(
        `return ${outputHelper}.hydrate(rawResponse.output as ${outputType});`,
      );
    });
    g.line("}");
  });
  g.line("}");
  g.break();
}
