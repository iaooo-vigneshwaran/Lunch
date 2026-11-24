import {
  calculate, defaultPrices, emptyOrder, initialRoster, isDate, isPreference, newDay, readDay,
  readParticipants, summarize,
  type Day, type Participant, type Preference, type Prices, type SavedDay,
} from "./ledger.js";
import { localStore, type LedgerStore } from "./store.js";
import type { CloudConfig } from "./firebase-store.js";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing element: " + id);
  return node as T;
}

const moneyFormat = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2,
});
const fullDateFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const shortDateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-IN", {
  month: "long", year: "numeric", timeZone: "UTC",
});
const rupees = (paise: number) => moneyFormat.format(paise / 100);
const utcDate = (date: string) => new Date(date + "T00:00:00Z");

function localToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function lastDayOfMonth(month: string) {
  const year = Number(month.slice(0, 4));
  const nextMonth = Number(month.slice(5, 7));
  const end = utcDate(month + "-01");
  end.setUTCFullYear(year, nextMonth, 0);
  return end.toISOString().slice(0, 10);
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function personLabel({ name }: Participant) {
  return '<span class="person"><span class="avatar" aria-hidden="true">'
    + escapeHtml(Array.from(name)[0]?.toLocaleUpperCase() ?? "") + "</span>" + escapeHtml(name) + "</span>";
}

const orders = element<HTMLTableSectionElement>("orders");
const settlement = element<HTMLTableSectionElement>("settlement");
const form = element<HTMLFormElement>("daily-form");
const dateInput = element<HTMLInputElement>("lunch-date");
const monthInput = element<HTMLInputElement>("month");
const throughInput = element<HTMLInputElement>("through");
const saveButton = element<HTMLButtonElement>("save-day");
const fullMonthButton = element<HTMLButtonElement>("full-month");
const payerInput = element<HTMLSelectElement>("payer");
const dailyTab = element<HTMLButtonElement>("daily-tab");
const monthlyTab = element<HTMLButtonElement>("monthly-tab");
const dailyPage = element("daily-page");
const monthlyPage = element("monthly-page");
const status = element("daily-status");
const prices = {
  food: element<HTMLInputElement>("food-price"),
  poriyal: element<HTMLInputElement>("poriyal-price"),
  egg: element<HTMLInputElement>("egg-price"),
};
type OrderFields = {
  meal: HTMLInputElement | HTMLSelectElement;
  selection: Preference;
  eggs: HTMLInputElement;
  extra: HTMLInputElement;
  note: HTMLInputElement;
  noteRow: HTMLElement;
  noteToggle: HTMLButtonElement;
  share: HTMLElement;
};

const entries = new Map<string, OrderFields>();
const history = element<HTMLUListElement>("history");
const days = new Map<string, SavedDay>();
const today = localToday();
const manageButton = element<HTMLButtonElement>("manage-participants");
const participantsDialog = element<HTMLDialogElement>("participants-dialog");
const participantForm = element<HTMLFormElement>("add-participant");
const participantList = element<HTMLUListElement>("participant-list");
const participantName = element<HTMLInputElement>("participant-name");
const participantPreference = element<HTMLSelectElement>("participant-preference");
const participantStatus = element("participants-status");
const cloudAccess = element("cloud-access");
const cloudStatus = element("cloud-status");
const signInButton = element<HTMLButtonElement>("cloud-sign-in");
const signOutButton = element<HTMLButtonElement>("cloud-sign-out");
const importButton = element<HTMLButtonElement>("cloud-import");
let roster = initialRoster();
let store: LedgerStore | null = null;
let activeDate = today;
let dirty = false;
let changes = 0;
let loading = true;
let saving = false;
let savingRoster = false;

function renderPeople(day: Day) {
  orders.replaceChildren();
  settlement.replaceChildren();
  payerInput.replaceChildren(new Option("Not recorded", ""));
  entries.clear();

  for (const person of roster.participants) {
    const { id, name, preference } = person;
    const order = day.orders[id] ?? emptyOrder();
    const selection = order.meal === "none" ? preference : order.meal;
    const safeName = escapeHtml(name);
    const lunchChoices = preference === "poriyal"
      ? '<option value="poriyal">Poriyal only</option><option value="food">Full meal</option>'
      : '<option value="food">Full meal</option><option value="poriyal">Poriyal only</option>';
    const lunch = id === "sandeep"
      ? '<select id="meal-' + id + '" aria-label="Lunch for ' + safeName + '">'
        + '<option value="none">None</option>' + lunchChoices + '</select>'
      : '<label class="lunch-choice"><input type="checkbox" id="meal-' + id + '" aria-label="'
        + safeName + ' had ' + (selection === "poriyal" ? "poriyal only" : "lunch") + '">'
        + (selection === "poriyal" ? '<small>Poriyal only</small>' : '') + '</label>';
    orders.insertAdjacentHTML("beforeend",
      '<tr data-person="' + id + '"><th scope="row">' + personLabel(person) + "</th>"
        + "<td>" + lunch + "</td>"
        + '<td><input class="number-field" id="eggs-' + id + '" type="number" min="0" step="1" inputmode="numeric" aria-label="Eggs for ' + safeName + '"></td>'
        + '<td><div class="extra-controls"><span class="money-field"><span aria-hidden="true">₹</span>'
        + '<input id="extra-' + id + '" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Extra charge for ' + safeName + '"></span>'
        + '<button class="note-toggle" id="note-toggle-' + id + '" type="button" aria-label="Extra note for ' + safeName
        + '" aria-controls="note-row-' + id + '" aria-expanded="false" title="Extra note">Note</button></div></td>'
        + '<td class="share zero" id="share-' + id + '">₹0</td></tr>'
        + '<tr class="note-row" id="note-row-' + id + '" hidden><td colspan="5"><label>Extra note for ' + safeName
        + '<input class="note-input" id="note-' + id + '" type="text"></label></td></tr>',
    );
    settlement.insertAdjacentHTML("beforeend",
      '<tr data-person="' + id + '"><th scope="row">' + personLabel(person)
        + '</th><td id="month-share-' + id + '"></td><td id="month-paid-' + id
        + '"></td><td id="month-balance-' + id + '"></td></tr>',
    );
    payerInput.add(new Option(name, id));
    const fields: OrderFields = {
      selection,
      meal: element<HTMLInputElement | HTMLSelectElement>("meal-" + id),
      eggs: element<HTMLInputElement>("eggs-" + id),
      extra: element<HTMLInputElement>("extra-" + id),
      note: element<HTMLInputElement>("note-" + id),
      noteRow: element("note-row-" + id),
      noteToggle: element<HTMLButtonElement>("note-toggle-" + id),
      share: element("share-" + id),
    };
    entries.set(id, fields);
    if (fields.meal instanceof HTMLSelectElement) fields.meal.value = order.meal;
    else fields.meal.checked = order.meal !== "none";
    fields.eggs.value = Number.isFinite(order.eggs) ? String(order.eggs) : "";
    fields.extra.value = Number.isFinite(order.extra) ? String(order.extra / 100) : "";
    fields.note.value = order.note;
    fields.noteRow.hidden = !order.note;
    fields.noteToggle.setAttribute("aria-expanded", String(Boolean(order.note)));
    fields.noteToggle.addEventListener("click", () => {
      const open = fields.noteRow.hidden;
      fields.noteRow.hidden = !open;
      fields.noteToggle.setAttribute("aria-expanded", String(open));
      if (open) fields.note.focus();
    });
  }
  payerInput.value = day.payer ?? "";
}

function renderParticipantList() {
  participantList.replaceChildren();
  for (const person of roster.participants) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = person.name;
    const choice = document.createElement("select");
    choice.setAttribute("aria-label", "Meal type for " + person.name);
    choice.add(new Option("Full meal", "food"));
    choice.add(new Option("Poriyal only", "poriyal"));
    choice.value = person.preference;
    choice.addEventListener("change", () => {
      const preference = choice.value;
      if (isPreference(preference)) {
        void saveParticipants(roster.participants.map((entry) =>
          entry.id === person.id ? { ...entry, preference } : entry), "Meal type saved.");
      }
    });
    item.append(label, choice);
    participantList.append(item);
  }
}

