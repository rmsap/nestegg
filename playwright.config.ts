import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const dataDirectory = process.env.NESTEGG_TEST_DATA_DIR;
if (!dataDirectory) throw new Error("Run npm run test:e2e to create an isolated test database.");

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "npm run seed:demo && npm start -- --port 3100",
    env: { NESTEGG_DATA_DIR: dataDirectory, NESTEGG_SECRET_KEY: "", NESTEGG_SCHEDULER: "0" },
    url: baseURL,
    reuseExistingServer: false,
  },
});
