// Slider hero của index.html — tách ra từ thẻ <script> inline giữa trang.
//
// RÀNG BUỘC VỊ TRÍ: file này đọc .mySlides/.dot/.hero/.hero-scroll và chạy
// render(0) + play() NGAY LÚC PARSE, nên thẻ script phải đứng ngay sau markup
// của hero như cũ. Dời xuống cuối body sẽ làm slide đầu hiện trễ.
// window.currentSlide được gọi từ onclick của các .dot trong HTML.

(function () {
    var slides = document.getElementsByClassName("mySlides");
    var dots = document.getElementsByClassName("dot");
    var slideIndex = 0;
    var timer = null;
    var DELAY = 5000; // tự chuyển 5s/lần

    // Hiển thị slide n: crossfade + Ken Burns qua class .is-active
    function render(n) {
        slideIndex = (n + slides.length) % slides.length;
        for (var i = 0; i < slides.length; i++) {
            slides[i].classList.toggle("is-active", i === slideIndex);
        }
        for (var j = 0; j < dots.length; j++) {
            dots[j].classList.toggle("active", j === slideIndex);
        }
    }

    function next() { render(slideIndex + 1); }

    function play() {
        stop();
        timer = setInterval(next, DELAY);
    }
    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    // Click vào dot: nhảy slide và reset đồng hồ tự chạy
    window.currentSlide = function (n) {
        render(n);
        play();
    };

    render(0);
    play();

    // Tạm dừng khi hover vào hero, chạy lại khi rời chuột
    var hero = document.querySelector(".hero");
    if (hero) {
        hero.addEventListener("mouseenter", stop);
        hero.addEventListener("mouseleave", play);
    }

    // Scroll indicator tự mờ dần khi user cuộn xuống
    var scrollEl = document.querySelector(".hero-scroll");
    if (scrollEl) {
        window.addEventListener("scroll", function () {
            var y = window.scrollY || window.pageYOffset || 0;
            scrollEl.style.opacity = Math.max(0, 1 - y / 240);
        }, { passive: true });
    }
})();
