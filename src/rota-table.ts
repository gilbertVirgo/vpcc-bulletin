import { h } from "./dom";
import { shortDate } from "./shared/dates";
import { ROLE_INFO } from "./shared/role-info";
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
    ...weeks.map((w) =>
      h(
        "th",
        { scope: "col" },
        h("time", { datetime: w.date }, shortDate(w.date)),
        // In the column head, so it plainly belongs to that Sunday.
        onDeleteWeek
          ? h(
              "button",
              { type: "button", class: "week-remove", onclick: (e) => onDeleteWeek(w, e.currentTarget as HTMLButtonElement) },
              "Remove week",
              h("span", { class: "visually-hidden" }, ` ${shortDate(w.date)}`),
            )
          : null,
      ),
    ),
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

  return h(
    "div",
    { class: "table-scroll", role: "region", "aria-label": caption, tabindex: 0 },
    h(
      "table",
      { class: "table" },
      h("caption", { class: "visually-hidden" }, caption),
      h("thead", {}, head),
      h("tbody", {}, ...rows),
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
        const info = ROLE_INFO[role.id];
        const term = h(
          "dt",
          {},
          role.name,
          info ? h("a", { href: `/role-info#${role.id}`, class: "week-step__info", "aria-label": `What ${role.name} involves` }, "i") : null,
          info?.arrival ? h("span", { class: "week-step__arrival" }, `Arrive ${info.arrival}`) : null,
        );
        return h("div", { class: "week-step__row" }, term, h("dd", {}, text || nobody()));
      }),
    );
    prev.setAttribute("aria-disabled", String(i === 0));
    next.setAttribute("aria-disabled", String(i === weeks.length - 1));
  }
  show();

  const download = h(
    "button",
    {
      type: "button",
      class: "button button--secondary button--sm week-step__download",
      onclick: () => void downloadImage(weeks[i], roles.map((r) => [r.name, namesIn(weeks[i], r, names) || "–"])),
    },
    "Download an image",
    h("span", { class: "visually-hidden" }, " of this Sunday's rota"),
  );

  return h("section", { class: "week-step", "aria-label": "Sunday rota" }, h("div", { class: "week-step__nav" }, prev, title, next), list, download);
}

/** Saves one Sunday as a PNG (role | names, zebra rows) in the page's own font and colours, for sharing in group chats. */
async function downloadImage(week: Week, rows: [string, string][]): Promise<void> {
  await document.fonts.ready;
  const body = getComputedStyle(document.body);
  const sunken = getComputedStyle(document.documentElement).getPropertyValue("--color-surface-sunken");
  const x = 2; // pixel ratio, so it stays sharp on phones
  const pad = 40 * x, inset = 8 * x, line = 32 * x, gap = 60 * x;
  const font = (weight: number, size: number) => `${weight} ${size * x}px ${body.fontFamily}`;
  const title = `Roles for ${shortDate(week.date)}`;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const widest = (f: string, texts: string[]) => ((ctx.font = f), Math.max(...texts.map((t) => ctx.measureText(t).width)));
  const roleWidth = widest(font(700, 16), rows.map(([r]) => r));
  const nameWidth = widest(font(500, 16), rows.map(([, n]) => n));
  // Setting the size clears the context, so measure first, draw after.
  canvas.width = Math.ceil(Math.max(pad * 2 + inset * 2 + roleWidth + gap + nameWidth, pad * 2 + widest(font(700, 20), [title])));
  canvas.height = pad * 2 + line * 2 + rows.length * line;

  ctx.fillStyle = body.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "middle";
  ctx.fillStyle = body.color;
  ctx.font = font(700, 20);
  ctx.fillText(title, pad, pad + line / 2);
  rows.forEach(([role, people], n) => {
    const top = pad + line * 2 + n * line;
    if (n % 2 === 0) {
      ctx.fillStyle = sunken;
      ctx.fillRect(pad, top, canvas.width - pad * 2, line);
    }
    ctx.fillStyle = body.color;
    ctx.font = font(700, 16);
    ctx.fillText(role, pad + inset, top + line / 2);
    ctx.font = font(500, 16);
    ctx.fillText(people, pad + inset + roleWidth + gap, top + line / 2);
  });
  h("a", { href: canvas.toDataURL("image/png"), download: `rota-${week.date}.png` }).click();
}
