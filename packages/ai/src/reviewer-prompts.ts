import { readFileSync } from "node:fs";
const files = {
  jack: "jack.md",
  olivia: "olivia.md",
  ryan: "ryan.md",
  mia: "mia.md",
  emma: "emma.md",
  leo: "leo.md",
  sophie: "sophie.md",
} as const;
export type ReviewerPromptId = keyof typeof files;
export function reviewerPrompt(id: ReviewerPromptId) {
  return readFileSync(
    new URL(`./prompts/reviewers/${files[id]}`, import.meta.url),
    "utf8",
  ).trim();
}
