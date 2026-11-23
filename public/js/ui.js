/**
 * Small DOM helper. Builds DOM nodes. Use textContent, never innerHTML for data.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "dataset" && typeof value === "object") {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = String(dv);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "disabled" || key === "checked" || key === "selected") {
      node[key] = Boolean(value);
    } else if (key === "htmlFor") {
      node.setAttribute("for", value);
    } else {
      node.setAttribute(key, String(value));
    }
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }

  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function formatCents(cents) {
  const amount = Number(cents || 0) / 100;
  return `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
