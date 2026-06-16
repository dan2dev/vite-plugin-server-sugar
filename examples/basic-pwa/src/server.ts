import { Hono } from "hono";
const app = new Hono();

app.get("/custom", (c) => c.text("hello from custom endpoint!"));
let tootlePAss = 0;
app.all("*", (_c, next) => {
  console.log("Request received", tootlePAss);
  // if (tootlePAss > 80) {
  //   c.status(500);
  //   return c.json({ message: "Not found!!!" });
  // }
  tootlePAss++;
  return next();
});

export default app;
