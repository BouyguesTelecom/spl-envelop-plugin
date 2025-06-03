// SPDX-License-Identifier: Apache-2.0

import { splListFilterer } from '@bouygues-telecom/spl'
import { handleStreamOrSingleExecutionResult } from '@envelop/core'
import type { Plugin } from '@envelop/types'
import {
  type ArgumentNode,
  type DocumentNode,
  type FieldNode,
  type StringValueNode,
  visit,
} from 'graphql'
import { getPath, setPath } from './utils.js'

/**
 * Defines the SPL (Simple Processing Language) directive type for GraphQL.
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
  """
  directive @SPL(
    """
    SPL query

    > [Usage examples](https://github.com/bouyguestelecom/SPL#examples)
    """
    query: String
  ) on FIELD
`

/**
 * Creates a GraphQL envelope plugin that applies SPL (Simple Predicate Language) filtering
 * to query results based on `@SPL` directives in the GraphQL schema.
 *
 * The plugin intercepts GraphQL execution results and applies the specified SPL queries
 * to array fields that have the `@SPL` directive, transforming the data before returning it.
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

        // Deep clone the data to avoid mutating the original result directly during traversal
        // SPLListFilterer's formatInput/Output also handle cloning, but this ensures safety for path-based modifications.
        let transformedData = JSON.parse(JSON.stringify(result.data))
        let hasChanges = false
        const pathStack: string[] = []

        // Enhanced visitor that tracks both document structure and data availability
        const processSPLDirectives = (node: FieldNode, pathStack: string[]) => {
          const splDirective = node.directives?.find((directive) => directive.name.value === 'SPL')

          if (splDirective) {
            const currentPath = [...pathStack]
            console.debug(`Processing @SPL directive on field "${currentPath.join('.')}"`)

            const queryArg = splDirective.arguments?.find(
              (arg: ArgumentNode) => arg.name.value === 'query',
            )

            if (queryArg && queryArg.value.kind === 'StringValue') {
              const splQueryString = (queryArg.value as StringValueNode).value
              const dataToTransform = getPath(transformedData, currentPath)

              // Only process if we have data at this path
              if (dataToTransform === undefined) {
                console.warn(
                  `@SPL directive on field "${currentPath.join(
                    '.',
                  )}" was ignored because the resolved value is undefined.`,
                )
                return
              }

              if (!Array.isArray(dataToTransform)) {
                console.warn(
                  `@SPL directive on field "${currentPath.join(
                    '.',
                  )}" was ignored because the resolved value is not an array. Got: ${typeof dataToTransform}`,
                )
                return
              }

              try {
                // Use GraphQL variables from the execution context
                const variables = args.variableValues || {}

                const formattedInput = splListFilterer.formatInput(dataToTransform)
                const formattedVariables = splListFilterer.formatVariables(variables)

                console.debug(
                  `Applying SPL query "${splQueryString}" to ${
                    dataToTransform.length
                  } items at path "${currentPath.join('.')}"`,
                )

                const transformedDataArray = splListFilterer.filter(
                  splQueryString,
                  formattedInput,
                  formattedVariables,
                )
                const finalTransformedData = splListFilterer.formatOutput(transformedDataArray)

                setPath(transformedData, currentPath, finalTransformedData)
                hasChanges = true

                console.debug(
                  `SPL filtering applied successfully: ${dataToTransform.length} -> ${finalTransformedData.length} items`,
                )
              } catch (e) {
                console.error(
                  `Error applying SPL directive to field "${currentPath.join('.')}":`,
                  e,
                )
                // Note: We could extend result.errors, but it's readonly in this context
                // The error is logged for debugging purposes
              }
            }
          }
        }

        visit(args.document as DocumentNode, {
          Field: {
            enter(node: FieldNode) {
              // Use alias if present, otherwise field name
              const fieldName = node.alias ? node.alias.value : node.name.value
              pathStack.push(fieldName)

              // Process SPL directive for this field
              processSPLDirectives(node, pathStack)
            },
            leave() {
              pathStack.pop()
            },
          },
        })

        if (hasChanges) {
          setResult({ ...result, data: transformedData })
        }
      }),
  }),
})
