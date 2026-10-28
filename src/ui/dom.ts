export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, any> | null,
  ...children: (string | Node | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const elem = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null) continue;
      if (key.startsWith('on') && typeof val === 'function') {
        const eventName = key.slice(2).toLowerCase();
        elem.addEventListener(eventName, val as EventListener);
      } else if (key === 'className') {
        elem.className = String(val);
      } else if (key in elem && key !== 'list' && key !== 'form') {
        (elem as any)[key] = val;
      } else {
        elem.setAttribute(key, String(val));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      elem.appendChild(document.createTextNode(String(child)));
    } else if ((typeof Node !== 'undefined' && child instanceof Node) || (child && typeof child === 'object' && 'nodeType' in child)) {
      elem.appendChild(child as Node);
    }
  }
  return elem;
}
