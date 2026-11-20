/* Núcleo · codigo.js — resaltado de Python y salida de consola. */
import { esc } from './util.js';

const KW = new Set(['def','return','if','elif','else','for','while','in','and','or','not','break','continue','True','False','None','global','import','from','as','pass']);
const BI = new Set(['print','input','int','float','str','len','range','sorted','sum','max','min','type','round','abs','list']);

export function pinta(code) {
  const re = /(#[^\n]*)|(f?"[^"\n]*"|f?'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|(________)|(\.[A-Za-z_]\w*(?=\())|([A-Za-z_]\w*)|([\s\S])/g;
  let o = '', m;
  while ((m = re.exec(code))) {
    if (m[1]) o += '<span class="c">' + esc(m[1]) + '</span>';
    else if (m[2]) o += '<span class="s">' + esc(m[2]) + '</span>';
    else if (m[3]) o += '<span class="n">' + m[3] + '</span>';
    else if (m[4]) o += '<span class="hueco">?</span>';
    else if (m[5]) o += '.<span class="m">' + esc(m[5].slice(1)) + '</span>';
    else if (m[6]) o += KW.has(m[6]) ? '<span class="k">' + m[6] + '</span>' : BI.has(m[6]) ? '<span class="f">' + m[6] + '</span>' : m[6];
    else o += esc(m[7]);
  }
  return o;
}
export const conLineas = code => pinta(code).split('\n').map((l, i) => '<span class="ln">' + (i + 1) + '</span>' + l).join('\n');
export const consola = txt => esc(txt).split('\n').map(l => /^(\w+Error)\b/.test(l) ? '<span class="err">' + l + '</span>' : l).join('\n');
