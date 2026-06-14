import { Hono } from 'hono'
const app = new Hono()

app.get('/custom', (c) => c.text('hello from custom endpoint!'))

export default app
