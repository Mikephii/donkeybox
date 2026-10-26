// Draws a piece at any time t. The piece is a list of layers (plain data, from compose/pieces.mjs);
// every moving value is a list of keys [{t, ...}] eased between. Nothing here plays on its own: time only
// moves when render(t) is called, so each frame comes out the same every time ("seek, don't play").
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The value of a key list at t: each key is {t, ...numbers}; between keys, eased. */
function at(keys, t, field) {
  if (!keys || !keys.length) return undefined;
  if (t <= keys[0].t) return keys[0][field];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) {
      if (a[field] === undefined || b[field] === undefined) return b[field] ?? a[field];
      const k = ease((t - a.t) / Math.max(1e-6, b.t - a.t));
      return a[field] + (b[field] - a[field]) * k;
    }
  }
  return keys[keys.length - 1][field];
}

const ICONS = {
  github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>',
  jira: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.6 2 2.2 11.4a.9.9 0 0 0 0 1.2l4.2 4.2L11.6 12a3.3 3.3 0 0 1 0-4.6l4.6-4.6L15.4 2a2.7 2.7 0 0 0-3.8 0Zm.8 10L7.2 17.2l4.4 4.4a1 1 0 0 0 1.2 0l9-9a.9.9 0 0 0 0-1.2l-4.2-4.2L12.4 12Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13v1M15 13v1"/></svg>',
  laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
  lid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18M5 18l2-9h10l2 9"/></svg>',
};
const dot = (color, inner, size = 30) => `<span class="dot" style="background:${color};width:${size}px;height:${size}px">${inner}</span>`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const builders = {
  footage(L, el) {
    el.classList.add("footage");
    if (L.flat) el.classList.add("flat");
    const img = document.createElement("img");
    el.appendChild(img);
    if (L.label) {
      const lab = document.createElement("div");
      lab.className = "label";
      lab.innerHTML = `${dot(L.label.color, esc(L.label.name[0]))}${esc(L.label.text ?? L.label.name)}`;
      el.appendChild(lab);
    }
    const ring = document.createElement("div");
    ring.className = "ring";
    ring.style.opacity = 0;
    el.appendChild(ring);
    return (t) => {
      const i = clamp(Math.floor((t - L.t0) * 30 + 1e-6), 0, L.frames.length - 1);
      const src = L.frames[i];
      const crop = L.crop ?? [{ t: 0, x: 0, y: 0, w: 1600 }];
      const w = at(crop, t, "w"), x = at(crop, t, "x"), y = at(crop, t, "y");
      const s = L.rect.w / w;
      img.style.transform = `scale(${s}) translate(${-x}px, ${-y}px)`;
      const flash = (L.rings ?? []).reduce((m, r) => Math.max(m, t >= r && t < r + 1.2 ? 1 - (t - r) / 1.2 : 0), 0);
      ring.style.opacity = flash;
      if (img.getAttribute("src") !== src) {
        img.setAttribute("src", src);
        return img.decode().catch(() => {});
      }
    };
  },
  bubble(L, el) {
    el.className += " bubble";
    const av = L.icon ? ICONS[L.icon] : esc(L.who[0]);
    el.innerHTML = `<span class="av" style="background:${L.color}">${av}</span><div class="msg"><div class="who">${esc(L.who)}${L.time ? `<time>${esc(L.time)}</time>` : ""}</div>${L.html}</div>`;
  },
  text(L, el) {
    el.innerHTML = L.html;
    if (L.cls) el.className += " " + L.cls;
    if (L.size) el.style.fontSize = L.size + "px";
    if (L.w) el.style.width = L.w + "px";
    if (L.color) el.style.color = L.color;
  },
  clock(L, el) {
    el.className += " mono";
    el.style.fontSize = (L.size ?? 96) + "px";
    el.style.fontWeight = 600;
    el.style.letterSpacing = "-0.04em";
    return (t) => {
      const m = Math.round(at(L.keys, t, "m")) % 1440;
      el.textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };
  },
  rail(L, el) {
    el.className += " rail";
    el.style.width = L.w + "px";
    el.innerHTML = L.rows.map((r) => `<div class="row"><time>${esc(r.time)}</time><span>${r.html}</span></div>`).join("");
    const rows = [...el.children];
    return (t) => {
      let now = -1;
      L.rows.forEach((r, i) => t >= r.t && (now = i));
      rows.forEach((row, i) => (row.className = "row " + (i < now ? "past" : i === now ? "now" : "future")));
    };
  },
  term(L, el) {
    el.className += " term";
    el.style.width = L.w + "px";
    el.style.height = L.h + "px";
    el.innerHTML = `<div class="bar"><i></i><i></i><i></i><span>${esc(L.title ?? "")}</span></div><pre></pre>`;
    const pre = el.querySelector("pre");
    return (t) => {
      let html = "";
      for (const s of L.script) {
        if (t < s.t) break;
        if (s.type) {
          const n = Math.min(s.type.length, Math.floor((t - s.t) * (s.cps ?? 18)));
          html += `<span class="p">${esc(s.prompt ?? "")}</span>${esc(s.type.slice(0, n))}`;
          if (n >= s.type.length && t >= s.t + s.type.length / (s.cps ?? 18) + 0.25) html += "\n";
          else html += '<span class="c"></span>';
        } else html += s.html + "\n";
      }
      pre.innerHTML = html;
    };
  },
  avatars(L, el) {
    el.style.display = "flex";
    el.style.gap = "18px";
    el.innerHTML = L.people
      .map((p) => `<div style="display:flex;align-items:center;gap:10px;font-size:22px;font-weight:600" data-p="${p.name}"><span style="position:relative">${dot(p.color, esc(p.name[0]), 46)}<span class="lid" style="position:absolute;right:-10px;bottom:-8px;width:28px;height:28px;border-radius:99px;background:var(--card);border:1px solid var(--border);display:grid;place-items:center;color:var(--muted-foreground)"><span style="width:18px;height:18px;display:block">${ICONS.lid}</span></span></span><span>${esc(p.name)}</span></div>`)
      .join("");
    const items = [...el.children];
    return (t) =>
      L.people.forEach((p, i) => {
        const away = (p.away ?? []).some(([a, b]) => t >= a && t < b);
        items[i].style.opacity = away ? 0.35 : 1;
        items[i].querySelector(".lid").style.opacity = away ? 1 : 0;
      });
  },
  scrim(L, el) {
    el.style.background = L.color ?? "var(--night)";
    el.style.borderRadius = (L.radius ?? 16) + "px";
    el.style.mixBlendMode = L.blend ?? "normal";
    return (t) => (el.style.opacity = at(L.keys, t, "a"));
  },
  html(L, el) {
    el.innerHTML = L.html;
    return L.dash ? (t) => el.querySelectorAll("svg.flow path").forEach((p) => (p.style.strokeDashoffset = String(-t * L.dash))) : undefined;
  },
};

