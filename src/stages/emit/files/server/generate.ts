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
import { renderServerRuntimeSource } from "./runtime";

/**
 * Emits the generated server target.
 */
export function generateServerFile(
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
  g.raw(renderServerRuntimeSource());
  g.break();
  renderServerFacade(g, context);

  return {
    path: "server.ts",
    content: renderTypeScriptFile(g.toString()),
  };
}

/**
 * Emits the generated public server API and typed registration wrappers.
 */
function renderServerFacade(
  g: ReturnType<typeof newGenerator>,
  context: GeneratorContext,
): void {
  writeDocComment(g, {
    fallback:
      "Server provides the high-level, type-safe API for building a VDL HTTP RPC server.",
  });
  g.line("export class Server<T = unknown> {");
  g.block(() => {
    g.line("private readonly intServer: InternalServer<T>;");
    g.line("public readonly rpcs: ServerRPCRegistry<T>;");
    g.break();

    g.line("constructor() {");
    g.block(() => {
      g.line("this.intServer = new InternalServer<T>(VDLProcs);");
      g.line("this.rpcs = new ServerRPCRegistry<T>(this.intServer);");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Registers a global middleware that runs for every procedure.",
    });
    g.line("use(mw: GlobalMiddlewareFunc<T>): void {");
    g.block(() => {
      g.line("this.intServer.addGlobalMiddleware(mw);");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: "Sets the global error handler used by all RPC services.",
    });
    g.line("setErrorHandler(fn: ErrorHandlerFunc<T>): void {");
    g.block(() => {
      g.line("this.intServer.setGlobalErrorHandler(fn);");
    });
    g.line("}");
    g.break();
    writeDocComment(g, {
      fallback:
        "Caps request body bytes accepted per procedure call. Values <= 0 restore the 4 MiB default.",
    });
    g.line("setMaxRequestBodyBytes(n: number): void {");
    g.block(() => {
      g.line("this.intServer.setMaxRequestBodyBytes(n);");
    });
    g.line("}");
    g.break();
    writeDocComment(g, {
      fallback:
        "Returns the active request body cap used when wiring adapters.",
    });
    g.line("getMaxRequestBodyBytes(): number {");
    g.block(() => {
      g.line("return this.intServer.getMaxRequestBodyBytes();");
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback:
        "Processes one incoming procedure request using the provided HTTP adapter.",
    });
    g.line("async handleRequest(");
    g.block(() => {
      g.line("props: T,");
      g.line("rpcName: string,");
      g.line("procName: string,");
      g.line("httpAdapter: HTTPAdapter,");
    });
    g.line("): Promise<void> {");
    g.block(() => {
      g.line(
        "return this.intServer.handleRequest(props, rpcName, procName, httpAdapter);",
      );
    });
    g.line("}");
  });
  g.line("}");
  g.break();

  writeDocComment(g, {
    fallback: "Top-level registry exposing every generated RPC service.",
  });
  g.line("class ServerRPCRegistry<T> {");
  g.block(() => {
    g.line("private readonly intServer: InternalServer<T>;");
    g.line("constructor(intServer: InternalServer<T>) {");
    g.block(() => {
      g.line("this.intServer = intServer;");
    });
    g.line("}");
    g.break();

    for (const service of context.services) {
      renderServiceAccessor(g, service);
    }
  });
  g.line("}");
  g.break();

  for (const service of context.services) {
    renderServiceClass(g, service);
    renderProcedureRegistry(g, service);

    for (const procedure of service.procs) {
      renderProcedureEntry(g, procedure);
    }
  }
}

/**
 * Emits one service accessor on the top-level RPC registry.
 */
function renderServiceAccessor(
  g: ReturnType<typeof newGenerator>,
  service: ServiceDescriptor,
): void {
  writeDocComment(g, {
    doc: service.doc,
    annotations: service.annotations,
    fallback: `Access the ${service.name} RPC service.`,
  });
  g.line(
    `${service.accessorName}(): Server${service.name}RPC<T> { return new Server${service.name}RPC<T>(this.intServer); }`,
  );
  g.break();
}

/**
 * Emits the class that groups one service procedures.
 */
function renderServiceClass(
  g: ReturnType<typeof newGenerator>,
  service: ServiceDescriptor,
): void {
  writeDocComment(g, {
    doc: service.doc,
    annotations: service.annotations,
    fallback: `Typed registration surface for the ${service.name} RPC service.`,
  });
  g.line(`class Server${service.name}RPC<T> {`);
  g.block(() => {
    g.line("private readonly intServer: InternalServer<T>;");
    g.line(`public readonly procs: Server${service.name}Procs<T>;`);
    g.break();

    g.line("constructor(intServer: InternalServer<T>) {");
    g.block(() => {
      g.line("this.intServer = intServer;");
      g.line(`this.procs = new Server${service.name}Procs<T>(intServer);`);
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: `Registers a middleware for every ${service.name} procedure.`,
    });
    g.line("use(mw: GlobalMiddlewareFunc<T>): void {");
    g.block(() => {
      g.line(
        `this.intServer.addRPCMiddleware(${JSON.stringify(service.name)}, mw);`,
      );
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      fallback: `Sets an RPC-specific error handler for ${service.name}.`,
    });
    g.line("setErrorHandler(fn: ErrorHandlerFunc<T>): void {");
    g.block(() => {
      g.line(
        `this.intServer.setRPCErrorHandler(${JSON.stringify(service.name)}, fn);`,
      );
    });
    g.line("}");
  });
  g.line("}");
  g.break();
}

