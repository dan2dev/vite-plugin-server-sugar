import { useState, useEffect, useRef } from "react";
import "./App.css";
import {
  getTodos,
  addTodo,
  toggleTodo,
  deleteTodo,
  getSomeData,
} from "./todos";
import type { Todo } from "./todos";
import { chat, getChatHistory } from "./chat";

const globalState = {
  count1: 0,
  get name() {
    console.log("globalState getName", this.count1);
    return "danilo2";
  },
};

const getSomeData2 = $action(async () => {
  globalState.count1 += 1;
  return {
    count: globalState.count1,
    name: globalState.name,
  };
});

function Chat() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const connRef = useRef<ReturnType<typeof chat.connect> | undefined>(
    undefined,
  );

  useEffect(() => {
    getChatHistory().then(setMessages);
    const conn = chat.connect();
    connRef.current = conn;
    conn.onMessage(({ message }) => {
      setMessages((prev) => [...prev, message]);
    });
    return () => conn.close();
  }, []);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    connRef.current?.send({ message: text, name: "server" });
    setInput("");
  }

  return (
    <section id="chat">
      <h2>Chat</h2>
      <ul className="todo-list">
        {messages.map((message, i) => (
          <li key={i} className="todo-item">
            {message}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSend} className="todo-form">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Say something..."
          className="todo-input"
        />
        <button type="submit" className="todo-add">
          Send
        </button>
      </form>
    </section>
  );
}

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [state, setState] = useState<{ count: number; name: string }>({
    count: 0,
    // name: '',
    name: globalState.name,
  });

  useEffect(() => {
    Promise.all([
      getTodos().then(setTodos),
      getSomeData().then(setState),
      getSomeData2().then(setState),
    ]).finally(() => {
      setLoading(false);
    });
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setAdding(true);
    const todo = await addTodo(text, Date.now().toString());
    setTodos((prev) => [todo, ...prev]);
    setInput("");
    setAdding(false);
  }

  async function handleToggle(id: number) {
    const result = await toggleTodo(id).catch((e) => {
      return e;
    });
    console.log(result);
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
        <h2>
          {state.count} - {state.name}
        </h2>
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

      <Chat />
    </section>
  );
}

export default App;
