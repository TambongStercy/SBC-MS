// Theme class on <html> before the first paint (no flash); see src/contexts/ThemeContext.tsx.
// A file rather than an inline script, so the Content-Security-Policy can forbid inline scripts.
(function () {
  var pref = 'system';
  try {
    var v = localStorage.getItem('sbc-support-theme');
    if (v === 'light' || v === 'dark' || v === 'system') pref = v;
  } catch (e) { /* storage blocked: default */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
})();
