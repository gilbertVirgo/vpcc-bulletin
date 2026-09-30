import "./styles/index.css";
import "./styles/rota.css";
import { ApiError, api, message } from "./api";
import { h } from "./dom";
import { cellKey, rotaTable, rotaWeek } from "./rota-table";
import { findConflicts } from "./shared/conflicts";
import { shortDate } from "./shared/dates";
import type { GeneratedWeek, Me, PeopleResponse, Person, Role, RotaResponse, Week } from "./shared/types";
import { mountShell } from "./shell";
import { confirmDialog, openModal, skeletonTable } from "./ui";

const main = document.querySelector<HTMLElement>("#main")!;
const body = h("div", {});
const status = h("p", { class: "status", role: "status" });
let me: Me;
let rota: RotaResponse = { roles: [], people: [], weeks: [] };
let people: Person[] = []; // full records (who holds which role); only loaded when signed in

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Conflicts for `shown`, judged against `context` too (e.g. the stored weeks either side of a preview). */
function conflictsFor(shown: Week[], context: Week[] = []): Map<string, string[]> {
  const dates = new Set(shown.map((w) => w.date));
  const all = findConflicts([...context.filter((w) => !dates.has(w.date)), ...shown], rota.roles, people);
  return new Map([...all].filter(([key]) => dates.has(key.split("/")[0])));
}

/** "3 conflicts" line plus one line per cell, so they are readable without hovering. */
function conflictList(conflicts: Map<string, string[]>, note = ""): HTMLElement | null {
  if (!conflicts.size) return null;
  const role = new Map(rota.roles.map((r) => [r.id, r.name]));
  const lines = [...conflicts].flatMap(([key, msgs]) => {
    const [date, roleId] = key.split("/");
    return msgs.map((m) => h("li", {}, `${shortDate(date)} · ${role.get(roleId)}: ${m}`));
  });
  return h("div", { class: "error" }, h("p", {}, `${plural(lines.length, "conflict")}.${note}`), h("ul", {}, ...lines));
}

async function start(): Promise<void> {
  me = await mountShell("rota");
  main.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("h1", {}, "Sunday rota"),
      me.user ? h("button", { type: "button", class: "button button--primary", onclick: openGenerate }, "Generate weeks") : null,
    ),
    status,
    body,
  );
  await load();
}

async function load(): Promise<void> {
  body.replaceChildren(skeletonTable(me.user ? 5 : 2, 11, "Loading the rota"));
  try {
    const [r, p] = await Promise.all([
      api<RotaResponse>("weeks"),
      me.user ? api<PeopleResponse>("people") : Promise.resolve(null),
    ]);
    rota = r;
    people = p?.people ?? [];
    render();
  } catch (err) {
    body.replaceChildren(h("p", { class: "error", role: "alert" }, `Could not load the rota. ${message(err)}`));
  }
}

function render(): void {
  if (!rota.weeks.length) {
    body.replaceChildren(
      h("p", { class: "empty" }, "No Sundays on the rota yet.", me.user ? " Use “Generate weeks” to add some." : ""),
    );
    return;
  }
  if (!me.user) {
    body.replaceChildren(rotaWeek(rota.roles, rota.people, rota.weeks));
    return;
  }
  const conflicts = conflictsFor(rota.weeks);
  body.replaceChildren(
    ...[
      conflictList(conflicts),
      rotaTable(rota.roles, rota.people, rota.weeks, "Sunday rota", {
        onEditCell: (week, role) => editCell(week, role, rota.weeks, (ids) => saveCell(week, role, ids), () => {
          render();
          body.querySelector<HTMLElement>(`[data-cell="${cellKey(week.date, role.id)}"]`)?.focus();
          status.textContent = `Saved ${role.name} for ${shortDate(week.date)}.`;
        }),
        onDeleteWeek: deleteWeek,
        conflicts,
      }),
    ].filter((n): n is HTMLElement => n !== null),
  );
}

