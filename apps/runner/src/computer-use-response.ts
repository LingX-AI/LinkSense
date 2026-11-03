import {
  computerUseFailure,
  computerUseResultSchema,
  type ComputerUseResult,
} from "@linksense/shared";

export async function readComputerUseResponse(response: Response): Promise<ComputerUseResult> {
  const result = computerUseResultSchema.safeParse(await response.json().catch(() => null));
  if (result.success && (response.ok || !result.data.ok)) return result.data;
  if (response.status === 401 || response.status === 403)
    return computerUseFailure("COMPUTER_USE_ACCESS_DENIED");
  // A failed relay can lose the reply after the desktop already received input.
  return computerUseFailure("COMPUTER_USE_COMMAND_FAILED", "unknown");
}
