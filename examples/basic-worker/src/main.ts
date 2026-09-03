import "./style.css";
import { addTodo, deleteTodo, listTodos, toggleTodo, todoCount, type Todo } from "./todos";
import { getCount, increment, resetCount } from "./counter";
import { getHealth, ping } from "./health";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main>
    <h1>basic-worker</h1>
    <p>
      <code>vite-plugin-server-sugar</code> targeting
      <code>platform: "cloudflare-worker"</code>. Every call below still goes
      through the same <code>$server()</code>/<code>$get()</code> macros as
      the default Bun output &mdash; only the production target changes. Run
      <code>npm run build</code> and look under <code>dist/server/</code> to
      see the generated Worker modules and <code>wrangler.toml</code> files.
    </p>

    <section>
      <h2>Todos <small>persisted in a local or deployed Cloudflare D1 database</small></h2>
      <form id="todo-form">
        <input id="todo-text" placeholder="What needs doing?" required />
        <button type="submit">Add</button>
      </form>
      <ul id="todo-list"></ul>
      <p id="todo-count"></p>
    </section>

    <section>
      <h2>Counter <small>a second, separate Worker: increment/resetCount/getCount share "count"</small></h2>
      <p id="counter-value">&hellip;</p>
      <button id="increment">+1</button>
      <button id="reset">Reset</button>
    </section>

    <section>
      <h2>Health <small>two more independent Workers: getHealth and ping share nothing</small></h2>
      <button id="health">getHealth()</button>
      <button id="ping">ping()</button>
      <pre id="health-output"></pre>
    </section>
  </main>
`;

// ── Todos ──

const todoList = document.querySelector<HTMLUListElement>("#todo-list")!;
const todoCountEl = document.querySelector<HTMLParagraphElement>("#todo-count")!;
const todoForm = document.querySelector<HTMLFormElement>("#todo-form")!;
const todoText = document.querySelector<HTMLInputElement>("#todo-text")!;

function renderTodo(todo: Todo): string {
  return `
    <li>
      <label>
        <input type="checkbox" data-id="${todo.id}" ${todo.done ? "checked" : ""} />
        <span style="text-decoration: ${todo.done ? "line-through" : "none"}">${todo.text}</span>
      </label>
      <button type="button" data-delete="${todo.id}" aria-label="Delete">&times;</button>
    </li>
  `;
}

async function refreshTodos(): Promise<void> {
  // `todoCount`'s query type ({ done?: string }) is a specific shape, not
  // the fully-generic Record<string, string>, so the client stub requires
  // the query object even though `done` itself is optional within it.
  const [todos, { count }] = await Promise.all([listTodos(), todoCount({})]);
  todoList.innerHTML = todos.map(renderTodo).join("");
  todoCountEl.textContent = `${count} total`;
}

todoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = todoText.value.trim();
  if (!text) return;
  await addTodo({ text });
  todoText.value = "";
  await refreshTodos();
});

todoList.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;

  const deleteId = target.dataset.delete;
  if (deleteId) {
    await deleteTodo({ id: deleteId });
    await refreshTodos();
    return;
  }

  if (target instanceof HTMLInputElement && target.dataset.id) {
    await toggleTodo({ id: Number(target.dataset.id) });
    await refreshTodos();
  }
});

void refreshTodos();

// ── Counter ──

const counterValue = document.querySelector<HTMLParagraphElement>("#counter-value")!;

async function refreshCounter(): Promise<void> {
  counterValue.textContent = String(await getCount());
}

document.querySelector("#increment")!.addEventListener("click", async () => {
  await increment();
  await refreshCounter();
});

document.querySelector("#reset")!.addEventListener("click", async () => {
  await resetCount();
  await refreshCounter();
});

void refreshCounter();

// ── Health ──

const healthOutput = document.querySelector<HTMLPreElement>("#health-output")!;

document.querySelector("#health")!.addEventListener("click", async () => {
  healthOutput.textContent = JSON.stringify(await getHealth(), null, 2);
});

document.querySelector("#ping")!.addEventListener("click", async () => {
  healthOutput.textContent = JSON.stringify(await ping(), null, 2);
});
