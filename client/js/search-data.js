const PRODUCTS = [
    // Van Hoc
    { ten: "Giua 2 nhip tho ngay dem", tenGoc: "Giữa 2 nhịp thở ngày đêm", danhmuc: "Văn Học", trang: "ao-nam.html", gia: "105,000đ", anh: "img/hinhanh7.png" },
    { ten: "Yeu minh trong nhung khoang lang", tenGoc: "Yêu mình trong những khoảng lặng", danhmuc: "Văn Học", trang: "ao-nam.html", gia: "75,000đ", anh: "img/hinhanh8.png" },
    { ten: "Duyen dut ganh", tenGoc: "Duyên đứt gánh", danhmuc: "Văn Học", trang: "ao-nam.html", gia: "115,000đ", anh: "img/hinhanh9.png" },
    { ten: "Ba chi em", tenGoc: "Ba chị em", danhmuc: "Văn Học", trang: "ao-nam.html", gia: "95,000đ", anh: "img/hinhanh100.png" },
    { ten: "Tham vong", tenGoc: "Tham vọng", danhmuc: "Văn Học", trang: "ao-nam.html", gia: "159,000đ", anh: "img/hinhanh11.png" },
    { ten: "Neu biet tram nam la huu han", tenGoc: "Nếu biết trăm năm là hữu hạn", danhmuc: "Văn Học", trang: "ao-nam.html", gia: "239,000đ", anh: "img/hinhanh12.png" },

    // Manga
    { ten: "Conan Tham Tu Lung Danh", tenGoc: "Conan Thám Tử Lừng Danh", danhmuc: "Manga", trang: "manga.html", gia: "200,000đ", anh: "img/sachconan.png" },
    { ten: "Attack on Titan", tenGoc: "Attack on Titan", danhmuc: "Manga", trang: "manga.html", gia: "220,000đ", anh: "img/aot.png" },
    { ten: "Blue Lock", tenGoc: "Blue Lock", danhmuc: "Manga", trang: "manga.html", gia: "280,000đ", anh: "img/bluelock.png" },
    { ten: "Solo Leveling", tenGoc: "Solo Leveling", danhmuc: "Manga", trang: "manga.html", gia: "130,000đ", anh: "img/sololv.png" },
    { ten: "BlueBox", tenGoc: "BlueBox", danhmuc: "Manga", trang: "manga.html", gia: "280,000đ", anh: "img/bbox.png" },
    { ten: "Wind", tenGoc: "Wind", danhmuc: "Manga", trang: "manga.html", gia: "350,000đ", anh: "img/wind.png" },
    { ten: "Saitama", tenGoc: "Saitama", danhmuc: "Manga", trang: "manga.html", gia: "340,000đ", anh: "img/saitama.png" },
    { ten: "Sword Art", tenGoc: "Sword Art", danhmuc: "Manga", trang: "manga.html", gia: "130,000đ", anh: "img/swart.png" },

    // English Books
    { ten: "English For Everyone", tenGoc: "English For Everyone", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "250,000đ", anh: "img/anh1.jpg" },
    { ten: "Tieng Anh Cho Nguoi Bat Dau", tenGoc: "Tiếng Anh Cho Người Bắt Đầu", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "165,000đ", anh: "img/anh2.png" },
    { ten: "Hoc Tu Vung Tieng Anh", tenGoc: "Học Từ Vựng Tiếng Anh", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "71,000đ", anh: "img/anh3.png" },
    { ten: "Giao Trinh Ngu Phap Tieng Anh", tenGoc: "Giáo Trình Ngữ Pháp Tiếng Anh", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "200,000đ", anh: "img/anh4.png" },
    { ten: "Essential Words For The IELTS", tenGoc: "Essential Words For The IELTS 3rd Edition", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "210,000đ", anh: "img/ielts.png" },
    { ten: "So Tay Tieng Anh", tenGoc: "Sổ Tay Tiếng Anh", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "170,000đ", anh: "img/anh5.png" },
    { ten: "Tu Hoc Ngu Phap Tieng Anh Co Ban", tenGoc: "Tự Học Ngữ Pháp Tiếng Anh Cơ Bản", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "200,000đ", anh: "img/anh6.png" },
    { ten: "130 Bai Ngu Phap Tieng Anh", tenGoc: "130 Bài Ngữ Pháp Tiếng Anh", danhmuc: "English Books", trang: "gold-jewellery.html", gia: "130,000đ", anh: "img/anh7.png" },

    // Sach Tieng Viet
    { ten: "Ky Nang Quan Ly Tai Chinh Dinh Cao", tenGoc: "Kỹ Năng Quản Lý Tài Chính Đỉnh Cao", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "280,000đ", anh: "img/kynang.png" },
    { ten: "Bac Hanh Luoc Ky", tenGoc: "Bắc Hành Lược Ký", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "200,000đ", anh: "img/bachanh.png" },
    { ten: "Tu Dien Tieng Viet", tenGoc: "Từ Điển Tiếng Việt", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "280,000đ", anh: "img/tudien.png" },
    { ten: "Nhat Linh Cha Toi", tenGoc: "Nhất Linh Cha Tôi", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "200,000đ", anh: "img/nhat.png" },
    { ten: "Nha Tranh", tenGoc: "Nhà Tranh", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "200,000đ", anh: "img/tranh.png" },
    { ten: "Sai Gon", tenGoc: "Sài Gòn", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "300,000đ", anh: "img/saigon.png" },
    { ten: "Hoi Ki Ve Bac Ho", tenGoc: "Hồi Kí Về Bác Hồ", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "229,000đ", anh: "img/hoiki.png" },
    { ten: "Tim Hieu Tac Gia Phan Khoi", tenGoc: "Tìm Hiểu Tác Gia Phan Khôi", danhmuc: "Sách Tiếng Việt", trang: "ao-nu.html", gia: "229,000đ", anh: "img/tacgia.png" },

    // Sale
    { ten: "1000 Hop Am Cho Dan Organ va Piano", tenGoc: "1000 Hợp Âm Cho Đàn Organ và Piano", danhmuc: "Sale", trang: "handbags.html", gia: "276,000đ", anh: "img/piano.png" },
    { ten: "Luoc Su Nuoc", tenGoc: "Lược Sử Nước", danhmuc: "Sale", trang: "handbags.html", gia: "400,000đ", anh: "img/luocsunuoc.png" },
    { ten: "Ky Thuat Oto Va Xe May Hien Dai", tenGoc: "Kỹ Thuật Oto Và Xe Máy Hiện Đại", danhmuc: "Sale", trang: "handbags.html", gia: "100,000đ", anh: "img/kythuatoto.png" },
    { ten: "Chua Lanh Bang Reiki", tenGoc: "Chữa Lành Bằng Reiki", danhmuc: "Sale", trang: "handbags.html", gia: "175,000đ", anh: "img/reiki.png" },
    { ten: "Tu Dien Viet Hoa", tenGoc: "Từ Điển Việt Hoa", danhmuc: "Sale", trang: "handbags.html", gia: "80,000đ", anh: "img/viethoa.png" },
    { ten: "Dua Vao Triet Hoc", tenGoc: "Đưa Vào Triết Học", danhmuc: "Sale", trang: "handbags.html", gia: "175,000đ", anh: "img/triethoc.png" },
    { ten: "Tam Ly Hoc Suc Khoe", tenGoc: "Tâm Lý Học Sức Khoẻ", danhmuc: "Sale", trang: "handbags.html", gia: "100,000đ", anh: "img/suckhoe.png" },
    { ten: "Tin Tuc Kien Tao", tenGoc: "Tin Tức Kiến Tạo", danhmuc: "Sale", trang: "handbags.html", gia: "250,000đ", anh: "img/tintuc.png" }
];

function timKiem(tuKhoa) {
    if (!tuKhoa) return [];
    const q = tuKhoa.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return PRODUCTS.filter(sp => {
        const tenKhongDau = sp.ten.toLowerCase();
        const tenGocKhongDau = sp.tenGoc.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const danhmucKhongDau = sp.danhmuc.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        return tenKhongDau.includes(q) || tenGocKhongDau.includes(q) || danhmucKhongDau.includes(q);
    });
}
