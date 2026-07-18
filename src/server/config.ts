import { timingSafeEqual } from "node:crypto";
import type { RateLimitConfig, WednesdayConfig } from "../core/config";

export interface ServerConfig {
  host: string;
  port: number;
  token?: string;
  rateLimit?: RateLimitConfig;
}
export function loadServerConfig(
  config: WednesdayConfig,
  token?: string,
): ServerConfig {
  return { ...config.server, token };
}
export function isLoopback(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
export function validateServerConfig(config: ServerConfig) {
  if (!isLoopback(config.host) && (!config.token || config.token.length < 24))
    throw new Error(
      "A server token of at least 24 characters is required when binding beyond localhost; store it with `wednesday config secret set server:token`",
    );
}
export function isAuthorized(request: Request, config: ServerConfig) {
  if (!config.token) return isLoopback(config.host);
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBuffer = Buffer.from(config.token),
    suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
