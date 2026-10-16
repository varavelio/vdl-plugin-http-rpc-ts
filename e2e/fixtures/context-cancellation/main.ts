// Verifies AbortSignal cancellation for procedures.
import { createServer } from "node:http";
import { createNodeHandler } from "./gen/adapters/node.ts";
import { NewClient, VdlError } from "./gen/client.ts";
import { Server } from "./gen/server.ts";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let cleanedUp = false;

  const server = new Server();

  server.rpcs
    .service()
    .procs.run()
    .handle(async (c) => {
      try {
        for (let i = 0; i < 20; i++) {
          if (c.signal.aborted) {
            throw new VdlError({
              message: "Request aborted",
              category: "ClientError",
              code: "ABORTED",
            });
          }
          await sleep(50);
        }
        return { count: 42 };
      } finally {
        cleanedUp = true;
      }
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
  const client = NewClient(baseUrl).build();

  // Pre-aborted signal fails fast.
  const preAborted = new AbortController();
  preAborted.abort();
  try {
    await client.rpcs
      .service()
      .procs.run()
      .withSignal(preAborted.signal)
      .execute({});
    console.error("expected pre-aborted call to fail");
    process.exit(1);
  } catch (e) {
    if (!(e instanceof VdlError) || e.code !== "ABORTED") {
      console.error("expected ABORTED, got:", e);
      process.exit(1);
    }
  }

  // Normal call succeeds.
  const ok = await client.rpcs.service().procs.run().execute({});
  if (ok.count !== 42) {
    console.error("unexpected output:", ok);
    process.exit(1);
  }

  // Mid-flight abort fails with ABORTED.
  const midFlight = new AbortController();
  const pending = client.rpcs
    .service()
    .procs.run()
    .withSignal(midFlight.signal)
    .execute({});
  await sleep(100);
  midFlight.abort();
  try {
    await pending;
    console.error("expected mid-flight abort to fail");
    process.exit(1);
  } catch (e) {
    if (!(e instanceof VdlError)) {
      console.error("expected VdlError, got:", e);
      process.exit(1);
    }
  }

  await sleep(200);
  if (!cleanedUp) {
    console.error("expected server handler to run cleanup");
    process.exit(1);
  }

  console.log("Success");
  httpServer.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
