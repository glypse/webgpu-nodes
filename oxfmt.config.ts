import { defineConfig } from "oxfmt";

export default defineConfig({
	printWidth: 100,
	tabWidth: 4,
	useTabs: true,
	sortImports: true,
	sortTailwindcss: true,
	svelte: true,
	ignorePatterns: ["**/CHANGELOG.md", ".changeset/*.md", ".agents", "**/static/"],
});
