// SPDX-License-Identifier: Apache-2.0

/**
 * Get a value from a nested object using a path array
 */
export const getPath = (obj: any, path: string[]): any =>
  path.reduce(
    (current, key) => (current && typeof current === 'object' ? current[key] : undefined),
    obj,
  )

/**
 * Set a value in a nested object using a path array
 */
export const setPath = (obj: any, path: string[], value: any): void => {
  const lastIndex = path.length - 1
  path.slice(0, lastIndex).reduce((current, key) => {
    if (current && typeof current === 'object') {
      return (current[key] ??= {})
    }
    return {}
  }, obj)[path[lastIndex]] = value
}
