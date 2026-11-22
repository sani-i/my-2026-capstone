/**
 * Stable merge sort. Returns a NEW array; never mutates the input.
 * Does not use Array.prototype.sort.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {(a: T, b: T) => number} compare - negative if a<b, 0 if equal, positive if a>b
 * @returns {T[]}
 */
export function mergeSort(items, compare) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }
  if (typeof compare !== "function") {
    throw new TypeError("compare must be a function");
  }

  const n = items.length;
  if (n <= 1) return items.slice();

  const mid = Math.floor(n / 2);
  const left = mergeSort(items.slice(0, mid), compare);
  const right = mergeSort(items.slice(mid), compare);
  return merge(left, right, compare);
}

/**
 * @template T
 * @param {T[]} left
 * @param {T[]} right
 * @param {(a: T, b: T) => number} compare
 * @returns {T[]}
 */
function merge(left, right, compare) {
  const out = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    const cmp = compare(left[i], right[j]);
    // <= 0 keeps left-first on equal values -> stable sort
    if (cmp <= 0) {
      out.push(left[i]);
      i += 1;
    } else {
      out.push(right[j]);
      j += 1;
    }
  }

  while (i < left.length) {
    out.push(left[i]);
    i += 1;
  }
  while (j < right.length) {
    out.push(right[j]);
    j += 1;
  }

  return out;
}
