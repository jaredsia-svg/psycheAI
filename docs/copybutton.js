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
      var note = document.getElementById(button.getAttribute('data-done-note') || '');
      var done = function () {
        button.textContent = button.getAttribute('data-done') || 'Copied';
        // A tap on the prompt itself selects it (user-select: all): cleared, so it doesn't sit highlighted.
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (note) note.hidden = false;
        setTimeout(function () { button.textContent = label; if (note) note.hidden = true; }, 4000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { selectAll(source); });
      } else selectAll(source);
    });
  });
  // The prompt itself copies too, on a tap (data-copy-by names its button), so nobody has to aim for the button.
  document.querySelectorAll('[data-copy-by]').forEach(function (node) {
    node.addEventListener('click', function () {
      var button = document.getElementById(node.getAttribute('data-copy-by'));
      if (button) button.click();
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
