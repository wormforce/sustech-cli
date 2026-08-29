import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.");
const QUESTION = z.string().trim().min(1).max(1_000);
const TASK = z.string().trim().min(1).max(1_000);
const COMMAND = z.string().trim().min(1).max(200);
const COURSE = z.string().trim().min(1).max(200);
const PUBLIC_FOCI = ["auto", "calendar", "resources", "faculty", "online", "papers", "nces", "library", "transit"] as const;

export function registerSustechMcpPrompts(server: McpServer): void {
  server.registerPrompt(
    "sustech_public_lookup",
    {
      title: "SUSTech public lookup",
      description: "Guide a model to answer a SUSTech question with the public sustech MCP surface.",
      argsSchema: z.object({
        question: QUESTION,
        focus: z.enum(PUBLIC_FOCI).optional(),
        date: ISO_DATE.optional(),
      }),
    },
    ({ question, focus, date }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Answer the following SUSTech question using the public sustech MCP surface.",
            `Question: ${question}`,
            `Preferred focus: ${focus ?? "auto"}`,
            `Reference date: ${date ?? "today"}`,
            "Prefer typed MCP tools and resources over free-form guessing.",
            "Preserve source provenance and freshness metadata when a tool returns it.",
            "Treat SUSTech Online as community-maintained rather than official university authority.",
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "sustech_guarded_cli_review",
    {
      title: "SUSTech guarded CLI review",
      description: "Guide a model to classify a SUSTech task against the MCP boundary and the direct CLI safety workflow.",
      argsSchema: z.object({
        task: TASK,
        command: COMMAND.optional(),
      }),
    },
    ({ task, command }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Review this SUSTech task against the local MCP safety boundary.",
            `Task: ${task}`,
            `Candidate command: ${command ?? "not yet chosen"}`,
            "Use sustech_discover, sustech_describe, sustech_consequences, and the MCP policy resource to classify the safest path.",
            "If the task requires authenticated personal data, browser-assisted reads, local file writes, or remote mutations, say that it must continue through the direct sustech CLI.",
            "If a mutation is needed, require preview, explicit approval, --confirm, and read-back verification.",
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "sustech_course_research",
    {
      title: "SUSTech course research",
      description: "Guide a model to research one course from public sources without treating community reviews as official requirements.",
      argsSchema: z.object({
        course: COURSE,
        question: QUESTION.optional(),
      }),
    },
    ({ course, question }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Research the SUSTech course ${course} using only the public sustech MCP tools and resources.`,
            `Question: ${question ?? "Summarize the available public evidence and unresolved points."}`,
            "Use NCES as community evidence, not as an official course or degree authority.",
            "Label the source of every recommendation and leave missing or conflicting facts unresolved.",
            "For cultivation-plan or graduation requirements, direct the user to the applicable official plan or authenticated TIS view.",
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "sustech_talk_digest",
    {
      title: "SUSTech public talk digest",
      description: "Guide a model to find and summarize public SUSTech talks while retaining provenance and freshness caveats.",
      argsSchema: z.object({
        query: QUESTION.optional(),
        since: ISO_DATE.optional(),
        until: ISO_DATE.optional(),
      }),
    },
    ({ query, since, until }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Build a concise digest from the selected public SUSTech Online talks index.",
            `Topic: ${query ?? "all relevant talks"}`,
            `Date range: ${since ?? "unbounded"} to ${until ?? "unbounded"}`,
            "Use the typed talks tools, preserve source URLs and fetched/updated timestamps, and distinguish future from past events.",
            "State that the index is community-maintained and do not infer missing venue, speaker, or schedule details.",
          ].join("\n"),
        },
      }],
    }),
  );
}
