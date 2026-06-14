import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  deps: {
    neverBundle: ['vite', 'typescript', 'rolldown'],
  },
  dts: {
    tsgo: true,
  },
})
