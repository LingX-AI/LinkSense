import { vi } from "vitest";

import type { ModelGatewayRuntime } from "../src/model-gateway/model-gateway.js";

export function createModelGatewayMock(): ModelGatewayRuntime & {
  issueLease: ReturnType<typeof vi.fn>;
} {
  let sequence = 0;
  return {
    baseUrl: "http://127.0.0.1:4011/v1",
    issueLease: vi.fn(() => {
      sequence += 1;
      return {
        token: `test-model-gateway-token-${sequence}`,
        setTurnCorrelation: vi.fn(),
        setModelTransition: vi.fn(),
        setManualModelTransitionCompaction: vi.fn(),
        release: vi.fn(),
      };
    }),
  };
}
