// SPDX-License-Identifier: Apache-2.0

import {
  type DocumentNode,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type StringValueNode,
  getOperationAST,
} from 'graphql'

const SPL_DIRECTIVE = 'SPL'
const QUERY_ARGUMENT = 'query'

/** A single `@SPL` occurrence, located in the result tree. */
export interface SplOccurrence {
  /** Response keys leading to the annotated field, aliases included. */
  path: string[]
  /** The SPL query to apply. */
  query: string
}

/**
 * Collects every `@SPL` directive of the operation being executed, in document order, along with
 * the response path leading to the field it annotates.
 *
 * Only the executed operation is visited: a document may hold several operations and any number of
 * fragment definitions, and the fields of those must not be mistaken for root fields. Fragments
 * are resolved in place, so the fields they contribute keep the path of the spread site — neither
 * a spread nor an inline fragment adds a response key.
 *
 * @param document the query document
 * @param operationName the operation to execute, when the document holds several
 */
export const collectSplDirectives = (
  document: DocumentNode,
  operationName?: string | null,
): SplOccurrence[] => {
  const operation = getOperationAST(document, operationName)

  if (!operation) {
    return []
  }

  const fragments = new Map<string, FragmentDefinitionNode>()
  for (const definition of document.definitions) {
    if (definition.kind === 'FragmentDefinition') {
      fragments.set(definition.name.value, definition)
    }
  }

  const occurrences: SplOccurrence[] = []

  const walk = (
    selectionSet: SelectionSetNode,
    path: string[],
    visitedFragments: ReadonlySet<string>,
  ): void => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === 'Field') {
        const fieldPath = [...path, selection.alias?.value ?? selection.name.value]

        for (const directive of selection.directives ?? []) {
          if (directive.name.value !== SPL_DIRECTIVE) {
            continue
          }

          const queryArgument = directive.arguments?.find(
            (argument) => argument.name.value === QUERY_ARGUMENT,
          )

          if (queryArgument?.value.kind !== 'StringValue') {
            continue
          }

          occurrences.push({
            path: fieldPath,
            query: (queryArgument.value as StringValueNode).value,
          })
        }

        if (selection.selectionSet) {
          walk(selection.selectionSet, fieldPath, visitedFragments)
        }
        continue
      }

      if (selection.kind === 'InlineFragment') {
        walk(selection.selectionSet, path, visitedFragments)
        continue
      }

      // FragmentSpread
      const fragmentName = selection.name.value
      const fragment = fragments.get(fragmentName)

      if (!fragment || visitedFragments.has(fragmentName)) {
        continue
      }

      walk(fragment.selectionSet, path, new Set([...visitedFragments, fragmentName]))
    }
  }

  walk(operation.selectionSet, [], new Set())

  return occurrences
}
