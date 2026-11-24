export type Preference = "food" | "poriyal";
export type Meal = Preference | "none";
export type Participant = { id: string; name: string; preference: Preference };
export type Prices = { food: number; poriyal: number; egg: number };
export type Order = { meal: Meal; eggs: number; extra: number; note: string };
export type Day = { date: string; prices: Prices; orders: Record<string, Order>; payer: string | null };
export type SavedDay = { day: Day; revision: string };
export type Roster = { participants: Participant[]; revision: string | null };
export type Ledger = { roster: Roster; days: SavedDay[] };
export type Share = { food: number; poriyal: number; eggs: number; extra: number; total: number };

export const defaultParticipants: Participant[] = [
  { id: "bharath", name: "Bharath", preference: "food" },
  { id: "riti", name: "Riti", preference: "food" },
  { id: "vivek", name: "Vivek", preference: "food" },
  { id: "dhamo", name: "Dhamo", preference: "food" },
  { id: "ganesh", name: "Ganesh", preference: "food" },
  { id: "vignesh", name: "Vignesh", preference: "food" },
  { id: "guru", name: "Guru", preference: "food" },
  { id: "sandeep", name: "Sandeep", preference: "poriyal" },
];

const defaultIds = new Set(defaultParticipants.map(({ id }) => id));
export const defaultPrices: Prices = { food: 8000, poriyal: 3000, egg: 1500 };
export const emptyOrder = (): Order => ({ meal: "none", eggs: 0, extra: 0, note: "" });
export const initialRoster = (): Roster => ({ participants: defaultParticipants, revision: null });

export function newDay(date: string, prices: Prices): Day {
  return { date, prices: { ...prices }, orders: {}, payer: null };
}

export function calculate(day: Day) {
  const { orders, prices } = day;
  const bothShareFood = orders.bharath?.meal === "food" && orders.riti?.meal === "food";
  const shares: Record<string, Share> = {};
  const bill: Share = { food: 0, poriyal: 0, eggs: 0, extra: 0, total: 0 };
  let portions = 0;

  for (const [id, order] of Object.entries(orders)) {
    let food = order.meal === "food" ? prices.food : 0;
    if (bothShareFood && id === "bharath") food = Math.ceil(food / 2);
    if (bothShareFood && id === "riti") food = Math.floor(food / 2);
    const poriyal = order.meal === "poriyal" ? prices.poriyal : 0;
    const eggs = order.eggs * prices.egg;
    const extra = order.extra;
    const total = food + poriyal + eggs + extra;
    shares[id] = { food, poriyal, eggs, extra, total };
    if (order.meal === "food") portions += 1;
    bill.food += food;
    bill.poriyal += poriyal;
    bill.eggs += eggs;
    bill.extra += extra;
    bill.total += total;
  }
  return { bill, shares, portions: portions - Number(bothShareFood) };
}

export function summarize(days: Day[], month: string, through: string, participants: Participant[]) {
  const totals = new Map(participants.map(({ id }) => [id, { share: 0, paid: 0, balance: 0 }]));
  let total = 0;
  let unrecorded = 0;
  let unrecordedTotal = 0;
  const entries = days.filter(({ date }) => date.startsWith(month + "-") && date <= through);
  for (const day of entries) {
    const { bill, shares } = calculate(day);
    const payer = day.payer ? totals.get(day.payer) : undefined;
    total += bill.total;
    for (const [id, share] of Object.entries(shares)) {
      const person = totals.get(id);
      if (!person) continue;
      person.share += share.total;
      if (payer) person.balance -= share.total;
    }
    if (payer) {
      payer.paid += bill.total;
      payer.balance += bill.total;
    } else if (bill.total > 0) {
      unrecorded += 1;
      unrecordedTotal += bill.total;
    }
  }
  return { entries, total, totals, unrecorded, unrecordedTotal };
}

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isPreference(value: unknown): value is Preference {
  return value === "food" || value === "poriyal";
}

export function readParticipants(input: unknown): Participant[] | undefined {
  if (!Array.isArray(input)) return;
  const ids = new Set<string>();
  const names = new Set<string>();
  const people: Participant[] = [];
  for (const item of input as unknown[]) {
    const participant = object(item);
    if (!participant) return;
    const { id, name, preference } = participant;
    if (typeof id !== "string" || (!defaultIds.has(id) && !/^person-[\da-f-]{36}$/.test(id))) return;
    if (typeof name !== "string" || !name.trim() || !isPreference(preference)) return;
    const trimmed = name.trim();
    const normalized = trimmed.toLowerCase();
    if (ids.has(id) || names.has(normalized)) return;
    ids.add(id);
    names.add(normalized);
    people.push({ id, name: trimmed, preference });
  }
  if ([...defaultIds].some((id) => !ids.has(id))) return;
  return people;
}

export function readDay(input: unknown, date: string, participants: Participant[]): Day | undefined {
  const candidate = object(input);
  if (!candidate || candidate.date !== date || !isDate(date)) return;
  const prices = object(candidate.prices);
  const orders = object(candidate.orders);
  if (!prices || !orders) return;
  const { food, poriyal, egg } = prices;
  if (!nonnegativeInteger(food) || !nonnegativeInteger(poriyal) || !nonnegativeInteger(egg)) return;
  const day = newDay(date, { food, poriyal, egg });
  const ids = new Set(participants.map(({ id }) => id));
  for (const [id, value] of Object.entries(orders)) {
    const order = object(value);
    if (!order || !ids.has(id)) return;
    const { meal, eggs, extra, note } = order;
    if (meal !== "none" && !isPreference(meal)) return;
    if (!nonnegativeInteger(eggs) || !nonnegativeInteger(extra) || typeof note !== "string") return;
    day.orders[id] = { meal, eggs, extra, note };
  }
  if (candidate.payer !== null && (typeof candidate.payer !== "string" || !ids.has(candidate.payer))) return;
  day.payer = candidate.payer;
  if (!Number.isSafeInteger(calculate(day).bill.total)) return;
  return day;
}
