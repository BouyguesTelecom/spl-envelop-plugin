// SPDX-License-Identifier: Apache-2.0

/**
 * End-to-end coverage of the shapes a `@SPL` directive has to cope with, through a real
 * `envelop` + `execute` round-trip rather than by calling the plugin internals.
 *
 * The schema is a small book catalogue, built to exercise one structural case each:
 *
 *   books                         a bare list at the root
 *   books[].reviews               an `{ items: [...] }` envelope, a nested sub-node
 *   catalogue.shelving.shelves    a list sitting between the root and the annotated field
 *   shelves[].books               a list reached *through* that list
 *
 * The last one is the interesting one: the response path holds field names only, so reaching
 * `books` means spreading over every shelf along the way.
 */

import { describe, it, expect } from 'vitest'
import { envelop, useEngine, useSchema } from '@envelop/core'
import * as graphqlJs from 'graphql'
import { buildSchema, type ExecutionResult } from 'graphql'
import { useSPL, splDirectiveTypeDef } from './index.js'

const schema = buildSchema(/* GraphQL */ `
  ${splDirectiveTypeDef}

  type Review {
    rating: String
    comment: String
  }

  type ReviewPage {
    items: [Review!]
  }

  type Book {
    isbn: ID!
    genre: String
    publishedOn: String
    reviews: ReviewPage
  }

  type Shelf {
    id: ID!
    books: [Book!]
  }

  type Shelving {
    shelves: [Shelf!]
  }

  type Catalogue {
    shelving: Shelving
  }

  type Query {
    books: [Book!]
    catalogue(id: String!): Catalogue
  }
`)

const review = (rating: string) => ({ rating, comment: `rated ${rating}` })

// B1 and B2 share a '1' review, B1 and B3 a '5' one: the same dataset answers two different
// predicates with two different pairs, which keeps the scenarios below honest.
const books = [
  { isbn: 'B1', genre: 'FICTION', reviews: { items: [review('5'), review('1')] } },
  { isbn: 'B2', genre: 'FICTION', reviews: { items: [review('1')] } },
  { isbn: 'B3', genre: 'ESSAY', reviews: { items: [review('5')] } },
]

const book = (publishedOn: string, ratings: string[]) => ({
  publishedOn,
  reviews: { items: ratings.map(review) },
})

const catalogue = {
  shelving: {
    shelves: [
      {
        id: 'S1',
        books: [
          book('2021-01-10', ['5', '1']), // kept
          book('2021-03-02', ['1']), // dropped, no '5'
          book('2021-02-20', ['5']), // kept
        ],
      },
    ],
  },
}

const rootValue = {
  books: () => books,
  catalogue: () => catalogue,
}

const run = async (
  query: string,
  variableValues: Record<string, unknown> = {},
): Promise<ExecutionResult> => {
  const getEnveloped = envelop({
    plugins: [useEngine(graphqlJs), useSchema(schema), useSPL()],
  })
  const { parse: envelopParse, execute, contextFactory, schema: envelopedSchema } = getEnveloped()

  return (await execute({
    schema: envelopedSchema,
    document: envelopParse(query),
    rootValue,
    contextValue: await contextFactory(),
    variableValues,
  })) as ExecutionResult
}

const isbns = (result: ExecutionResult): string[] =>
  (result.data?.books as { isbn: string }[]).map((b) => b.isbn)

