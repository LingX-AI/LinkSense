export { PrivacyMasker } from "@linksense/shared/privacy-masking-engine";
export type {
  MaskContext,
  PrivacyMaskHit,
} from "@linksense/shared/privacy-masking-engine";
export { maskResponsesRequest } from "./request.js";
export type { MaskRequestHit } from "./request.js";
export {
  hasPlaceholder,
  placeholderNote,
  withChatPlaceholderNote,
  withPlaceholderNote,
} from "./note.js";
export {
  PrivacyRestorer,
  partialPlaceholderTail,
  restoreJsonValue,
} from "./restore.js";
export type { RestoredEvent } from "./restore.js";
