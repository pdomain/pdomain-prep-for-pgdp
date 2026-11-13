import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeEnv } from "./runtimeEnv";

afterEach(() => vi.unstubAllGlobals());

describe("runtime environment", () => {
  it("reads the injected auth and API strings", () => {
    vi.stubGlobal("__ENV__", {
      API_BASE: "/prep",
      AUTH_MODE: "jwt",
      API_TOKEN: "token",
      JWT_ISSUER: "https://issuer.invalid",
      JWT_AUDIENCE: "prep",
    });
    expect(getRuntimeEnv()).toEqual({
      API_BASE: "/prep",
      AUTH_MODE: "jwt",
      API_TOKEN: "token",
      JWT_ISSUER: "https://issuer.invalid",
      JWT_AUDIENCE: "prep",
    });
  });

  it.each([null, undefined, 7, [], { API_BASE: 7, AUTH_MODE: false }])(
    "ignores malformed injection %j",
    (value: unknown) => {
      vi.stubGlobal("__ENV__", value);
      expect(getRuntimeEnv().API_BASE).toBeUndefined();
      expect(getRuntimeEnv().AUTH_MODE).toBeUndefined();
    },
  );
});
