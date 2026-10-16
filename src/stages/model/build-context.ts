import type {
  Annotation,
  Field,
  PluginInput,
  TypeDef,
} from "@varavel/vdl-plugin-sdk";
import {
  getDeprecationMessage,
  isDeprecated,
} from "@varavel/vdl-plugin-sdk/utils/deprecations";
import { getAnnotation } from "@varavel/vdl-plugin-sdk/utils/ir";
import * as strings from "@varavel/vdl-plugin-sdk/utils/strings";
import {
  toClientOperationMethodName,
  toInlineTypeName,
} from "../../shared/naming";
import type {
  GeneratorContext,
  GeneratorOptions,
  ProcDescriptor,
  ServiceDescriptor,
} from "./types";

/**
 * Builds the intermediate HTTP RPC generation context from the annotation-based IR.
 */
export function createGeneratorContext(options: {
  input: PluginInput;
  generatorOptions: GeneratorOptions;
}): GeneratorContext {
  const services: ServiceDescriptor[] = [];

  for (const typeDef of options.input.ir.types) {
    if (!getAnnotation(typeDef.annotations, "httpRpc")) {
      continue;
    }

    services.push(buildServiceDescriptor(typeDef));
  }

  const procs: ProcDescriptor[] = [];

  for (const service of services) {
    procs.push(...service.procs);
  }

  return {
    input: options.input,
    schema: options.input.ir,
    options: options.generatorOptions,
    services,
    procs,
  };
}

/**
 * Converts an `@httpRpc`-annotated type into a service descriptor.
 */
function buildServiceDescriptor(typeDef: TypeDef): ServiceDescriptor {
  const procs: ProcDescriptor[] = [];

  for (const field of typeDef.typeRef.objectFields ?? []) {
    const proc = buildProcDescriptor(typeDef, field);
    if (proc) {
      procs.push(proc);
    }
  }

  return {
    name: typeDef.name,
    accessorName: strings.camelCase(typeDef.name),
    position: typeDef.position,
    doc: typeDef.doc,
    deprecated: deprecationNote(typeDef.annotations),
    annotations: filterOperationalAnnotations(typeDef.annotations, "httpRpc"),
    procs,
  };
}

/**
 * Converts a `@proc` field inside an `@httpRpc` service into a procedure descriptor.
 */
function buildProcDescriptor(
  serviceType: TypeDef,
  field: Field,
): ProcDescriptor | undefined {
  if (!getAnnotation(field.annotations, "proc")) {
    return undefined;
  }

  const inputField = findOperationField(field, "input");
  const outputField = findOperationField(field, "output");
  const procTypeName = toInlineTypeName(serviceType.name, field.name);

  return {
    rpcName: serviceType.name,
    rpcAccessorName: strings.camelCase(serviceType.name),
    name: field.name,
    clientMethodName: toClientOperationMethodName(serviceType.name, field.name),
    serverMethodName: field.name,
    procTypeName,
    inputTypeName: inputField
      ? toInlineTypeName(procTypeName, inputField.name)
      : undefined,
    outputTypeName: outputField
      ? toInlineTypeName(procTypeName, outputField.name)
      : undefined,
    position: field.position,
    doc: field.doc,
    deprecated: deprecationNote(field.annotations),
    annotations: filterOperationalAnnotations(field.annotations, "proc"),
    inputField,
    outputField,
  };
}

/**
 * Finds the named `input` or `output` field inside an operation object.
 */
function findOperationField(
  operationField: Field,
  name: string,
): Field | undefined {
  return operationField.typeRef.objectFields?.find(
    (field) => field.name === name,
  );
}

/**
 * Keeps bare `@deprecated` visible: an empty note renders the default message.
 */
function deprecationNote(annotations: Annotation[]): string | undefined {
  if (!isDeprecated(annotations)) {
    return undefined;
  }

  return getDeprecationMessage(annotations) ?? "";
}

/**
 * Removes a marker annotation while preserving the remaining semantic metadata.
 */
function filterOperationalAnnotations(
  annotations: Annotation[],
  marker: "httpRpc" | "proc",
): Annotation[] {
  return annotations.filter((annotation) => annotation.name !== marker);
}
