import adapter from "@sveltejs/adapter-static";
import { type Config } from "@sveltejs/kit/vite";

/** GitHub Pages serves the app under a sub-path, given by `BASE_PATH` at build time. */
const dev = process.argv.includes("dev");
const base = dev ? "" : (process.env.BASE_PATH ?? "");

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
	// Sent as a meta tag, GitHub Pages having no headers to set: `frame-ancestors`
	// and `sandbox` are ignored there. Styles stay inline for SvelteFlow's nodes.
	csp: {
		mode: "hash",
		directives: {
			"default-src": ["self"],
			"script-src": ["self"],
			"style-src": ["self", "unsafe-inline"],
			"img-src": ["self", "blob:", "data:"],
			"media-src": ["self", "blob:"],
			"font-src": ["self", "data:"],
			"worker-src": ["self", "blob:"],
			// In development, core's `stdlib:build` serves the project to lay out.
			"connect-src": ["self", "blob:", ...(dev ? (["http://localhost:*"] as const) : [])],
			"object-src": ["none"],
			"base-uri": ["none"],
			"form-action": ["none"],
		},
	},
};
