import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { serverBuildPlugin } from 'vite-plugin-server-build'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    serverBuildPlugin({ port: 3001, serverEntry: 'src/server.ts' }),
  ],
})
