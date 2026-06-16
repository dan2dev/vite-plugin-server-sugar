import { Hono } from "hono";
const app = new Hono();

app.get("/custom", (c) => c.text("hello from custom endpoint!"));
let tootlePAss = 0;
app.all("*", (_c, next) => {
  console.log("Request received");
  if (tootlePAss > 30) {
    return new Response("Not found!!!", { status: 404 });
  }
  tootlePAss++;
  return next();
});

export default app;
