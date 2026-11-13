interface RuntimeEnv {
  API_BASE?: string;
  AUTH_MODE?: string;
  API_TOKEN?: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
}

export function getRuntimeEnv(): RuntimeEnv {
  const value: unknown = Reflect.get(globalThis, "__ENV__");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const result: RuntimeEnv = {};
  for (const key of [
    "API_BASE",
    "AUTH_MODE",
    "API_TOKEN",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
  ] as const) {
    const field: unknown = Reflect.get(value, key);
    if (typeof field === "string") result[key] = field;
  }
  return result;
}
