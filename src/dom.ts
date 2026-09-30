type AttrValue = string | number | boolean | undefined | ((e: Event) => void);
export type Attrs = Record<string, AttrValue>;
export type Child = Node | string | null | undefined | false;

/**
 * Element builder. Strings become text nodes, so user data can never become markup.
 * `onclick` style keys attach listeners; `true` sets an empty attribute; false/undefined are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}
