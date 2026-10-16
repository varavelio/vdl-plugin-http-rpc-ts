// Showcases typed error handling: business codes travel end to end, unknown failures stay sanitized, and both sides validate input independently.

import { createServer } from "node:http";
import { createNodeHandler } from "./gen/adapters/node.ts";
import { VdlError as ClientVdlError, NewClient } from "./gen/client.ts";
import { Server, VdlError as ServerVdlError } from "./gen/server.ts";

async function main() {
  const server = new Server();
  let productCalls = 0;

  server.rpcs
    .shop()
    .procs.getProduct()
    .handle(async ({ input }) => {
      productCalls += 1;
      if (input.id !== "p1") {
        throw new ServerVdlError({
          message: "Product not found",
          code: "PRODUCT_NOT_FOUND",
          category: "NotFound",
        });
      }
      return { name: "Widget", price: 9.99 };
    });

  server.rpcs
    .shop()
    .procs.boom()
    .handle(async () => {
      throw new Error("kaboom");
    });

  const handler = createNodeHandler(server, undefined, { prefix: "/rpc" });
  const httpServer = createServer(async (req, res) => {
    await handler(req, res);
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  const port = (httpServer.address() as any).port;
  const baseUrl = `http://localhost:${port}/rpc`;

  const client = NewClient(baseUrl).build();

  // Test 1: success path stays fully typed.
  const product = await client.rpcs
    .shop()
    .procs.getProduct()
    .execute({ id: "p1" });
  if (product.name !== "Widget" || product.price !== 9.99) {
    console.error("Test 1 FAILED: unexpected typed output:", product);
    process.exit(1);
  }
  console.log("Test 1 PASSED");

  // Test 2: business codes travel end to end as typed VdlError.
  try {
    await client.rpcs.shop().procs.getProduct().execute({ id: "nope" });
    console.error("Test 2 FAILED: expected PRODUCT_NOT_FOUND, got success");
    process.exit(1);
  } catch (error) {
    if (!(error instanceof ClientVdlError)) {
      console.error("Test 2 FAILED: expected VdlError, got:", error);
      process.exit(1);
    }
    if (error.code !== "PRODUCT_NOT_FOUND" || error.category !== "NotFound") {
      console.error("Test 2 FAILED: code/category lost:", error);
      process.exit(1);
    }
    if (error.message !== "Product not found") {
      console.error("Test 2 FAILED: message lost:", error.message);
      process.exit(1);
    }
  }
  console.log("Test 2 PASSED");

  // Test 3: unknown failures stay sanitized; internals never leak.
  try {
    await client.rpcs.shop().procs.boom().execute({});
    console.error("Test 3 FAILED: expected Internal error, got success");
    process.exit(1);
  } catch (error) {
    if (!(error instanceof ClientVdlError)) {
      console.error("Test 3 FAILED: expected VdlError, got:", error);
      process.exit(1);
    }
    if (error.message !== "Internal error") {
      console.error(
        "Test 3 FAILED: expected sanitized error, got:",
        error.message,
      );
      process.exit(1);
    }
  }
  console.log("Test 3 PASSED");

  // Test 4: client validates input before any network traffic.
  const callsBefore = productCalls;
  try {
    await client.rpcs
      .shop()
      .procs.getProduct()
      .execute({ id: 123 as unknown as string });
    console.error("Test 4 FAILED: expected INVALID_INPUT, got success");
    process.exit(1);
  } catch (error) {
    if (!(error instanceof ClientVdlError)) {
      console.error("Test 4 FAILED: expected VdlError, got:", error);
      process.exit(1);
    }
    if (error.code !== "INVALID_INPUT") {
      console.error("Test 4 FAILED: expected INVALID_INPUT, got:", error.code);
      process.exit(1);
    }
  }
  if (productCalls !== callsBefore) {
    console.error("Test 4 FAILED: invalid input reached the server");
    process.exit(1);
  }
  console.log("Test 4 PASSED");

  // Test 5: server validates input independently (raw request bypassing the client).
  const raw = await fetch(`${baseUrl}/shop/getProduct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: 123 }),
  });
  const envelope = (await raw.json()) as any;
  if (
    raw.status !== 200 ||
    envelope.ok !== false ||
    envelope.error?.code !== "INVALID_INPUT"
  ) {
    console.error(
      "Test 5 FAILED: expected ok:false INVALID_INPUT, got:",
      raw.status,
      envelope,
    );
    process.exit(1);
  }
  console.log("Test 5 PASSED");

  console.log("Success");
  httpServer.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
