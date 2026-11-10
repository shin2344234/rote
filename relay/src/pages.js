// The pages the site serves. Plain strings keep the relay free of a build step.
const base = `
  @font-face { font-family: "League Gothic"; src: url(/fonts/league-gothic.woff2) format("woff2"); font-display: swap; }
  @font-face { font-family: "Public Sans"; src: url(/fonts/public-sans.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
  :root {
    color-scheme: light;
    --wall: #e9ebee; --ink: #14171a; --board: #0d0e10;
    --ticket: #ffc91f; --light: #f4f5f6; --paper: #ffffff; --clipboard: #33373c; --muted: #4a4f55; --ok: #12804a; --warn: #c26f00;
    --gutter: clamp(16px, 3vw, 32px);
    --display: "League Gothic", "Arial Narrow", sans-serif;
    --ease: cubic-bezier(.16, 1, .3, 1);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scrollbar-color: var(--ink) var(--wall); }
  body { margin: 0; background: var(--wall); color: var(--ink); font: 400 18px/1.55 "Public Sans", system-ui, sans-serif; }
  ::selection { background: var(--ticket); color: var(--ink); }
  a { color: inherit; text-decoration-thickness: 2px; text-underline-offset: 3px; }
  a:hover { text-decoration-thickness: 4px; }
  :focus-visible { outline: 3px solid currentColor; outline-offset: 3px; border-radius: 2px; }
  h1, h2, h3 { font-family: var(--display); font-weight: 400; line-height: .98; margin: 0; text-wrap: balance; }
  .wrap { max-width: 1376px; margin: 0 auto; padding-inline: var(--gutter); }
  .sign { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; padding-block: 16px; font-weight: 600; font-size: 17px; }
  .plate { background: var(--ink); color: var(--light); font: 400 30px/1 var(--display); padding: 6px 14px 5px; text-decoration: none; border-radius: 3px; margin-right: auto; }
  .plate:hover { background: #33373c; }
  @media (max-width: 640px) { .sign { font-size: 16px; gap: 8px 16px; } .sign a:last-child { display: none; } }
  @media (max-width: 360px) { .sign { font-size: 15px; gap: 8px 12px; } .plate { font-size: 26px; } }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { transition: none !important; } }
`;

