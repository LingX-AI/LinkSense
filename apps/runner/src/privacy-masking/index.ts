export { PrivacyMasker } from "@linksense/shared/privacy-masking-engine";
export type {
  MaskContext,
  PrivacyMaskHit,
} from "@linksense/shared/privacy-masking-engine";
export { maskResponsesRequest } from "./request.js";
export {
  PrivacyRestorer,
  partialPlaceholderTail,
  restoreJsonValue,
} from "./restore.js";
export type { RestoredEvent } from "./restore.js";
