// SPDX-License-Identifier: Apache-2.0

import { splListFilterer } from '@bouygues-telecom/spl'
import { handleStreamOrSingleExecutionResult } from '@envelop/core'
import type { Plugin } from '@envelop/types'
import type { DocumentNode } from 'graphql'
import { collectSplDirectives } from './collectSplDirectives.js'
import { updateAtPath } from './utils.js'

/**
 * Defines the SPL (Simple Predicate Language) directive type for GraphQL.
 *
 * This directive allows for sorting, filtering, and pagination of arrays of maps
 * using a lightweight expression language.
 *
 * The SPL directive takes a query string parameter that follows the SPL syntax
 * for processing data collections.
 *
 * @remarks
 * SPL is designed to be a straightforward and non-evaluated expression language.
 * For usage examples, see: https://github.com/bouyguestelecom/SPL#examples
 */
export const splDirectiveTypeDef: string = /* GraphQL */ `
  """
  This is a very small, lightweight, straightforward and non-evaluated expression language to sort, filter and paginate arrays of maps.

  The filters are applied once the whole result tree is resolved, so a predicate may read values
  coming from nested sub-nodes, whoever resolved them.

  The directive is \`repeatable\`: several \`@SPL\` can be applied to the same field, and they are
  then composed in the order they are written (each filter applies to the result of the previous one).
  """
  directive @SPL(
    """
    SPL query

    > [Usage examples](https://github.com/bouyguestelecom/SPL#examples)
    """
    query: String
  ) repeatable on FIELD
`

/**
 * Runs a SPL query (filter, sort and limit) over a list.
 */
const runSplFilter = (
  query: string,
  input: unknown[],
  variables: Record<string, unknown>,
): unknown[] =>
  splListFilterer.formatOutput(
    splListFilterer.filter(
      query,
      splListFilterer.formatInput(input),
      splListFilterer.formatVariables(variables),
    ),
  )

/**
 * Applies a SPL query to the value held by an annotated field.
 *
 * Both shapes the directive can be placed on are supported: a bare list, and the
 * `{ items: [...] }` wrapper, whose `items` are filtered while the rest of the envelope is kept.
 * Anything else is returned untouched.
 */
const applySplToValue = (
  value: unknown,
  query: string,
  variables: Record<string, unknown>,
  pathLabel: string,
): unknown => {
  if (Array.isArray(value)) {
    const filtered = runSplFilter(query, value, variables)
    console.debug(
      `SPL filtering applied successfully: ${value.length} -> ${filtered.length} items at path "${pathLabel}"`,
    )
    return filtered
  }

  if (value !== null && typeof value === 'object' && Array.isArray((value as any).items)) {
    const wrapper = value as { items: unknown[] }
    const filtered = runSplFilter(query, wrapper.items, variables)
    console.debug(
      `SPL filtering applied successfully: ${wrapper.items.length} -> ${filtered.length} items at path "${pathLabel}.items"`,
    )
    return { ...wrapper, items: filtered }
  }

  console.warn(
    `@SPL directive on field "${pathLabel}" was ignored because the resolved value is neither a list nor an { items } wrapper. Got: ${
      value === null ? 'null' : typeof value
    }`,
  )
  return value
}

/**
 * Creates a GraphQL envelope plugin that applies SPL (Simple Predicate Language) filtering
 * to query results based on `@SPL` directives in the GraphQL query.
 *
 * The plugin intercepts GraphQL execution results and applies the specified SPL queries
 * to array fields that have the `@SPL` directive, transforming the data before returning it.
 *
 * It runs once the execution is over, on the fully resolved tree, so a predicate may read values
 * from nested sub-nodes — including ones fetched by separate downstream calls, which the gateway
 * has already resolved by then.
 *
 * @returns A GraphQL Envelop plugin that handles SPL filtering
 */
export const useSPL = (): Plugin => ({
  onExecute: ({ args }) => ({
    onExecuteDone: (payload) =>
      handleStreamOrSingleExecutionResult(payload, ({ result, setResult }) => {
        if (!result.data || !args.document) {
          // Ensure we have data and the query document
          return
        }

        const occurrences = collectSplDirectives(
          args.document as DocumentNode,
          args.operationName,
        )

        if (occurrences.length === 0) {
          return
        }

        // Deep clone the data to avoid mutating the original result directly during traversal.
        const transformedData = JSON.parse(JSON.stringify(result.data))
        const variables = (args.variableValues ?? {}) as Record<string, unknown>
        let hasChanges = false

        for (const occurrence of occurrences) {
          const pathLabel = occurrence.path.join('.')

          // Each occurrence is isolated: one failing on an unexpected tree shape must neither
          // break the others nor the GraphQL response.
          try {
            console.debug(`Applying SPL query "${occurrence.query}" at path "${pathLabel}"`)

            const applied = updateAtPath(transformedData, occurrence.path, (value) =>
              applySplToValue(value, occurrence.query, variables, pathLabel),
            )

            if (applied === 0) {
              console.warn(
                `@SPL directive on field "${pathLabel}" was ignored because the path did not resolve in the result.`,
              )
              continue
            }

            hasChanges = true
          } catch (e) {
            console.error(`Error applying SPL directive to field "${pathLabel}":`, e)
            // Note: We could extend result.errors, but it's readonly in this context
            // The error is logged for debugging purposes
          }
        }

        if (hasChanges) {
          setResult({ ...result, data: transformedData })
        }
      }),
  }),
})
