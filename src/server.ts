import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initialRoster, isDate, readDay, readParticipants, type Roster, type SavedDay } from "./ledger.js";

const project = fileURLToPath(new URL("../", import.meta.url));
const dataDirectory = resolve(process.env.LUNCH_ACCOUNT_DATA_DIR ?? join(project, "data"));
const webDirectory = resolve(process.env.LUNCH_WEB_DIR ?? join(project, "dist", "web"));
const dataFile = join(dataDirectory, "ledger.json");
const rosterFile = join(dataDirectory, "participants.json");
const port = Number(process.env.PORT ?? 41735);
const assets = new Map<string, [string, string]>([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/firebase-config.json", ["firebase-config.json", "application/json; charset=utf-8"]],
]);

type Book = Record<string, SavedDay>;

function readData<T>(path: string, defaults: T): T {
  if (!existsSync(path)) return defaults;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeData(path: string, value: unknown) {
  mkdirSync(dataDirectory, { recursive: true });
  const temporary = join(dataDirectory, randomUUID() + ".tmp");
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
    flush: true,
  });
  renameSync(temporary, path);
}

function json(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 512 * 1024) return undefined;
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const host = request.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return json(response, 403, { error: "Open the app using its localhost address." });
  }
  const pathname = new URL(request.url ?? "/", "http://" + host).pathname;
  if (request.method === "GET") {
    if (pathname === "/api/days" || pathname === "/api/ledger") {
      const days = Object.values(readData<Book>(dataFile, {}));
      if (pathname === "/api/days") return json(response, 200, days);
      return json(response, 200, { roster: readData(rosterFile, initialRoster()), days });
    }
    const asset = assets.get(pathname) ?? (
      /^\/chunks\/[\w-]+\.js$/.test(pathname)
        ? [pathname.slice(1), "text/javascript; charset=utf-8"]
        : undefined
    );
    if (asset) {
      const [path, contentType] = asset;
      const file = join(webDirectory, path);
      if (!existsSync(file)) return json(response, 404, { error: "App file not found." });
      const content = readFileSync(file);
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(content);
      return;
    }
  }

  const date = /^\/api\/days\/([^/]+)$/.exec(pathname)?.[1];
  if (request.method === "PUT" && (pathname === "/api/roster" || isDate(date))) {
    const { origin } = request.headers;
    if (origin && origin !== "http://" + host) {
      return json(response, 403, { error: "Open the app directly to save entries." });
    }
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      return json(response, 415, { error: "The entry must be sent as JSON." });
    }
    const payload = await requestBody(request) as { day?: unknown; participants?: unknown; revision?: unknown } | undefined;
    const roster = readData(rosterFile, initialRoster());

    if (pathname === "/api/roster") {
      const participants = readParticipants(payload?.participants);
      if (!participants || roster.participants.some(({ id }) => !participants.some((person) => person.id === id))) {
        return json(response, 400, { error: "Check the participant names and meal preferences." });
      }
      if (roster.revision !== payload?.revision) {
        return json(response, 409, { error: "Participants changed elsewhere. Reload the app before editing them." });
      }
      const saved: Roster = { participants, revision: randomUUID() };
      writeData(rosterFile, saved);
      return json(response, 200, saved);
    }
    if (!isDate(date)) return json(response, 404, { error: "Invalid lunch date." });
    const day = readDay(payload?.day, date, roster.participants);
    if (!day) return json(response, 400, { error: "Check the date, prices, and orders before saving." });
    const book = readData<Book>(dataFile, {});
    if ((book[date]?.revision ?? null) !== payload?.revision) {
      return json(response, 409, { error: "This lunch day changed elsewhere. Reload the app before editing it." });
    }
    const saved = { day, revision: randomUUID() };
    book[date] = saved;
    writeData(dataFile, book);
    return json(response, 200, saved);
  }
  return json(response, 404, { error: "Page not found." });
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: "The local ledger could not be accessed." });
    else response.end();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("Lunch Account is ready at http://127.0.0.1:" + port);
});
