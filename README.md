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
