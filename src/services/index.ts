import { BLACKBOARD_STATUS } from "./blackboard.js";
import { BOOKING_STATUS } from "./booking.js";
import { LIBRARY_BOOKING_STATUS, LIBRARY_CATALOG_STATUS } from "./library.js";
import { NCES_STATUS } from "./nces.js";
import { PAPERS_STATUS } from "./papers.js";
import { PMS_STATUS } from "./pms.js";
import { WS_STATUS } from "./ws.js";
import type { ServiceStatus } from "./base.js";

export const SERVICE_STATUSES: readonly ServiceStatus[] = [
  BLACKBOARD_STATUS,
  BOOKING_STATUS,
  LIBRARY_CATALOG_STATUS,
  LIBRARY_BOOKING_STATUS,
  WS_STATUS,
  PMS_STATUS,
  NCES_STATUS,
  PAPERS_STATUS,
] as const;

export function serviceStatus(name: string): ServiceStatus | undefined {
  return SERVICE_STATUSES.find((entry) => entry.service === name);
}

export function formatServiceStatuses(statuses: readonly ServiceStatus[]): string {
  return [
    `Service adapters · ${statuses.length}`,
    ...statuses.map((status) => [
      `${status.service} [${status.availability}]`,
      `  auth=${status.auth} · campusNetwork=${status.campusNetwork} · browser=${status.browser}`,
      `  ${status.summary}`,
      ...status.notes.map((note) => `  Note: ${note}`),
    ].join("\n")),
  ].join("\n\n");
}

export * from "./base.js";
export * from "./blackboard.js";
export * from "./booking.js";
export * from "./library.js";
export * from "./nces.js";
export * from "./papers.js";
export * from "./pms.js";
export * from "./ws.js";