function setParticipantStatus(message: string, error = false) {
  participantStatus.textContent = message;
  participantStatus.classList.toggle("error", error);
}

async function saveParticipants(participants: Participant[], message: string) {
  const source = store;
  const validated = readParticipants(participants);
  if (!source || savingRoster) return;
  if (!validated) {
    setParticipantStatus("Enter a unique name and choose a meal type.", true);
    return;
  }

  savingRoster = true;
  for (const field of participantsDialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
    "#add-participant input, #add-participant select, #add-participant button, #participant-list select",
  )) field.disabled = true;

  try {
    const saved = await source.saveRoster(validated, roster.revision);
    if (store !== source) return;
    const draft = readForm();
    roster = saved;
    renderPeople(draft);
    updateBill();
    updateMonth();
    setParticipantStatus(message);
  } catch (error) {
    setParticipantStatus(error instanceof Error ? error.message : "Could not save participants.", true);
    return;
  } finally {
    savingRoster = false;
    renderParticipantList();
    for (const field of participantForm.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      "input, select, button",
    )) field.disabled = false;
  }
  return true;
}

manageButton.addEventListener("click", () => {
  renderParticipantList();
  setParticipantStatus("");
  participantsDialog.showModal();
});

participantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = participantName.value.trim();
  const preference = participantPreference.value;
  if (!name || !isPreference(preference)) {
    setParticipantStatus("Enter a name and choose a meal type.", true);
    return;
  }
  const participants = [...roster.participants, { id: "person-" + crypto.randomUUID(), name, preference }];
  if (await saveParticipants(participants, name + " added.")) participantForm.reset();
});