/**
 * Emits the typed procedure registry for one service.
 */
function renderProcedureRegistry(
  g: ReturnType<typeof newGenerator>,
  service: ServiceDescriptor,
): void {
  writeDocComment(g, {
    fallback: `Registry exposing every generated procedure entry for ${service.name}.`,
  });
  g.line(`class Server${service.name}Procs<T> {`);
  g.block(() => {
    g.line("private readonly intServer: InternalServer<T>;");
    g.line(
      "constructor(intServer: InternalServer<T>) { this.intServer = intServer; }",
    );
    g.break();

    for (const procedure of service.procs) {
      writeDocComment(g, {
        doc: procedure.doc,
        annotations: procedure.annotations,
        fallback: `Registers the ${service.name}.${procedure.name} procedure.`,
      });
      g.line(
        `${procedure.serverMethodName}(): Proc${service.name}${procedure.name}Entry<T> { return new Proc${service.name}${procedure.name}Entry<T>(this.intServer); }`,
      );
      g.break();
    }
  });
  g.line("}");
  g.break();
}

/**
 * Emits one typed procedure registration entry.
 */
function renderProcedureEntry(
  g: ReturnType<typeof newGenerator>,
  proc: ProcDescriptor,
): void {
  const inputType = renderRuntimeTypeReference(proc.inputTypeName);
  const outputType = renderRuntimeTypeReference(proc.outputTypeName);
  const inputHelper = renderRuntimeHelperReference(proc.inputTypeName);
  const outputHelper = renderRuntimeHelperReference(proc.outputTypeName);

  writeDocComment(g, {
    doc: proc.doc,
    annotations: proc.annotations,
    fallback: `Typed procedure registration entry for ${proc.rpcName}.${proc.name}.`,
  });
  g.line(`class Proc${proc.rpcName}${proc.name}Entry<T> {`);
  g.block(() => {
    g.line("private readonly intServer: InternalServer<T>;");
    g.line(
      "constructor(intServer: InternalServer<T>) { this.intServer = intServer; }",
    );
    g.break();

    writeDocComment(g, {
      doc: proc.doc,
      annotations: proc.annotations,
      fallback: `Registers a typed middleware for ${proc.rpcName}.${proc.name}.`,
    });
    g.line(
      `use(mw: ProcMiddlewareFunc<T, ${inputType}, ${outputType}>): void {`,
    );
    g.block(() => {
      g.line("const adapted: ProcMiddlewareFunc<T, any, any> = (next) => {");
      g.block(() => {
        g.line("return async (cGeneric) => {");
        g.block(() => {
          g.line(
            `const typedNext: ProcHandlerFunc<T, ${inputType}, ${outputType}> = async (c) => {`,
          );
          g.block(() => {
            g.line("cGeneric.props = c.props;");
            g.line("cGeneric.input = c.input;");
            g.line(`return (await next(cGeneric)) as ${outputType};`);
          });
          g.line("};");
          g.line("const typedChain = mw(typedNext);");
          g.line(
            `const cSpecific = new HandlerContext<T, ${inputType}>(cGeneric.props, cGeneric.input as ${inputType}, cGeneric.signal, cGeneric.proc);`,
          );
          g.line("return typedChain(cSpecific);");
        });
        g.line("};");
      });
      g.line("};");
      g.line(
        `this.intServer.addProcMiddleware(${JSON.stringify(proc.rpcName)}, ${JSON.stringify(proc.name)}, adapted);`,
      );
    });
    g.line("}");
    g.break();

    writeDocComment(g, {
      doc: proc.doc,
      annotations: proc.annotations,
      fallback: `Registers the business handler for ${proc.rpcName}.${proc.name}.`,
    });
    g.line(
      `handle(handler: ProcHandlerFunc<T, ${inputType}, ${outputType}>): void {`,
    );
    g.block(() => {
      g.line(
        "const adaptedHandler: ProcHandlerFunc<T, any, any> = async (cGeneric) => {",
      );
      g.block(() => {
        g.line(
          `const cSpecific = new HandlerContext<T, ${inputType}>(cGeneric.props, cGeneric.input as ${inputType}, cGeneric.signal, cGeneric.proc);`,
        );
        g.line("const output = await handler(cSpecific);");
        g.line(`const outputError = ${outputHelper}.validate(output);`);
        g.line("if (outputError !== null) {");
        g.block(() => {
          g.line(
            'throw new Error("Internal error: unexpected output for " + cSpecific.rpcName + "." + cSpecific.procName);',
          );
        });
        g.line("}");
        g.line("return output;");
      });
      g.line("};");
      g.break();
      g.line("const deserializer: deserializerFunc = async (raw) => {");
      g.block(() => {
        g.line(`const error = ${inputHelper}.validate(raw);`);
        g.line("if (error !== null) {");
        g.block(() => {
          g.line(
            'throw new VdlError({ message: error, code: "INVALID_INPUT", category: "ValidationError" });',
          );
        });
        g.line("}");
        g.line(`return ${inputHelper}.hydrate(raw as ${inputType});`);
      });
      g.line("};");
      g.line(
        `this.intServer.setProcHandler(${JSON.stringify(proc.rpcName)}, ${JSON.stringify(proc.name)}, adaptedHandler, deserializer);`,
      );
    });
    g.line("}");
  });
  g.line("}");
  g.break();
}

/**
 * Returns the runtime type reference used in generated server signatures.
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
