export class DomainError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function invariant(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) {
    throw new DomainError(message, code);
  }
}