function setStatus(message: string, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function readMoney(input: HTMLInputElement) {
  const paise = Math.round(Number(input.value) * 100);
  return input.validity.valid && Number.isSafeInteger(paise) ? paise : NaN;
}

function readForm(): Day {
  const day = newDay(activeDate, {
    food: readMoney(prices.food), poriyal: readMoney(prices.poriyal), egg: readMoney(prices.egg),
  });
  for (const [id, fields] of entries) {
    const meal = fields.meal instanceof HTMLSelectElement
      ? (isPreference(fields.meal.value) ? fields.meal.value : "none")
      : fields.meal.checked ? fields.selection : "none";
    const eggCount = Number(fields.eggs.value);
    const eggs = fields.eggs.validity.valid && Number.isSafeInteger(eggCount) ? eggCount : NaN;
    day.orders[id] = { meal, eggs, extra: readMoney(fields.extra), note: fields.note.value.trim() };
  }
  day.payer = entries.has(payerInput.value) ? payerInput.value : null;
  return day;
}

function updateBill() {
  const day = readForm();
  const { bill, shares, portions } = calculate(day);
  const valid = Number.isSafeInteger(bill.total) && Object.values(day.prices).every(Number.isSafeInteger);
  for (const [id, fields] of entries) {
    const share = shares[id]?.total ?? 0;
    fields.share.textContent = Number.isSafeInteger(share) ? rupees(share) : "—";
    fields.share.classList.toggle("zero", share === 0);
  }
  const totalText = valid ? rupees(bill.total) : "—";
  element("daily-total").textContent = totalText;
  element("compact-total").textContent = totalText;
  element("portion-count").textContent = portions + (portions === 1 ? " food portion" : " food portions");
  for (const kind of ["food", "poriyal", "eggs", "extra"] as const) {
    element("bill-" + kind).textContent = Number.isSafeInteger(bill[kind]) ? rupees(bill[kind]) : "—";
  }
  const ordersEntered = Object.values(day.orders)
    .some(({ meal, eggs, extra }) => meal !== "none" || eggs > 0 || extra > 0);
  manageButton.disabled = loading || !store;
  saveButton.disabled = !store || loading || saving || !valid || (!ordersEntered && !days.has(day.date));
  saveButton.textContent = saving ? "Saving…" : days.has(day.date) ? "Save changes" : "Save day";
}

function previousPrices(date: string): Prices {
  const previous = [...days.keys()].filter((key) => key < date).sort().at(-1);
  return (previous && days.get(previous)?.day.prices) || defaultPrices;
}

function showDay(date: string) {
  activeDate = date;
  const saved = days.get(date);
  const day = saved?.day ?? newDay(date, previousPrices(date));
  dateInput.value = date;
  element("date-heading").textContent = fullDateFormat.format(utcDate(date));
  prices.food.value = String(day.prices.food / 100);
  prices.poriyal.value = String(day.prices.poriyal / 100);
  prices.egg.value = String(day.prices.egg / 100);
  renderPeople(day);
  dirty = false;
  setStatus(saved ? "Saved entry" : "");
  updateBill();
}

function openDate(date: string) {
  if (date !== activeDate) {
    if (saving || (dirty && !window.confirm("Leave this day and discard its unsaved changes?"))) {
      dateInput.value = activeDate;
      return;
    }
    showDay(date);
  }
  showPage("daily");
}

function showPage(page: "daily" | "monthly") {
  const daily = page === "daily";
  dailyPage.hidden = !daily;
  monthlyPage.hidden = daily;
  dailyTab.toggleAttribute("aria-current", daily);
  monthlyTab.toggleAttribute("aria-current", !daily);
  (daily ? dailyTab : monthlyTab).setAttribute("aria-current", "page");
  if (!daily) updateMonth();
}

function setMonth() {
  const month = monthInput.value;
  if (!isDate(month + "-01")) return;
  throughInput.min = month + "-01";
  throughInput.max = lastDayOfMonth(month);
  throughInput.value = month === today.slice(0, 7) ? today : throughInput.max;
  updateMonth();
}

function updateMonth() {
  const month = monthInput.value;
  if (!isDate(month + "-01")) return;
  const last = lastDayOfMonth(month);
  const through = isDate(throughInput.value) && throughInput.value.startsWith(month + "-")
    ? throughInput.value : last;
  fullMonthButton.disabled = through === last;
  const monthName = monthFormat.format(utcDate(month + "-01"));
  element("month-heading").textContent = through === last
    ? monthName : monthName + " through " + shortDateFormat.format(utcDate(through));
  const result = summarize([...days.values()].map(({ day }) => day), month, through, roster.participants);

  for (const [id, { share, paid, balance }] of result.totals) {
    element("month-share-" + id).textContent = rupees(share);
    element("month-paid-" + id).textContent = rupees(paid);
    const balanceCell = element("month-balance-" + id);
    balanceCell.className = "balance " + (balance > 0 ? "receive" : balance < 0 ? "pay" : "settled");
    balanceCell.textContent = balance === 0 ? "—" : (balance > 0 ? "Receive " : "Pay ") + rupees(Math.abs(balance));
  }

  const notice = element("unrecorded");
  notice.hidden = result.unrecorded === 0;
  notice.textContent = result.unrecorded + (result.unrecorded === 1 ? " bill has" : " bills have")
    + " no payer recorded (" + rupees(result.unrecordedTotal) + "). Lunch shares include these bills. "
    + "Net balances cover recorded payments.";
  element("history-total").textContent = rupees(result.total);
  element("history-count").textContent = result.entries.length + (result.entries.length === 1 ? " saved day" : " saved days");
  element("no-history").hidden = result.entries.length > 0;
  history.replaceChildren();
  for (const day of result.entries.sort((a, b) => b.date.localeCompare(a.date))) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const date = document.createElement("span");
    const amount = document.createElement("strong");
    button.type = "button";
    date.textContent = shortDateFormat.format(utcDate(day.date));
    amount.textContent = rupees(calculate(day).bill.total);
    button.append(date, amount);
    button.addEventListener("click", () => openDate(day.date));
    item.append(button);
    history.append(item);
  }
}

