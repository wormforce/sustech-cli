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
  consequence("credentials.store", "medium", false, "Stores one verified account password in the operating-system credential store and records non-secret profile metadata.", "Selecting the wrong account or profile can make later authenticated commands target an unintended identity.", "Run auth status for the exact profile and confirm the masked SID and persistent backend.", "implemented"),
  consequence("credentials.delete", "medium", false, "Deletes one local credential profile from the operating-system credential store.", "Automations using that profile will stop authenticating until credentials are stored again.", "Run auth status for the exact profile and confirm it is no longer configured.", "implemented"),
  consequence("profile.export", "medium", true, "Writes a whitelisted student profile report to an explicit local JSON path.", "The report contains personal academic data, and --overwrite can replace an existing local file.", "Verify the returned absolute path, schema version, masked SID, and per-source statuses; on POSIX also verify mode 0600, while Windows uses destination ACLs.", "implemented"),
  consequence("academic.snapshot.save", "medium", true, "Writes a versioned academic-state snapshot to an explicit local JSON path.", "The snapshot contains personal academic data, and --overwrite can replace an existing local file.", "Verify the returned absolute path, schema version, digest, and per-source statuses; on POSIX also verify mode 0600, while Windows uses destination ACLs.", "implemented"),
  consequence("tis.ical.export", "medium", true, "Writes selected timetable, exam, deadline, or holiday events to an explicit local iCalendar path.", "The file can expose schedule data, and --overwrite can replace an existing local file.", "Verify the returned absolute path, event count, source statuses, omissions, and SHA-256 digest.", "implemented"),
  consequence("tis.enroll", "high", false, "Adds one exact course section to the student's TIS enrollment.", "The target may be wrong or conflict with the intended timetable.", "Read the enrolled schedule back and match the exact RWH.", "implemented"),
  consequence("tis.drop", "critical", true, "Drops one exact enrolled course section.", "A released seat can be taken immediately and may not be recoverable.", "Read the enrolled schedule back and confirm the exact RWH is absent; do not retry automatically if verification is inconclusive.", "implemented"),
  consequence("tis.cart.update", "low", false, "Changes the student's selection cart.", "A later enrollment plan may use stale cart state.", "Read cart/enrolled state back and match the exact RWH plus TIS ID.", "implemented"),
  consequence("tis.bid", "high", false, "Changes the bid assigned to one or more selectable course sections.", "A wrong bid can reduce the chance of obtaining a course or oversubscribe the round budget.", "Read cart/enrolled plus round state back and match the exact RWH and bid values.", "implemented"),
  consequence("tis.evaluation.submit", "high", true, "Submits a teaching evaluation.", "Submitted answers may be final and apply to the wrong teacher or course.", "Read evaluation status back and confirm only the intended task changed.", "unavailable"),
  consequence("blackboard.download", "low", true, "Writes one selected teacher-provided attachment to an explicit local path.", "A wrong destination, combined with --overwrite, can replace an existing local file.", "Use the returned absolute path, byte count, and SHA-256 to verify the saved file.", "implemented"),
  consequence("blackboard.sync", "medium", true, "Writes multiple selected Blackboard attachments under an explicit local directory.", "A wrong destination, or reuse with --overwrite, can replace local files while syncing several items.", "Review the returned file list, absolute paths, byte counts, and SHA-256 hashes before using the synced copy.", "implemented"),
  consequence("blackboard.calendar-link.store", "medium", false, "Stores or replaces one private Blackboard calendar subscription link in the operating-system credential store.", "Selecting the wrong profile or link can make later calendar refreshes expose another account's events.", "Run bb calendar-link show without --reveal for the exact profile and confirm the masked link plus persistent backend.", "implemented"),
  consequence("blackboard.calendar-link.fetch", "medium", true, "Optionally writes the personal Blackboard calendar feed to an explicit local iCalendar path.", "The calendar contains personal course events, and --overwrite can replace an existing local file.", "Verify the returned absolute path, byte count, SHA-256 digest, masked source, and profile.", "implemented"),
  consequence("blackboard.calendar-link.delete", "medium", false, "Deletes one private Blackboard calendar subscription link from the operating-system credential store.", "Local refreshes using that profile will stop until the link is stored again.", "Run bb calendar-link show for the exact profile and confirm it reports that no link is configured.", "implemented"),
  consequence("blackboard.submit", "critical", true, "Uploads and submits an assignment attempt.", "The wrong file or assignment can affect grading and may consume an attempt.", "Read attempt status and submitted filename back; retain the receipt when Blackboard exposes one.", "implemented"),
  consequence("booking.create", "medium", false, "Creates a campus room reservation.", "It can occupy a limited room slot and affect other users.", "Read the user's meetings back and match the exact room, title, and time.", "implemented"),
  consequence("booking.cancel", "high", true, "Cancels an existing room reservation.", "The released slot may be taken and cannot be guaranteed to return.", "Read the user's meetings back and confirm the exact meeting ID is absent.", "implemented"),
  consequence("library-booking.create", "medium", false, "Creates a library room reservation.", "It uses reservation quota and may block a scarce room.", "Read reservations back and match the exact devId, title, and time window.", "implemented"),
  consequence("library-booking.cancel", "high", true, "Cancels a library reservation.", "The released slot may be taken immediately.", "Read reservations back and confirm the exact reservation ID is absent.", "implemented"),
  consequence("pms.upload", "low", false, "Uploads one local document to the campus print queue without printing it.", "A wrong file or option set can add an unintended document to the remote queue.", "Read print jobs back and match the exact filename plus options.", "implemented"),
  consequence("pms.delete", "high", true, "Deletes one exact queued PMS print document.", "The remote queued copy may be unrecoverable if no local source remains.", "Read the print queue back and confirm the exact job ID is absent.", "implemented"),
  consequence("papers.fetch-oa", "low", true, "Writes one public open-access PDF to an explicit local destination.", "With --overwrite, an existing regular file at that exact destination is replaced.", "Use the returned absolute path, byte count, PDF signature validation, and SHA-256 digest.", "implemented"),
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
