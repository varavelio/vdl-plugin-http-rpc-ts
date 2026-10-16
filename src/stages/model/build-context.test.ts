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
import { createGeneratorContext } from "./build-context";

describe("createGeneratorContext", () => {
  it("models annotation-based HTTP RPC services and operations", () => {
    const context = createGeneratorContext({
      input: pluginInput({
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
                      objectType([field("text", primitiveType("string"))]),
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
      }),
      generatorOptions: {
        target: "client",
        typesImport: "../types/index.js",
        importExtension: "js",
      },
    });

    expect(context.services).toHaveLength(1);
    expect(context.procs).toHaveLength(1);

    const service = context.services[0];
    const proc = context.procs[0];

    expect(service).toMatchObject({
      name: "Messages",
      accessorName: "messages",
    });
    expect(proc).toMatchObject({
      rpcName: "Messages",
      rpcAccessorName: "messages",
      name: "sendMessage",
      clientMethodName: "messagesSendMessage",
      serverMethodName: "sendMessage",
      procTypeName: "MessagesSendMessage",
      inputTypeName: "MessagesSendMessageInput",
      outputTypeName: "MessagesSendMessageOutput",
    });
    expect(proc?.annotations.map((item) => item.name)).toEqual(["cache"]);
  });

  it("allows operations that omit input and output", () => {
    const context = createGeneratorContext({
      input: pluginInput({
        ir: schema({
          types: [
            typeDef(
              "Commands",
              objectType([
                field("ping", objectType([]), {
                  annotations: [annotation("proc")],
                }),
              ]),
              {
                annotations: [annotation("httpRpc")],
              },
            ),
          ],
        }),
      }),
      generatorOptions: {
        target: "server",
        typesImport: "../types/index.js",
        importExtension: "ts",
      },
    });

    expect(context.procs[0]).toMatchObject({
      name: "ping",
      inputTypeName: undefined,
      outputTypeName: undefined,
    });
  });

  it("ignores types without httpRpc and orphan proc members", () => {
    const context = createGeneratorContext({
      input: pluginInput({
        ir: schema({
          types: [
            typeDef(
              "Plain",
              objectType([
                field("orphan", objectType([]), {
                  annotations: [annotation("proc")],
                }),
              ]),
            ),
            typeDef(
              "Users",
              objectType([
                field("ping", objectType([]), {
                  annotations: [annotation("proc")],
                }),
              ]),
              {
                annotations: [annotation("httpRpc")],
              },
            ),
          ],
        }),
      }),
      generatorOptions: {
        target: "client",
        typesImport: "../types/index.js",
        importExtension: "js",
      },
    });

    expect(context.services).toHaveLength(1);
    expect(context.procs).toHaveLength(1);
    expect(context.procs[0]).toMatchObject({
      rpcName: "Users",
      name: "ping",
    });
  });
});
