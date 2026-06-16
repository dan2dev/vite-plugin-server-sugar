import { Hono } from "hono";
const app = new Hono();

app.get("/custom", (c) => c.text("hello from custom endpoint!"));
let tootlePAss = 0;
app.all("*", (c, next) => {
  console.log("Request received");
  if (tootlePAss > 70) {
    return c.json({ message: "Not found!!!" }, 404);
  }
  tootlePAss++;
  return next();
});

export default app;