describe('filtering shapes', () => {
  it('1 — a predicate on a plain field', async () => {
    const result = await run(/* GraphQL */ `
      {
        books @SPL(query: "genre = 'FICTION'") {
          isbn
          genre
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    expect(isbns(result)).toEqual(['B1', 'B2'])
  })

  it('2 — a predicate reading a nested sub-node', async () => {
    const result = await run(/* GraphQL */ `
      {
        books @SPL(query: "'5' IN MAP(reviews.items, rating)") {
          isbn
          genre
          reviews {
            items {
              rating
            }
          }
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    expect(isbns(result)).toEqual(['B1', 'B3'])
  })

  it('3 — the same nested predicate with another value returns another subset', async () => {
    const result = await run(/* GraphQL */ `
      {
        books @SPL(query: "'1' IN MAP(reviews.items, rating)") {
          isbn
          genre
          reviews {
            items {
              rating
            }
          }
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    expect(isbns(result)).toEqual(['B1', 'B2'])
  })

  it('4 — deep case: under a list, with SORT, LIMIT and a nested @SPL', async () => {
    const result = await run(
      /* GraphQL */ `
        query DeepFilter($catalogueId: String!) {
          catalogue(id: $catalogueId) {
            shelving {
              shelves {
                id
                books
                  @SPL(
                    query: "'5' IN MAP(reviews.items, rating) SORT BY publishedOn DESC LIMIT 2"
                  ) {
                  publishedOn
                  reviews {
                    items @SPL(query: "rating = '5'") {
                      rating
                      comment
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { catalogueId: 'C1' },
    )

    expect(result.errors).toBeUndefined()

    const shelves = (result.data?.catalogue as any).shelving.shelves
    const shelfBooks = shelves[0].books

    expect(shelfBooks.map((b: any) => b.publishedOn)).toEqual(['2021-02-20', '2021-01-10'])

    // The inner @SPL narrowed each book's reviews down to the '5' ones.
    for (const b of shelfBooks) {
      expect(b.reviews.items.map((i: any) => i.rating)).toEqual(['5'])
    }
  })
})

describe('plugin behaviour', () => {
  it('applies nested @SPL in document order, outermost first', async () => {
    // The outer filter keeps the books having a '5' review, while the inner one strips exactly
    // those reviews away. The two disagree, so the result reveals which ran first.
    const result = await run(/* GraphQL */ `
      {
        books @SPL(query: "'5' IN MAP(reviews.items, rating)") {
          isbn
          reviews {
            items @SPL(query: "rating != '5'") {
              rating
            }
          }
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    // The outer filter ran first, on the untouched sub-nodes, and kept B1 and B3; the inner one
    // then stripped the '5' reviews from what survived.
    expect(isbns(result)).toEqual(['B1', 'B3'])
  })

  it('composes repeated @SPL directives in the order they are written', async () => {
    const result = await run(/* GraphQL */ `
      {
        books @SPL(query: "genre = 'FICTION'") @SPL(query: "isbn = 'B1'") {
          isbn
          genre
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    expect(isbns(result)).toEqual(['B1'])
  })

  it('filters the items of an { items } envelope and keeps the envelope', async () => {
    // Here the directive sits on `reviews`, which resolves to `{ items: [...] }` rather than to a
    // list. The envelope has to survive, with only its `items` filtered.
    const result = await run(/* GraphQL */ `
      {
        books {
          isbn
          reviews @SPL(query: "rating = '5'") {
            items {
              rating
            }
          }
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    const data = result.data?.books as any[]
    expect(data.map((b) => b.reviews)).not.toContain(null)
    expect(data.map((b) => b.reviews.items.map((i: any) => i.rating))).toEqual([
      ['5'],
      [],
      ['5'],
    ])
  })

  it('leaves a value that is neither a list nor an envelope untouched', async () => {
    // `shelving` resolves to a plain object. There is nothing to filter, so the data must come
    // back exactly as the resolvers produced it.
    const result = await run(/* GraphQL */ `
      {
        catalogue(id: "C1") {
          shelving @SPL(query: "rating = '5'") {
            shelves {
              id
            }
          }
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    expect((result.data?.catalogue as any).shelving).toEqual({ shelves: [{ id: 'S1' }] })
  })

  it('leaves the result untouched when there is no @SPL directive', async () => {
    const result = await run(/* GraphQL */ `
      {
        books {
          isbn
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    expect(isbns(result)).toEqual(['B1', 'B2', 'B3'])
  })

  it('resolves the path through a named fragment', async () => {
    const result = await run(/* GraphQL */ `
      {
        books {
          ...BookFields
        }
      }

      fragment BookFields on Book {
        isbn
        reviews {
          items @SPL(query: "rating = '5'") {
            rating
          }
        }
      }
    `)

    expect(result.errors).toBeUndefined()
    const data = result.data?.books as any[]
    expect(data.map((b) => b.reviews.items.map((i: any) => i.rating))).toEqual([
      ['5'],
      [],
      ['5'],
    ])
  })

  it('drops the elements whose sub-node is null instead of failing the whole filter', async () => {
    const withHole = [...books, { isbn: 'B4', genre: 'ESSAY', reviews: null }]
    const getEnveloped = envelop({
      plugins: [useEngine(graphqlJs), useSchema(schema), useSPL()],
    })
    const { parse: envelopParse, execute, contextFactory, schema: envelopedSchema } = getEnveloped()

    const result = (await execute({
      schema: envelopedSchema,
      document: envelopParse(/* GraphQL */ `
        {
          books @SPL(query: "'5' IN MAP(reviews.items, rating)") {
            isbn
            reviews {
              items {
                rating
              }
            }
          }
        }
      `),
      rootValue: { books: () => withHole },
      contextValue: await contextFactory(),
    })) as ExecutionResult

    expect(result.errors).toBeUndefined()
    expect(isbns(result)).toEqual(['B1', 'B3'])
  })
})
