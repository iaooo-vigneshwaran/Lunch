import type { Day, Ledger, Participant, Roster, SavedDay } from "./ledger.js";

export interface LedgerStore {
  load(): Promise<Ledger>;
  saveDay(day: Day, revision: string | null): Promise<SavedDay>;
  saveRoster(participants: Participant[], revision: string | null): Promise<Roster>;
}

async function json<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(path, payload === undefined ? undefined : {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(problem.error ?? "Could not access the local ledger.");
  }
  return await response.json() as T;
}

export const localStore: LedgerStore = {
  load: () => json("/api/ledger"),
  saveDay: (day, revision) => json("/api/days/" + day.date, { day, revision }),
  saveRoster: (participants, revision) => json("/api/roster", { participants, revision }),
};
