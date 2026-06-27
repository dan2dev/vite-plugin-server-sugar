// ── serverEntry: custom Hono app with middleware and routes ──

import { Hono } from "hono";

const app = new Hono();

app.get("/custom", (c) => c.text("Custom Hono endpoint"));

app.all("*", (_c, next) => {
	// return new Response("helloe", { status: 200 });
	return next();
});

export default app;
