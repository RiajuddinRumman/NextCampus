export function hasPatchValues(dto: object): boolean {
  const values = Object.values(dto as Record<string, unknown>);
  return values.some((value) => value != null);
}
