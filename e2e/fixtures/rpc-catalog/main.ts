// Verifies VDLPaths and VDLProcs catalog exports.
import { VDLPaths, VDLProcs } from "./gen/client.ts";

function fail(name: string, expected: string, actual: string): never {
  console.error(`${name} mismatch: expected "${expected}", got "${actual}"`);
  process.exit(1);
}

function main() {
  if (VDLPaths.MyService.myProc !== "/myService/myProc") {
    fail(
      "VDLPaths.MyService.myProc",
      "/myService/myProc",
      VDLPaths.MyService.myProc,
    );
  }

  let foundProc = false;
  for (const op of VDLProcs) {
    if (op.rpcName === "MyService" && op.name === "myProc") {
      foundProc = true;
      const expectedPath = "/myService/myProc";
      if (op.path !== expectedPath) {
        fail("op path for MyProc", expectedPath, op.path);
      }
      if (op.rpcRoute !== "myService") {
        fail("op rpcRoute for MyProc", "myService", op.rpcRoute);
      }
    }
  }
  if (!foundProc) {
    console.error("MyProc procedure not found in VDLProcs");
    process.exit(1);
  }

  console.log("Paths verification successful");
  process.exit(0);
}

main();
