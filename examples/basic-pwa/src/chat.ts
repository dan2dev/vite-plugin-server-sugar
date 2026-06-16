// Demonstrates websocket(), sharing module-level state with a sibling
// backend() handler from the same file (the connected sockets / history
// below are a single shared instance across both handler kinds).
const connections = new Set<ServerWebSocket>();
const history: string[] = [];

export const getChatHistory = backend(async () => history);

export const chat = websocket({
  onOpen(ws) {
    connections.add(ws);
  },
  onMessage(_ws, data) {
    const message = String(data);
    history.push(message);
    for (const conn of connections) {
      conn.send({ message });
    }
  },
  onClose(ws) {
    connections.delete(ws);
  },
});
