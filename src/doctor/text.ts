import type { DoctorReport } from "./service.js";

export function formatDoctorReport(report: DoctorReport): string {
  const heading = report.summary.healthy ? "healthy" : "attention required";
  return [
    `SUSTech CLI doctor · ${heading}`,
    `Runtime: ${report.runtime} · ${report.platform}/${report.architecture}`,
    `Profile: ${report.profile} · live=${report.live}`,
    `Checks: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skipped} skipped`,
    "",
    ...report.checks.flatMap((check) => [
      `[${check.status.toUpperCase()}] ${check.id}: ${check.summary}`,
      ...(check.remediation ? [`  Remediation: ${check.remediation}`] : []),
    ]),
  ].join("\n");
}
