import { formatOnlineAdvisories } from "./shared.js";
import { talkSearchSnippet } from "./talks.js";
import type { OnlineTalk, OnlineTalkSummary } from "./types.js";

export function formatOnlineTalks(talks: readonly OnlineTalkSummary[], title = "SUSTech Online talks"): string {
  if (talks.length === 0) return `${title}\n\nNo public talk records matched.`;
  const blocks = talks.map((talk, index) => [
    `${index + 1}. ${talk.title}`,
    `   Id: ${talk.id}`,
    `   When: ${[talk.date, talk.weekday, talk.timeText].filter(Boolean).join(" ")}`,
    talk.speakerLine ? `   Speaker: ${talk.speakerLine}` : "",
    talk.series ? `   Series: ${talk.series}` : "",
    `   Detail: ${talk.detailUrl}`,
    `   Source: ${talk.provenance.sourceRepoPath}${talk.provenance.sourceUpdatedAt ? ` · updated ${talk.provenance.sourceUpdatedAt}` : ""} · ${talk.provenance.license}`,
    `   Advisories: ${formatOnlineAdvisories(talk.provenance.advisories)}`,
  ].filter(Boolean).join("\n"));
  return `${title}\n\n${blocks.join("\n\n")}\n\n${talks.length} talk(s).`;
}

export function formatOnlineTalkSearch(talks: readonly OnlineTalkSummary[], query: string): string {
  if (talks.length === 0) return `SUSTech Online talks search · ${query}\n\nNo public talk records matched.`;
  const blocks = talks.map((talk, index) => [
    `${index + 1}. ${talk.title} [${talk.id}]`,
    `   ${talkSearchSnippet(talk)}`,
  ].join("\n"));
  return `SUSTech Online talks search · ${query}\n\n${blocks.join("\n\n")}\n\n${talks.length} match(es).`;
}

export function formatOnlineTalk(talk: OnlineTalk): string {
  const lines = [
    `SUSTech Online talk · ${talk.title}`,
    "",
    `Id: ${talk.id}`,
    `When: ${talk.timeRangeText ?? [talk.date, talk.weekday, talk.timeText].filter(Boolean).join(" ")}`,
    talk.speakerLine ? `Speaker: ${talk.speakerLine}` : "",
    talk.series ? `Series: ${talk.series}` : "",
    talk.venue ? `Venue: ${talk.venue}` : "",
    talk.abstract ? `Abstract: ${talk.abstract}` : "",
    talk.speakerBio ? `Speaker bio: ${talk.speakerBio}` : "",
    talk.posterUrl ? `Poster: ${talk.posterUrl}` : "",
    `Detail: ${talk.detailUrl}`,
    `Source: ${talk.provenance.sourceRepoPath}${talk.provenance.sourceUpdatedAt ? ` · updated ${talk.provenance.sourceUpdatedAt}` : ""} · ${talk.provenance.license}`,
    `Advisories: ${formatOnlineAdvisories(talk.provenance.advisories)}`,
  ].filter(Boolean);
  return lines.join("\n");
}
