(function () {
  var stage = document.querySelector(".stage") || document.body;
  var burger = document.getElementById("burger");
  var menu = document.getElementById("menu");
  if (!burger || !menu) return;

  function setOpen(open) {
    stage.classList.toggle("is-open", open);
    document.body.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.setAttribute("aria-hidden", open ? "false" : "true");
  }

  burger.addEventListener("click", function () {
    setOpen(!stage.classList.contains("is-open") && !document.body.classList.contains("is-open"));
  });
  menu.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setOpen(false);
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth / window.innerHeight > 1.1) setOpen(false);
  });
})();
