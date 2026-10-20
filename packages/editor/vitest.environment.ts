import type { Environment } from "vitest/runtime";

/**
 * Node, but with modules transformed for the browser: Svelte compiles runes
 * to its client runtime there, so effects run in tests (its server output
 * skips them).
 */
const environment: Environment = {
	name: "svelte-client",
	viteEnvironment: "client",
	setup: () => ({ teardown: () => undefined }),
};

export default environment;
