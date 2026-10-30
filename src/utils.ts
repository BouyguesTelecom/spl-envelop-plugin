// SPDX-License-Identifier: Apache-2.0

const isPlainContainer = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Applies `update` to the value located at `path` inside a GraphQL result tree, in place.
 *
 * A response path built from the query document only holds field names, while the result tree also
 * contains lists. Whenever the walk meets a list, it spreads over every element and keeps going
 * with the same segment — the equivalent of the integer indices a `ResultPath` carries server-side.
 * So `catalogue.shelving.shelves.books` reaches the `books` field of every shelf, however many
 * there are.
 *
 * @param root the root of the result data
 * @param path the field names leading to the value to update
 * @param update receives the current value and returns its replacement
 * @returns how many values were updated; `0` means the path did not resolve
 */
export const updateAtPath = (
  root: unknown,
  path: readonly string[],
  update: (value: unknown) => unknown,
): number => {
  if (path.length === 0) {
    return 0
  }

  const walk = (node: unknown, depth: number): number => {
    if (node === null || node === undefined) {
      return 0
    }

    if (Array.isArray(node)) {
      // Spread over the list and resume at the very same segment.
      return node.reduce<number>((total, element) => total + walk(element, depth), 0)
    }

    if (!isPlainContainer(node)) {
      return 0
    }

    const key = path[depth]

    if (depth === path.length - 1) {
      if (!(key in node)) {
        return 0
      }
      node[key] = update(node[key])
      return 1
    }

    return walk(node[key], depth + 1)
  }

  return walk(root, 0)
}
