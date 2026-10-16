import type {
  Annotation,
  Field,
  IrSchema,
  PluginInput,
  Position,
} from "@varavel/vdl-plugin-sdk";
import type { ImportExtension } from "../../shared/imports";

/**
 * Supported generator target values.
 */
export type GeneratorTarget = "client" | "server";

/**
 * Resolved plugin options used by later generation stages.
 */
export type GeneratorOptions = {
  target: GeneratorTarget;
  typesImport: string;
  importExtension: ImportExtension;
};

/**
 * Structured descriptor for a VPP-2 procedure discovered in the IR.
 */
export type ProcDescriptor = {
  rpcName: string;
  rpcAccessorName: string;
  name: string;
  clientMethodName: string;
  serverMethodName: string;
  procTypeName: string;
  inputTypeName?: string;
  outputTypeName?: string;
  position: Position;
  doc?: string;
  deprecated?: string;
  annotations: Annotation[];
  inputField?: Field;
  outputField?: Field;
};

/**
 * Structured descriptor for an annotation-based HTTP RPC service.
 */
export type ServiceDescriptor = {
  name: string;
  accessorName: string;
  position: Position;
  doc?: string;
  deprecated?: string;
  annotations: Annotation[];
  procs: ProcDescriptor[];
};

/**
 * Canonical generation context shared by emission stages.
 */
export type GeneratorContext = {
  input: PluginInput;
  schema: IrSchema;
  options: GeneratorOptions;
  services: ServiceDescriptor[];
  procs: ProcDescriptor[];
};
