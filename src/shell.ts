import { api, loginUrl, logout } from "./api";
import { h } from "./dom";
import type { Me } from "./shared/types";

// The VPCC mark, from vpcc-v1 src/components/brand/logo.tsx. Painted with currentColor.
const MARK =
  "M50 100C77.6142 100 100 77.6142 100 50C100 22.3858 77.6142 0 50 0C22.3858 0 0 22.3858 0 50C0 77.6142 22.3858 100 50 100ZM12.32 43.36L19.04 60H23.52L30.24 43.36H25.76L21.28 55.44L16.8 43.36H12.32ZM40.8638 42.96C36.0638 42.96 31.9037 46.88 31.9037 51.68V68.32H36.3838V58.96C37.8237 60 39.4238 60.4 41.1037 60.4C45.8237 60.4 49.8237 56.48 49.8237 51.68C49.8237 46.48 46.0638 42.96 40.8638 42.96ZM45.3438 51.68C45.3438 54.24 43.5037 56.24 40.8638 56.24C38.3037 56.24 36.3838 54.24 36.3838 51.68C36.3838 49.04 38.3037 47.12 40.8638 47.12C43.5037 47.12 45.3438 49.04 45.3438 51.68ZM52.5491 51.68C52.5491 56.88 56.3091 60.4 61.5091 60.4C63.8291 60.4 66.0691 59.44 67.6691 57.76L64.7091 54.88C63.9091 55.68 62.7091 56.24 61.5091 56.24C58.9491 56.24 57.0291 54.24 57.0291 51.68C57.0291 49.04 58.9491 47.12 61.5091 47.12C62.7891 47.12 63.9091 47.6 64.7891 48.4L67.7491 45.44C65.9891 43.68 63.9891 42.96 61.5091 42.96C56.7091 42.96 52.5491 46.88 52.5491 51.68ZM70.3225 51.68C70.3225 56.88 74.0825 60.4 79.2825 60.4C81.6025 60.4 83.8425 59.44 85.4425 57.76L82.4825 54.88C81.6825 55.68 80.4825 56.24 79.2825 56.24C76.7225 56.24 74.8025 54.24 74.8025 51.68C74.8025 49.04 76.7225 47.12 79.2825 47.12C80.5625 47.12 81.6825 47.6 82.5625 48.4L85.5225 45.44C83.7625 43.68 81.7625 42.96 79.2825 42.96C74.4825 42.96 70.3225 46.88 70.3225 51.68Z";

function logo(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("clip-rule", "evenodd");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", MARK);
  svg.append(path);
  return svg;
}

/** Renders the header into #site-header and returns who is signed in. */
export async function mountShell(active: "rota" | "people" | "role-info"): Promise<Me> {
  const me = await api<Me>("me");
  const link = (href: string, label: string, key: string) =>
    h("a", { href, "aria-current": key === active ? "page" : undefined }, label);
  const auth = me.user
    ? [
        h("span", {}, me.user.username),
        h("button", { type: "button", class: "button button--sm button--secondary", onclick: () => void logout(me.hub) }, "Log out"),
      ]
    : [h("a", { class: "button button--sm button--secondary", href: loginUrl(me.hub) }, "Log in")];
  document.querySelector<HTMLElement>("#site-header")!.replaceChildren(
    h(
      "div",
      { class: "container site-header__inner" },
      h("a", { href: "/", class: "site-header__logo", "aria-label": "Victoria Park Community Church rota" }, logo()),
      h("nav", { class: "site-nav", "aria-label": "Main" }, link("/", "Rota", "rota"), link("/role-info", "Role info", "role-info"), me.user ? link("/people", "People", "people") : null),
      h("div", { class: "site-header__auth" }, ...auth),
    ),
  );
  return me;
}
