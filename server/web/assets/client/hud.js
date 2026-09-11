import { ENEMY_TYPES } from './levels.js';

export class HUD {
  constructor() {
    this.score = document.getElementById('score');
    this.missiles = document.getElementById('missiles');
    this.vel = document.getElementById('vel-fill');
    this.msg = document.getElementById('msg');
    this.dead = document.getElementById('dead');
    this.deadSub = document.getElementById('dead-sub');
    this.help = document.getElementById('help');
    this.obj = document.getElementById('obj');
    this.podsEl = document.getElementById('pods');
    this.board = document.getElementById('board');
    this.net = document.getElementById('net');
    this.intent = document.getElementById('intent');
    this.mouse = document.getElementById('mouse');
    this.boost = document.getElementById('boost');
    this.axisLabel = document.getElementById('axis-label');
    this.radarLabel = document.getElementById('radar-label');
    this.hitFlash = document.getElementById('hit-flash');
    this.hpbar = document.getElementById('hpbar');
    this.hpbarFill = document.getElementById('hpbar-fill');
    this.lock = document.getElementById('lock');
    this.msl = document.getElementById('msl');
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

  update(dt, player, enemies, pods, score, radar, lock) {
    this.score.textContent = String(score).padStart(6, '0');
    this.missiles.textContent = player.missiles;
    this.vel.style.height = Math.min(100, 100 * player.speed() / player.maxSpeed) + '%';

    // hull: a top bar that only shows when damaged (+ the hit vignette)
    const hp = player.hull / player.maxHull;
    const damaged = player.alive && hp < 0.999;
    this.hpbar.style.display = damaged ? 'block' : 'none';
    if (damaged) {
      this.hpbarFill.style.width = (100 * Math.max(0, hp)) + '%';
      this.hpbar.classList.toggle('warn', hp < 0.55 && hp >= 0.28);
      this.hpbar.classList.toggle('crit', hp < 0.28);
    }

    // red damage vignette
    if (this.hitFlash) this.hitFlash.style.opacity = (player.hitPulse * 0.9).toFixed(3);

    const dm = !!(lock && lock.dm);

    this.dead.style.display = player.alive ? 'none' : 'block';
    if (!player.alive && this.deadSub) {
      this.deadSub.textContent = dm
        ? 'FRAGGED — respawning'
        : `Level ${enemies.level}   Score ${String(score).padStart(6, '0')}`;
    }

    // reticle: deployed intent marker + raw mouse cursor
    const maxX = window.innerWidth * 0.34;
    const maxY = window.innerHeight * 0.34;
    this.intent.style.transform = `translate(${player.intent.x * maxX}px, ${player.intent.y * maxY}px)`;
    this.mouse.style.transform = `translate(${player.mouse.x * maxX}px, ${player.mouse.y * maxY}px)`;
    this.boost.classList.toggle('on', player.boosting && player.thrusting !== 0);

    // missile lock ring + in-flight indicator
    if (this.lock) this.lock.classList.toggle('locked', player.alive && !!(lock && lock.locked));
    if (this.msl) {
      this.msl.className = '';
      if (lock && lock.missileActive) {
        this.msl.classList.add(lock.missileGuided ? 'guided' : 'ballistic');
        this.msl.textContent = lock.missileGuided ? 'Msl ▸ Guided' : 'Msl ▸ Ballistic';
      }
    }

    const escName = (s) => String(s).slice(0, 16).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

    if (dm) {
      // deathmatch: the top HUD is a frag scoreboard, not level objectives
      this.obj.style.display = 'none';
      if (this.podsEl) this.podsEl.style.display = 'none';
      if (this.board) {
        this.board.style.display = 'block';
        this.board.innerHTML = '<div class="btitle">FRAGS</div>' + (lock.board || [])
          .map((r) => `<div class="brow${r.id === lock.selfId ? ' me' : ''}${r.a ? '' : ' out'}"><span>${escName(r.n)}</span><span class="frag">${r.f | 0}</span></div>`)
          .join('');
      }
    } else {
      this.obj.style.display = '';
      if (this.podsEl) this.podsEl.style.display = '';
      const parts = [`Level ${enemies.level}`];
      for (const k of Object.keys(enemies.goals)) {
        if (enemies.goals[k] > 0) parts.push(`${ENEMY_TYPES[k].name}×${enemies.goals[k]}`);
      }
      this.obj.textContent = parts.join('   ');

      // co-op: a standing roster — who's connected + their shield/hull %
      const roster = lock && lock.online ? lock.roster : null;
      if (this.board && roster && roster.length) {
        this.board.style.display = 'block';
        this.board.innerHTML = `<div class="btitle">PLAYERS ${roster.length}</div>` + roster
          .map((r) => {
            const pct = Math.max(0, Math.round(100 * (r.hull / (r.maxHull || 1))));
            const cls = r.id === lock.selfId ? ' me' : '';
            const hpCls = !r.a ? ' out' : pct < 28 ? ' crit' : pct < 55 ? ' warn' : '';
            return `<div class="brow${cls}"><span>${escName(r.n)}</span><span class="hp${hpCls}">${r.a ? pct + '%' : 'OUT'}</span></div>`;
          })
          .join('');
      } else if (this.board) {
        this.board.style.display = 'none';
      }
      if (this.podsEl) {
        this.podsEl.textContent = `Pods ${pods.alive}/${pods.total}`;
        this.podsEl.classList.toggle('crit', pods.alive <= 2);
      }
    }

    if (radar && this.radarLabel) {
      this.radarLabel.textContent = `Scanner  Z${radar.zoomLevel}/${radar.maxZoom} · ${radar.range}`;
    }

    if (this.net) this.net.textContent = lock && lock.rtt ? `RTT ${Math.round(lock.rtt)} ms` : '';

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
