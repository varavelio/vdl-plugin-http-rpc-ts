import * as strings from "@varavel/vdl-plugin-sdk/utils/strings";

/**
 * Derives the generated type name for an inline object nested under a parent named type.
 */
export function toInlineTypeName(
  parentTypeName: string,
  fieldName: string,
): string {
  return `${parentTypeName}${strings.pascalCase(fieldName)}`;
}

/**
 * Returns the client-side flattened method name for a service operation.
 */
export function toClientOperationMethodName(
  rpcName: string,
  operationName: string,
): string {
  return `${strings.camelCase(rpcName)}${strings.pascalCase(operationName)}`;
}

/**
 * Applies the VPP-2 route rule to an RPC service name.
 */
export function toLowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Renders a safe object property key.
 */
export function renderPropertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value)
    ? value
    : JSON.stringify(value);
}
