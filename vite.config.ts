import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // This repository is published under this path.
  base: "/noor-prayer-companion/",
  plugins: [react()],
  server: { host: "0.0.0.0" },
});