async function saveCell(week: Week, role: Role, personIds: string[]): Promise<void> {
  const { week: saved } = await api<{ week: Week }>(`weeks?date=${week.date}`, { method: "PUT", body: { roleId: role.id, personIds } });
  // Patch in place rather than reloading, so focus can go back to the cell that was edited.
  rota.weeks = rota.weeks.map((w) => (w.date === saved.date ? saved : w));
}

/**
 * Picker for one cell. `weeks` is the rota the cell sits in, used to show what each choice would clash with.
 * `save` stores the choice (the dialog stays open to show its error if it throws); `saved` runs after close.
 */
function editCell(
  week: Week, role: Role, weeks: Week[], save: (personIds: string[]) => Promise<void>, saved: () => void,
): void {
  const current = new Set(week.assignments[role.id] ?? []);
  // Nobody holds a manual role, so everyone is offered. Otherwise whoever is already in the cell stays
  // listed even if they no longer hold the role, so saving keeps them.
  const holders = role.manual ? people : people.filter((p) => p.roles.includes(role.id) || current.has(p.id));
  // What picking each person would break, ignoring whoever else is in the cell now.
  const wouldBreak = (p: Person) => {
    const trial = { date: week.date, assignments: { ...week.assignments, [role.id]: [p.id] } };
    const msgs = findConflicts([...weeks.filter((w) => w.date !== week.date), trial], rota.roles, people).get(cellKey(week.date, role.id)) ?? [];
    return msgs.filter((m) => !m.endsWith(`does not do ${role.name}`));
  };
  const label = (p: Person) => {
    const notes = [...(role.manual || p.roles.includes(role.id) ? [] : ["no longer does this role"]), ...wouldBreak(p).map((m) => m.slice(p.name.length + 1))];
    return notes.length ? `${p.name} (${notes.join("; ")})` : p.name;
  };
  const error = h("p", { class: "error", role: "alert" });
  const boxes = holders.map((p) =>
    h("input", { type: "checkbox", id: `pick-${p.id}`, value: p.id, checked: current.has(p.id) }),
  );
  const sync = () => {
    const picked = boxes.filter((b) => b.checked).length;
    for (const b of boxes) b.disabled = !b.checked && picked >= role.needs;
  };
  boxes.forEach((b) => b.addEventListener("change", sync));
  sync();

  const saveButton = h("button", { type: "submit", class: "button button--primary" }, "Save");
  const form = h(
    "form",
    { class: "stack" },
    h(
      "fieldset",
      { class: "fieldset" },
      h("legend", { class: "field__label" }, role.needs === 1 ? "Choose one person" : `Choose up to ${role.needs} people`),
      ...(holders.length
        ? holders.map((p, i) => h("div", { class: "check" }, boxes[i], h("label", { for: `pick-${p.id}` }, label(p))))
        : [h("p", { class: "status" }, "Nobody does this role yet. Add it to someone on the People page.")]),
    ),
    error,
    h(
      "div",
      { class: "dialog__actions" },
      h("button", { type: "button", class: "button button--secondary", onclick: () => dialog.close() }, "Cancel"),
      saveButton,
    ),
  );
  const dialog = openModal(`${role.name} · ${shortDate(week.date)}`, form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    saveButton.disabled = true;
    try {
      await save(boxes.filter((b) => b.checked).map((b) => b.value));
      dialog.close();
      saved();
    } catch (err) {
      error.textContent = message(err);
      saveButton.disabled = false;
    }
  });
}

async function deleteWeek(week: Week, button: HTMLButtonElement): Promise<void> {
  if (!(await confirmDialog(`Remove ${shortDate(week.date)} from the rota?`, "Delete"))) return;
  button.disabled = true;
  try {
    await api(`weeks?date=${week.date}`, { method: "DELETE" });
    status.textContent = `Removed ${shortDate(week.date)}.`;
    await load();
    main.focus();
  } catch (err) {
    status.textContent = message(err);
    button.disabled = false;
  }
}

