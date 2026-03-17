import { createProxyApp } from './proxy-app.mjs'

const app = createProxyApp()
const port = Number(process.env.PORT ?? 8788)

app.listen(port, () => {
  console.log(`FCC proxy listening on http://0.0.0.0:${port}`)
})
