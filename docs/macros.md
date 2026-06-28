# Macro reference

All macros are ambient compile-time globals. Add the package declaration
subpaths to `tsconfig.json`, then call the macros directly in source files.

```json
{
  "compilerOptions": {
    "types": [
      "vite-plugin-server-sugar/server",
      "vite-plugin-server-sugar/ws",
      "vite-plugin-server-sugar/worker"
    ]
  }
}
```

## `$server()`

Use `$server()` for typed RPC-style calls.

```ts
export const getUser = $server(async (id: string) => {
  return db.query("SELECT * FROM users WHERE id = ?").get(id);
});

export const renameUser = $server(async (id: string, name: string) => {
  db.query("UPDATE users SET name = ? WHERE id = ?").run(name, id);
});
```

```ts
const user = await getUser("u_123");
await renameUser("u_123", "Ada");
```

Signature:

```ts
declare function $server<Args extends unknown[], R>(
  fn: (...args: Args) => R | Promise<R>,
): (...args: Args) => Promise<Awaited<R>>;
```

Arguments and return values should be JSON-serializable unless the handler
returns a `Response`. TypeScript types are preserved at compile time, but the
plugin does not add runtime schema validation.

## HTTP method helpers

Use HTTP helpers when you want method-specific endpoints and a Hono-compatible
context object:

```ts
export const listTodos = $get(async (c) => {
  const limit = Number(c.req.query("limit") ?? "50");
  return db.query("SELECT * FROM todos LIMIT ?").all(limit);
});

export const createTodo = $post(
  async (c: ServerContext<{ text: string }>) => {
    const body = await c.req.json();
    return db.query("INSERT INTO todos (text) VALUES (?) RETURNING *").get(
      body.text,
    );
  },
);
```

Client calls:

```ts
await listTodos({ limit: "10" });
await createTodo({ text: "Write docs" });
```

Available helpers:

- `$get()`
- `$post()`
- `$put()`
- `$patch()`
- `$delete()`
- `$head()`

`$post()`, `$put()`, and `$patch()` client wrappers take:

```ts
body, optionalQuery, optionalFetchOptions
```

`$get()`, `$delete()`, and `$head()` client wrappers take:

```ts
optionalQuery, optionalFetchOptions
```

`optionalFetchOptions` currently supports request headers:

```ts
await createTodo(
  { text: "Document auth headers" },
  undefined,
  { headers: { Authorization: "Bearer token" } },
);
```

Typed query objects make the client query argument required:

```ts
export const getTodo = $get(
  async (c: ServerContext<never, { id: string }>) => {
    return db.query("SELECT * FROM todos WHERE id = ?").get(c.req.query("id"));
  },
);

await getTodo({ id: "42" });
```

Untyped query objects are optional:

```ts
export const searchTodos = $get(async (c) => {
  return c.req.query("q");
});

await searchTodos();
await searchTodos({ q: "docs" });
```

Handlers may return JSON-serializable values, `undefined`, or a `Response`.
Returning `undefined` sends `204 No Content`.

## `$ws()`

Use `$ws()` for typed persistent connections:

```ts
type ClientMessage = { text: string };
type ServerMessage = { text: string; from: string };

const history: ServerMessage[] = [];

export const getHistory = $server(async () => history);

export const chat = $ws<ClientMessage, ServerMessage, [username: string]>({
  onOpen(ws) {
    ws.send({ text: `Joined ${ws.args[0]}`, from: "system" });
  },
  onMessage(ws, data) {
    const message = { text: data.text, from: ws.args[0] };
    history.push(message);
    chat.send(message);
  },
});
```

Client usage:

```ts
const conn = chat.connect("ada");

conn.onMessage((message) => {
  console.log(message.from, message.text);
});

conn.send({ text: "hello" });
```

Client connections expose:

- `send(data)`
- `onMessage(callback)`
- `onClose(callback)`
- `close(code?, reason?)`
- `readyState`

Server handlers receive `ws.args` from `connect(...args)`. Calling
`chat.send(data)` from a sibling `$server()` or `$ws()` handler in the same file
broadcasts to every open connection for that endpoint.

You can also infer message types by annotating handler parameters:

```ts
export const chat = $ws({
  onMessage(ws: ServerWs<ServerMessage>, data: ClientMessage) {
    ws.send({ text: data.text, from: "server" });
  },
});
```

Leaving handlers unannotated keeps the message types as `unknown`.

## `$worker()`

Use `$worker()` to create a dedicated module worker. The factory runs once
inside the worker, and the returned methods become async client proxies.

```ts
export const counterWorker = $worker(() => {
  let count = 0;

  function increment() {
    count += 1;
    return count;
  }

  function reset() {
    count = 0;
  }

  return { increment, reset };
});
```

```ts
await counterWorker.increment();
await counterWorker.reset();
```

Signature:

```ts
declare function $worker<T extends Record<string, (...args: any[]) => any>>(
  factory: () => T | Promise<T>,
): { [K in keyof T]: (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>> };
```

All returned methods share one worker thread and one closure, so state inside
the factory persists across method calls.

Same-file `$server()` and `$ws()` siblings referenced by a worker are replaced
with client stubs inside the worker module:

```ts
const getItems = $server(async () => db.query("SELECT * FROM items").all());

export const processorWorker = $worker(() => {
  async function names(limit: number) {
    const items = await getItems();
    return items.slice(0, limit).map((item) => item.name);
  }

  return { names };
});
```

## Shared state and sibling references

Top-level state referenced by handlers is emitted into a shared per-file server
scope. Sibling handlers in the same file can call each other and share state:

```ts
let requestCount = 0;

export const countRequest = $server(() => {
  requestCount += 1;
  return requestCount;
});

export const getStatus = $server(async () => {
  return {
    requests: countRequest(),
    uptime: process.uptime(),
  };
});
```

This sharing applies across `$server()` and `$ws()` handlers from the same
source file in dev and production.

## Endpoint names

Endpoint names are deterministic. The plugin takes the source file path
relative to the project root, strips a leading `src/`, removes the extension,
appends an inferred handler label, and kebab-cases every segment:

```txt
src/todos.ts + getTodos -> todos/get-todos
src/admin/users.ts + deleteUser -> admin/users/delete-user
```

Labels usually come from the assigned variable or object property name:

```ts
export const getUser = $server(async () => {});

export const api = {
  saveUser: $server(async () => {}),
};
```

If the plugin cannot infer a natural label, it falls back to a line/column
label. Duplicate endpoint names in the same file get a line/column suffix.
