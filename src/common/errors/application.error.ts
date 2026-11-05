export class ApplicationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly description: string,
  ) {
    super(description);
    this.name = 'ApplicationError';
  }
}
