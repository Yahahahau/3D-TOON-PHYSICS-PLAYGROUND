/** Text stats panel for Physics Debug mode (pointer-events: none, never blocks play). */
export class DebugOverlay {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'debug-stats';
    root.appendChild(this.el);
    this.visible = false;
    this.acc = 0;
  }

  setVisible(v) {
    this.visible = v;
    this.el.classList.toggle('show', v);
  }

  update(dt, stats) {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    this.el.innerHTML =
      `FPS        ${stats.fps.toFixed(0)}  (${stats.ms.toFixed(1)} ms)\n` +
      `Draw calls ${stats.calls}\n` +
      `Triangles  ${(stats.triangles / 1000).toFixed(1)}k\n` +
      `Objects    ${stats.objects}\n` +
      `Bodies     ${stats.bodies}  (awake ${stats.awake})\n` +
      `Contacts   ${stats.contacts}\n` +
      `Particles  ${stats.particles} / ${stats.particleBudget}\n` +
      `Decals     ${stats.decals}\n` +
      `Quality    ${stats.quality}  ×${stats.pixelRatio.toFixed(2)} px\n` +
      `Buffer     ${stats.buffer}\n` +
      `A ${stats.a}\nB ${stats.b}` +
      `<div class="debug-legend"><i style="background:#ff4fa3"></i>char<i style="background:#38e08a"></i>dynamic<i style="background:#8a94a8"></i>sleep<i style="background:#ffa938"></i>kinematic<i style="background:#6c8cff"></i>static<i style="background:#ffe066"></i>AABB<i style="background:#ff3b3b"></i>velocity</div>`;
  }
}
