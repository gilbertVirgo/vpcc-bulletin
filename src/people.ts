import "./styles/index.css";
import { api, loginUrl, message } from "./api";
import { h } from "./dom";
import type { PeopleResponse, Person, PersonInput } from "./shared/types";
import { mountShell } from "./shell";
import { confirmDialog, openModal, skeletonTable } from "./ui";

const main = document.querySelector<HTMLElement>("#main")!;
const body = h("div", {});
const status = h("p", { class: "status", role: "status" });
let data: PeopleResponse = { people: [], roles: [] };

// The API stores frequency as 0..1; people read it as a share of Sundays.
const percent = (f: number): string => `${Math.round(f * 100)}%`;

async function start(): Promise<void> {
  const me = await mountShell("people");
  if (!me.user) {
    const url = loginUrl(me.hub);
    main.replaceChildren(
      h("h1", {}, "People"),
      h("p", {}, "You need to log in to manage the people on the rota. ", h("a", { href: url }, "Log in"), "."),
    );
    location.assign(url);
    return;
  }
  main.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("h1", {}, "People"),
      h("button", { type: "button", class: "button button--primary", onclick: () => edit(null) }, "Add person"),
    ),
    status,
    body,
  );
  await load();
}

async function load(): Promise<void> {
  body.replaceChildren(skeletonTable(4, 6, "Loading people"));
  try {
    data = await api<PeopleResponse>("people");
    render();
  } catch (err) {
    body.replaceChildren(h("p", { class: "error", role: "alert" }, `Could not load people: ${message(err)}`));
  }
}

function render(): void {
  if (!data.people.length) {
    body.replaceChildren(h("p", { class: "empty" }, "Nobody here yet. Add the first person."));
    return;
  }
  const rows = data.people.map((p) =>
    h(
      "tr",
      {},
      h("th", { scope: "row" }, p.name),
      h("td", {}, data.roles.filter((r) => p.roles.includes(r.id)).map((r) => r.name).join(", ") || "–"),
      h("td", {}, percent(p.frequency)),
      h(
        "td",
        {},
        h(
          "div",
          { class: "row-actions" },
          h("button", { type: "button", class: "button button--sm button--secondary", onclick: () => edit(p) },
            "Edit", h("span", { class: "visually-hidden" }, ` ${p.name}`)),
          h("button", { type: "button", class: "button button--sm button--danger", onclick: (e) => void remove(p, e.currentTarget as HTMLButtonElement) },
            "Remove", h("span", { class: "visually-hidden" }, ` ${p.name}`)),
        ),
      ),
    ),
  );
  body.replaceChildren(
    h(
      "div",
      { class: "table-scroll", role: "region", "aria-label": "People", tabindex: 0 },
      h(
        "table",
        { class: "table" },
        h("caption", { class: "visually-hidden" }, "People on the rota"),
        h(
          "thead",
          {},
          h("tr", {},
            h("th", { scope: "col" }, "Name"),
            h("th", { scope: "col" }, "Roles"),
            h("th", { scope: "col" }, "Sundays"),
            h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Actions"))),
        ),
        h("tbody", {}, ...rows),
      ),
    ),
  );
}

function edit(person: Person | null): void {
  const error = h("p", { id: "person-error", class: "error", role: "alert" });
  const name = h("input", {
    id: "person-name", class: "control", required: true, maxlength: 60, autocomplete: "off", value: person?.name ?? "",
    "aria-describedby": "person-error",
  });
  const frequency = h("input", {
    id: "person-frequency", class: "control control--short", type: "number", inputmode: "numeric", min: 0, max: 100, step: 1,
    required: true, value: Math.round((person?.frequency ?? 0.5) * 100), "aria-describedby": "person-frequency-hint",
  });
  const roles = data.roles.filter((r) => !r.manual); // nobody holds a manual role
  const boxes = roles.map((r) =>
    h("input", { type: "checkbox", id: `role-${r.id}`, value: r.id, checked: person?.roles.includes(r.id) ?? false }),
  );
  const submit = h("button", { type: "submit", class: "button button--primary" }, person ? "Save" : "Add");
  const form = h(
    "form",
    { class: "stack" },
    h("div", { class: "field" }, h("label", { for: "person-name", class: "field__label" }, "Name"), name),
    h(
      "fieldset",
      { class: "fieldset fieldset--columns" },
      h("legend", { class: "field__label" }, "Roles"),
      ...roles.map((r, i) => h("div", { class: "check" }, boxes[i], h("label", { for: `role-${r.id}` }, r.name))),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: "person-frequency", class: "field__label" }, "Share of Sundays (%)"),
      frequency,
      h("p", { id: "person-frequency-hint", class: "field__hint" },
        "How often they can serve: 100 = every Sunday, 50 = every other Sunday, 0 = never scheduled."),
    ),
    error,
    h(
      "div",
      { class: "dialog__actions" },
      h("button", { type: "button", class: "button button--secondary", onclick: () => dialog.close() }, "Cancel"),
      submit,
    ),
  );
  const dialog = openModal(person ? `Edit ${person.name}` : "Add person", form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    const input: PersonInput = {
      name: name.value.trim(),
      roles: boxes.filter((b) => b.checked).map((b) => b.value),
      frequency: frequency.valueAsNumber / 100,
    };
    submit.disabled = true;
    try {
      await api(person ? `people?id=${person.id}` : "people", { method: person ? "PUT" : "POST", body: input });
      dialog.close();
      status.textContent = person ? `Saved ${input.name}.` : `Added ${input.name}.`;
      await load();
    } catch (err) {
      error.textContent = message(err);
      submit.disabled = false;
    }
  });
}

async function remove(person: Person, button: HTMLButtonElement): Promise<void> {
  if (!(await confirmDialog(`Remove ${person.name}? They will also be taken off every upcoming Sunday they are rota'd for.`, "Remove"))) return;
  button.disabled = true;
  try {
    const { weeksUpdated } = await api<{ weeksUpdated: number }>(`people?id=${person.id}`, { method: "DELETE" });
    status.textContent = `Removed ${person.name} from ${weeksUpdated} upcoming week${weeksUpdated === 1 ? "" : "s"}.`;
    await load();
  } catch (err) {
    status.textContent = `Could not remove ${person.name}: ${message(err)}`;
    button.disabled = false;
  }
}

start().catch((err) => main.replaceChildren(h("p", { class: "error", role: "alert" }, message(err))));
