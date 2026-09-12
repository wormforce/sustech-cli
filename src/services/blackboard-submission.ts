import { CliError } from "../core/errors.js";
import { collapseWhitespace, type ServiceAdapter } from "./base.js";
import { submitBlackboardOriginalForm, type BlackboardFormSubmission, type BlackboardFormTarget } from "./blackboard-assignment-form.js";
import { getBlackboardAttempt, listBlackboardAttemptFiles, listBlackboardAttempts, type BlackboardAttempt, type BlackboardAttemptFile } from "./blackboard.js";

export interface BlackboardSubmissionVerification {
  status: "confirmed" | "not_observed" | "unavailable";
  message: string;
}

/** The caller performs confirmation and live preflight before entering this write flow. */
export async function applyBlackboardOriginalSubmission(
  adapter: ServiceAdapter,
  target: BlackboardFormTarget & { columnId: string },
  submission: BlackboardFormSubmission,
  previousAttempts: readonly { id: string }[],
  options: { comment?: string } = {},
): Promise<{
  attempt: BlackboardAttempt;
  files: BlackboardAttemptFile[];
  verification: BlackboardSubmissionVerification;
  recoveredAfterError: boolean;
}> {
  let stage: "prepare_form" | "submit_form" | "verify" = "prepare_form";
  let postStarted = false;
  let postError: unknown;
  try {
    await submitBlackboardOriginalForm(adapter, target, submission, {
      ...options,
      onStage: (nextStage) => { stage = nextStage; if (nextStage === "submit_form") postStarted = true; },
    });
    stage = "verify";
  } catch (error) {
    if (!postStarted) {
      if (error instanceof CliError && error.code === "BLACKBOARD_FILE_CHANGED") throw error;
      throw new CliError("Blackboard submission preparation failed; no submission POST was sent.", "BLACKBOARD_SUBMISSION_PREPARATION_FAILED", 4, {
        ...target, stage, upstream: submissionDiagnostic(error), submissionPostSent: false,
      });
    }
    postError = error;
  }

  let candidateAttemptIds: string[] = [];
  let attempt: BlackboardAttempt | undefined;
  let files: BlackboardAttemptFile[] = [];
  let readBackError: unknown;
  try {
    const previousIds = new Set(previousAttempts.map((entry) => entry.id));
    const current = await listBlackboardAttempts(adapter, target.courseId, target.columnId);
    candidateAttemptIds = current.filter((entry) => !previousIds.has(entry.id)).map((entry) => entry.id);
    // Neither an old same-named file nor multiple concurrent attempts proves this POST succeeded.
    if (candidateAttemptIds.length === 1) {
      attempt = await getBlackboardAttempt(adapter, target.courseId, target.columnId, candidateAttemptIds[0]!);
      if (attempt.id !== candidateAttemptIds[0]) throw new CliError("Blackboard returned a different attempt during verification.", "BLACKBOARD_ATTEMPT_MISMATCH");
      if (submission.kind === "file") files = await listBlackboardAttemptFiles(adapter, target.courseId, attempt.id);
    }
  } catch (error) { readBackError = error; }

  const verification = verifySubmission(attempt, files, submission, options.comment);
  if (!readBackError && attempt && verification.status === "confirmed") {
    return { attempt, files, verification, recoveredAfterError: postError !== undefined };
  }
  throw new CliError("Blackboard submission outcome is uncertain. Do not retry automatically.", "BLACKBOARD_SUBMISSION_OUTCOME_UNKNOWN", 5, {
    ...target, stage, candidateAttemptIds,
    ...(attempt ? { attemptId: attempt.id, attemptStatus: attempt.status } : {}),
    ...(submission.kind === "file" ? { fileName: submission.file.name } : { textFile: submission.textFile.absolutePath }),
    observedFiles: files.map((entry) => entry.name), verification,
    ...(postError !== undefined ? { upstream: submissionDiagnostic(postError) } : {}),
    ...(readBackError !== undefined ? { readBack: submissionDiagnostic(readBackError) } : {}),
    warning: "DO_NOT_RETRY_AUTOMATICALLY",
  });
}

function verifySubmission(
  attempt: BlackboardAttempt | undefined,
  files: readonly BlackboardAttemptFile[],
  submission: BlackboardFormSubmission,
  comment: string | undefined,
): BlackboardSubmissionVerification {
  if (!attempt) return { status: "unavailable", message: "A single new attempt could not be identified after the submission POST." };
  const submitted = attempt.status === "NeedsGrading" || attempt.status === "Completed";
  const contentMatches = submission.kind === "file"
    ? files.some((entry) => entry.name === submission.file.name)
    : attempt.studentSubmission === collapseWhitespace(submission.text);
  const commentMatches = !comment || attempt.studentComments === collapseWhitespace(comment);
  if (submitted && contentMatches && commentMatches) {
    return { status: "confirmed", message: "A new submitted attempt and its expected file/text and comment were read back from Blackboard." };
  }
  return { status: "not_observed", message: "The new attempt did not match the expected submitted status, file/text, or comment." };
}

function submissionDiagnostic(error: unknown): Record<string, unknown> {
  if (!(error instanceof CliError)) return { code: "REQUEST_FAILED", message: "The Blackboard request did not complete." };
  const details = error.details;
  const rawPath = typeof details?.path === "string" ? details.path : details?.url;
  let path: string | undefined;
  if (typeof rawPath === "string") {
    try {
      const url = new URL(rawPath, "https://bb.sustech.edu.cn");
      if (url.origin === "https://bb.sustech.edu.cn") path = url.pathname;
    } catch { /* Do not forward malformed URLs or credential-bearing query strings. */ }
  }
  return {
    code: error.code, message: error.message,
    ...(path ? { path } : {}),
    ...(typeof details?.status === "number" ? { status: details.status } : {}),
  };
}
