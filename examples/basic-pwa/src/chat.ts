// Demonstrates websocket(), sharing module-level state with a sibling
// backend() handler from the same file (the connected sockets / history
// below are a single shared instance across both handler kinds).

// Client -> server: what a connected client sends over the wire.
interface ChatMessage {
  message: string;
  name: string;
}

// Server -> client: what every connection receives, including broadcasts
// from the sibling getChatHistory() backend() handler below.
interface ChatBroadcast {
  message: string;
  name: string;
}

type ChatSocket = ServerWebSocket<ChatBroadcast>;

const connections = new Set<ChatSocket>();
const history: string[] = [];

export const getChatHistory = backend(async () => {
  chat.send({
    message: "[testing] someone requested chat history",
    name: "server",
  });
  for (const conn of connections) {
    conn.send({ message: "[testing] someone joined", name: "server" });
  }
  return history;
});

export const chat = websocket({
  onOpen(ws: ChatSocket) {
    connections.add(ws);
  },
  onMessage(_ws: ChatSocket, data: ChatMessage) {
    history.push(data.message);
    for (const conn of connections) {
      conn.send(data);
    }
  },
  onClose(ws: ChatSocket) {
    connections.delete(ws);
  },
});
