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
      h("button", { type: "button", class: "button button--primary", onclick: add }, "Add person"),
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
      h("th", { scope: "row" }, nameInput(p)),
      h("td", {}, rolePills(p)),
      h("td", {}, frequencyInput(p)),
      h(
        "td",
        {},
        h("div", { class: "row-actions" },
          h("button", { type: "button", class: "button button--sm button--danger", onclick: (e) => void remove(p, e.currentTarget as HTMLButtonElement) },
            "Remove", h("span", { class: "visually-hidden" }, ` ${p.name}`))),
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

/** Stores one change to a person. Throws (after reporting it) so the caller can put its control back. */
async function update(person: Person, change: Partial<PersonInput>): Promise<void> {
  const input: PersonInput = { name: person.name, roles: person.roles, frequency: person.frequency, ...change };
  try {
    const { person: saved } = await api<{ person: Person }>(`people?id=${person.id}`, { method: "PUT", body: input });
    Object.assign(person, saved);
    status.textContent = `Saved ${saved.name}.`;
  } catch (err) {
    status.textContent = `Could not save ${person.name}: ${message(err)}`;
    throw err;
  }
}

/** Looks like text until hovered or focused; saves on Enter or leaving the field. */
function nameInput(p: Person): HTMLInputElement {
  const input = h("input", {
    class: "inline-input", required: true, maxlength: 60, autocomplete: "off", value: p.name, "aria-label": "Name",
    onchange: () => {
      const name = input.value.trim();
      if (!name) return void (input.value = p.name);
      update(p, { name }).catch(() => (input.value = p.name));
    },
  });
  return input;
}

function frequencyInput(p: Person): HTMLElement {
  const percent = () => String(Math.round(p.frequency * 100));
  const input = h("input", {
    class: "inline-input inline-input--number", type: "number", inputmode: "numeric", min: 0, max: 100, step: 1, value: percent(),
    "aria-label": `Share of Sundays for ${p.name} (%). 100 = every Sunday, 0 = never scheduled.`,
    onchange: () => {
      if (!input.checkValidity() || input.value === "") return void (input.value = percent());
      update(p, { frequency: input.valueAsNumber / 100 }).catch(() => (input.value = percent()));
    },
  });
  return h("span", { class: "inline-percent" }, input, h("span", { "aria-hidden": "true" }, "%"));
}

/** A pill per role (× removes it) and a + menu of the roles they don't have. */
function rolePills(p: Person): HTMLElement {
  const wrap = h("div", { class: "pills" });
  const roles = data.roles.filter((r) => !r.manual); // nobody holds a manual role
  const change = async (roles: string[]) => {
    await update(p, { roles }).catch(() => {});
    wrap.replaceWith(rolePills(p));
    document.querySelector<HTMLElement>(`[data-add-role="${p.id}"]`)?.focus();
  };
  const missing = roles.filter((r) => !p.roles.includes(r.id));
  const add = h(
    "select",
    {
      class: "pill pill--add", "data-add-role": p.id, "aria-label": `Add a role for ${p.name}`,
      onchange: () => void change([...p.roles, add.value]),
    },
    h("option", { value: "", hidden: true, selected: true }, "+"),
    ...missing.map((r) => h("option", { value: r.id }, r.name)),
  );
  wrap.append(
    ...roles
      .filter((r) => p.roles.includes(r.id))
      .map((r) =>
        h(
          "span",
          { class: "pill" },
          r.name,
          h("button", {
            type: "button", class: "pill__remove", "aria-label": `Remove ${r.name} from ${p.name}`,
            onclick: () => void change(p.roles.filter((id) => id !== r.id)),
          }, "×"),
        ),
      ),
    ...(missing.length ? [add] : []),
  );
  return wrap;
}

function add(): void {
  const error = h("p", { id: "person-error", class: "error", role: "alert" });
  const name = h("input", {
    id: "person-name", class: "control", required: true, maxlength: 60, autocomplete: "off",
    "aria-describedby": "person-error",
  });
  const frequency = h("input", {
    id: "person-frequency", class: "control control--short", type: "number", inputmode: "numeric", min: 0, max: 100, step: 1,
    required: true, value: 50, "aria-describedby": "person-frequency-hint",
  });
  const roles = data.roles.filter((r) => !r.manual); // nobody holds a manual role
  const boxes = roles.map((r) => h("input", { type: "checkbox", id: `role-${r.id}`, value: r.id }));
  const submit = h("button", { type: "submit", class: "button button--primary" }, "Add");
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
  const dialog = openModal("Add person", form);
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
      await api("people", { method: "POST", body: input });
      dialog.close();
      status.textContent = `Added ${input.name}.`;
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
