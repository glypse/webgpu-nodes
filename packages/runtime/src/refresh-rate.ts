/**
 * The display's refresh rate in Hz, from the median time between `frames`
 * animation frames. Animation frames slow down while the GPU falls behind,
 * so this only holds when measured with little else drawing.
 */
export function measureRefreshRate(frames = 20): Promise<number> {
	return new Promise((resolve) => {
		const stamps: number[] = [];
		const tick = (timestamp: number) => {
			stamps.push(timestamp);
			if (stamps.length <= frames) {
				requestAnimationFrame(tick);
				return;
			}
			const intervals = stamps
				.slice(1)
				.map((stamp, i) => stamp - (stamps[i] ?? stamp))
				.sort((a, b) => a - b);
			resolve(1000 / (intervals[Math.floor(intervals.length / 2)] ?? 1000 / 60));
		};
		requestAnimationFrame(tick);
	});
}
