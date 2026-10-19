/* Generates QR matrices for many payloads so they can be decoded with an independent decoder (see decode.py). */
const Q = require('../../www/qr.js'), fs = require('fs');
const out = [];
const samples = ['upi://pay?pa=shop@okbank&pn=Nexus%20Docs&am=19.00&cu=INR&tn=NXSN898NVU&tr=NXSN898NVU', 'a', 'hello world', 'x'.repeat(200)];
for (let n = 3; n <= 205; n += 7) samples.push(Array.from({ length: n }, (_, i) => String.fromCharCode(33 + (i * 7 + n) % 90)).join(''));
samples.push('upi://pay?pa=some.long.name123@ybl&pn=Nexus%20Docs%20Premium&am=1499.50&cu=INR&tn=NXAB23CD45&tr=NXAB23CD45');
samples.push('Rupee ₹49 ✓');
samples.forEach(t => out.push({ text: t, m: Q.matrix(t).map(r => r.map(x => x ? 1 : 0).join('')) }));
fs.writeFileSync(process.argv[2], JSON.stringify(out)); console.log(out.length + ' matrices, sizes: ' + [...new Set(out.map(o => o.m.length))].sort((a, b) => a - b).join(','));