function openGenerate(): void {
  let preview: GeneratedWeek[] = [];
  const count = h("input", {
    type: "number", id: "generate-count", class: "control control--short", min: 1, max: 5, step: 1, value: 4, required: true,
  });
  const generateButton = h("button", { type: "submit", class: "button button--secondary" }, "Generate");
  const saveButton = h("button", { type: "button", class: "button button--primary", disabled: true }, "Save");
  const out = h("div", { class: "preview", "aria-live": "polite" });
  const error = h("p", { class: "error", role: "alert" });
  const form = h(
    "form",
    { class: "generate__form" },
    h("div", { class: "field" }, h("label", { for: "generate-count", class: "field__label" }, "Weeks (1–5)"), count),
    generateButton,
  );
  const dialog = openModal(
    "Generate weeks",
    form,
    out,
    error,
    h(
      "div",
      { class: "dialog__actions" },
      h("button", { type: "button", class: "button button--secondary", onclick: () => dialog.close() }, "Cancel"),
      saveButton,
    ),
  );
  dialog.classList.add("dialog--wide");

  // Edits change the preview only; nothing is stored until Save.
  const renderPreview = () => {
    const gaps = preview.reduce((n, w) => n + w.gaps.length, 0);
    const conflicts = conflictsFor(preview, rota.weeks);
    out.replaceChildren(
      ...[
        h(
          "p",
          { class: gaps ? "error" : "status" },
          gaps
            ? `${plural(gaps, "role")} could not be filled — marked Unfilled. Click a cell to fill it by hand.`
            : `Every role is filled for ${plural(preview.length, "Sunday")}. Click a cell to change it.`,
        ),
        conflictList(conflicts, " You can still save."),
        rotaTable(rota.roles, rota.people, preview, "Generated preview", {
          conflicts,
          onEditCell: (week, role) =>
            editCell(
              week,
              role,
              [...rota.weeks, ...preview],
              async (ids) => {
                preview = preview.map((w) => {
                  if (w.date !== week.date) return w;
                  const gaps = w.gaps.filter((g) => g !== role.id);
                  return { date: w.date, assignments: { ...w.assignments, [role.id]: ids }, gaps: ids.length < role.needs && !role.manual ? [...gaps, role.id] : gaps };
                });
              },
              () => {
                renderPreview();
                out.querySelector<HTMLElement>(`[data-cell="${cellKey(week.date, role.id)}"]`)?.focus();
              },
            ),
        }),
      ].filter((n): n is HTMLElement => n !== null),
    );
  };

  // One request at a time: both actions are locked while either is in flight.
  const busy = (on: boolean) => {
    generateButton.disabled = on;
    saveButton.disabled = on || !preview.length;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    busy(true);
    try {
      preview = (await api<{ weeks: GeneratedWeek[] }>("generate", { method: "POST", body: { weeks: count.valueAsNumber } })).weeks;
      renderPreview();
      generateButton.textContent = "Regenerate";
    } catch (err) {
      error.textContent = message(err);
    } finally {
      busy(false);
    }
  });

  saveButton.addEventListener("click", async () => {
    error.textContent = "";
    busy(true);
    try {
      await api("weeks", { method: "POST", body: { weeks: preview.map(({ date, assignments }) => ({ date, assignments })) } });
      dialog.close();
      status.textContent = `Added ${plural(preview.length, "week")}.`;
      await load();
    } catch (err) {
      const dates = err instanceof ApiError && Array.isArray(err.body.dates) ? (err.body.dates as string[]) : [];
      error.textContent = dates.length
        ? `${message(err)}: ${dates.map(shortDate).join(", ")}. Regenerate to plan the next free Sundays.`
        : message(err);
      busy(false);
    }
  });
}

start().catch((err) => main.replaceChildren(h("p", { class: "error", role: "alert" }, message(err))));
