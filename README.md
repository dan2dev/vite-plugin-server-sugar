# vite-plugin-server-sugar

Write server functions, HTTP handlers, WebSockets, and Web Workers inline in a
Vite app. The publishable package lives in
[`packages/vite-plugin`](./packages/vite-plugin).

```bash
npm install vite-plugin-server-sugar hono
```

```ts
import { defineConfig } from "vite";
import { serverBuildPlugin } from "vite-plugin-server-sugar";

export default defineConfig({
  plugins: [serverBuildPlugin({ port: 3001 })],
});
```

```ts
// src/todos.ts
export const getTodos = $server(async () => {
  return [{ id: 1, text: "Ship the README" }];
});
```

See the full package README for setup, examples, options, and runtime
contracts:

- [`packages/vite-plugin/README.md`](./packages/vite-plugin/README.md)
- [`packages/vite-plugin/ARCHITECTURE.md`](./packages/vite-plugin/ARCHITECTURE.md)
