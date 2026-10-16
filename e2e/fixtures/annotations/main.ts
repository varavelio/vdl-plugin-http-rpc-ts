// Fixture annotations proves proc annotations reach handlers and interceptors verbatim.

import { createServer } from "node:http";
import { createNodeHandler } from "./gen/adapters/node.ts";
import { NewClient, VdlError } from "./gen/client.ts";
import { Server } from "./gen/server.ts";

function annotationMap(
  annotations: { name: string; argument?: unknown }[],
): Map<string, unknown> {
  return new Map(annotations.map((item) => [item.name, item.argument]));
}

function expectProcAnnotations(
  annotations: { name: string; argument?: unknown }[],
  side: string,
): void {
  const names = annotationMap(annotations);
  if (!names.has("audited")) {
    throw new Error(`${side}: missing bare marker audited`);
  }
  if (names.get("audited") !== undefined) {
    throw new Error(`${side}: bare marker must carry no argument`);
  }
  const quota = names.get("quota") as any;
  if (typeof quota !== "object" || quota === null) {
    throw new Error(`${side}: missing quota object`);
  }
  if (quota?.max !== 100 || quota?.burst !== true) {
    throw new Error(`${side}: bad quota argument`);
  }
  if (
    !Array.isArray(quota?.tags) ||
    quota.tags.length !== 2 ||
    quota.tags[0] !== "a" ||
    quota.tags[1] !== "b"
  ) {
    throw new Error(`${side}: bad quota.tags`);
  }
  if (names.has("serviceTag")) {
    throw new Error(`${side}: service-level annotations must not propagate`);
  }
}

async function main() {
  const server = new Server();

  server.rpcs
    .service()
    .procs.check()
    .handle(async (c) => {
      expectProcAnnotations(c.annotations, "handler");
      return { ok: true };
    });

  const handler = createNodeHandler(server, undefined, { prefix: "/rpc" });
  const httpServer = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    await handler(req, res);
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });

  const addr = httpServer.address() as any;
  const baseUrl = `http://localhost:${addr.port}/rpc`;
  const client = NewClient(baseUrl)
    .withInterceptor(async (req, next) => {
      try {
        expectProcAnnotations(req.proc?.annotations ?? [], "interceptor");
      } catch (error) {
        throw new VdlError({
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return next(req);
    })
    .build();

  const result = await client.rpcs.service().procs.check().execute({
    id: "x",
  });
  if (!result.ok) {
    throw new Error("expected ok");
  }

  console.log("annotations ok");
  httpServer.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
