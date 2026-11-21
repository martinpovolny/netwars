// Single-player run state: lives and the pod-rescue score bonus. Pure (no DOM,
// no THREE) so it can be unit-tested. Kill points stay in world.score (the
// shared sim is untouched); the displayed/submitted total is
// world.score + run.bonusScore.
export const LIVES = 3;
export const POD_BONUS = 500;

export class Run {
  constructor() {
    this.lives = LIVES;
    this.bonusScore = 0;
  }

  // A level was cleared: bonus for every pod still alive (scaled by the level
  // number) plus an extra life, uncapped. Returns the bonus awarded.
  levelCleared(level, podsAlive) {
    const bonus = POD_BONUS * level * podsAlive;
    this.bonusScore += bonus;
    this.lives += 1;
    return bonus;
  }

  loseLife() {
    this.lives = Math.max(0, this.lives - 1);
  }

  get isOver() {
    return this.lives === 0;
  }
}
