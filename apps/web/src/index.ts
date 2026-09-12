import { createServer } from "node:http";

const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.WEB_PORT ?? 3000);

export const webServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ service: "web", status: "ok" }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Deck Rehearsal web skeleton\n");
});

if (process.env.NODE_ENV !== "test") {
  webServer.listen(port, host, () => {
    console.log(
      `Deck Rehearsal web listening on http://${host}:${String(port)}`,
    );
  });
}
