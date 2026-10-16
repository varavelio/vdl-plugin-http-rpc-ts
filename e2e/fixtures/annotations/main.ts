// Fixture annotations proves proc annotations reach handlers and interceptors verbatim.

import { createServer } from "node:http";
import { createNodeHandler } from "./gen/adapters/node.ts";
import { NewClient, VdlError } from "./gen/client.ts";
import { Server } from "./gen/server.ts";

function namesOf(annotations: { name: string }[]): Set<string> {
  return new Set(annotations.map((item) => item.name));
}

async function main() {
  const server = new Server();

  server.rpcs
    .service()
    .procs.check()
    .handle(async (c) => {
      const names = namesOf(c.annotations);
      if (!names.has("audited") || !names.has("quota")) {
        throw new Error("handler missing proc annotations");
      }
      if (names.has("serviceTag")) {
        throw new Error("service annotations must not propagate");
      }
      const quota = c.annotations.find((item) => item.name === "quota")
        ?.argument as any;
      if (quota?.max !== 100 || quota?.burst !== true) {
        throw new Error("handler bad quota argument");
      }
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
      const names = namesOf(req.proc?.annotations ?? []);
      if (!names.has("audited") || !names.has("quota")) {
        throw new VdlError({ message: "interceptor missing annotations" });
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
