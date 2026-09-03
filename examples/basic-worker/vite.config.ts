import { defineConfig } from "vite";
import { serverBuildPlugin } from "vite-plugin-server-sugar";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    serverBuildPlugin({
      // The only option that differs from the basic-pwa example: target
      // Cloudflare Workers instead of the default Bun + Hono server.
      //
      // No `serverEntry` here on purpose — mounting a custom app forces every
      // endpoint onto one combined Worker. Leaving it unset is what lets each
      // $server()/HTTP endpoint become its own independent Worker under
      // dist/server/functions/.
      platform: "cloudflare-worker",
    }),
  ],
});
