export class ImagePreviewRequestError extends Error {
  readonly retryable: boolean;

  constructor(readonly statusCode: number) {
    super("image_preview_registration_failed");
    this.name = "ImagePreviewRequestError";
    this.retryable = statusCode === 409 || statusCode === 429 || statusCode >= 500;
  }
}
