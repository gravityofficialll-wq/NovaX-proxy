// NovaX proxy server — no dependencies. Run: node server.js  → http://localhost:8080
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8080;
const enc = encodeURIComponent;
const prox = (u) => '/go?url=' + enc(u);
const absUrl = (v, base) => { try { return new URL(v, base).href; } catch { return null; } };
const SKIP = /^(#|data:|javascript:|mailto:|tel:|blob:|about:)/i;

// Basic guard so the proxy can't be pointed at your own machine/network.
const isPrivate = (h) => /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$)/i.test(h);

function clientScript(base) {
  const b = JSON.stringify(base).replace(/</g, '\\u003c');
  return `<script>(function(){var B=${b},P=function(u){try{u=new URL(u,B).href}catch(e){return u}return '/go?url='+encodeURIComponent(u)};
var f=window.fetch;window.fetch=function(i,o){try{if(typeof i==='string')i=P(i);else if(i&&i.url)i=new Request(P(i.url),i)}catch(e){}return f.call(this,i,o)};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=P(u);return xo.apply(this,arguments)};
document.addEventListener('submit',function(e){var fm=e.target;if(!fm||fm.tagName!=='FORM')return;e.preventDefault();
var a=new URL(fm.getAttribute('action')||'',B);
if((fm.method||'get').toLowerCase()==='post'){fm.action=P(a.href);HTMLFormElement.prototype.submit.call(fm);}
else{new FormData(fm).forEach(function(v,k){if(typeof v==='string')a.searchParams.set(k,v)});location.href=P(a.href)}},true);
window.open=function(u){location.href=P(u);return null};
document.addEventListener('click',function(e){var l=e.target.closest&&e.target.closest('a');if(l&&l.target==='_blank')l.target='_self'},true);
if(window.parent!==window)parent.postMessage({novax:B},'*');
if(window.parent===window){document.addEventListener('DOMContentLoaded',function(){
var h=document.createElement('div');h.style.cssText='all:initial;position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647';
var s=h.attachShadow({mode:'open'});
s.innerHTML='<style>*{box-sizing:border-box;font-family:system-ui,sans-serif}.b{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 14px;border-radius:999px;background:rgba(14,9,38,.92);border:1px solid rgba(169,139,255,.5);box-shadow:0 6px 30px rgba(80,50,200,.45);backdrop-filter:blur(10px)}a{font-weight:800;font-size:15px;text-decoration:none;background:linear-gradient(90deg,#b9a4ff,#7fc4ff,#ff9ae0);-webkit-background-clip:text;background-clip:text;color:transparent}form{display:flex;gap:6px;margin:0}input{width:min(300px,52vw);font-size:13px;padding:6px 12px;border-radius:999px;border:1px solid rgba(190,170,255,.35);background:rgba(8,5,24,.9);color:#f4f1ff;outline:none}input:focus{border-color:#a98bff}button{font-size:13px;font-weight:700;padding:6px 14px;border-radius:999px;border:0;color:#fff;cursor:pointer;background:linear-gradient(90deg,#8e6bff,#4aa8ff)}.x{color:#a79fcf;cursor:pointer;font-size:18px;padding:0 4px}:host(.m) .b{padding:4px 12px}:host(.m) form,:host(.m) .x{display:none}</style><div class="b"><a href="/">NovaX</a><form><input placeholder="Search or enter a web address"><button>Go</button></form><span class="x" title="Hide">&times;</span></div>';
var w=s.querySelector('.b'),inp=s.querySelector('input');
s.querySelector('.x').onclick=function(){s.host.classList.add('m')};
w.querySelector('a').onclick=function(e){if(s.host.classList.contains('m')){e.preventDefault();s.host.classList.remove('m')}};
s.querySelector('form').onsubmit=function(e){e.preventDefault();var q=inp.value.trim();if(!q)return;var u;
if(/^https?:/i.test(q))u=q;else if(q.indexOf(' ')<0&&q.indexOf('.')>0)u='https://'+q;else u='https://html.duckduckgo.com/html/?q='+encodeURIComponent(q);
location.href='/go?url='+encodeURIComponent(u)};
document.documentElement.appendChild(h)})}
})();</script>`;
}

function rewriteHtml(html, base) {
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy[^>]*>/gi, '');
  html = html.replace(/\s(integrity|crossorigin|nonce)=(["']).*?\2/gi, '');
  html = html.replace(/\s(href|src|poster)=(["'])(.*?)\2/gi, (m, a, q, v) => {
    if (SKIP.test(v.trim())) return m;
    const u = absUrl(v.replace(/&amp;/g, '&').trim(), base);
    return u ? ` ${a}=${q}${prox(u)}${q}` : m;
  });
  const inj = clientScript(base);
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inj) : inj + html;
}

function rewriteCss(css, base) {
  return css.replace(/url\(\s*(['"]?)(?!data:)(.*?)\1\s*\)/gi, (m, q, v) => {
    const u = absUrl(v, base);
    return u ? `url(${q}${prox(u)}${q})` : m;
  });
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (u.pathname !== '/go') { res.writeHead(404); return res.end('Not found'); }

  let target;
  try { target = new URL(u.searchParams.get('url')); } catch { res.writeHead(400); return res.end('Bad URL'); }
  if (!/^https?:$/.test(target.protocol) || isPrivate(target.hostname)) { res.writeHead(403); return res.end('Blocked'); }

  const headers = {
    'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
    'accept': req.headers.accept || '*/*',
    'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9',
    'accept-encoding': 'identity',
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];

  const lib = target.protocol === 'https:' ? https : http;
  const up = lib.request(target, { method: req.method, headers }, (r) => {
    const out = {};
    const drop = /^(x-frame-options|content-security-policy.*|strict-transport-security|set-cookie|content-length|content-encoding|transfer-encoding|connection)$/i;
    for (const [k, v] of Object.entries(r.headers)) if (!drop.test(k)) out[k] = v;
    out['access-control-allow-origin'] = '*';
    if (r.headers.location) { const l = absUrl(r.headers.location, target.href); if (l) out.location = prox(l); }

    const type = (r.headers['content-type'] || '').toLowerCase();
    if (type.includes('text/html') || type.includes('text/css')) {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        body = type.includes('html') ? rewriteHtml(body, target.href) : rewriteCss(body, target.href);
        res.writeHead(r.statusCode, out);
        res.end(body);
      });
    } else {
      res.writeHead(r.statusCode, out);
      r.pipe(res);
    }
  });
  up.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Could not reach site: ' + e.message); });
  req.pipe(up);
}).listen(PORT, () => console.log('NovaX running at http://localhost:' + PORT));
