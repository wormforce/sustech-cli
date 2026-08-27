import type { CredentialProfileStatus } from "./keyring.js";

export interface DashboardInput {
  version: string;
  runtime: string;
  credentials: CredentialProfileStatus;
  brandArt: string;
  terminalColumns?: number;
}

const COLUMN_GAP = 4;
const ANSI_SGR = /\u001b\[[0-9;]*m/g;

export function formatDashboard(input: DashboardInput): string {
  const { credentials } = input;
  const credentialState = credentials.credentialAvailable
    ? "ready"
    : credentials.configured
      ? "unavailable"
      : "not configured";
  const storageState = credentials.backend === "unavailable"
    ? "unavailable"
    : `${credentials.backend} · ${credentials.backendAvailable ? "ready" : "unavailable"}`;

  const account = [
    "Account",
    `  Profile      ${credentials.profile}`,
    `  SID          ${credentials.maskedSid ?? "—"}`,
    `  Credentials  ${credentialState}`,
    `  Storage      ${storageState}`,
    ...(credentials.profiles.length > 1
      ? [`  Profiles     ${credentials.profiles.join(", ")}`]
      : []),
  ];

  const next = credentials.credentialAvailable
    ? [
        "Quick start",
        "  sustech context --live",
        "  sustech tis schedule",
        "  sustech bb deadlines",
      ]
    : [
        "Sign in",
        `  sustech auth login${credentials.profile === "default" ? "" : ` --profile ${credentials.profile}`}`,
        "",
        "Without an account",
        "  sustech calendar day",
      ];

  const panel = [
    `sustech-cli ${input.version} · ${input.runtime}`,
    "",
    ...account,
    "",
    ...next,
    "",
    "More commands",
    "  sustech --help",
  ];

  if (canUseColumns(input.brandArt, panel, input.terminalColumns)) {
    return joinColumns(input.brandArt.split("\n"), panel);
  }

  return [input.brandArt, "", ...panel].join("\n");
}

function canUseColumns(art: string, panel: readonly string[], terminalColumns: number | undefined): boolean {
  if (terminalColumns === undefined) return false;
  const artWidth = Math.max(...art.split("\n").map(visibleWidth));
  const panelWidth = Math.max(...panel.map(visibleWidth));
  return artWidth + COLUMN_GAP + panelWidth <= terminalColumns;
}

function joinColumns(left: readonly string[], right: readonly string[]): string {
  const leftWidth = Math.max(...left.map(visibleWidth));
  const rows = Math.max(left.length, right.length);
  return Array.from({ length: rows }, (_, index) => {
    const leftCell = left[index] ?? "";
    const rightCell = right[index];
    if (rightCell === undefined) return leftCell;
    const padding = " ".repeat(leftWidth - visibleWidth(leftCell) + COLUMN_GAP);
    return `${leftCell}${padding}${rightCell}`;
  }).join("\n");
}

function visibleWidth(value: string): number {
  return value.replaceAll(ANSI_SGR, "").length;
}
