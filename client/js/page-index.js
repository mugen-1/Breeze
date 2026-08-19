// Script riêng của index.html — tách ra từ thẻ <script> inline cuối trang.
// LƯU Ý: index.html KHÔNG có sidebar lọc nào, không chỗ nào gọi toggleFilter.
// Giữ nguyên theo đúng bản cũ, chưa xoá.

function toggleFilter(heading) {
    heading.classList.toggle('collapsed');
    var list = heading.nextElementSibling;
    if (list) {
        list.style.display = list.style.display === 'none' ? '' : 'none';
    }
}
