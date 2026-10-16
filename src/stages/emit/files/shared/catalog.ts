import { unwrapLiteral } from "@varavel/vdl-plugin-sdk/utils/ir";
import { indent } from "@varavel/vdl-plugin-sdk/utils/strings";
import { toLowerFirst } from "../../../../shared/naming";
import type { GeneratorContext, ProcDescriptor } from "../../../model/types";

/**
 * Returns runtime catalog metadata embedded into generated client and server files.
 */
export function renderCatalogSource(context: GeneratorContext): string {
  const procs = context.procs
    .map((proc) => `${renderProcDefinitionLiteral(proc)},`)
    .join("\n");

  const paths = context.services
    .map((service) => {
      const entries = service.procs
        .map(
          (proc) =>
            `    ${proc.name}: ${JSON.stringify(`/${toLowerFirst(proc.rpcName)}/${proc.name}`)},`,
        )
        .join("\n");

      return [`  ${service.name}: {`, entries, "  },"].join("\n");
    })
    .join("\n");

  return [
    "/**",
    " * VDLProcs lists every generated procedure definition with preserved schema metadata.",
    " * Use it for introspection, tracing, and building operation-aware tooling.",
    " */",
    "export const VDLProcs: ProcDefinition[] = [",
    procs,
    "] as const;",
    "",
    "/**",
    " * VDLPaths maps rpcName -> procName -> relative URL path.",
    " * Paths follow the VPP-2 canonical route rule with lowerFirst(RPCName).",
    " */",
    "export const VDLPaths = {",
    paths,
    "} as const;",
  ].join("\n");
}

/**
 * Renders one catalog entry literal from a procedure descriptor.
 */
function renderProcDefinitionLiteral(proc: ProcDescriptor): string {
  const annotations = proc.annotations.map((annotation) => ({
    name: annotation.name,
    ...(annotation.argument
      ? { argument: unwrapLiteral<unknown>(annotation.argument) }
      : {}),
  }));

  return indent(
    JSON.stringify(
      {
        rpcName: proc.rpcName,
        rpcRoute: toLowerFirst(proc.rpcName),
        name: proc.name,
        path: `/${toLowerFirst(proc.rpcName)}/${proc.name}`,
        hasInput: Boolean(proc.inputTypeName),
        hasOutput: Boolean(proc.outputTypeName),
        annotations,
      },
      null,
      2,
    ),
  );
}
