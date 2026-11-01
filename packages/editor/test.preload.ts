import { plugin } from "bun";
import { compileModule } from "svelte/compiler";

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Compiles runes in `.svelte.ts` modules (and their tests) for Svelte's client
 * runtime, resolved through the `browser` condition, so effects run in tests:
 * its server output skips them.
 */
plugin({
	name: "svelte-modules",
	setup(build) {
		build.onLoad({ filter: /\.svelte\.(test\.)?ts$/ }, async ({ path }) => {
			const source = transpiler.transformSync(await Bun.file(path).text());
			const { js } = compileModule(source, { filename: path, generate: "client" });
			return { contents: js.code, loader: "js" };
		});
	},
});
