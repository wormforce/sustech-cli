export interface ConfirmationOptions {
  credentialsFile?: string;
  profile?: string;
}

export interface BookingCreateConfirmationTarget {
  roomId: string;
  title: string;
  start: string;
  end: string;
  participants: number;
  description?: string;
}

export interface BookingCancelConfirmationTarget {
  meetingId: string;
}

export interface LibraryBookingCreateConfirmationTarget {
  classKind: number;
  kindId: number;
  labId: number;
  devId: number;
  title: string;
  start: string;
  end: string;
  memberKind: 1 | 2;
  members: number[];
  memo?: string;
}

export interface LibraryBookingCancelConfirmationTarget {
  reservationId: number;
}

export interface ApplyConfirmation {
  required: true;
  argv: string[];
  command: string;
}

export function buildBookingCreateApplyConfirmation(
  target: BookingCreateConfirmationTarget,
  options: ConfirmationOptions,
): ApplyConfirmation {
  const argv = [
    "sustech",
    "booking",
    "create",
    "apply",
    ...(options.credentialsFile ? ["--credentials-file", options.credentialsFile] : []),
    ...(options.profile ? ["--profile", options.profile] : []),
    "--room-id",
    target.roomId,
    "--start",
    target.start,
    "--end",
    target.end,
    "--title",
    target.title,
    "--participants",
    String(target.participants),
    ...(target.description ? ["--description", target.description] : []),
    "--confirm",
  ];
  return { required: true, argv, command: argv.map(shellQuote).join(" ") };
}

export function buildBookingCancelApplyConfirmation(
  target: BookingCancelConfirmationTarget,
  options: ConfirmationOptions,
): ApplyConfirmation {
  const argv = [
    "sustech",
    "booking",
    "cancel",
    "apply",
    ...(options.credentialsFile ? ["--credentials-file", options.credentialsFile] : []),
    ...(options.profile ? ["--profile", options.profile] : []),
    "--meeting-id",
    target.meetingId,
    "--confirm",
  ];
  return { required: true, argv, command: argv.map(shellQuote).join(" ") };
}

export function buildLibraryBookingCreateApplyConfirmation(
  target: LibraryBookingCreateConfirmationTarget,
  options: ConfirmationOptions,
): ApplyConfirmation {
  const argv = [
    "sustech",
    "lib-booking",
    "create",
    "apply",
    ...(options.credentialsFile ? ["--credentials-file", options.credentialsFile] : []),
    ...(options.profile ? ["--profile", options.profile] : []),
    "--kind-id",
    String(target.kindId),
    "--lab-id",
    String(target.labId),
    "--dev-id",
    String(target.devId),
    "--start",
    target.start,
    "--end",
    target.end,
    "--title",
    target.title,
    "--class-kind",
    String(target.classKind),
    "--member-kind",
    String(target.memberKind),
    ...target.members.flatMap((value) => ["--member", String(value)]),
    ...(target.memo ? ["--memo", target.memo] : []),
    "--confirm",
  ];
  return { required: true, argv, command: argv.map(shellQuote).join(" ") };
}

export function buildLibraryBookingCancelApplyConfirmation(
  target: LibraryBookingCancelConfirmationTarget,
  options: ConfirmationOptions,
): ApplyConfirmation {
  const argv = [
    "sustech",
    "lib-booking",
    "cancel",
    "apply",
    ...(options.credentialsFile ? ["--credentials-file", options.credentialsFile] : []),
    ...(options.profile ? ["--profile", options.profile] : []),
    "--reservation-id",
    String(target.reservationId),
    "--confirm",
  ];
  return { required: true, argv, command: argv.map(shellQuote).join(" ") };
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/:=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
