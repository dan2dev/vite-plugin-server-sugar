// ── $worker: shared closure state, calling $server from inside a worker ──

import {getTodos} from "./todos";
import {getChatHistory} from "./chat";

export interface WorkerStats {
    totalTodos: number;
    doneTodos: number;
    pendingTodos: number;
    chatMessages: number;
    processedAt: number;
}

export const demoWorker = $worker(() => {
    let callCount = 0;

    async function computeStats(): Promise<WorkerStats> {
        callCount++;
        const [todos, messages] = await Promise.all([getTodos(), getChatHistory()]);
        const doneTodos = todos.filter((t) => t.done).length;
        return {
            totalTodos: todos.length,
            doneTodos,
            pendingTodos: todos.length - doneTodos,
            chatMessages: messages.length,
            processedAt: Date.now(),
        };
    }

    function computeFibonacci(n: number): number {
        callCount++;

        function fib(x: number): number {
            if (x <= 1) return x;
            return fib(x - 1) + fib(x - 2);
        }

        return fib(n);
    }

    function getCallCount(): number {
        return callCount;
    }

    return {computeStats, computeFibonacci, getCallCount};
});
