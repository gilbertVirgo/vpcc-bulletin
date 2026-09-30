import { h } from "./dom";
import { shortDate } from "./shared/dates";
import type { GeneratedWeek, PersonName, Role, Week } from "./shared/types";

export type TableOptions = {
  onEditCell?: (week: Week, role: Role) => void;
  onDeleteWeek?: (week: Week, button: HTMLButtonElement) => void;
};

/** Stable hook for putting focus back on a cell after the table is re-rendered. */
export const cellKey = (date: string, roleId: string): string => `${date}/${roleId}`;

/** The rota as a table: rows = Sundays, columns = roles. Read-only unless handlers are given. */
export function rotaTable(
  roles: Role[],
  people: PersonName[],
  weeks: (Week | GeneratedWeek)[],
  caption: string,
  opts: TableOptions = {},
): HTMLElement {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const { onEditCell, onDeleteWeek } = opts;

  const head = h(
    "tr",
    {},
    h("th", { scope: "col" }, "Sunday"),
    ...roles.map((r) => h("th", { scope: "col" }, r.name)),
    onDeleteWeek ? h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Actions")) : null,
  );

  const rows = weeks.map((week) => {
    const gaps = "gaps" in week ? week.gaps : [];
    const date = shortDate(week.date);
    return h(
      "tr",
      {},
      h("th", { scope: "row" }, h("time", { datetime: week.date }, date)),
      ...roles.map((role) => {
        const text = (week.assignments[role.id] ?? []).map((id) => names.get(id) ?? "Unknown").join(", ");
        const gap = gaps.includes(role.id);
        const content = [
          text
            ? h("span", {}, text)
            : h("span", { class: "cell__empty" }, h("span", { "aria-hidden": "true" }, "–"), h("span", { class: "visually-hidden" }, "Nobody")),
          gap ? h("span", { class: "cell__gap-label" }, "Unfilled") : null,
        ];
        return h(
          "td",
          { class: gap ? "cell cell--gap" : "cell" },
          onEditCell
            ? h(
                "button",
                {
                  type: "button",
                  class: "cell__edit",
                  "data-cell": cellKey(week.date, role.id),
                  "aria-label": `${role.name} on ${date}: ${text || "nobody"}. Edit`,
                  onclick: () => onEditCell(week, role),
                },
                ...content,
              )
            : h("span", {}, ...content),
        );
      }),
      onDeleteWeek
        ? h(
            "td",
            { class: "cell cell--actions" },
            h(
              "button",
              {
                type: "button",
                class: "button button--sm button--danger",
                onclick: (e) => onDeleteWeek(week, e.currentTarget as HTMLButtonElement),
              },
              "Delete",
              h("span", { class: "visually-hidden" }, ` ${date}`),
            ),
          )
        : null,
    );
  });

  return h(
    "div",
    { class: "table-scroll", role: "region", "aria-label": caption, tabindex: 0 },
    h("table", { class: "table" }, h("caption", { class: "visually-hidden" }, caption), h("thead", {}, head), h("tbody", {}, ...rows)),
  );
}
