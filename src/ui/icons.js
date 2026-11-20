const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>'),
  play: svg('<path d="M8 5.5l10 6.5-10 6.5z"/>'),
  reset: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v5h5"/>'),
  respawn: svg('<path d="M12 3v9"/><path d="M8.5 8.5L12 12l3.5-3.5"/><ellipse cx="12" cy="18.5" rx="7.5" ry="2.6"/>'),
  chars: svg('<circle cx="9" cy="11" r="5.5"/><circle cx="17" cy="14.5" r="4"/><circle cx="7.6" cy="10.4" r="0.6"/><circle cx="10.6" cy="10.4" r="0.6"/>'),
  arena: svg('<rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><rect x="8" y="3.5" width="8" height="8" rx="1.5"/>'),
  debug: svg('<path d="M12 2.8l8.5 4.7v9L12 21.2l-8.5-4.7v-9z"/><path d="M12 21V12M20.5 7.5L12 12 3.5 7.5"/>'),
  settings: svg('<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