async function saveDay(event: SubmitEvent) {
  event.preventDefault();
  const source = store;
  if (!source || saveButton.disabled) return;
  const day = readForm();
  const submittedChanges = changes;
  saving = true;
  dateInput.disabled = true;
  setStatus("");
  updateBill();

  try {
    const saved = await source.saveDay(day, days.get(day.date)?.revision ?? null);
    if (store !== source) return;
    days.set(day.date, saved);
    dirty = changes !== submittedChanges;
    setStatus(dirty ? "Saved. You have newer unsaved changes." : "Day saved");
    if (!monthlyPage.hidden) updateMonth();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not save this day.", true);
  } finally {
    saving = false;
    dateInput.disabled = false;
    updateBill();
  }
}

form.addEventListener("input", () => {
  dirty = true;
  changes += 1;
  setStatus("");
  updateBill();
});
form.addEventListener("submit", (event) => void saveDay(event));
dateInput.addEventListener("change", () => {
  if (isDate(dateInput.value)) openDate(dateInput.value);
  else dateInput.value = activeDate;
});
dailyTab.addEventListener("click", () => showPage("daily"));
monthlyTab.addEventListener("click", () => showPage("monthly"));
monthInput.addEventListener("change", () => {
  if (isDate(monthInput.value + "-01")) setMonth();
  else monthInput.value = throughInput.min.slice(0, 7);
});
throughInput.addEventListener("change", () => {
  if (!throughInput.validity.valid) throughInput.value = throughInput.max;
  updateMonth();
});
fullMonthButton.addEventListener("click", () => {
  throughInput.value = throughInput.max;
  updateMonth();
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});

showDay(today);
monthInput.value = today.slice(0, 7);
setMonth();


async function loadLedger(source: LedgerStore) {
  const loaded = await source.load();
  if (store !== source) return;
  const participants = readParticipants(loaded.roster.participants);
  if (!participants) throw new Error("The saved participant list is invalid.");
  const savedDays = new Map<string, SavedDay>();
  for (const saved of loaded.days) {
    const day = readDay(saved.day, saved.day.date, participants);
    if (!day) throw new Error("A saved lunch entry is invalid.");
    savedDays.set(day.date, { day, revision: saved.revision });
  }
  const draft = dirty ? readForm() : null;
  roster = { participants, revision: loaded.roster.revision };
  days.clear();
  for (const [date, saved] of savedDays) days.set(date, saved);
  loading = false;
  if (draft) renderPeople(draft);
  else showDay(activeDate);
  updateBill();
  updateMonth();
}

