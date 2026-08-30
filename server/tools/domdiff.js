/* domdiff.js — so DOM contract giữa trang EJS render và file .html cũ.

   VÌ SAO KHÔNG PIXEL-DIFF
   Máy này không có headless browser (client chỉ có firebase, không puppeteer /
   playwright). Nhưng pixel-diff vốn chỉ là cách GIÁN TIẾP hỏi "trình duyệt có dựng ra
   cùng một thứ không". Nếu chuỗi token DOM giống hệt VÀ css/js không đổi thì pixel
   bằng nhau theo định nghĩa — mạnh hơn ảnh chụp, và tất định (index.html chạy
   animation nên ảnh chụp còn không tất định).

   Token hoá:
     - thẻ  -> <tên attr1="v1" attr2="v2">  attribute SẮP XẾP theo tên, khoảng trắng
               trong thẻ gom về 1 dấu cách
     - text -> gom khoảng trắng, bỏ nếu rỗng
   Nhờ vậy khác biệt thuần định dạng bị loại, còn khác biệt THẬT (thiếu/thừa class, id,
   data-, aria-, sai thứ tự phần tử, đổi chữ) thì lộ ra.

   COMMENT tách thành kênh riêng: chú thích HTML không phải class, id, data- hay aria- và
   không có JS nào query nó, nên không thuộc DOM contract — nhưng vẫn báo ra để thấy
   mình đã bỏ đi cái gì, không giấu.

   Dùng:  node domdiff.js <url> <file-cu> [--dump]
          node domdiff.js --selftest        (negative control: chứng minh nó biết báo lỗi)
*/
const fs = require('fs');
const http = require('http');
const path = require('path');

const OUT = __dirname;


/* Giải mã entity: '&amp;' và '&' cho ra CÙNG một ký tự sau khi trình duyệt parse, nên
   so chuỗi thô sẽ báo khác biệt giả. Giải mã trước khi so mới là so đúng cái DOM thấy. */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/* Thẻ </body> và </html> thứ hai trở đi bị trình duyệt bỏ qua hoàn toàn. handbags.html
   và sale.html cũ có </body> hai lần — mô phỏng đúng parser thì chúng không phải khác
   biệt DOM. */
function dropDuplicateEnd(tokens) {
  const seen = {};
  return tokens.filter((t) => {
    if (t !== '</body>' && t !== '</html>') return true;
    if (seen[t]) return false;
    seen[t] = true;
    return true;
  });
}

function tokenize(html) {
  const tags = [], comments = [];
  const re = /<!--([\s\S]*?)-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let last = 0, m;
  while ((m = re.exec(html)) !== null) {
    const text = html.slice(last, m.index).replace(/\s+/g, ' ').trim();
    if (text) tags.push('TEXT ' + decodeEntities(text));
    last = re.lastIndex;

    if (m[1] !== undefined) { comments.push(m[1].replace(/\s+/g, ' ').trim()); continue; }

    const name = m[3].toLowerCase();
    if (m[2] === '/') { tags.push('</' + name + '>'); continue; }

    const attrs = [];
    const ar = /([\w:.-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = ar.exec(m[4])) !== null) {
      const val = a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : null;
      attrs.push(a[1].toLowerCase() + (val === null ? '' : '="' + val.replace(/\s+/g, ' ').trim() + '"'));
    }
    attrs.sort();
    tags.push('<' + name + (attrs.length ? ' ' + attrs.join(' ') : '') + '>');
  }
  const tail = html.slice(last).replace(/\s+/g, ' ').trim();
  if (tail) tags.push('TEXT ' + decodeEntities(tail));
  return { tags: dropDuplicateEnd(tags), comments };
}


/* Chuẩn hoá ĐÃ DUYỆT — khác biệt cố ý, có lý do, không phải lỗi.
   Mỗi mục phải ghi rõ vì sao nó vô hại, nếu không thì đừng cho vào đây. */
const KNOWN = {
  'profile.html': [
    /* profile.html là trang DUY NHẤT bỏ type="text/css" ở link CSS riêng trang.
       HTML5 coi text/css là mặc định nên thuộc tính này không đổi gì; 20 trang kia
       đều có. Chuẩn hoá theo số đông. */
    ['<link href="css/profile.css" rel="stylesheet">',
     '<link href="css/profile.css" rel="stylesheet" type="text/css">'],
    /* profile.html là trang DUY NHẤT gắn defer cho theme.js. Đã kiểm: theme.js chỉ
       định nghĩa window.BreezeTheme, không đọc DOM và không có tác dụng phụ lúc nạp;
       mọi chỗ dùng nó (page-profile.js syncThemeUI + handler click) đều chạy từ
       DOMContentLoaded trở đi, mà script defer chạy TRƯỚC DOMContentLoaded. Nên bỏ
       defer không đổi hành vi, chỉ làm global có sớm hơn và khớp 20 trang còn lại. */
    ['<script defer src="js/theme.js">', '<script src="js/theme.js">'],
  ],
  'index.html': [
    /* index.html là trang DUY NHẤT trong 14 trang có doctype để <html> trần;
       13 trang kia đều <html lang="vi">. Hơn nữa i18n.js gọi
       documentElement.setAttribute('lang', lang) mỗi lần apply, tức ngay lúc tải,
       nên sau khi JS chạy hai bản giống hệt nhau. */
    ['<html>', '<html lang="vi">'],
    /* index.html cũng là trang duy nhất đặt <title> TRƯỚC <meta viewport>; 13 trang
       kia đặt sau. Thứ tự hai thẻ này trong <head> không ảnh hưởng gì. */
    ['<title>', '<meta content="width=device-width, initial-scale=1" name="viewport">'],
    ['TEXT BREEZE - Thời trang', '<title>'],
    ['</title>', 'TEXT BREEZE - Thời trang'],
    ['<meta content="width=device-width, initial-scale=1" name="viewport">', '</title>'],
  ],
};
function isKnown(label, a, b) {
  const list = KNOWN[label] || [];
  return list.some((k) => k[0] === a && k[1] === b);
}

