// ── $ws: typed messages, typed connect args, broadcast from sibling $server ──

interface ChatMessage {
	message: string;
}

interface ChatBroadcast {
	message: string;
	sender: string;
}

type ChatSocket = ServerWs<ChatBroadcast, [username: string]>;
const connections = new Set<ChatSocket>();
const history: ChatBroadcast[] = [];

export const getChatHistory = $server(async () => {
	return history;
});

export const announce = $server(async (text: string) => {
	const broadcast: ChatBroadcast = { message: text, sender: "system" };
	history.push(broadcast);
	chat.send(broadcast);
});

export const chat = $ws<ChatMessage, ChatBroadcast, [username: string]>({
	onOpen(ws: ChatSocket) {
		connections.add(ws);
		const [username] = ws.args;
		const broadcast: ChatBroadcast = { message: `${username} joined`, sender: "system" };
		history.push(broadcast);
		for (const conn of connections) {
			conn.send(broadcast);
		}
	},
	onMessage(ws: ChatSocket, data: ChatMessage) {
		const [username] = ws.args;
		const broadcast: ChatBroadcast = { message: data.message, sender: username };
		history.push(broadcast);
		for (const conn of connections) {
			conn.send(broadcast);
		}
	},
	onClose(ws: ChatSocket) {
		connections.delete(ws);
		const [username] = ws.args;
		const broadcast: ChatBroadcast = { message: `${username} left`, sender: "system" };
		history.push(broadcast);
		for (const conn of connections) {
			conn.send(broadcast);
		}
	},
});
