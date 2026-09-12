import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
};

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    scenario: text("scenario").notNull(),
    customScenario: text("custom_scenario"),
    audience: text("audience").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    concerns: text("concerns"),
    currentVersionId: text("current_version_id"),
    ...timestamps,
  },
  (table) => [index("projects_owner_idx").on(table.ownerId)],
);

export const sourceFiles = pgTable("source_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  mediaType: text("media_type").notNull(),
  storageKey: text("storage_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const deckVersions = pgTable(
  "deck_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: text("source_file_id")
      .notNull()
      .references(() => sourceFiles.id),
    parentVersionId: text("parent_version_id"),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull(),
    storageKey: text("storage_key").notNull(),
    changeSummary: text("change_summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("deck_version_number_idx").on(
      table.projectId,
      table.versionNumber,
    ),
  ],
);

export const slides = pgTable(
  "slides",
  {
    id: text("id").primaryKey(),
    deckVersionId: text("deck_version_id")
      .notNull()
      .references(() => deckVersions.id, { onDelete: "cascade" }),
    sourceStableId: text("source_stable_id").notNull(),
    index: integer("slide_index").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    purpose: text("purpose"),
    notes: text("notes"),
    visualSummary: text("visual_summary"),
    renderStorageKey: text("render_storage_key"),
  },
  (table) => [
    uniqueIndex("slide_version_stable_idx").on(
      table.deckVersionId,
      table.sourceStableId,
    ),
  ],
);

export const slideElements = pgTable("slide_elements", {
  id: text("id").primaryKey(),
  slideId: text("slide_id")
    .notNull()
    .references(() => slides.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  bounds: jsonb("bounds").notNull(),
  text: text("text"),
  editable: boolean("editable").notNull().default(false),
  contentHash: text("content_hash").notNull(),
});

export const deckContexts = pgTable("deck_contexts", {
  deckVersionId: text("deck_version_id")
    .primaryKey()
    .references(() => deckVersions.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  scenario: text("scenario").notNull(),
  audience: text("audience").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  goal: jsonb("goal"),
  expectedAudienceResponse: jsonb("expected_audience_response"),
  narrativeSummary: text("narrative_summary"),
  facts: jsonb("facts").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const reviewers = pgTable("reviewers", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  deckVersionId: text("deck_version_id")
    .notNull()
    .references(() => deckVersions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  displayName: text("display_name").notNull(),
  rubric: jsonb("rubric").notNull(),
  routeReason: text("route_reason").notNull(),
  relatedSlideIds: jsonb("related_slide_ids").notNull(),
  confidence: real("confidence").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export const reviewIssues = pgTable("review_issues", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  deckVersionId: text("deck_version_id")
    .notNull()
    .references(() => deckVersions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rootCause: text("root_cause").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  relatedSlideIds: jsonb("related_slide_ids").notNull(),
  ignoredReason: text("ignored_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const issueClusters = pgTable("issue_clusters", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  deckVersionId: text("deck_version_id")
    .notNull()
    .references(() => deckVersions.id, { onDelete: "cascade" }),
  rootCause: text("root_cause").notNull(),
  issueIds: jsonb("issue_ids").notNull(),
  primaryIssueId: text("primary_issue_id")
    .notNull()
    .references(() => reviewIssues.id),
});

export const reviewComments = pgTable("review_comments", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => reviewIssues.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id")
    .notNull()
    .references(() => reviewers.id),
  deckVersionId: text("deck_version_id")
    .notNull()
    .references(() => deckVersions.id, { onDelete: "cascade" }),
  headline: text("headline").notNull(),
  body: text("body").notNull(),
  evidence: text("evidence").notNull(),
  impact: text("impact").notNull(),
  suggestedAction: text("suggested_action").notNull(),
  confidence: real("confidence").notNull(),
  relatedSlideIds: jsonb("related_slide_ids").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const rewriteProposals = pgTable("rewrite_proposals", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  deckVersionId: text("deck_version_id")
    .notNull()
    .references(() => deckVersions.id),
  selection: jsonb("selection").notNull(),
  replacementText: text("replacement_text").notNull(),
  rationale: text("rationale").notNull(),
  factsPreserved: boolean("facts_preserved").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const changeSets = pgTable("change_sets", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  baseVersionId: text("base_version_id")
    .notNull()
    .references(() => deckVersions.id),
  status: text("status").notNull(),
  operations: jsonb("operations").notNull().default([]),
  ...timestamps,
});

export const scripts = pgTable("scripts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  deckVersionId: text("deck_version_id")
    .notNull()
    .references(() => deckVersions.id),
  style: text("style").notNull(),
  status: text("status").notNull(),
  pages: jsonb("pages").notNull().default([]),
  totalDurationSeconds: integer("total_duration_seconds").notNull(),
  compressionAdvice: text("compression_advice"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const analysisJobs = pgTable("analysis_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  deckVersionId: text("deck_version_id")
    .notNull()
    .references(() => deckVersions.id),
  stage: text("stage").notNull(),
  processedSlides: integer("processed_slides").notNull().default(0),
  totalSlides: integer("total_slides").notNull(),
  failedSlideIds: jsonb("failed_slide_ids").notNull().default([]),
  failureReason: text("failure_reason"),
  ...timestamps,
});

export const databaseSchema = {
  projects,
  sourceFiles,
  deckVersions,
  slides,
  slideElements,
  deckContexts,
  reviewers,
  reviewIssues,
  issueClusters,
  reviewComments,
  rewriteProposals,
  changeSets,
  scripts,
  analysisJobs,
};
