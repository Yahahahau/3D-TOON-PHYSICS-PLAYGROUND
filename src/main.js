import './ui/styles.css';
import { detectWebGL, showFatalError } from './core/webgl.js';

async function boot() {
  const support = detectWebGL();
  if (!support.ok) {
    showFatalError(support.reason, support.error);
    return;
  }
  try {
    const { Game } = await import('./core/Game.js');
    const game = new Game({
      canvas: document.getElementById('game-canvas'),
      uiRoot: document.getElementById('ui-root'),
    });
    game.start();
    window.__game = game; // handy for debugging from the console
    requestAnimationFrame(() => document.getElementById('loading')?.classList.add('hidden'));
  } catch (err) {
    console.error(err);
    showFatalError('error', err);
  }
}

boot();
