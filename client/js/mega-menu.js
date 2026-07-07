(function () {
    var btn = document.getElementById('mega-btn');
    var menu = document.getElementById('mega-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', function (e) {
        e.preventDefault();
        menu.classList.toggle('open');
        btn.classList.toggle('open');
    });

    document.addEventListener('click', function (e) {
        if (!menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove('open');
            btn.classList.remove('open');
        }
    });

    window.addEventListener('scroll', function () {
        if (menu.classList.contains('open')) {
            menu.classList.remove('open');
            btn.classList.remove('open');
        }
    });
})();
