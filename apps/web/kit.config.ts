import adapter from "@sveltejs/adapter-static";
import { type Config } from "@sveltejs/kit/vite";

/** GitHub Pages serves the app under a sub-path, given by `BASE_PATH` at build time. */
const base = process.argv.includes("dev") ? "" : (process.env.BASE_PATH ?? "");

/**
 * SvelteKit + Svelte configuration, passed to the `sveltekit` Vite plugin
 * (SvelteKit 3 no longer reads `svelte.config.*`). Shared with ESLint, which
 * needs the same compiler options.
 */
export const config: Config = {
	prebundleSvelteLibraries: true,
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) =>
			filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
	},
	adapter: adapter(),
	paths: {
		base: base as "" | `/${string}`,
	},
};
