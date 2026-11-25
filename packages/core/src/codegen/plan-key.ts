import { planPasses, type RenderPlan, type ResourceDecl } from "./plan";

const formatOf = (resource: ResourceDecl | undefined): string =>
	resource && "format" in resource ? resource.format : "";

/**
 * Whatever a compiled plan's pipelines and bind group layouts are made from:
 * two plans with the same key can share the compiled programs, taking the
 * other's sizes, uniforms, iteration counts and frame values by an update.
 *
 * Pass ids are in it, in the order the passes run, because a plan's programs
 * are matched to the passes of its updates by it.
 */
export function planKey(plan: RenderPlan): string {
	const resources = new Map(plan.resources.map((r) => [r.id, r]));
	return JSON.stringify([
		planPasses(plan.passes).map(({ id, program, reads, writes }) => [
			id,
			program.code,
			program.vertexEntry,
			program.fragmentEntry,
			[program.frame.binding, program.frame.size],
			[program.uniforms.binding, program.uniforms.size],
			[program.frameValues.binding, program.frameValues.size],
			writes.map((write) => [write, formatOf(resources.get(write))]),
			reads,
			program.textures.map((t) => [t.binding, t.sampleType, t.source.kind, t.source.id]),
			program.samplers.map((s) => [s.binding, s.filter, s.address]),
		]),
		plan.resources
			.map((r) => [r.id, r.kind, formatOf(r), r.kind === "transient" && r.mips === true])
			.sort(([a], [b]) => String(a).localeCompare(String(b))),
	]);
}
