import type { OfficialTalksResult } from "./client.js";

export function formatOfficialTalks(result: OfficialTalksResult): string {
  const sections = result.scope === "all"
    ? [
        ["尚未开始", result.talks.filter((talk) => talk.timing === "upcoming")],
        ["时间待确认", result.talks.filter((talk) => talk.timing === "unknown")],
        ["已经开始", result.talks.filter((talk) => talk.timing === "started")],
      ] as const
    : [
        ["尚未开始", result.talks.filter((talk) => talk.timing === "upcoming")],
        ["时间待确认", result.talks.filter((talk) => talk.timing === "unknown")],
      ] as const;
  const body = sections.flatMap(([heading, talks]) => talks.length === 0 ? [] : [
    `${heading}（${talks.length} 场）`,
    "",
    ...talks.flatMap((talk) => [
      talk.startAt ? formatStart(talk.startAt) : talk.timeText || "时间待定",
      talk.title,
      `主讲：${talk.speaker || "未提供"}`,
      `地点：${talk.venue || "未提供"}`,
      `详情：${talk.detailUrl}`,
      "",
    ]),
  ]);
  return [
    `南科大官网学术讲座 · ${result.scope === "all" ? `当前展示 ${result.total} 场` : `尚未开始 ${result.talks.filter((talk) => talk.timing === "upcoming").length} 场`}`,
    `北京时间 · ${result.scope === "all" ? "未开始的从近到远，已开始的从新到旧" : "按开始时间从近到远"}`,
    "",
    ...(body.length ? body : ["没有匹配的讲座。", ""]),
    `范围：官网首页当前展示的 ${result.sourceTotal} 条讲座`,
    `来源：${result.provenance.sourceUrl}`,
    `抓取时间：${result.provenance.fetchedAt}`,
    ...(result.scope === "all" ? [] : ["使用 --all 查看包含已开始讲座的全部记录。"]),
    ...result.warnings.map((warning) => `注意：${warning}`),
  ].join("\n");
}

function formatStart(startAt: string): string {
  const date = new Date(startAt);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}-${value("day")} ${value("weekday")} ${value("hour")}:${value("minute")}`;
}
