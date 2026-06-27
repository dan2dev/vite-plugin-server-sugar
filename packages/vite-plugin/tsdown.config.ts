import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/rollup.ts', 'src/rolldown.ts'],
  deps: {
    neverBundle: ['vite', 'typescript', 'rolldown'],
  },
  dts: {
    tsgo: true,
  },
})
