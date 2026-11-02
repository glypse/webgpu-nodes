/** `std-hash`'s components in [0, 1] for a cell (padded with zeros) and seed. */
export function hash(cell: readonly number[], seed: number): number[] {
	const v = [0, 1, 2, 3].map((i) => (Math.imul(cell[i] ?? 0, 1664525) + 1013904223 + seed) | 0);
	const round = () => {
		v[0] = ((v[0] ?? 0) + Math.imul(v[1] ?? 0, v[3] ?? 0)) | 0;
		v[1] = ((v[1] ?? 0) + Math.imul(v[2] ?? 0, v[0])) | 0;
		v[2] = ((v[2] ?? 0) + Math.imul(v[0], v[1])) | 0;
		v[3] = ((v[3] ?? 0) + Math.imul(v[1], v[2])) | 0;
	};
	round();
	for (let i = 0; i < 4; i++) v[i] = (v[i] ?? 0) ^ ((v[i] ?? 0) >> 16);
	round();
	return v.map((n) => (n & 0x7fffffff) / 2147483647);
}
