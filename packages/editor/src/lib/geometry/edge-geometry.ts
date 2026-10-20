/** SvelteFlow's control-point offset for a bezier edge (see @xyflow/system). */
function controlOffset(distance: number, curvature: number): number {
	return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
}

/**
 * Direction (degrees, SVG convention) of a right-to-left bezier edge at its
 * midpoint, where SvelteFlow places labels. Its control points sit
 * horizontally `c` away from both ends, so the tangent at t = 0.5 is
 * proportional to (dx - c, dy).
 */
export function bezierMidpointAngle(
	sourceX: number,
	sourceY: number,
	targetX: number,
	targetY: number,
	curvature = 0.25,
): number {
	const dx = targetX - sourceX;
	const dy = targetY - sourceY;
	const c = controlOffset(dx, curvature);
	return (Math.atan2(dy, dx - c) * 180) / Math.PI;
}
