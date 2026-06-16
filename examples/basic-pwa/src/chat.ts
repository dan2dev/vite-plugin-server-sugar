// Demonstrates websocket(), sharing module-level state with a sibling
// backend() handler from the same file (the connected sockets / history
// below are a single shared instance across both handler kinds).
const connections = new Set<ServerWebSocket>();
const history: string[] = [];

export const getChatHistory = backend(async () => {
  chat.send({ message: "someone requested chat history" });
  return history;
});

export const chat = websocket({
  onOpen(ws) {
    connections.add(ws);
  },
  onMessage(ws, data) {
    console.log(ws);
    const message = String(data);
    console.log(`-------------onMessage`);
    console.log(data);
    history.push(message);
    for (const conn of connections) {
      conn.send({ message });
    }
  },
  onClose(ws) {
    connections.delete(ws);
  },
});
