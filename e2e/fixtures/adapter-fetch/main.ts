/**
 * E2E Test: Fetch Adapter
 *
 * This test verifies that the generated Fetch adapter (gen/adapters/fetch.ts)
 * works correctly with Web Standards Request/Response objects.
 *
 * Since we're running in Node.js and not a real edge runtime,
 * we simulate the Fetch API flow by directly invoking the handler.
 */
import { createFetchHandler, FetchAdapter } from "./gen/adapters/fetch.ts";
import { Server } from "./gen/server.ts";

async function main() {
  // =========================================================================
  // Setup: Create server with handlers
  // =========================================================================

  const server = new Server<{ requestId: string }>();

  // Register handlers
  server.rpcs
    .greeter()
    .procs.hello()
    .handle(async ({ input, props }) => {
      // Verify props is passed through
      console.log("Handler received requestId:", props.requestId);
      return { greeting: `Hello, ${input.name}!` };
    });

  server.rpcs
    .greeter()
    .procs.echo()
    .handle(async ({ input }) => {
      return { message: input.message };
    });

  server.rpcs
    .calculator()
    .procs.add()
    .handle(async ({ input }) => {
      return { result: input.a + input.b };
    });

  // =========================================================================
  // Test 1: createFetchHandler with context
  // =========================================================================

  console.log("Test 1: createFetchHandler with context");

  const handler = createFetchHandler(
    server,
    async (req) => {
      // Create context from request
      return { requestId: req.headers.get("X-Request-ID") || "unknown" };
    },
    { prefix: "/rpc" },
  );

  const request = new Request("http://localhost/rpc/Greeter/hello", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "test-123",
    },
    body: JSON.stringify({ name: "World" }),
  });

  const response = await handler(request);

  if (response.status !== 200) {
    console.error(
      "Test 1 FAILED: Expected status 200 but got:",
      response.status,
    );
    process.exit(1);
  }

  const result = (await response.json()) as any;
  if (!result.ok || result.output.greeting !== "Hello, World!") {
    console.error("Test 1 FAILED: Unexpected response:", result);
    process.exit(1);
  }

  console.log("Test 1 PASSED");

  // =========================================================================
  // Test 2: Multiple RPC calls
  // =========================================================================

  console.log("Test 2: Multiple RPC calls");

  const echoRequest = new Request("http://localhost/rpc/Greeter/echo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Test message" }),
  });

  const echoResponse = await handler(echoRequest);
  const echoResult = (await echoResponse.json()) as any;

  if (!echoResult.ok || echoResult.output.message !== "Test message") {
    console.error("Test 2a FAILED: Unexpected echo response:", echoResult);
    process.exit(1);
  }

  const addRequest = new Request("http://localhost/rpc/Calculator/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a: 10, b: 20 }),
  });

  const addResponse = await handler(addRequest);
  const addResult = (await addResponse.json()) as any;

  if (!addResult.ok || addResult.output.result !== 30) {
    console.error("Test 2b FAILED: Unexpected add response:", addResult);
    process.exit(1);
  }

  console.log("Test 2 PASSED");

  // =========================================================================
  // Test 3: Invalid path returns 404
  // =========================================================================

  console.log("Test 3: Invalid path returns 404");

  const invalidRequest = new Request("http://localhost/rpc/invalid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const invalidResponse = await handler(invalidRequest);

  if (invalidResponse.status !== 404) {
    console.error(
      "Test 3 FAILED: Expected 404 but got:",
      invalidResponse.status,
    );
    process.exit(1);
  }

  const invalidResult = (await invalidResponse.json()) as any;
  if (invalidResult.ok !== false) {
    console.error(
      "Test 3 FAILED: Expected error response but got:",
      invalidResult,
    );
    process.exit(1);
  }

  console.log("Test 3 PASSED");

  // =========================================================================
  // Test 4: FetchAdapter directly
  // =========================================================================

  console.log("Test 4: FetchAdapter directly");

  const directRequest = new Request("http://localhost/Greeter/echo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Direct adapter test" }),
  });

  const adapter = new FetchAdapter(directRequest);

  // Process request
  await server.handleRequest(
    { requestId: "direct-test" },
    "Greeter",
    "echo",
    adapter,
  );

  const directResponse = adapter.toResponse();
  const directResult = (await directResponse.json()) as any;

  if (
    !directResult.ok ||
    directResult.output.message !== "Direct adapter test"
  ) {
    console.error("Test 4 FAILED: Unexpected direct response:", directResult);
    process.exit(1);
  }

  console.log("Test 4 PASSED");

  // =========================================================================
  // Test 5: Invalid procedure returns error
  // =========================================================================

  console.log("Test 5: Invalid procedure returns error");

  const invalidOpRequest = new Request(
    "http://localhost/rpc/Greeter/nonExistent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );

  const invalidOpResponse = await handler(invalidOpRequest);
  const invalidOpResult = (await invalidOpResponse.json()) as any;

  if (invalidOpResult.ok !== false) {
    console.error(
      "Test 5 FAILED: Expected error for non-existent procedure:",
      invalidOpResult,
    );
    process.exit(1);
  }

  console.log("Test 5 PASSED");

  console.log("\n=== All Fetch Adapter tests PASSED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
