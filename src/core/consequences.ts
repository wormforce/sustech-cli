export type ConsequenceSeverity = "low" | "medium" | "high" | "critical";

export interface Consequence {
  operation: string;
  severity: ConsequenceSeverity;
  irreversible: boolean;
  whatChanges: string;
  risk: string;
  verification: string;
  availability: "implemented" | "preview-only" | "unavailable";
}

export const CONSEQUENCES: readonly Consequence[] = [
  consequence("tis.enroll", "high", false, "Adds one exact course section to the student's TIS enrollment.", "The target may be wrong or conflict with the intended timetable.", "Read the enrolled schedule back and match the exact RWH.", "implemented"),
  consequence("tis.drop", "critical", true, "Drops one exact enrolled course section.", "A released seat can be taken immediately and may not be recoverable.", "Read the enrolled schedule back and confirm the RWH is absent.", "preview-only"),
  consequence("tis.cart.update", "low", false, "Changes the student's selection cart.", "A later enrollment plan may use stale cart state.", "Read the cart back and compare exact course IDs.", "preview-only"),
  consequence("tis.bid", "high", false, "Changes the bid assigned to a selectable course.", "A wrong bid can reduce the chance of obtaining a course.", "Read selectable-course state back and match the exact bid.", "preview-only"),
  consequence("tis.evaluation.submit", "high", true, "Submits a teaching evaluation.", "Submitted answers may be final and apply to the wrong teacher or course.", "Read evaluation status back and confirm only the intended task changed.", "unavailable"),
  consequence("blackboard.download", "low", true, "Writes one selected teacher-provided attachment to an explicit local path.", "A wrong destination, combined with --overwrite, can replace an existing local file.", "Use the returned absolute path, byte count, and SHA-256 to verify the saved file.", "implemented"),
  consequence("blackboard.submit", "critical", true, "Uploads and submits an assignment attempt.", "The wrong file or assignment can affect grading and may consume an attempt.", "Read attempt status and submitted filename back; retain the receipt when Blackboard exposes one.", "implemented"),
  consequence("booking.create", "medium", false, "Creates a campus room reservation.", "It can occupy a limited room slot and affect other users.", "Read the user's meetings back and match room plus time.", "unavailable"),
  consequence("booking.cancel", "high", true, "Cancels an existing room reservation.", "The released slot may be taken and cannot be guaranteed to return.", "Read the user's meetings back and confirm the exact meeting is absent.", "unavailable"),
  consequence("library-booking.create", "medium", false, "Creates a library room reservation.", "It uses reservation quota and may block a scarce room.", "Read reservations back and match the exact room plus period.", "unavailable"),
  consequence("library-booking.cancel", "high", true, "Cancels a library reservation.", "The released slot may be taken immediately.", "Read reservations back and confirm the exact reservation is absent.", "unavailable"),
  consequence("pms.upload", "low", false, "Uploads a document to the campus print queue.", "The document enters an account-visible queue, although printing is not triggered.", "Read print jobs back and match filename plus options.", "unavailable"),
  consequence("pms.delete", "high", true, "Deletes a queued print or scan document.", "The remote copy may be unrecoverable if no local source remains.", "Read the corresponding queue back and confirm the exact job is absent.", "unavailable"),
] as const;

export function consequenceByOperation(operation: string): Consequence | undefined {
  return CONSEQUENCES.find((entry) => entry.operation === operation);
}

export function formatConsequences(entries: readonly Consequence[]): string {
  return [
    `Consequence-rich operations · ${entries.length}`,
    ...entries.map((entry) => [
      `${entry.operation} [${entry.severity}${entry.irreversible ? ", irreversible" : ""}]`,
      `  ${entry.whatChanges}`,
      `  Risk: ${entry.risk}`,
      `  Verification: ${entry.verification}`,
      `  Availability: ${entry.availability}`,
    ].join("\n")),
  ].join("\n\n");
}

function consequence(
  operation: string,
  severity: ConsequenceSeverity,
  irreversible: boolean,
  whatChanges: string,
  risk: string,
  verification: string,
  availability: Consequence["availability"],
): Consequence {
  return { operation, severity, irreversible, whatChanges, risk, verification, availability };
}
