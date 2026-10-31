// Runs in <head>, before the page is drawn. The front page is in the HTML
// itself, visible, so that it can be read without JavaScript: by a search
// engine, an AI crawler or a link preview. A returning reader with a card,
// or one arriving on a link or a gift, is shown something else at once, so
// for them the front page is kept out of sight until app.js has chosen what
// to show (show() takes the class off). A page whose scripts fail still shows
// it after a few seconds rather than nothing.
(function () {
  try {
    var root = document.documentElement;
    var returning = Boolean(localStorage.getItem('psycheai_profile'));
    var arriving = /[?&](c|gift)=/.test(location.search) || /^#(p=|sample)/.test(location.hash);
    if (!returning && !arriving) return;
    root.classList.add('view-pending');
    setTimeout(function () { root.classList.remove('view-pending'); }, 4000);
  } catch (error) { /* storage blocked: the front page shows, as for anyone new */ }
})();
