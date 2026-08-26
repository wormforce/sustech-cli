export interface FacultyIndexCard {
  slug: string;
  name: string;
  title?: string;
  department?: string;
  photoUrl?: string;
  profileUrl: string;
}

export interface FacultyLinks {
  researcherId?: string;
  googleScholar?: string;
}

export interface FacultyProfile extends FacultyIndexCard {
  source: "index" | "profile";
  nameEn?: string;
  email?: string;
  phone?: string;
  office?: string;
  biography?: string;
  education: string[];
  workHistory: string[];
  researchInterests: string[];
  extraSections: Record<string, string[]>;
  links: FacultyLinks;
  relevanceScore?: number;
  matchedFields: string[];
}
