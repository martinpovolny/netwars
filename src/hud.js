import { ENEMY_TYPES } from './levels.js';

export class HUD {
  constructor() {
    this.score = document.getElementById('score');
    this.missiles = document.getElementById('missiles');
    this.vel = document.getElementById('vel-fill');
    this.shd = document.getElementById('shd-fill');
    this.msg = document.getElementById('msg');
    this.dead = document.getElementById('dead');
    this.help = document.getElementById('help');
    this.obj = document.getElementById('obj');
    this.podsEl = document.getElementById('pods');
    this.intent = document.getElementById('intent');
    this.mouse = document.getElementById('mouse');
    this.boost = document.getElementById('boost');
    this.axisLabel = document.getElementById('axis-label');
    this.radarLabel = document.getElementById('radar-label');
    this._flash = 0;
    this._helpT = 0;
  }

  hideHelp() { this.help.classList.add('hidden'); this._helpT = 0; }

  // show the key list for a few seconds (H)
  showHelp(seconds = 4) {
    this.help.classList.remove('hidden');
    this._helpT = seconds;
  }

  flash(text, hold = 1.8) {
    this.msg.textContent = text;
    this.msg.style.opacity = '1';
    this._flash = hold;
  }

  // position the inset labels to sit against the WebGL viewports
  layout(orient, radar) {
    this.axisLabel.style.left = orient.left + 'px';
    this.axisLabel.style.top = (orient.top + orient.h + 4) + 'px';
    this.radarLabel.style.right = radar.right + 'px';
    this.radarLabel.style.bottom = (radar.bottom + radar.h + 6) + 'px';
  }

  update(dt, player, enemies, pods, score, radar) {
    this.score.textContent = String(score).padStart(6, '0');
    this.missiles.textContent = player.missiles;
    this.vel.style.height = Math.min(100, 100 * player.speed() / player.maxSpeed) + '%';
    this.shd.style.height = (100 * player.hull / player.maxHull) + '%';
    this.dead.style.display = player.alive ? 'none' : 'block';

    // reticle: deployed intent marker + raw mouse cursor
    const maxX = window.innerWidth * 0.34;
    const maxY = window.innerHeight * 0.34;
    this.intent.style.transform = `translate(${player.intent.x * maxX}px, ${player.intent.y * maxY}px)`;
    this.mouse.style.transform = `translate(${player.mouse.x * maxX}px, ${player.mouse.y * maxY}px)`;
    this.boost.classList.toggle('on', player.boosting && player.thrusting !== 0);

    const parts = [`Level ${enemies.level}`];
    for (const k of Object.keys(enemies.goals)) {
      if (enemies.goals[k] > 0) parts.push(`${ENEMY_TYPES[k].name}×${enemies.goals[k]}`);
    }
    this.obj.textContent = parts.join('   ');

    if (radar && this.radarLabel) {
      this.radarLabel.textContent = `Scanner  Z${radar.zoomLevel}/${radar.maxZoom} · ${radar.range}`;
    }

    if (this.podsEl) {
      this.podsEl.textContent = `Pods ${pods.alive}/${pods.total}`;
      this.podsEl.classList.toggle('crit', pods.alive <= 2);
    }

    if (this._flash > 0) {
      this._flash -= dt;
      if (this._flash <= 0) this.msg.style.opacity = '0';
    }
    if (this._helpT > 0) {
      this._helpT -= dt;
      if (this._helpT <= 0) this.help.classList.add('hidden');
    }
  }
}
