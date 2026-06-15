import { useState, useEffect } from "react";
import "./App.css";
import {
  getTodos,
  addTodo,
  toggleTodo,
  deleteTodo,
  getSomeData,
} from "./todos";
import type { Todo } from "./todos";

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [state, setState] = useState<{ count: number }>({
    count: 0,
  });

  useEffect(() => {
    Promise.all([
      getTodos().then(setTodos),
      getSomeData().then(setState),
    ]).finally(() => {
      setLoading(false);
    });
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setAdding(true);
    const todo = await addTodo(text);
    setTodos((prev) => [todo, ...prev]);
    setInput("");
    setAdding(false);
  }

  async function handleToggle(id: number) {
    await toggleTodo(id);
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: t.done ? 0 : 1 } : t)),
    );
  }

  async function handleDelete(id: number) {
    await deleteTodo(id);
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <section id="center">
      <h1>Todos</h1>

      <form onSubmit={handleAdd} className="todo-form">
        <h2>{state.count} </h2>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What needs to be done?"
          className="todo-input"
          disabled={adding}
        />
        <button
          type="submit"
          className="todo-add"
          disabled={adding || !input.trim()}
        >
          Add
        </button>
      </form>

      {loading ? (
        <p className="todo-empty">Loading...</p>
      ) : todos.length === 0 ? (
        <p className="todo-empty">No todos yet. Add one above!</p>
      ) : (
        <ul className="todo-list">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={`todo-item${todo.done ? " done" : ""}`}
            >
              <button
                className="todo-check"
                onClick={() => handleToggle(todo.id)}
                aria-label={todo.done ? "Mark undone" : "Mark done"}
              >
                {todo.done ? "✓" : ""}
              </button>
              <span className="todo-text">{todo.text}</span>
              <button
                className="todo-delete"
                onClick={() => handleDelete(todo.id)}
                aria-label="Delete todo"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default App;
