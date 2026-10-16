import { describe, expect, it } from "vitest";
import {
  toClientProcMethodName,
  toInlineTypeName,
  toLowerFirst,
} from "./naming";

describe("toLowerFirst", () => {
  it("lowercases the first letter and keeps the rest untouched", () => {
    expect(toLowerFirst("Calculator")).toBe("calculator");
    expect(toLowerFirst("MyService")).toBe("myService");
    expect(toLowerFirst("myProc")).toBe("myProc");
  });

  it("handles empty and single character values", () => {
    expect(toLowerFirst("")).toBe("");
    expect(toLowerFirst("A")).toBe("a");
  });

  it("leaves leading non-letters untouched", () => {
    expect(toLowerFirst("123Abc")).toBe("123Abc");
  });
});

describe("inline type names", () => {
  it("derives nested type names from parent and field names", () => {
    expect(toInlineTypeName("Messages", "send")).toBe("MessagesSend");
    expect(toInlineTypeName("MessagesSend", "input")).toBe("MessagesSendInput");
  });

  it("derives flattened client method names", () => {
    expect(toClientProcMethodName("Messages", "send")).toBe("messagesSend");
  });
});
