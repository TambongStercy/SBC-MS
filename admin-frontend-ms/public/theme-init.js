// Theme class on <html> before the first paint (no flash); see src/contexts/ThemeContext.tsx.
// A file rather than an inline script, so a Content-Security-Policy can forbid inline scripts.
// Default is dark: the original admin pages are drawn dark (bg-gray-800/900).
(function () {
  var pref = 'dark';
  try {
    var v = localStorage.getItem('sbc-admin-theme');
    if (v === 'light' || v === 'dark' || v === 'system') pref = v;
  } catch (e) { /* storage blocked: default */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
})();
