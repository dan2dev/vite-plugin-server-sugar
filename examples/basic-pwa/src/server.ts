// ── serverEntry: custom Hono app with middleware and routes ──

import { Hono } from "hono";

const app = new Hono();

app.get("/custom", (c) => c.text("Custom Hono endpoint"));

app.all("*", (_c, next) => {
	return next();
});

export default app;