function showWorkspace(visible: boolean) {
  element("main-nav").hidden = !visible;
  if (visible) showPage("daily");
  else {
    dailyPage.hidden = true;
    monthlyPage.hidden = true;
  }
}

function showCloudStatus(message: string) {
  cloudStatus.textContent = message;
}

const localHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

async function configureStorage() {
  const response = await fetch(new URL("firebase-config.json", document.baseURI), { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the app's storage configuration.");
  const config = await response.json() as CloudConfig | null;
  if (!config) {
    if (!localHost) {
      cloudAccess.hidden = false;
      showWorkspace(false);
      showCloudStatus("This site needs a Firebase web app configuration.");
      return;
    }
    store = localStore;
    await loadLedger(localStore);
    return;
  }

  cloudAccess.hidden = false;
  showWorkspace(false);
  showCloudStatus("Checking sign-in…");
  const { connectFirestore } = await import("./firebase-store.js");
  const cloud = connectFirestore(config);
  signInButton.addEventListener("click", async () => {
    signInButton.disabled = true;
    try {
      await cloud.signIn();
    } catch (error) {
      showCloudStatus(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      signInButton.disabled = false;
    }
  });
  signOutButton.addEventListener("click", async () => {
    if (saving || savingRoster || importButton.disabled) return;
    if (dirty && !window.confirm("Sign out and discard the unsaved lunch changes?")) return;
    try {
      await cloud.signOut();
    } catch {
      showCloudStatus("Could not sign out. Try again.");
    }
  });

  importButton.addEventListener("click", async () => {
    const source = store;
    if (!source || source === localStore || saving || savingRoster || dirty) {
      showCloudStatus("Save any pending lunch changes before importing.");
      return;
    }
    importButton.disabled = true;
    showCloudStatus("Importing lunch entries…");
    try {
      const local = await localStore.load();
      const current = await source.load();
      const knownIds = new Set(current.roster.participants.map(({ id }) => id));
      const additions = local.roster.participants.filter(({ id }) => !knownIds.has(id));
      const merged = current.roster.revision === null
        ? local.roster.participants
        : [...current.roster.participants, ...additions];
      if (!readParticipants(merged)) throw new Error("The local and cloud participant names conflict.");
      if (local.roster.revision !== null && (current.roster.revision === null || additions.length)) {
        await source.saveRoster(merged, current.roster.revision);
      }
      const existing = new Set(current.days.map(({ day }) => day.date));
      let imported = 0;
      for (const { day } of local.days) {
        if (existing.has(day.date)) continue;
        await source.saveDay(day, null);
        imported += 1;
      }
      await loadLedger(source);
      showCloudStatus(imported + (imported === 1 ? " local day imported." : " local days imported."));
    } catch (error) {
      await loadLedger(source).catch(() => undefined);
      showCloudStatus(error instanceof Error ? error.message : "Could not finish the import. Try again.");
    } finally {
      importButton.disabled = false;
    }
  });

  cloud.watch(async (session) => {
    store = session?.store ?? null;
    loading = true;
    days.clear();
    roster = initialRoster();
    if (participantsDialog.open) participantsDialog.close();
    participantForm.reset();
    showDay(today);
    updateMonth();
    showWorkspace(false);
    importButton.hidden = true;
    signInButton.hidden = Boolean(session);
    signOutButton.hidden = !session;

    if (!session) {
      showCloudStatus("Sign in to enter lunch and view shared records on your devices.");
      return;
    }
    showCloudStatus("Loading your lunch records…");
    try {
      await loadLedger(session.store);
      if (store !== session.store) return;
      showCloudStatus(session.email ? "Signed in as " + session.email : "Signed in");
      showWorkspace(true);
      if (localHost) {
        const local = await localStore.load().catch(() => null);
        if (store === session.store) importButton.hidden = !local || (!local.days.length && !local.roster.revision);
      }
    } catch (error) {
      if (store === session.store) showCloudStatus(error instanceof Error ? error.message : "Could not load Firestore.");
    }
  });
}

try {
  await configureStorage();
} catch (error) {
  const message = error instanceof Error ? error.message : "Could not load saved lunch entries.";
  if (cloudAccess.hidden) setStatus(message, true);
  else showCloudStatus(message);
}
