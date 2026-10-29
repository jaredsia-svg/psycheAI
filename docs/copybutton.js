// A button that copies the text of the element it names (data-copy="<id>"),
// for the install prompt on /muse. Without script the prompt still selects in
// one tap (.paste), so nothing depends on this.
(function () {
  'use strict';
  document.querySelectorAll('button[data-copy]').forEach(function (button) {
    var label = button.textContent;
    button.addEventListener('click', function () {
      var source = document.getElementById(button.getAttribute('data-copy'));
      if (!source) return;
      var text = source.textContent;
      var done = function () {
        button.textContent = button.getAttribute('data-done') || 'Copied';
        setTimeout(function () { button.textContent = label; }, 2200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { selectAll(source); });
      } else selectAll(source);
    });
  });
  function selectAll(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
})();
