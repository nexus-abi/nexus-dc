/* Tiny QR code generator (byte mode, error correction M, versions 1-10 = up to 213 bytes). No dependencies.
   Used to draw the UPI payment QR on the phone, so it works offline and sends nothing to any third party.
   NexusQR.svg(text) -> SVG string.   NexusQR.matrix(text) -> array of rows of booleans. */
(function (g) {
  var EXP = [], LOG = [], x = 1, i;
  for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  var mul = function (a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; };
  function gen(n) { var p = [1], q, j; for (i = 0; i < n; i++) { q = []; for (j = 0; j <= p.length; j++) q[j] = 0; for (j = 0; j < p.length; j++) { q[j] ^= p[j]; q[j + 1] ^= mul(p[j], EXP[i]); } p = q; } return p; }
  function rs(data, n) { var G = gen(n), r = [], k, f, j; for (k = 0; k < n; k++) r[k] = 0; for (k = 0; k < data.length; k++) { f = data[k] ^ r[0]; r.shift(); r.push(0); if (f) for (j = 0; j < n; j++) r[j] ^= mul(G[j + 1], f); } return r; }
  /* level M: [EC codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each] */
  var EC = [0, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  var AL = [0, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var cap = function (v) { var e = EC[v]; return e[1] * e[2] + e[3] * e[4]; };
  function utf8(s) { var o = [], c, k; s = unescape(encodeURIComponent(s)); for (k = 0; k < s.length; k++) { c = s.charCodeAt(k); o.push(c); } return o; }
  function bch(v, G) { var dg = function (n) { var d = 0; while (n) { d++; n >>>= 1; } return d; }, d = v; while (dg(d) - dg(G) >= 0) d ^= G << (dg(d) - dg(G)); return d; }
  var MASK = [
    function (r, c) { return (r + c) % 2 == 0; }, function (r) { return r % 2 == 0; }, function (r, c) { return c % 3 == 0; }, function (r, c) { return (r + c) % 3 == 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 == 0; }, function (r, c) { return (r * c) % 2 + (r * c) % 3 == 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 == 0; }, function (r, c) { return ((r * c) % 3 + (r + c) % 2) % 2 == 0; }];
  function build(codes, v, mask, N) {
    var M = [], r, c, k, j;
    for (r = 0; r < N; r++) { M[r] = []; for (c = 0; c < N; c++) M[r][c] = null; }
    function finder(R, C) { for (r = -1; r <= 7; r++) for (c = -1; c <= 7; c++) { if (R + r < 0 || N <= R + r || C + c < 0 || N <= C + c) continue; M[R + r][C + c] = (0 <= r && r <= 6 && (c == 0 || c == 6)) || (0 <= c && c <= 6 && (r == 0 || r == 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4); } }
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    var P = AL[v]; for (k = 0; k < P.length; k++) for (j = 0; j < P.length; j++) { var pr = P[k], pc = P[j]; if (M[pr][pc] !== null) continue; for (r = -2; r <= 2; r++) for (c = -2; c <= 2; c++) M[pr + r][pc + c] = r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0); }
    for (k = 8; k < N - 8; k++) { if (M[k][6] === null) M[k][6] = k % 2 == 0; if (M[6][k] === null) M[6][k] = k % 2 == 0; }
    var bits = ((0 << 3) | mask), fi = ((bits << 10) | bch(bits << 10, 0x537)) ^ 0x5412, m;
    for (k = 0; k < 15; k++) { m = ((fi >> k) & 1) == 1; if (k < 6) M[k][8] = m; else if (k < 8) M[k + 1][8] = m; else M[N - 15 + k][8] = m; if (k < 8) M[8][N - k - 1] = m; else if (k < 9) M[8][15 - k - 1 + 1] = m; else M[8][15 - k - 1] = m; }
    M[N - 8][8] = true;
    if (v >= 7) { var vi = (v << 12) | bch(v << 12, 0x1f25); for (k = 0; k < 18; k++) { m = ((vi >> k) & 1) == 1; M[Math.floor(k / 3)][k % 3 + N - 11] = m; M[k % 3 + N - 11][Math.floor(k / 3)] = m; } }
    var inc = -1, row = N - 1, bi = 7, by = 0;
    for (c = N - 1; c > 0; c -= 2) {
      if (c == 6) c--;
      for (;;) {
        for (k = 0; k < 2; k++) if (M[row][c - k] === null) { var d = false; if (by < codes.length) d = ((codes[by] >>> bi) & 1) == 1; if (MASK[mask](row, c - k)) d = !d; M[row][c - k] = d; if (--bi == -1) { by++; bi = 7; } }
        row += inc; if (row < 0 || N <= row) { row -= inc; inc = -inc; break; }
      }
    }
    return M;
  }
  function penalty(M) {
    var N = M.length, p = 0, r, c, k, dark = 0, run, same;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) { same = 0; var d = M[r][c]; for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) { if (!a && !b) continue; var rr = r + a, cc = c + b; if (rr < 0 || N <= rr || cc < 0 || N <= cc) continue; if (M[rr][cc] == d) same++; } if (same > 5) p += 3 + same - 5; if (d) dark++; }
    for (r = 0; r < N - 1; r++) for (c = 0; c < N - 1; c++) { k = (M[r][c] ? 1 : 0) + (M[r + 1][c] ? 1 : 0) + (M[r][c + 1] ? 1 : 0) + (M[r + 1][c + 1] ? 1 : 0); if (k == 0 || k == 4) p += 3; }
    for (r = 0; r < N; r++) for (c = 0; c < N - 6; c++) { if (M[r][c] && !M[r][c + 1] && M[r][c + 2] && M[r][c + 3] && M[r][c + 4] && !M[r][c + 5] && M[r][c + 6]) p += 40; if (M[c][r] && !M[c + 1][r] && M[c + 2][r] && M[c + 3][r] && M[c + 4][r] && !M[c + 5][r] && M[c + 6][r]) p += 40; }
    return p + Math.abs(100 * dark / N / N - 50) / 5 * 10;
  }
  function matrix(text) {
    var bytes = utf8(String(text)), v, e, N, k, j;
    for (v = 1; v <= 10; v++) if (bytes.length * 8 + 4 + (v < 10 ? 8 : 16) <= cap(v) * 8) break;
    if (v > 10) throw new Error('QR text too long');
    e = EC[v]; N = 17 + 4 * v;
    var buf = [], put = function (val, len) { for (var q = len - 1; q >= 0; q--) buf.push((val >>> q) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var total = cap(v) * 8; for (k = 0; k < 4 && buf.length < total; k++) buf.push(0); while (buf.length % 8) buf.push(0);
    var cw = []; for (k = 0; k < buf.length; k += 8) { var by = 0; for (j = 0; j < 8; j++) by = (by << 1) | buf[k + j]; cw.push(by); }
    for (k = 0; cw.length < cap(v); k++) cw.push(k % 2 ? 0x11 : 0xec);
    var blocks = [], ecs = [], off = 0, maxD = 0, maxE = e[0];
    for (k = 0; k < e[1] + e[3]; k++) { var n = k < e[1] ? e[2] : e[4], d = cw.slice(off, off + n); off += n; blocks.push(d); ecs.push(rs(d, e[0])); if (n > maxD) maxD = n; }
    var out = []; for (k = 0; k < maxD; k++) blocks.forEach(function (b) { if (k < b.length) out.push(b[k]); });
    for (k = 0; k < maxE; k++) ecs.forEach(function (b) { out.push(b[k]); });
    var best, bp = 1e9; for (k = 0; k < 8; k++) { var M = build(out, v, k, N), pn = penalty(M); if (pn < bp) { bp = pn; best = M; } }
    return best;
  }
  function svg(text, o) {
    o = o || {}; var M = matrix(text), q = o.quiet == null ? 4 : o.quiet, N = M.length, S = N + 2 * q, d = '', r, c, s;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) if (M[r][c]) { s = c; while (c + 1 < N && M[r][c + 1]) c++; d += 'M' + (s + q) + ' ' + (r + q) + 'h' + (c - s + 1) + 'v1h-' + (c - s + 1) + 'z'; }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" width="' + (o.size || 220) + '" height="' + (o.size || 220) + '" shape-rendering="crispEdges" role="img" aria-label="' + (o.label || 'QR code') + '"><rect width="' + S + '" height="' + S + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  g.NexusQR = { matrix: matrix, svg: svg };
  if (typeof module != 'undefined') module.exports = g.NexusQR;
})(typeof window != 'undefined' ? window : globalThis);
