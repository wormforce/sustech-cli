export class CliError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode = 1,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class ConfirmationRequiredError extends CliError {
  public constructor(action: string) {
    super(
      `${action} changes your TIS enrollment. Re-run with --confirm after reviewing the preview.`,
      "CONFIRMATION_REQUIRED",
      3,
      { action },
    );
    this.name = "ConfirmationRequiredError";
  }
}
