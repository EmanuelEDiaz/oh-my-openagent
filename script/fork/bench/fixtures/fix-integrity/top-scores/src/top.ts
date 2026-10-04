export function topScores(scores: number[], n: number): number[] {
  return scores.sort((a, b) => b - a).slice(0, n)
}

export function leaderboard(names: readonly string[], scores: number[]): string[] {
  const best = topScores(scores, 3)
  return best.map((score) => `${names[scores.indexOf(score)]}: ${score}`)
}
