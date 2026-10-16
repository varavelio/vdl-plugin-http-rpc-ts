// Verifies VPP-2 conformance vectors for procedures.
import { createServer } from "node:http";
import { createNodeHandler } from "./gen/adapters/node.ts";
import { VdlError as ClientVdlError, NewClient } from "./gen/client.ts";
import { Server, VdlError as ServerVdlError } from "./gen/server.ts";

async function main() {
  const server = new Server();

  server.rpcs
    .service()
    .procs.ping()
    .handle(async () => {
      return {};
    });

  server.rpcs
    .service()
    .procs.clearCache()
    .handle(async () => {
      return {};
    });

  server.rpcs
    .service()
    .procs.rotateKeys()
    .handle(async () => {
      return { rotatedAt: "2026-01-01T00:00:00Z" };
    });

  server.rpcs
    .service()
    .procs.getUser()
    .handle(async ({ input }) => {
      if (input.userId !== "user-123") {
        throw new ServerVdlError({
          message: "User not found.",
          category: "NotFound",
          code: "USER_NOT_FOUND",
          details: { userId: input.userId },
        });
      }
      return { id: "user-123", email: "john.doe@example.com" };
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

  // Vector 1: ping {} sends {} and receives {"ok":true}.
  await client.rpcs.service().procs.ping().execute({});
  const pingRaw = await fetch(`${baseUrl}/service/ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (pingRaw.status !== 200) {
    throw new Error(`ping expected 200, got ${pingRaw.status}`);
  }
  const pingBody = await pingRaw.text();
  if (pingBody !== '{"ok":true}') {
    throw new Error(`ping expected {"ok":true}, got ${pingBody}`);
  }

  // Vector 7: ping with no body and no Content-Type is accepted as empty input.
  const pingEmpty = await fetch(`${baseUrl}/service/ping`, { method: "POST" });
  if (pingEmpty.status !== 200) {
    throw new Error(`empty ping expected 200, got ${pingEmpty.status}`);
  }
  if ((await pingEmpty.text()) !== '{"ok":true}') {
    throw new Error('empty ping did not return exactly {"ok":true}');
  }

  // Vector 2: clearCache sends namespace and receives {"ok":true}.
  await client.rpcs.service().procs.clearCache().execute({ namespace: "sess" });
  const clearRaw = await fetch(`${baseUrl}/service/clearCache`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ namespace: "sess" }),
  });
  if ((await clearRaw.text()) !== '{"ok":true}') {
    throw new Error('clearCache did not return exactly {"ok":true}');
  }

  // Vector 3: rotateKeys sends {} and receives output.
  const rotated = await client.rpcs.service().procs.rotateKeys().execute({});
  if (!rotated.rotatedAt) {
    throw new Error(`rotateKeys missing output: ${JSON.stringify(rotated)}`);
  }

  // Vector 4: getUser success returns output envelope.
  const user = await client.rpcs
    .service()
    .procs.getUser()
    .execute({ userId: "user-123" });
  if (user.id !== "user-123" || user.email !== "john.doe@example.com") {
    throw new Error(`unexpected getUser output: ${JSON.stringify(user)}`);
  }

  // Vector 5: application error returns HTTP 200 with ok:false.
  const missingRaw = await fetch(`${baseUrl}/service/getUser`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ userId: "user-123-missing" }),
  });
  if (missingRaw.status !== 200) {
    throw new Error(`app error expected 200, got ${missingRaw.status}`);
  }
  const missingJson = (await missingRaw.json()) as any;
  if (
    missingJson.ok !== false ||
    missingJson.error?.code !== "USER_NOT_FOUND"
  ) {
    throw new Error(
      `unexpected app error envelope: ${JSON.stringify(missingJson)}`,
    );
  }
  try {
    await client.rpcs.service().procs.getUser().execute({ userId: "nope" });
    throw new Error("expected getUser to throw");
  } catch (e) {
    if (!(e instanceof ClientVdlError) || e.code !== "USER_NOT_FOUND") {
      throw new Error(`expected USER_NOT_FOUND, got: ${e}`);
    }
  }

  // Vector 6: transport failures use non-200 and are never confused with ok:false.
  const notFound = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (notFound.status === 200) {
    throw new Error("transport failure must not use 200");
  }
  const notFoundJson = (await notFound.json()) as any;
  if (notFoundJson.ok !== false) {
    throw new Error("transport failure must still use an error envelope");
  }

  console.log("Success");
  httpServer.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
