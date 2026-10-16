import type { PluginInput, PluginOutput } from "@varavel/vdl-plugin-sdk";
import { assertValidIrForHttpRpc } from "@varavel/vdl-plugin-sdk/utils/rpc";
import { generateFiles } from "./stages/emit/generate-files";
import { createGeneratorContext } from "./stages/model/build-context";
import { resolveGeneratorOptions } from "./stages/options/resolve";

/**
 * Runs the complete VDL HTTP RPC TypeScript generation pipeline.
 */
export function generate(input: PluginInput): PluginOutput {
  // Setup & Validation (Fail Fast)
  const generatorOptions = resolveGeneratorOptions(input);
  assertValidIrForHttpRpc(input.ir);

  // Context Initialization
  const context = createGeneratorContext({ input, generatorOptions });

  // File Emission
  const files = generateFiles(context);

  return { files };
}
