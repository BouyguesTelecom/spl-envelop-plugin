# Simple Predicate Langage (SPL)

![NPM Version](https://img.shields.io/npm/v/@bouygues-telecom/spl-envelop-plugin?style=flat-square)

[SPL](https://github.com/BouyguesTelecom/SPL) is a very small, lightweight, straightforward and non-evaluated expression language to sort, filter and paginate arrays of maps.

This package is a [GraphQL Envelop](https://the-guild.dev/graphql/envelop) plugin of the `@SPL` directive, bringing SPL capabilities to your GraphQL API.

## Usage

```graphql
query GetUsers {
  users @SPL(query: "SORT BY age LIMIT 3") {
    name
    age
  }
}
```

## Getting Started

To use the SPL Envelop plugin, you need to:

1. Install the package:

    ```shell
    npm install @bouygues-telecom/spl-envelop-plugin
    ```

2. Import the plugin in your GraphQL Mesh configuration:

    ```typescript
    // ...
    import { splDirectiveTypeDef } from '@bouygues-telecom/spl-envelop-plugin'

    export const composeConfig = defineConfig({
      // ...
      additionalTypeDefs: /* GraphQL */ `
        ${splDirectiveTypeDef}
      `,
    })
    ```

3. Add the plugin to your GraphQL Mesh configuration:

    ```typescript
    // ...
    import { useSPL } from '@bouygues-telecom/spl-envelop-plugin'

    export const composeConfig = defineConfig({
      // ...
      plugins: [
        useSPL(),
      ],
    })
    ```

## Repeatable directive

`@SPL` is `repeatable`: several directives can be applied to the same field, and they are composed
in the order they are written — each filter applies to the result of the previous one.

```graphql
query GetYoungestAdmins {
  users @SPL(query: "role = 'admin'") @SPL(query: "SORT BY age LIMIT 3") {
    name
    age
  }
}
```

## Filtering on a nested sub-node

The filters run once the execution is over, on the fully resolved result tree. A predicate may
therefore read values from nested sub-nodes, including ones the gateway fetched through separate
downstream calls (HATEOAS links and the like) — by the time the plugin runs, they are populated.

```graphql
query GetAcclaimedBooks {
  books @SPL(query: "'5' IN MAP(reviews.items, rating) SORT BY publishedOn DESC LIMIT 2") {
    publishedOn
    reviews {
      items {
        rating
      }
    }
  }
}
```

Only the books that really have a `5` rating are kept, then sorted and paginated.

### Good to know

- Express the sorting and the pagination **inside the SPL query** (`SORT BY … LIMIT …`). Do not
  combine them with a separate `@sort`/`@limit`, which would truncate the list before the filter
  runs.
- The directive applies to a bare list as well as to an `{ items: [...] }` wrapper, in which case
  `items` is filtered and the rest of the envelope kept.
- A list nested under another list is handled: the filter is applied to every occurrence of the
  annotated field.
- Nested `@SPL` directives are independent — each filters at its own level, without cascading —
  and they are applied in document order, outermost first.
