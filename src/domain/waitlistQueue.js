class Node {
  /** @param {unknown} value */
  constructor(value) {
    this.value = value;
    /** @type {Node | null} */
    this.next = null;
  }
}

/**
 * First-in-first-out queue implemented as a singly linked list.
 * enqueue, dequeue, peek, and size are O(1).
 */
export class Queue {
  /** @type {Node | null} */
  #head = null;
  /** @type {Node | null} */
  #tail = null;
  #size = 0;

  /**
   * Add a value to the back of the queue. O(1).
   * @param {unknown} value
   */
  enqueue(value) {
    const node = new Node(value);
    if (this.#tail === null) {
      this.#head = node;
      this.#tail = node;
    } else {
      this.#tail.next = node;
      this.#tail = node;
    }
    this.#size += 1;
  }

  /**
   * Remove and return the value at the front. O(1).
   * @returns {unknown | undefined}
   */
  dequeue() {
    if (this.#head === null) return undefined;
    const node = this.#head;
    this.#head = node.next;
    if (this.#head === null) {
      this.#tail = null;
    }
    node.next = null;
    this.#size -= 1;
    return node.value;
  }

  /**
   * Return the front value without removing it. O(1).
   * @returns {unknown | undefined}
   */
  peek() {
    return this.#head === null ? undefined : this.#head.value;
  }

  /**
   * Number of items in the queue. O(1).
   * @returns {number}
   */
  get size() {
    return this.#size;
  }
}