let layers = [];
window.setup = (spec) => {
  document.documentElement.classList.toggle("dark", spec.theme === "dark");
  const stage = document.getElementById("stage");
  stage.innerHTML = "";
  layers = spec.layers.map((L) => {
    const el = document.createElement("div");
    el.className = "layer";
    Object.assign(el.style, { left: (L.rect?.x ?? L.x ?? 0) + "px", top: (L.rect?.y ?? L.y ?? 0) + "px", zIndex: L.z ?? 1 });
    if (L.rect) Object.assign(el.style, { width: L.rect.w + "px", height: L.rect.h + "px" });
    // A reply sits by its right edge, avatar on the right, like the other side of a chat.
    if (L.rightEdge) Object.assign(el.style, { left: "auto", right: 1600 - L.rightEdge + "px", flexDirection: "row-reverse" });
    stage.appendChild(el);
    const update = builders[L.kind](L, el) ?? (() => {});
    return { L, el, update };
  });
  return document.fonts.ready.then(() => true);
};

window.render = async (t) => {
  const waits = [];
  for (const { L, el, update } of layers) {
    const t0 = L.t0 ?? 0, t1 = L.t1 ?? Infinity;
    const fi = L.fadeIn ?? 0.35, fo = L.fadeOut ?? 0.35;
    let o = t < t0 || t >= t1 ? 0 : Math.min(fi ? (t - t0) / fi : 1, fo && t1 !== Infinity ? (t1 - t) / fo : 1, 1);
    if (L.move) {
      const x = at(L.move, t, "x") ?? 0, y = at(L.move, t, "y") ?? 0, s = at(L.move, t, "s") ?? 1, mo = at(L.move, t, "o") ?? 1;
      el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      el.style.transformOrigin = L.origin ?? "50% 50%";
      o *= mo;
    } else if (L.rise && t >= t0) {
      const k = ease(clamp((t - t0) / 0.45, 0, 1));
      el.style.transform = `translateY(${(1 - k) * 18}px)`;
    }
    el.style.opacity = clamp(o, 0, 1);
    el.style.visibility = o <= 0 ? "hidden" : "visible";
    if (o > 0 || L.kind === "footage") {
      const w = update(t);
      if (w) waits.push(w);
    }
  }
  await Promise.all(waits);
  return true;
};
