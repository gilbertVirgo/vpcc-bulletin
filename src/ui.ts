import { h } from "./dom";

/** Native modal <dialog>: focus trap, Esc and inert background come from the platform. Removed on close. */
export function openModal(title: string, ...content: Node[]): HTMLDialogElement {
  const id = `dialog-${crypto.randomUUID()}`;
  const dialog = h("dialog", { class: "dialog", "aria-labelledby": id }, h("h2", { id, class: "dialog__title" }, title), ...content);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** In-page confirm. Not window.confirm, which blocks browser automation. Esc = cancel. */
export function confirmDialog(text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = openModal(
      "Are you sure?",
      h("p", {}, text),
      h(
        "form",
        { method: "dialog", class: "dialog__actions" },
        h("button", { value: "cancel", class: "button button--secondary" }, "Cancel"),
        h("button", { value: "ok", class: "button button--danger" }, confirmLabel),
      ),
    );
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"));
  });
}

export function skeletonTable(columns: number, rows: number, label: string): HTMLElement {
  const cell = () => h("td", {}, h("span", { class: "skeleton skeleton--line", "aria-hidden": "true" }, "Loading"));
  return h(
    "div",
    { class: "table-scroll", "aria-busy": "true" },
    h("p", { class: "visually-hidden" }, label),
    h("table", { class: "table" }, h("tbody", {}, ...Array.from({ length: rows }, () => h("tr", {}, ...Array.from({ length: columns }, cell))))),
  );
}
