export const worker = {
  name: "deck-rehearsal-worker",
  status: "ready",
} as const;

if (process.env.NODE_ENV !== "test") {
  console.log(`${worker.name} is ${worker.status}`);
}
