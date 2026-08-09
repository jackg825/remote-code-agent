import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          ACCESS_AUD: "test-audience",
          ACCESS_TEAM_DOMAIN: "https://test-team.cloudflareaccess.com",
          ORIGIN_URL: "https://terminal-origin.invalid",
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/worker.spec.ts"],
  },
});
