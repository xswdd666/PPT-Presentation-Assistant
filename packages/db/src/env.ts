import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url().refine((value) => value.startsWith("postgresql://"), {
    message: "DATABASE_URL must use PostgreSQL",
  }),
  OBJECT_STORAGE_BUCKET: z.string().min(1),
  JOB_QUEUE_NAME: z.string().min(1).default("deck-rehearsal"),
});

export type DatabaseEnvironment = z.infer<typeof environmentSchema>;

export function parseDatabaseEnvironment(
  environment: NodeJS.ProcessEnv,
): DatabaseEnvironment {
  return environmentSchema.parse(environment);
}
