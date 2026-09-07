import { formatOnlineAdvisories } from "./shared.js";
import type { OnlineManualRecord, OnlineManualSourceStatus } from "./manual.js";

export function formatOnlineManualRecords(
  records: readonly OnlineManualRecord[],
  title = "SUSTech Online manual",
  options: { partial?: boolean; sourceStatuses?: readonly OnlineManualSourceStatus[] } = {},
): string {
  const statusLine = formatPartialStatus(options.partial, options.sourceStatuses);
  if (records.length === 0) return `${title}\n\nNo public handbook records matched.${statusLine}`;
  const blocks = records.map((record, index) => [
    `${index + 1}. ${record.title}`,
    `   Id: ${record.id}`,
    `   Source: ${record.sourceTitle} [${record.sourceKey}]`,
    `   Section: ${record.sectionPath}`,
    `   Summary: ${record.summary}`,
    record.links[0]?.url ? `   Link: ${record.links[0].url}` : `   Page: ${record.pageUrl}`,
    `   Provenance: ${record.pageRepoPath}${record.provenance.sourceUpdatedAt ? ` · updated ${record.provenance.sourceUpdatedAt}` : ""} · ${record.provenance.license}`,
    `   Advisories: ${formatOnlineAdvisories(record.provenance.advisories)}`,
  ].filter(Boolean).join("\n"));
  return `${title}\n\n${blocks.join("\n\n")}\n\n${records.length} record(s).${statusLine}`;
}

export function formatOnlineManualRecord(
  record: OnlineManualRecord,
  options: { partial?: boolean; sourceStatuses?: readonly OnlineManualSourceStatus[] } = {},
): string {
  const lines = [
    `SUSTech Online manual · ${record.title}`,
    "",
    `Id: ${record.id}`,
    `Source: ${record.sourceTitle} [${record.sourceKey}]`,
    `Section: ${record.sectionPath}`,
    `Summary: ${record.summary}`,
    `Page: ${record.pageUrl}`,
    record.links.length > 0 ? `Links: ${record.links.map((link) => `${link.text} → ${link.url}`).join(" | ")}` : "",
    `Content: ${record.content}`,
    `Provenance: ${record.pageRepoPath}${record.provenance.sourceUpdatedAt ? ` · updated ${record.provenance.sourceUpdatedAt}` : ""} · ${record.provenance.license}`,
    `Advisories: ${formatOnlineAdvisories(record.provenance.advisories)}`,
  ].filter(Boolean);
  const statusLine = formatPartialStatus(options.partial, options.sourceStatuses);
  return lines.join("\n") + statusLine;
}

function formatPartialStatus(
  partial: boolean | undefined,
  sourceStatuses: readonly OnlineManualSourceStatus[] | undefined,
): string {
  if (!partial) return "";
  const incomplete = sourceStatuses?.filter((status) => status.status !== "ok") ?? [];
  return `\n\nPartial result: ${incomplete.length} manual source(s) were unavailable or no longer matched the allowlist.`;
}
