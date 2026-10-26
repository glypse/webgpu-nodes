import os from "node:os";
import path from "node:path";

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { config } from "./kit.config.ts";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(config)],
	ssr: {
		// A workspace package: built from source like $editor and $theme, so its
		// exports never come from a stale dist build.
		noExternal: ["$core"],
	},
	server: {
		fs: {
			allow: [path.join(os.homedir(), ".bun", "install", "cache")],
		},
	},
});
