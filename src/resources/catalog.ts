export type ResourceCategory = "official" | "academic" | "maps" | "papers" | "community";

export interface CampusResource {
  id: string;
  name: string;
  category: ResourceCategory;
  url: string;
  authentication: "none" | "campus" | "service-specific";
  summary: string;
}

export const CAMPUS_RESOURCES: readonly CampusResource[] = [
  resource("official", "SUSTech official site", "official", "https://www.sustech.edu.cn", "none", "University news and official information."),
  resource("online", "SUSTech Online", "community", "https://sustech.online", "none", "Student-maintained guides and study resources."),
  resource("tis", "Teaching Information System", "academic", "https://tis.sustech.edu.cn", "campus", "Courses, grades, exams, schedules, and selection."),
  resource("blackboard", "Blackboard Learn", "academic", "https://bb.sustech.edu.cn", "campus", "Course materials, assignments, and deadlines."),
  resource("cas", "SUSTech CAS", "official", "https://cas.sustech.edu.cn", "campus", "Central authentication service; use through a target service."),
  resource("library", "SUSTech Library", "academic", "https://library.sustech.edu.cn", "none", "Library portal and services."),
  resource("primo", "Library Primo", "academic", "https://sustc.primo.exlibrisgroup.com.cn", "campus", "Library catalog and discovery search."),
  resource("campus-map", "Campus map documents", "maps", "https://mirrors.sustech.edu.cn/site/sustech-online/documents/campus-map/", "none", "Community mirror of campus map documents."),
  resource("documents", "SUSTech Online documents", "community", "https://mirrors.sustech.edu.cn/site/sustech-online/documents/", "none", "Mirrored calendars, schedules, and student documents."),
  resource("crossref", "Crossref", "papers", "https://api.crossref.org/works", "none", "Public scholarly metadata API."),
  resource("arxiv", "arXiv", "papers", "https://arxiv.org", "none", "Open research preprints."),
  resource("europe-pmc", "Europe PMC", "papers", "https://europepmc.org", "none", "Life-science literature and open-access links."),
  resource("nces", "NCES course evaluations", "community", "https://ncesnext.com", "none", "Community course reviews and public JSON search."),
] as const;

export function searchResources(query: string, category?: ResourceCategory): CampusResource[] {
  const normalized = query.trim().toLowerCase();
  return CAMPUS_RESOURCES.filter((entry) => {
    if (category && entry.category !== category) return false;
    if (!normalized) return true;
    return [entry.id, entry.name, entry.category, entry.summary, entry.url]
      .some((field) => field.toLowerCase().includes(normalized));
  });
}

function resource(
  id: string,
  name: string,
  category: ResourceCategory,
  url: string,
  authentication: CampusResource["authentication"],
  summary: string,
): CampusResource {
  return { id, name, category, url, authentication, summary };
}
