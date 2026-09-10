const fs = require('fs');

function htmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
function htmlUnescape(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const gasPath = 'gas_template.gs';
const htmlPath = 'index.html';

const gasCode = fs.readFileSync(gasPath, 'utf8');
const escaped = htmlEscape(gasCode);

let html = fs.readFileSync(htmlPath, 'utf8');
const re = /(<textarea id="gas-code-box" readonly[^>]*>)([\s\S]*?)(<\/textarea>)/;
if (!re.test(html)) {
  console.error('textarea#gas-code-box not found');
  process.exit(1);
}
html = html.replace(re, function (m, open, _content, close) {
  return open + escaped + close;
});
fs.writeFileSync(htmlPath, html, 'utf8');

// 往復確認：埋め込んだ内容をデコードして元ファイルと完全一致するか
const html2 = fs.readFileSync(htmlPath, 'utf8');
const m2 = html2.match(re);
const roundTrip = htmlUnescape(m2[2]);
if (roundTrip === gasCode) {
  console.log('OK: round-trip matches exactly. length=' + gasCode.length);
} else {
  console.error('MISMATCH: round-trip does not match original gas_template.gs');
  process.exit(1);
}
