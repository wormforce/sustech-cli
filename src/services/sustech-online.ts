import {
  ONLINE_CONTACT_REPO_PATH,
  ONLINE_CONTACT_SITE_PATH,
  ONLINE_RAW_ORIGIN,
  ONLINE_REPO_BRANCH,
  ONLINE_REPO_NAME,
  ONLINE_REPO_OWNER,
  ONLINE_SITE_ORIGIN,
  ONLINE_TALKS_INDEX_REPO_PATH,
  ONLINE_TALKS_INDEX_SITE_PATH,
} from "../online/shared.js";
import type { ServiceStatus } from "./base.js";

export const SUSTECH_ONLINE_STATUS: ServiceStatus = {
  service: "sustech-online",
  availability: "implemented",
  auth: "none",
  campusNetwork: false,
  browser: false,
  summary: "Selected public talks and institutional contacts are read from the community-maintained SUSTech Online project.",
  notes: [
    "Results retain community authority, source, freshness, and CC BY-SA attribution metadata.",
    "High-stakes, financial, personal, dining/chat, and professor-list contact sections are excluded.",
  ],
  endpoints: [
    `${ONLINE_RAW_ORIGIN}/${ONLINE_REPO_OWNER}/${ONLINE_REPO_NAME}/${ONLINE_REPO_BRANCH}/${ONLINE_TALKS_INDEX_REPO_PATH}`,
    `${ONLINE_RAW_ORIGIN}/${ONLINE_REPO_OWNER}/${ONLINE_REPO_NAME}/${ONLINE_REPO_BRANCH}/${ONLINE_CONTACT_REPO_PATH}`,
    `${ONLINE_SITE_ORIGIN}${ONLINE_TALKS_INDEX_SITE_PATH}`,
    `${ONLINE_SITE_ORIGIN}${ONLINE_CONTACT_SITE_PATH}`,
  ],
};