const shell = (title, description, css, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#e9ebee">
<link rel="preload" href="/fonts/league-gothic.woff2" as="font" type="font/woff2" crossorigin>
<style>${base}${css}</style>
</head>
<body>
${body}
</body>
</html>`;

const nav = `<nav class="wrap sign" aria-label="Main">
  <a class="plate" href="/">Rote</a>
  <a href="/#install">Install</a>
  <a href="/#use">How to use it</a>
  <a href="/privacy">Privacy</a>
  <a href="https://github.com/shin2344234/rote">Source code</a>
</nav>`;

const homeCss = `
  .board { background: var(--board); padding: 12px; border-radius: 6px; box-shadow: 0 6px 14px rgba(20, 23, 26, .35); }
  .board canvas { display: block; width: 100%; height: 108px; }
  .hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 620px); gap: clamp(32px, 6vw, 96px); padding-block: clamp(28px, 4vw, 48px) 72px; align-items: start; }
  h1 { font-size: clamp(3.4rem, 7.2vw, 6rem); margin-top: 8px; }
  .lede { font-size: clamp(1.15rem, 1.6vw, 1.35rem); max-width: 34em; margin: 24px 0 28px; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px; font-weight: 600; }
  .aihelp { max-width: 34em; margin: 26px 0 0; font-size: 1rem; }

  .tk { position: relative; isolation: isolate; display: inline-block; color: var(--ink); filter: drop-shadow(0 2px 3px rgba(20, 23, 26, .4)); }
  .tk::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--tk, var(--ticket));
    -webkit-mask: radial-gradient(circle 5px at 0 50%, #0000 97%, #000) left / 51% 14px repeat-y, radial-gradient(circle 5px at 100% 50%, #0000 97%, #000) right / 51% 14px repeat-y;
    mask: radial-gradient(circle 5px at 0 50%, #0000 97%, #000) left / 51% 14px repeat-y, radial-gradient(circle 5px at 100% 50%, #0000 97%, #000) right / 51% 14px repeat-y; }
  a.tk, button.tk { font: 400 30px/1 var(--display); padding: 15px 30px 13px; text-decoration: none; border: 0; background: none; cursor: pointer; transition: transform .35s var(--ease); }
  a.tk:hover, button.tk:hover { transform: translateY(-2px); }
  a.tk:active, button.tk:active { transform: translateY(1px); }
  button.tk.small { font-size: 22px; padding: 9px 20px 7px; }

  .clip { position: relative; border-radius: 12px; padding: 40px 14px 14px;
    background: var(--clipboard);
    box-shadow: 0 10px 22px rgba(20, 23, 26, .28); }
  .hardware { position: absolute; top: -15px; left: 50%; width: 176px; height: 58px; margin-left: -88px; z-index: 1; }
  figure { margin: 0; }
  .sheet { background: var(--paper); padding: 18px 20px 16px; font-size: 14px; line-height: 1.3; }
  .sheet-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 2px solid var(--ink); padding-bottom: 6px; margin-bottom: 12px; }
  .sheet-head b { font: 400 25px/1 var(--display); }
  .sheet-head span { font-size: 12.5px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 9px 10px; }
  .f { grid-column: span 6; }
  .f.half { grid-column: span 3; }
  .f.third { grid-column: span 2; }
  .f small { display: block; font-size: 12.5px; font-weight: 600; margin-bottom: 3px; }
  .f small i { font-style: normal; color: #945200; visibility: hidden; }
  .box { display: block; min-height: 31px; padding: 6px 8px; border: 1px solid #868c93; background: #fff; white-space: nowrap; overflow: hidden; transition: outline-color .3s; outline: 2px solid transparent; outline-offset: -1px; }
  .f.tall { position: relative; }
  .f.tall .box { min-height: 72px; }
  .f.ok .box { outline-color: var(--ok); }
  .f.warn .box { outline-color: var(--warn); }
  .f.warn small i { visibility: visible; }
  .sheet-foot { display: flex; align-items: center; gap: 12px; margin-top: 12px; color: var(--muted); font-size: 13px; }
  .sheet-foot b { background: var(--ink); color: #fff; padding: 7px 18px; font-weight: 600; font-size: 14px; }
  .replay { position: absolute; top: 10px; right: 16px; font: 600 14px/1 "Public Sans", sans-serif; background: none; border: 0; padding: 4px 0; color: var(--light); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .yours { position: absolute; left: -158px; top: 2px; margin: 0; width: 150px; padding: 8px 16px; filter: none; transition: transform .7s var(--ease), opacity .25s; }
  .yours b { display: block; font: 400 28px/1 var(--display); }
  .yours span { display: block; font-size: 13px; line-height: 1.3; font-weight: 500; }
  .yours.away { opacity: 0; transform: translateY(26px); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  section { padding-block: clamp(40px, 5vw, 72px); }
  h2 { font-size: clamp(3.2rem, 7vw, 5.6rem); }
  .intro { max-width: 40em; margin: 16px 0 0; font-size: 1.15rem; }
  .windows { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(32px, 5vw, 72px); margin-top: 48px; }
  .window > header { display: flex; align-items: center; gap: 18px; background: var(--ink); color: var(--light); padding: 14px 20px; border-radius: 4px; }
  .window > header .letter { font: 400 76px/.9 var(--display); color: var(--ticket); }
  .window h3 { font-size: 40px; }
  .window header p { margin: 4px 0 0; font-size: 15.5px; line-height: 1.35; }
  ol.steps { list-style: none; margin: 28px 0 0; padding: 0; display: grid; gap: 26px; }
  ol.steps li { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 16px; }
  .no { font: 400 46px/1 var(--display); align-self: start; font-variant-numeric: tabular-nums; }
  ol.steps h4 { font-size: 1.2rem; font-weight: 700; margin: 2px 0 2px; line-height: 1.3; }
  ol.steps p { margin: 0; }
  ol.steps .do { margin-top: 12px; }
  .cmd { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; margin-top: 10px; background: var(--ink); color: var(--light); padding: 12px 14px; border-radius: 4px; }
  .cmd code { flex: 1 1 16em; font: 500 15px/1.45 ui-monospace, Consolas, monospace; overflow-wrap: anywhere; }
  .after { max-width: 44em; margin: 48px 0 0; }
  .bridge { margin-top: clamp(64px, 8vw, 104px); }
  .bridge > h3 { font-size: clamp(2.6rem, 5vw, 4.2rem); }
  .note { max-width: 44em; margin: 36px 0 0; }
  .pick { margin-top: 14px !important; }
  .window > p { margin: 0; }
  .branch { font: 400 32px/1 var(--display); margin: 30px 0 8px; }
  .branch + ol.steps { margin-top: 16px; }
  .cmd .tk:focus-visible { outline-color: var(--ticket); }
  .coffee a.tk:focus-visible { outline-color: var(--ink); }

  ol.roll { background: var(--paper); }
  .coffee { background: var(--ticket); }
  ol.roll, .coffee {
    -webkit-mask: radial-gradient(circle 6px at 50% 0, #0000 97%, #000) top / 16px 51% repeat-x, radial-gradient(circle 6px at 50% 100%, #0000 97%, #000) bottom / 16px 51% repeat-x;
    mask: radial-gradient(circle 6px at 50% 0, #0000 97%, #000) top / 16px 51% repeat-x, radial-gradient(circle 6px at 50% 100%, #0000 97%, #000) bottom / 16px 51% repeat-x; }
  ol.roll { list-style: none; padding: 0; margin: 40px 0 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  ol.roll li { padding: 36px clamp(16px, 2vw, 32px) 40px; }
  ol.roll li + li { border-left: 2px dashed rgba(20, 23, 26, .5); }
  ol.roll b { display: block; font: 400 clamp(3.5rem, 6vw, 4.5rem)/.9 var(--display); }
  ol.roll h3 { font-size: 36px; margin: 14px 0 10px; }
  ol.roll p { margin: 0 0 10px; font-size: 17px; }
  ol.roll p:last-child { margin: 0; }

  .posted { background: var(--ink); color: var(--light); border-radius: 4px; padding: clamp(28px, 4vw, 56px); box-shadow: 0 6px 14px rgba(20, 23, 26, .35); }
  .posted ul { list-style: none; padding: 0; margin: 28px 0 0; font: 400 clamp(2.4rem, 5.2vw, 4.4rem)/1.02 var(--display); }
  .posted li { padding: 12px 0; border-top: 1px solid rgba(244, 245, 246, .3); text-wrap: balance; }
  .data { margin-top: 40px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px clamp(32px, 5vw, 72px); }
  .data h3 { font-size: 36px; margin-bottom: 8px; }
  .data p { margin: 0; max-width: 36em; }

  .coffee { padding: clamp(40px, 6vw, 80px) clamp(24px, 5vw, 72px); }
  .coffee h2 { max-width: 13em; }
  .coffee p { max-width: 36em; margin: 18px 0 26px; font-size: 1.15rem; }
  .coffee a.tk { --tk: var(--ink); color: var(--light); }
  footer { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 40px; padding-bottom: 12px; font-size: 16px; }
  footer span { margin-right: auto; max-width: 38em; }

  @media (max-width: 1360px) {
    .f.tall .box { min-height: 92px; }
    .yours { left: auto; right: 8px; top: 24px; }
    .yours b { font-size: 28px; }
    .yours span { font-size: 13px; }
  }
  @media (min-width: 1081px) and (max-height: 820px) {
    .board canvas { height: 84px; }
    .hero { padding-top: 18px; }
    h1 { font-size: 4.2rem; }
    .lede { font-size: 1.1rem; margin: 14px 0 16px; }
    .sheet { padding: 12px 16px 10px; font-size: 13px; }
    .sheet-head { margin-bottom: 8px; padding-bottom: 4px; }
    .sheet-head b { font-size: 21px; }
    .grid { gap: 5px 10px; }
    .f small { font-size: 11.5px; margin-bottom: 1px; }
    .box { min-height: 25px; padding: 3px 8px; }
    .f.tall .box { min-height: 44px; }
    .sheet-foot { margin-top: 8px; }
    .sheet-foot b { padding: 4px 14px; font-size: 13px; }
    .yours { padding: 8px 18px; }
    .yours b { font-size: 28px; }
    .yours span { font-size: 13px; }
  }
  @media (min-width: 1081px) and (max-width: 1360px) and (max-height: 820px) {
    .f.tall .box { min-height: 60px; }
    .yours { top: 18px; width: 130px; padding: 6px 16px 4px; }
    .yours span { display: none; }
  }
  @media (max-width: 1080px) {
    .hero { grid-template-columns: minmax(0, 1fr); }
    .clip { max-width: 620px; }
    .windows, .data { grid-template-columns: minmax(0, 1fr); }
    ol.roll { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    ol.roll li:nth-child(3) { border-left: 0; }
    ol.roll li:nth-child(n+3) { border-top: 2px dashed rgba(20, 23, 26, .5); }
  }
  @media (max-width: 640px) {
    body { font-size: 17px; }
    .clip { padding-bottom: 40px; }
    .replay { top: auto; bottom: 10px; }
    .board canvas { height: 104px; }
    .sheet { padding: 14px 12px 12px; }
    ol.steps li { grid-template-columns: 26px minmax(0, 1fr); gap: 12px; }
    .no { font-size: 36px; }
    ol.roll { grid-template-columns: minmax(0, 1fr); }
    ol.roll li + li { border-left: 0; border-top: 2px dashed rgba(20, 23, 26, .5); }
    .window > header .letter { font-size: 60px; }
  }
`;

// Client code for the LED board, the filling form and the copy buttons.
const homeScript = `
(function () {
  var glyphs = {
    A:'7E1111117E',B:'7F49494936',C:'3E41414122',D:'7F4141221C',E:'7F49494941',F:'7F09090901',G:'3E4149497A',H:'7F0808087F',I:'00417F4100',
    J:'2040413F01',K:'7F08142241',L:'7F40404040',M:'7F020C027F',N:'7F0408107F',O:'3E4141413E',P:'7F09090906',Q:'3E4151215E',R:'7F09192946',
    S:'4649494931',T:'01017F0101',U:'3F4040403F',V:'1F2040201F',W:'3F4038403F',X:'6314081463',Y:'0708700807',Z:'6151494543',
    0:'3E5149453E',1:'00427F4000',2:'4261514946',3:'2141454B31',4:'1814127F10',5:'2745454539',6:'3C4A494930',7:'0171090503',8:'3649494936',9:'064949291E',
    ' ':'0000000000','.':'0060600000','?':'0201510906'
  };
  var digits = ['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var state = { number: 10, message: 'YOUR TURN' };
  var lit = '#ff4a3d', dim = '#241517';

  function dotText(text, x, y, pitch, maxChars) {
    var r = pitch * 0.45;
    for (var i = 0; i < maxChars; i++) {
      var g = glyphs[text.charAt(i)] || glyphs[' '];
      for (var col = 0; col < 5; col++) {
        var bits = parseInt(g.substr(col * 2, 2), 16);
        for (var row = 0; row < 7; row++) {
          var on = bits >> row & 1;
          var cx = x + (i * 6 + col) * pitch + pitch / 2, cy = y + row * pitch + pitch / 2;
          ctx.fillStyle = on ? lit : dim;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.3); ctx.fill();
        }
      }
    }
  }

  function segment(points, on) {
    ctx.fillStyle = on ? lit : dim;
    ctx.beginPath();
    points.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.fill();
  }

  function sevenSeg(n, x, y, w, h) {
    var t = h * 0.13, m = y + h / 2, g = t * 0.14, on = digits[n];
    var flat = function (yc) { return [[x + t / 2 + g, yc], [x + t + g, yc - t / 2], [x + w - t - g, yc - t / 2], [x + w - t / 2 - g, yc], [x + w - t - g, yc + t / 2], [x + t + g, yc + t / 2]]; };
    var tall = function (xc, y1, y2) { return [[xc, y1 + g], [xc + t / 2, y1 + t / 2 + g], [xc + t / 2, y2 - t / 2 - g], [xc, y2 - g], [xc - t / 2, y2 - t / 2 - g], [xc - t / 2, y1 + t / 2 + g]]; };
    segment(flat(y + t / 2), on[0] === '1');
    segment(tall(x + w - t / 2, y + t / 2, m), on[1] === '1');
    segment(tall(x + w - t / 2, m, y + h - t / 2), on[2] === '1');
    segment(flat(y + h - t / 2), on[3] === '1');
    segment(tall(x + t / 2, m, y + h - t / 2), on[4] === '1');
    segment(tall(x + t / 2, y + t / 2, m), on[5] === '1');
    segment(flat(m), on[6] === '1');
  }

  function number(x, y, dw, dh, gap) {
    var text = String(state.number % 1000).padStart(3, '0');
    for (var i = 0; i < 3; i++) sevenSeg(+text.charAt(i), x + i * (dw + gap), y, dw, dh);
  }

  function draw() {
    var ratio = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) {
      canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var cells = 18, padded = (state.message + ' '.repeat(cells)).slice(0, cells);
    if (W >= 720) {
      dotText('FIELDS', 6, H / 2 - 30, 3.6, 7);
      dotText('FILLED', 6, H / 2 + 6, 3.6, 7);
      number(176, 6, 56, H - 12, 12);
      var left = 176 + 3 * 68 + 36, pitch = Math.min(8.6, (W - left) / (cells * 6));
      dotText(padded, left, (H - 7 * pitch) / 2, pitch, cells);
    } else {
      dotText('FIELDS FILLED', 2, 16, Math.min(2.7, (W - 102) / 78), 13);
      var dw = 26, dh = 44, gap = 6;
      number(W - 3 * dw - 2 * gap - 2, 2, dw, dh, gap);
      var p = (W - 2) / (cells * 6);
      dotText(padded, 1, H - 7 * p - 8, p, cells);
    }
  }

  var fields = [].slice.call(document.querySelectorAll('[data-label]'));
  var values = fields.map(function (f) { return f.querySelector('.box').textContent; });
  var ticket = document.getElementById('yours');
  var replay = document.getElementById('replay');
  var run = 0;

  function wait(ms, id) { return new Promise(function (done, stop) { setTimeout(function () { id === run ? done() : stop(); }, ms); }); }

  async function play() {
    var id = ++run;
    ticket.classList.add('away');
    fields.forEach(function (f) { f.classList.remove('ok', 'warn'); f.querySelector('.box').textContent = ''; });
    state.number = 0; state.message = 'SCANNING PAGE'; draw();
    try {
      await wait(900, id);
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i], box = f.querySelector('.box'), text = values[i];
        state.message = f.dataset.label; draw();
        if (!text) { await wait(450, id); continue; }
        for (var c = 1; c <= text.length; c += 2) { box.textContent = text.slice(0, c); await wait(14, id); }
        box.textContent = text;
        f.classList.add(f.dataset.state);
        state.number++; draw();
        await wait(380, id);
      }
      state.message = 'YOUR TURN'; draw();
      ticket.classList.remove('away');
    } catch (stopped) { /* a newer run took over */ }
  }

  draw();
  if (window.ResizeObserver) new ResizeObserver(draw).observe(canvas);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { replay.hidden = true; }
  else { replay.addEventListener('click', play); play(); }

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var label = button.textContent;
      navigator.clipboard.writeText(button.dataset.copy).then(function () {
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = label; }, 1800);
      }, function () { button.textContent = 'Select and copy it'; });
    });
  });
})();
`;

const field = (label, board, value, state, size = '', extra = '') => `<div class="f ${size}${state === 'done' ? '' : ` ${state}`}" data-label="${board}" data-state="${state}"><small>${label}${state === 'warn' ? ' <i>Check this</i>' : ''}</small><span class="box">${value}</span>${extra}</div>`;

const command = 'irm https://raw.githubusercontent.com/shin2344234/rote/main/install.ps1 | iex';

const bridgeCommand = '&amp; ([scriptblock]::Create((irm https://raw.githubusercontent.com/shin2344234/rote/main/install.ps1))) -WithBridge';

const pin = 'Click the puzzle piece next to the address bar, then the pin beside Rote. Its icon stays in your toolbar.';

export const HOME_PAGE = shell('Rote fills in job applications from your resume', 'Rote is a free Chrome extension that reads your resume in your browser and fills job applications on any site. You check the answers and click submit.', homeCss, `
${nav}
<div class="wrap">
  <div class="board" aria-hidden="true"><canvas id="board">Fields filled</canvas></div>
  <main class="hero">
    <div>
      <h1>Stop retyping your resume into every job application.</h1>
      <p class="lede">Rote is a free Chrome extension that reads your resume and fills out the application for you on pretty much any job site. You look it over and hit submit yourself.</p>
      <p class="actions"><a class="tk" href="#install">Install Rote free</a> <a href="#use">How to use it</a></p>
      <p class="aihelp">AI is optional. For the questions Rote can't answer, you can connect Claude Code or Codex through the bridge, use an API key, or run a model on your own computer. Whichever you pick gets your whole profile and saved answers when you ask it for help. <a href="#bridge">Here's how to set it up</a>.</p>
    </div>
    <figure class="clip">
      <figcaption class="sr">An example job application. Rote fills each field in turn, outlines confident answers in green and answers to check in amber, leaves the open question for the applicant, and does not click Submit.</figcaption>
      <svg class="hardware" viewBox="0 0 176 58" aria-hidden="true"><path d="M6 56V36q0-8 8-8h30q6 0 9-6l5-11q3-7 10-7h40q7 0 10 7l5 11q3 6 9 6h30q8 0 8 8v20z" fill="#aeb4ba"/><rect x="66" y="12" width="44" height="7" rx="3.5" fill="#33373c"/></svg>
      <button class="replay" id="replay" type="button">Watch it again</button>
      <div class="sheet" aria-hidden="true">
        <div class="sheet-head"><b>Application for employment</b><span>Example details</span></div>
        <div class="grid">
          ${field('Resume', 'RESUME ATTACHED', 'sam-rivera-resume.pdf', 'ok')}
          ${field('First name', 'FIRST NAME', 'Sam', 'ok', 'half')}
          ${field('Last name', 'LAST NAME', 'Rivera', 'ok', 'half')}
          ${field('Email', 'EMAIL', 'sam@example.com', 'ok', 'half')}
          ${field('Phone', 'PHONE', '(555) 010-0142', 'ok', 'half')}
          ${field('Street address', 'STREET ADDRESS', '214 Example Street', 'ok')}
          ${field('City', 'CITY', 'Springfield', 'ok', 'third')}
          ${field('State', 'STATE', 'Illinois', 'ok', 'third')}
          ${field('ZIP', 'ZIP CODE', '62704', 'ok', 'third')}
          ${field('Are you authorized to work here?', 'WORK AUTHORIZATION', 'Yes', 'warn')}
          ${field('Why do you want to work here?', 'OPEN QUESTION', '', 'open', 'tall', '<p class="tk yours" id="yours"><b>Your turn</b><span>This one is yours.</span></p>')}
        </div>
        <div class="sheet-foot"><b>Submit</b> Rote won't click this.</div>
      </div>
    </figure>
  </main>
</div>

<section id="install"><div class="wrap">
  <h2>Install it</h2>
  <p class="intro">You need Chrome on a computer. It won't work on a phone. Pick A or B. You end up with the same thing either way. It'll be in the Chrome Web Store eventually, and then you can skip all of this.</p>
  <div class="windows">
    <div class="window">
      <header><span class="letter" aria-hidden="true">A</span><div><h3>Download it</h3><p>Windows, Mac or Linux. No typing commands.</p></div></header>
      <ol class="steps">
        <li><span class="no">1</span><div><h4>Download Rote</h4><p>It's a zip file. It'll show up in your Downloads folder.</p><p class="do"><a class="tk" href="/download">Download Rote</a></p></div></li>
        <li><span class="no">2</span><div><h4>Unzip it</h4><p>On Windows, right-click the file and choose Extract All. On a Mac, double-click it. Put the folder somewhere you won't delete it, like Documents. Chrome keeps using it.</p></div></li>
        <li><span class="no">3</span><div><h4>Open Chrome's extensions page</h4><p>Websites can't link to this page, so copy the address, paste it into Chrome's address bar and press Enter.</p><div class="cmd"><code>chrome://extensions</code><button class="tk small" type="button" data-copy="chrome://extensions">Copy</button></div></div></li>
        <li><span class="no">4</span><div><h4>Turn on Developer mode</h4><p>The switch is at the top right of that page. Chrome makes you do this for anything that isn't from its store.</p></div></li>
        <li><span class="no">5</span><div><h4>Click Load unpacked</h4><p>The button appears at the top left. Choose the unzipped folder, the one with manifest.json inside it, and click Select Folder.</p></div></li>
        <li><span class="no">6</span><div><h4>Pin Rote to your toolbar</h4><p>${pin}</p></div></li>
      </ol>
    </div>
    <div class="window">
      <header><span class="letter" aria-hidden="true">B</span><div><h3>Paste one command</h3><p>Windows only. The command does the downloading for you.</p></div></header>
      <ol class="steps">
        <li><span class="no">1</span><div><h4>Open PowerShell</h4><p>Press the Windows key, type PowerShell and press Enter.</p></div></li>
        <li id="b-commands"><span class="no">2</span><div><h4>Pick one command, paste it and press Enter</h4><p>To paste, click in the PowerShell window and press Ctrl+V.</p><p class="pick"><b>Rote only.</b> This doesn't install the AI bridge.</p><div class="cmd"><code>${command}</code><button class="tk small" type="button" data-copy="${command}">Copy</button></div><p class="pick"><b>Rote and the AI bridge.</b> This installs both. <a href="#bridge">Install what the bridge needs</a> first.</p><div class="cmd"><code>${bridgeCommand}</code><button class="tk small" type="button" data-copy="${bridgeCommand}">Copy</button></div><p class="pick">Either one runs a script from the internet, so <a href="https://github.com/shin2344234/rote/blob/main/install.ps1">read it first</a> if that makes you nervous. It stops if the download doesn't match the file on GitHub.</p></div></li>
        <li><span class="no">3</span><div><h4>Turn on Developer mode</h4><p>Chrome will open to its extensions page. The switch is at the top right.</p></div></li>
        <li><span class="no">4</span><div><h4>Click Load unpacked</h4><p>The command already copied the folder's location. Press Ctrl+V in the Folder box at the bottom of the window, then click Select Folder.</p></div></li>
        <li><span class="no">5</span><div><h4>Pin Rote to your toolbar</h4><p>${pin}</p></div></li>
      </ol>
    </div>
  </div>
  <div class="bridge" id="bridge">
    <h3>Do you want AI help?</h3>
    <p class="intro">You don't need it. Rote scans and fills forms on its own. AI only comes in if you want help with the questions Rote can't answer. You can use an API key, a model running on your computer, or the bridge, which is a small program that lets Rote use the Claude Code or Codex you already have on your PC.</p>
    <div class="windows">
      <div class="window">
        <header><div><h3>Without the bridge</h3><p>Works on any computer with Chrome. For an API key or a local model. If you don't want AI, you're done after A or B.</p></div></header>
        <ol class="steps">
          <li><span class="no">1</span><div><h4>Pick your connection</h4><p>Click the Rote icon, then Profile and logs. Under AI review, open Connection and choose Anthropic API key or OpenAI API key. For anything else, choose Other provider or local model, then pick the provider.</p></div></li>
          <li><span class="no">2</span><div><h4>Add your key or start your model</h4><p>Paste an API key into its box. That provider bills you for what you use. A local model needs no key and your details stay on your computer, but it has to be running. Ollama also needs its OLLAMA_ORIGINS setting changed to chrome-extension://* and a restart. LM Studio needs CORS turned on in its server settings.</p></div></li>
          <li><span class="no">3</span><div><h4>Test it and save</h4><p>Click Test connection, pick a model and click Save. Changing Connection doesn't turn anything on until you do.</p></div></li>
        </ol>
      </div>
      <div class="window">
        <header><div><h3>With the bridge</h3><p>Skip this unless you already use Claude Code or Codex. Windows only, and it counts against your Claude Code or Codex plan.</p></div></header>
        <h4 class="branch">First, install what it needs</h4>
        <p>Install <a href="https://nodejs.org">Node</a>. Make sure <a href="https://docs.claude.com/en/docs/claude-code/overview">Claude Code</a> or <a href="https://github.com/openai/codex">Codex</a> is installed and signed in. Claude Code has to come from its own installer, because the bridge can't start a copy installed with npm.</p>
        <h4 class="branch">If you installed with B</h4>
        <p>Open a new PowerShell window so it can find Node. Then run the Rote and the AI bridge command from <a href="#b-commands">step 2 of B</a>. If Rote is already in Chrome, click the reload icon on its card afterwards.</p>
        <h4 class="branch">If you installed with A</h4>
        <ol class="steps">
          <li><span class="no">1</span><div><h4>Download the bridge</h4><p class="do"><a class="tk" href="/download-bridge">Download the bridge</a></p><p class="pick">Unzip it and put the folder somewhere you won't delete it, like Documents. The bridge runs from there.</p></div></li>
          <li><span class="no">2</span><div><h4>Copy the setup command</h4><p>In Rote, click Profile and logs. Under AI review, change Connection to Claude Code on this PC or Codex on this PC, then click Copy setup command.</p></div></li>
          <li><span class="no">3</span><div><h4>Run it</h4><p>Open the unzipped folder, the one with a folder named bridge inside it. Right-click an empty spot and choose Open in Terminal, then press Ctrl+V and Enter. On Windows 10, hold Shift while you right-click and choose Open PowerShell window here.</p></div></li>
        </ol>
        <h4 class="branch">Then, either way</h4>
        <p>Under AI review in Profile and logs, set Connection to Claude Code on this PC or Codex on this PC and click Check again. When the page says Ready, click Save.</p>
      </div>
    </div>
    <p class="note">If you move the Rote folder or the bridge folder later, you'll need to set the bridge up again. Whichever way you connect, clicking Review missed sends your whole profile and saved answers to the provider you picked. With the bridge, that's Claude or Codex.</p>
  </div>
  <p class="after">Updating later? If you used A, unzip the new download, copy everything in it over your old Rote folder and choose Replace. If you used B, run the same command again, the bridge one if that's what you used. Then click the reload icon on Rote's card on the extensions page. Don't click Load unpacked again. Your profile and saved answers only stick around if Rote keeps loading from the same folder.</p>
</div></section>

<section id="use"><div class="wrap">
  <h2>Use it</h2>
  <p class="intro">Add your resume once. After that, it's a couple of clicks per application, plus whatever Rote couldn't answer.</p>
<ol class="roll">
  <li><b>1</b><h3>Add your resume</h3><p>Click the Rote icon, then Profile and logs. Add your resume as a PDF, a .docx Word file or a text file and fix anything it got wrong. Fill in the stuff a resume doesn't cover, then click Save profile.</p><p>It all stays in your browser.</p></li>
  <li><b>2</b><h3>Scan the page</h3><p>Open a job application on any site. Click the Rote icon to open the side panel, then click Scan page.</p><p>The scan runs in your browser.</p></li>
  <li><b>3</b><h3>Click Fill form</h3><p>Rote attaches your resume and fills in what it knows. Green means it's confident. Amber means double-check it. Undo clears what it filled, and the panel tells you if a custom control needs resetting by hand.</p><p>Your details are on the job site's form now, and some sites save them or upload your resume right away, same as if you'd typed them in.</p></li>
  <li><b>4</b><h3>Finish and submit</h3><p>The side panel lists what's left for you to do. If the form has more pages, scan again on each one. If you set up AI, Review missed fills in what it can. Its answers go straight onto the form, so check each one.</p><p>Rote never sends the application. You click submit.</p></li>
</ol>
</div></section>

<section class="rules"><div class="wrap">
  <div class="posted">
  <h2>What Rote won't do</h2>
  <ul>
    <li>It won't click submit.</li>
    <li>It won't touch a CAPTCHA.</li>
    <li>It won't change what's already in a field without asking.</li>
    <li>It won't store or fill in Social Security numbers, dates of birth, passwords or bank details.</li>
  </ul>
  </div>
  <div class="data">
    <div><h3>Where your details go</h3><p>Your resume, profile and saved answers stay in your browser. There's no account, and I don't have a server holding any of it. When Rote fills out a form, your details go to that job site. <a href="/privacy">Read the privacy page</a>.</p></div>
    <div><h3>AI is off unless you turn it on</h3><p>If you turn it on, it takes a shot at the questions Rote missed, using Claude, Codex, another provider or a model on your own computer. Every time you click Review missed, your whole profile and saved answers go to whichever one you picked.</p></div>
  </div>
</div></section>

<section class="close"><div class="wrap">
  <div class="coffee">
    <h2>If Rote helps you get hired, buy me a coffee.</h2>
    <p>Rote's free and there are no ads. The code's on GitHub under the MIT license.</p>
    <a class="tk" href="https://buymeacoffee.com/SethWalker234">Buy me a coffee</a>
  </div>
  <footer>
    <span>Found a bug? Click Report a bug in Rote's side panel. Preview report shows exactly what gets sent.</span>
    <a href="/privacy">Privacy</a>
    <a href="https://github.com/shin2344234/rote">Source code</a>
  </footer>
</div></section>
<script>${homeScript}</script>
`);

const proseCss = `
  main { max-width: 42rem; padding: 32px var(--gutter) 96px; margin: 0 auto; }
  h1 { font-size: clamp(3.2rem, 8vw, 5rem); margin-bottom: 20px; }
  h2 { font-size: 34px; margin: 40px 0 8px; }
  p { margin: 0 0 14px; }
`;

export const PRIVACY_PAGE = shell('Rote privacy', 'What Rote keeps in your browser and what leaves it.', proseCss, `
${nav}
<main>
<h1>Privacy</h1>
<p>Your resume, profile and saved answers stay in your own browser. There's no account, and I don't run a server that holds any of that.</p>
<h2>What leaves your browser</h2>
<p>When Rote fills out a form, your details go to that job site, same as if you'd typed them. If it attaches your resume, that gets uploaded there too.</p>
<p>AI review is off until you turn it on. When you click its button, your whole profile, your saved answers and the unanswered questions go to whichever AI provider you picked. If you picked a model on your own computer, they stay on your computer.</p>
<p>A bug report only gets sent when you click Send report. It has your description, the extension and browser versions, the host name of the page, which AI connection and model you use, and Rote's log. The log has form field labels, field types, match scores and the address of each page you scanned, so a report can show which job postings you opened. Rote strips out your form answers and anything from your resume before the report leaves your browser. I only get a contact address if you type one in.</p>
<h2>What happens to a report</h2>
<p>Reports go to a private issue tracker that only I can read, and I use them to fix the bug you reported. If you want one deleted, send me its report ID in a new report.</p>
<h2>What Rote never collects</h2>
<p>Rote has no analytics and no tracking. It won't store or fill in Social Security numbers, dates of birth, passwords or bank details.</p>
</main>
`);

export const CONNECTED_PAGE = shell('Rote is connected', 'OpenRouter sign-in finished.', proseCss, `
<main>
<h1>Rote is connected</h1>
<p>OpenRouter approved the sign-in. This tab should close by itself. If it doesn't, you can close it.</p>
</main>
`);
