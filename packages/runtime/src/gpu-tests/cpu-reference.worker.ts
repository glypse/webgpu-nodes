import { GraphModel, type Value } from "$core";
import { evaluate, evaluationContext } from "$core/testing";

import type { CpuReferenceReply, CpuReferenceRequest } from "./cpu-reference";

function canvasColor(value: Value): [number, number, number, number] {
	const [x = 0, y = 0, z = 0, w = 1] = value;
	if (value.length >= 4) return [x, y, z, w];
	if (value.length === 3) return [x, y, z, 1];
	if (value.length === 2) return [x, y, 0, 1];
	return [x, x, x, 1];
}

function evaluatePixels({
	project,
	size: { width, height },
	colorSpace,
	frame,
	pixels,
}: CpuReferenceRequest): Float64Array {
	const model = new GraphModel(project);
	const edge = model.root.edgesByTarget.get("out")?.find((e) => e.targetHandle === "color");
	if (!edge) throw new Error("the output has no link into its color");
	const context = evaluationContext(model);
	const values = new Float64Array(pixels.length * 4);
	for (const [i, [x, y]] of pixels.entries()) {
		const value = evaluate(model, edge.source, edge.sourceHandle, colorSpace, [width, height], {
			uv: [(x + 0.5) / width, 1 - (y + 0.5) / height],
			context,
			frame,
		});
		values.set(canvasColor(value), i * 4);
	}
	return values;
}

addEventListener("message", (event: MessageEvent<CpuReferenceRequest>) => {
	let reply: CpuReferenceReply;
	try {
		reply = { values: evaluatePixels(event.data) };
	} catch (error) {
		reply = { error: error instanceof Error ? error.message : String(error) };
	}
	postMessage(reply, { transfer: "values" in reply ? [reply.values.buffer] : [] });
});
