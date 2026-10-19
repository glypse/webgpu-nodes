import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
