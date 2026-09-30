import "./styles/index.css";
import "./styles/rota.css";
import { api, message } from "./api";
import { h } from "./dom";
import { ROLE_INFO } from "./shared/role-info";
import type { RotaResponse } from "./shared/types";
import { mountShell } from "./shell";

const main = document.querySelector<HTMLElement>("#main")!;

/** Every role as a <details>, id = role id, so /role-info#<id> opens that one. Ticks are for the day only, never saved. */
async function start(): Promise<void> {
  await mountShell("role-info");
  const body = h("div", { class: "role-info" }, h("p", { class: "status" }, "Loading roles…"));
  main.replaceChildren(h("div", { class: "page-head" }, h("h1", {}, "Role info")), body);
  try {
    const { roles } = await api<RotaResponse>("weeks");
    body.replaceChildren(
      ...roles.map((role) => {
        const info = ROLE_INFO[role.id];
        return h(
          "details",
          { id: role.id, name: "role-info", class: "role-info__item" },
          h("summary", {}, role.name),
          info?.arrival ? h("p", { class: "role-info__arrival" }, h("strong", {}, "Arrival time: "), info.arrival) : null,
          info?.how.length
            ? h(
                "ul",
                { class: "role-info__list" },
                ...info.how.map((step, i) =>
                  h("li", { class: "check" }, h("input", { type: "checkbox", id: `${role.id}-${i}` }), h("label", { for: `${role.id}-${i}` }, step)),
                ),
              )
            : h("p", { class: "status" }, "No checklist for this role yet."),
        );
      }),
    );
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView({ block: "center" });
    }
  } catch (err) {
    body.replaceChildren(h("p", { class: "error", role: "alert" }, `Could not load the roles. ${message(err)}`));
  }
}

start().catch((err) => main.replaceChildren(h("p", { class: "error", role: "alert" }, message(err))));