function compare(oldHtml, newHtml, label) {
  const A = tokenize(oldHtml), B = tokenize(newHtml);
  let diffs = 0, known = 0;
  const n = Math.max(A.tags.length, B.tags.length);
  for (let i = 0; i < n; i++) {
    if (A.tags[i] !== B.tags[i]) {
      if (isKnown(label, A.tags[i], B.tags[i])) { known++; continue; }
      if (diffs === 0) console.log('  KHAC BIET DOM:');
      if (diffs < 8) {
        console.log('    [' + i + '] cu : ' + (A.tags[i] === undefined ? '(het)' : A.tags[i]));
        console.log('         moi: ' + (B.tags[i] === undefined ? '(het)' : B.tags[i]));
      }
      diffs++;
    }
  }
  const lostC = A.comments.filter(c => !B.comments.includes(c));
  const gainC = B.comments.filter(c => !A.comments.includes(c));
  return { diffs, known, tokens: A.tags.length, lostC, gainC, byteSame: oldHtml === newHtml };
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => {
      let b = ''; r.setEncoding('utf8');
      r.on('data', c => (b += c));
      r.on('end', () => resolve({ status: r.statusCode, body: b }));
    }).on('error', reject);
  });
}

/* Negative control: cố tình phá 4 kiểu khác nhau, phép kiểm PHẢI bắt được cả 4.
   Không có bước này thì "0 khác biệt" chẳng chứng minh được gì. */
function selftest() {
  const base = '<!DOCTYPE html>\n<html><head><title>A</title></head>\n<body class="x" data-k="1">\n' +
               '  <div id="a" class="b c"><span aria-label="z">Xin chào</span></div>\n' +
               '  <!-- ghi chu -->\n</body></html>\n';
  const cases = [
    ['doi class',        base.replace('class="b c"', 'class="b d"')],
    ['mat data-*',       base.replace(' data-k="1"', '')],
    ['doi thu tu the',   base.replace('<div id="a" class="b c"><span aria-label="z">Xin chào</span></div>',
                                      '<span aria-label="z">Xin chào</span><div id="a" class="b c"></div>')],
    ['doi chu',          base.replace('Xin chào', 'Xin chao')],
    ['mat aria-*',       base.replace(' aria-label="z"', '')],
  ];
  let ok = 0;
  console.log('NEGATIVE CONTROL — phep kiem co bat duoc loi khong:');
  cases.forEach(([name, broken]) => {
    const r = compare(base, broken, name);
    const caught = r.diffs > 0;
    console.log('  ' + (caught ? 'BAT DUOC' : 'LOT LUOI') + '  ' + name + ' (' + r.diffs + ' khac biet)');
    if (caught) ok++;
  });
  const same = compare(base, base, 'giong het');
  console.log('  ' + (same.diffs === 0 ? 'OK      ' : 'SAI     ') + '  ban giong het -> ' + same.diffs + ' khac biet (phai la 0)');
  const pass = ok === cases.length && same.diffs === 0;
  console.log(pass ? 'NEGATIVE CONTROL: DAT — phep kiem co gia tri.' : 'NEGATIVE CONTROL: HONG — dung tin ket qua.');
  process.exit(pass ? 0 : 1);
}

(async () => {
  if (process.argv[2] === '--selftest') return selftest();

  const [url, file, flag] = process.argv.slice(2);
  const res = await get(url);
  if (res.status !== 200) { console.log('  FAIL ' + url + ' — HTTP ' + res.status); process.exit(1); }

  const oldHtml = fs.readFileSync(file, 'utf8');
  const r = compare(oldHtml, res.body, path.basename(file));
  const label = path.basename(file);

  if (r.diffs === 0) {
    console.log('  OK   ' + label.padEnd(24) + ' DOM khop 100% (' + r.tokens + ' token)' +
                (r.byteSame ? ', byte-identical' : '') + (r.known ? ', ' + r.known + ' chuan hoa da duyet' : ''));
  } else {
    console.log('  FAIL ' + label + ' — ' + r.diffs + ' khac biet DOM');
  }
  if (r.lostC.length) console.log('       comment bo di : ' + r.lostC.map(c => '"' + c.slice(0, 46) + '"').join(', '));
  if (r.gainC.length) console.log('       comment them  : ' + r.gainC.map(c => '"' + c.slice(0, 46) + '"').join(', '));

  if (flag === '--dump') {
    fs.writeFileSync(path.join(OUT, 'old.html'), oldHtml);
    fs.writeFileSync(path.join(OUT, 'new.html'), res.body);
    console.log('       da ghi ' + OUT + '/old.html va new.html');
  }
  process.exit(r.diffs === 0 ? 0 : 1);
})();
