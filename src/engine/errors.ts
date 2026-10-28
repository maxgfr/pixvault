// Errors meant for the user carry a code the interface translates; the
// message is the English fallback (and what the tests read).

export type ErrorCode = "unsupported" | "damaged" | "too-large" | "no-preview" | "encode-failed" | "bad-options" | "model" | "cancelled";

export class DecodeError extends Error {
  override name = "DecodeError";
  constructor(
    message: string,
    readonly code: ErrorCode = "damaged",
  ) {
    super(message);
  }
}
