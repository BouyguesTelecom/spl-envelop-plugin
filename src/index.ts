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
 * What a single directive did, accumulated across every location it reached.
 *
 * A directive sitting under a list is applied once per element, so reporting each application
 * would mean one log line per element. The counts are gathered here and reported once.
 */
interface ApplyTally {
  /** Values that were actually filtered. */
  filtered: number
  /** Items seen across those values, before and after filtering. */
  before: number
  after: number
  /** Values left untouched because they were neither a list nor an `{ items }` envelope. */
  skipped: number
  /** The kinds of those untouched values, for a single actionable warning. */
  skippedKinds: Set<string>
}

const newTally = (): ApplyTally => ({
  filtered: 0,
  before: 0,
  after: 0,
  skipped: 0,
  skippedKinds: new Set(),
})

/**
 * Applies a SPL query to the value held by an annotated field, recording what it did in `tally`.
 *
 * Both shapes the directive can be placed on are supported: a bare list, and the
 * `{ items: [...] }` wrapper, whose `items` are filtered while the rest of the envelope is kept.
 * Anything else is returned untouched.
 */
const applySplToValue = (
  value: unknown,
  query: string,
  variables: Record<string, unknown>,
  tally: ApplyTally,
): unknown => {
  if (Array.isArray(value)) {
    const filtered = runSplFilter(query, value, variables)
    tally.filtered += 1
    tally.before += value.length
    tally.after += filtered.length
    return filtered
  }

  if (value !== null && typeof value === 'object' && Array.isArray((value as any).items)) {
    const wrapper = value as { items: unknown[] }
    const filtered = runSplFilter(query, wrapper.items, variables)
    tally.filtered += 1
    tally.before += wrapper.items.length
    tally.after += filtered.length
    return { ...wrapper, items: filtered }
  }

  tally.skipped += 1
  tally.skippedKinds.add(value === null ? 'null' : typeof value)
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
            const tally = newTally()

            const applied = updateAtPath(transformedData, occurrence.path, (value) =>
              applySplToValue(value, occurrence.query, variables, tally),
            )

            if (applied === 0) {
              console.warn(
                `@SPL directive on field "${pathLabel}" was ignored because the path did not resolve in the result.`,
              )
              continue
            }

            // One line per directive, not per element: under a list the callback above runs once
            // for every element, and logging there would scale with the size of the data.
            console.debug(
              `Applied SPL query "${occurrence.query}" at path "${pathLabel}": ` +
                `${tally.filtered} value(s) filtered, ${tally.before} -> ${tally.after} items`,
            )

            if (tally.skipped > 0) {
              console.warn(
                `@SPL directive on field "${pathLabel}" left ${tally.skipped} value(s) untouched: ` +
                  `neither a list nor an { items } wrapper. Got: ${[...tally.skippedKinds].join(', ')}`,
              )
            }

            hasChanges = tally.filtered > 0 || hasChanges
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
