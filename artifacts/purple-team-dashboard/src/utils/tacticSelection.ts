export function tacticNames(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : value.split(","))
    .map(name => name.trim())
    .filter(Boolean);
}

/**
 * Multi-tactic techniques are excluded when any of their mapped tactics is
 * disabled. This prevents a disabled tactic from leaking into another view
 * through a technique that also belongs to an enabled tactic.
 */
export function tacticsAreEnabled(
  value: string | string[],
  disabledTactics: ReadonlySet<string>,
): boolean {
  return tacticNames(value).every(name => !disabledTactics.has(name));
}
