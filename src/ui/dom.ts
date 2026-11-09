// Builds DOM nodes. Text from job pages goes through textContent only, so a
// hostile label can't inject markup into an extension page.
type Attrs = Record<string, string | boolean | ((event: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(name, value);
    else if (name === 'class') el.className = String(value);
    else if (name === 'value') (el as HTMLInputElement).value = String(value);
    else if (name === 'checked') (el as HTMLInputElement).checked = Boolean(value);
    else el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== undefined) el.append(child);
  return el;
}

export function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
