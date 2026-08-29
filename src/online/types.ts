export type OnlineAuthority = "community";
export type OnlineAdvisory =
  | "AI_PROCESSED_SOURCE"
  | "COMMUNITY_MAINTAINED"
  | "SOURCE_UPDATE_UNKNOWN"
  | "STALE_SOURCE";

export interface OnlineProvenance {
  authority: OnlineAuthority;
  sourceUrl: string;
  sourceRepoPath: string;
  sourceUpdatedAt?: string;
  fetchedAt: string;
  license: "CC-BY-SA-4.0";
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/";
  advisories: readonly OnlineAdvisory[];
}

export interface OnlineTalkSummary {
  kind: "talk";
  id: string;
  slug: string;
  label: string;
  title: string;
  series?: string;
  speakerLine?: string;
  speakerName?: string;
  speakerAffiliation?: string;
  date: string;
  weekday?: string;
  timeText: string;
  startAt?: string;
  detailUrl: string;
  detailRepoPath: string;
  provenance: OnlineProvenance;
}

export interface OnlineTalk extends OnlineTalkSummary {
  timeRangeText?: string;
  endAt?: string;
  venue?: string;
  speakerBio?: string;
  abstract?: string;
  posterUrl?: string;
}

export interface OnlineContactRecord {
  kind: "contact";
  id: string;
  name: string;
  category: string;
  categoryKey: string;
  phones: string[];
  emails: string[];
  address?: string;
  hours?: string[];
  websiteUrl?: string;
  notes: string[];
  provenance: OnlineProvenance;
}

export interface OnlineSearchHit {
  kind: "talk" | "contact";
  id: string;
  title: string;
  subtitle?: string;
  snippet: string;
  url?: string;
  provenance: OnlineProvenance;
}
