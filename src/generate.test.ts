import {
  annotation,
  field,
  objectLiteral,
  objectType,
  pluginInput,
  primitiveType,
  schema,
  stringLiteral,
  typeDef,
} from "@varavel/vdl-plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { generate } from "./generate";

function createBaseInput() {
  return pluginInput({
    ir: schema({
      types: [
        typeDef(
          "Messages",
          objectType([
            field(
              "sendMessage",
              objectType([
                field(
                  "input",
                  objectType([
                    field("roomId", primitiveType("string")),
                    field("text", primitiveType("string")),
                  ]),
                ),
                field(
                  "output",
                  objectType([field("accepted", primitiveType("bool"))]),
                ),
              ]),
              {
                annotations: [
                  annotation("proc"),
                  annotation(
                    "cache",
                    objectLiteral({ scope: stringLiteral("room") }),
                  ),
                ],
              },
            ),
          ]),
          {
            annotations: [annotation("httpRpc")],
          },
        ),
      ],
    }),
    options: {
      typesImport: "../types/index.js",
      importExtension: "ts",
    },
  });
}

describe("generate", () => {
  it("generates the client target", () => {
    const output = generate({
      ...createBaseInput(),
      options: {
        ...createBaseInput().options,
        target: "client",
      },
    });

    expect(output.errors).toBeUndefined();
    expect(output.files?.map((file) => file.path)).toEqual(["client.ts"]);
    expect(fileContent(output, "client.ts")).toContain(
      'import * as vdlTypes from "../types/index.js";',
    );
    expect(fileContent(output, "client.ts")).toContain(
      "export const VDLProcs: ProcDefinition[] = [",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "public readonly rpcs: ClientRPCRegistry;",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "messages(): ClientMessagesRPC",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "public readonly procs: ClientMessagesProcs;",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "sendMessage(): ProcMessagessendMessageBuilder",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "withRetries(config: Partial<RetryConfig>)",
    );
    expect(fileContent(output, "client.ts")).toContain('"name": "cache"');
    expect(fileContent(output, "client.ts")).toContain(
      "private verifyRuntimeDeps()",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "private rpcHeaderProviders: Map<string, HeaderProvider[]> = new Map();",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "private rpcRetryConf: Map<string, RetryConfig> = new Map();",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "setRPCRetryConfig(rpcName: string, conf: RetryConfig)",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "setRPCHeaderProvider(rpcName: string, provider: HeaderProvider)",
    );
    expect(fileContent(output, "client.ts")).toContain(
      'this.intClient.setRPCRetryConfig("Messages", normalizeRetryConfig(config, 3));',
    );
    expect(fileContent(output, "client.ts")).not.toContain("VDLProcedures");
    expect(fileContent(output, "client.ts")).not.toContain("VDLStreams");
    expect(fileContent(output, "client.ts")).not.toContain("StreamRegistry");
    expect(fileContent(output, "client.ts")).toContain("/messages/sendMessage");
  });

  it("exposes typed input accessors for middleware and interceptors", () => {
    const output = generate({
      ...createBaseInput(),
      options: {
        ...createBaseInput().options,
        target: "client",
      },
    });

    expect(output.errors).toBeUndefined();
    expect(fileContent(output, "client.ts")).toContain(
      "export function inputAs<O>(input: unknown): O | undefined",
    );
  });

  it("caps response body size on the client", () => {
    const output = generate({
      ...createBaseInput(),
      options: {
        ...createBaseInput().options,
        target: "client",
      },
    });

    expect(output.errors).toBeUndefined();
    expect(fileContent(output, "client.ts")).toContain(
      "withMaxResponseBodyBytes(n: number): clientBuilder",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "withMaxResponseBodyBytes(n: number): ClientBuilder",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "Response body too large",
    );
    expect(fileContent(output, "client.ts")).toContain(
      "export function cloneProcDefinition(proc: ProcDefinition): ProcDefinition",
    );
  });

  it("generates the server target", () => {
    const output = generate({
      ...createBaseInput(),
      options: {
        ...createBaseInput().options,
        target: "server",
      },
    });

    expect(output.errors).toBeUndefined();
    expect(output.files?.map((file) => file.path)).toEqual([
      "server.ts",
      "adapters/node.ts",
      "adapters/fetch.ts",
    ]);
    expect(fileContent(output, "server.ts")).toContain(
      "get annotations(): Annotation[]",
    );
    expect(fileContent(output, "server.ts")).toContain(
      "export const VDLProcs: ProcDefinition[] = [",
    );
    expect(fileContent(output, "server.ts")).not.toContain("VDLStreams");
    expect(fileContent(output, "server.ts")).not.toContain("StreamHandlerFunc");
    expect(fileContent(output, "server.ts")).not.toContain("flush");
    expect(fileContent(output, "server.ts")).toContain(
      "HTTPAdapter defines the interface required by the RPC server",
    );
    expect(fileContent(output, "server.ts")).toContain(
      "get rpcRoute(): string",
    );
    expect(fileContent(output, "server.ts")).toContain("get path(): string");
    expect(fileContent(output, "server.ts")).toContain(
      "inputAs<O>(): O | undefined",
    );
    expect(fileContent(output, "server.ts")).toContain(
      "type deserializerFunc = (raw: unknown) => Promise<unknown>;",
    );
    expect(fileContent(output, "server.ts")).toContain(
      "setMaxRequestBodyBytes(n: number): void",
    );
    expect(fileContent(output, "server.ts")).toContain(
      "getMaxRequestBodyBytes(): number",
    );
    expect(fileContent(output, "server.ts")).toContain(
      'new VdlError({ message: "Internal error" })',
    );
    expect(fileContent(output, "server.ts")).toContain(
      '{"ok":false,"error":{"message":"Internal error"}}',
    );
    expect(fileContent(output, "adapters/node.ts")).toContain(
      "createNodeHandler",
    );
    expect(fileContent(output, "adapters/node.ts")).toContain(
      "NodeAdapter implements HTTPAdapter for Node.js HTTP environments.",
    );
    expect(fileContent(output, "adapters/node.ts")).toContain(
      "METHOD_NOT_ALLOWED",
    );
    expect(fileContent(output, "adapters/node.ts")).toContain('Allow: "POST"');
    expect(fileContent(output, "adapters/node.ts")).toContain(
      "NodeAdapter requires a non-null request",
    );
    expect(fileContent(output, "adapters/fetch.ts")).toContain(
      "FetchAdapter implements HTTPAdapter for Web Standards environments.",
    );
    expect(fileContent(output, "adapters/fetch.ts")).toContain(
      "FetchAdapter requires a non-null Request",
    );
  });

  it("throws SDK RPC validation errors before modeling", () => {
    expect(() =>
      generate(
        pluginInput({
          ir: schema({
            types: [
              typeDef(
                "Broken",
                objectType([
                  field(
                    "oops",
                    objectType([field("input", primitiveType("string"))]),
                    {
                      annotations: [annotation("proc")],
                    },
                  ),
                ]),
                {
                  annotations: [annotation("httpRpc")],
                },
              ),
            ],
          }),
          options: {
            target: "server",
            typesImport: "../types/index.js",
          },
        }),
      ),
    ).toThrowError(
      'Field "input" in operation "Broken.oops" must be an inline object type when present.',
    );
  });

  it("emits no files when the schema has no RPC operations", () => {
    const output = generate(
      pluginInput({
        options: {
          target: "client",
          typesImport: "../types/index.js",
        },
        ir: schema({
          types: [
            typeDef("User", objectType([field("id", primitiveType("string"))])),
          ],
        }),
      }),
    );

    expect(output.errors).toBeUndefined();
    expect(output.files).toEqual([]);
  });
});

function fileContent(
  result: ReturnType<typeof generate>,
  path: string,
): string {
  const file = result.files?.find((entry) => entry.path === path);
  expect(file).toBeDefined();
  return file?.content ?? "";
}
