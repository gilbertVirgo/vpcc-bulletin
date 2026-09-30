import { h } from "./dom";
import { shortDate } from "./shared/dates";
import type { GeneratedWeek, PersonName, Role, Week } from "./shared/types";

export type TableOptions = {
  onEditCell?: (week: Week, role: Role) => void;
  onDeleteWeek?: (week: Week, button: HTMLButtonElement) => void;
  conflicts?: Map<string, string[]>; // cellKey -> messages, from findConflicts
};

/** Stable hook for putting focus back on a cell after the table is re-rendered. */
export const cellKey = (date: string, roleId: string): string => `${date}/${roleId}`;

const namesIn = (week: Week, role: Role, names: Map<string, string>): string =>
  (week.assignments[role.id] ?? []).map((id) => names.get(id) ?? "Unknown").join(", ");

const nobody = () =>
  h("span", { class: "cell__empty" }, h("span", { "aria-hidden": "true" }, "–"), h("span", { class: "visually-hidden" }, "Nobody"));

/** The rota as a table: rows = roles, columns = Sundays. Read-only unless handlers are given. */
export function rotaTable(
  roles: Role[],
  people: PersonName[],
  weeks: (Week | GeneratedWeek)[],
  caption: string,
  opts: TableOptions = {},
): HTMLElement {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const { onEditCell, onDeleteWeek, conflicts } = opts;

  const head = h(
    "tr",
    {},
    h("th", { scope: "col" }, "Role"),
    ...weeks.map((w) => h("th", { scope: "col" }, h("time", { datetime: w.date }, shortDate(w.date)))),
  );

  const rows = roles.map((role) =>
    h(
      "tr",
      {},
      h("th", { scope: "row" }, role.name),
      ...weeks.map((week) => {
        const date = shortDate(week.date);
        const text = namesIn(week, role, names);
        const gap = !role.manual && "gaps" in week && week.gaps.includes(role.id);
        const problems = conflicts?.get(cellKey(week.date, role.id)) ?? [];
        const content = [
          text ? h("span", {}, text) : nobody(),
          gap ? h("span", { class: "cell__gap-label" }, "Unfilled") : null,
          problems.length ? h("span", { class: "cell__gap-label" }, "Conflict") : null,
        ];
        return h(
          "td",
          { class: gap || problems.length ? "cell cell--gap" : "cell", title: problems.join("\n") || undefined },
          onEditCell
            ? h(
                "button",
                {
                  type: "button",
                  class: "cell__edit",
                  "data-cell": cellKey(week.date, role.id),
                  "aria-label": `${role.name} on ${date}: ${text || "nobody"}.${problems.map((m) => ` ${m}.`).join("")} Edit`,
                  onclick: () => onEditCell(week, role),
                },
                ...content,
              )
            : h("span", {}, ...content),
        );
      }),
    ),
  );

  const actions = onDeleteWeek
    ? h(
        "tr",
        {},
        h("th", { scope: "row" }, h("span", { class: "visually-hidden" }, "Actions")),
        ...weeks.map((week) =>
          h(
            "td",
            { class: "cell" },
            h(
              "button",
              {
                type: "button",
                class: "button button--sm button--danger",
                onclick: (e) => onDeleteWeek(week, e.currentTarget as HTMLButtonElement),
              },
              "Delete",
              h("span", { class: "visually-hidden" }, ` ${shortDate(week.date)}`),
            ),
          ),
        ),
      )
    : null;

  return h(
    "div",
    { class: "table-scroll", role: "region", "aria-label": caption, tabindex: 0 },
    h(
      "table",
      { class: "table" },
      h("caption", { class: "visually-hidden" }, caption),
      h("thead", {}, head),
      h("tbody", {}, ...rows, actions),
    ),
  );
}

/** One Sunday at a time, with previous/next. Starts on the first week given (the API sends upcoming weeks only). */
export function rotaWeek(roles: Role[], people: PersonName[], weeks: Week[]): HTMLElement {
  const names = new Map(people.map((p) => [p.id, p.name]));
  let i = 0;
  const title = h("h2", { class: "week-step__title", "aria-live": "polite" });
  const list = h("dl", { class: "week-step__list" });
  // aria-disabled rather than disabled, so focus stays on the button when it reaches the end.
  const step = (by: number) => (e: Event) => {
    if ((e.currentTarget as HTMLElement).getAttribute("aria-disabled") === "true") return;
    i += by;
    show();
  };
  const prev = h("button", { type: "button", class: "button button--secondary button--sm", onclick: step(-1) }, "‹ Previous");
  const next = h("button", { type: "button", class: "button button--secondary button--sm", onclick: step(1) }, "Next ›");

  function show(): void {
    const week = weeks[i];
    title.replaceChildren(h("time", { datetime: week.date }, shortDate(week.date)));
    list.replaceChildren(
      ...roles.map((role) => {
        const text = namesIn(week, role, names);
        return h("div", { class: "week-step__row" }, h("dt", {}, role.name), h("dd", {}, text || nobody()));
      }),
    );
    prev.setAttribute("aria-disabled", String(i === 0));
    next.setAttribute("aria-disabled", String(i === weeks.length - 1));
  }
  show();

  return h("section", { class: "week-step", "aria-label": "Sunday rota" }, h("div", { class: "week-step__nav" }, prev, title, next), list);
}
