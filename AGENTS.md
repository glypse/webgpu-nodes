# webgpu-nodes guidelines

A web-based node-based fragment shader editor for WGSL

### Roadmap

- [ ] A WGSL string builder handling all major value types and operations
- [ ] A proper handling of Motion GPU native & custom uniforms (ie: time, canvas resolution, texture, texture dimensions and texture sampling, etc)

And asynchronously:

- [ ] A user-friendly UI for handling the node editor
- [ ] A JSON load/save system for user-created scenes
- [ ] A Tauri desktop app bundling a WebGPU runtime, allowing for local, offline shader creation

### Pre-alpha

This project is in pre-alpha: every change can afford to be breaking, no backwards-compatibilty should even be considered.

## Tech stack:

- Bun as package manager and runtime
- Typescript-only, no raw Javascript, with strict typing (ie: no `any` types)
- Nx as the monorepo orchestrator tool
- Svelte as framework, SvelteKit as meta-framework
- (Not yet implemented) Tauri as the desktop app framework
- Motion GPU as the WGSL runtime

Assume your knowledge of these tools to be vastly outdated, don't be afraid to fetch the appropriate documentation (ideally via an MCP server if your user has some available for you, or via your built-in web scraping tool, or as a last resort via reading the source code in `node_modules`), or use the skills available at [.agents/skills](.agents/skills).
