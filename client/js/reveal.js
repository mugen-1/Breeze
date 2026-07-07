/* Reveal-on-scroll: phần tử .reveal fade-up khi lọt vào viewport (chỉ chạy 1 lần).
   Không phụ thuộc cart / i18n / firebase. */
(function () {
    function run() {
        var els = document.querySelectorAll('.reveal');
        if (!els.length) return;

        var reduce = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Không hỗ trợ IntersectionObserver hoặc user tắt hiệu ứng → hiện ngay
        if (reduce || !('IntersectionObserver' in window)) {
            for (var i = 0; i < els.length; i++) els[i].classList.add('in');
            return;
        }

        var io = new IntersectionObserver(function (entries, obs) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('in');
                    obs.unobserve(entry.target); // chỉ chạy 1 lần
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

        els.forEach(function (el) { io.observe(el); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
