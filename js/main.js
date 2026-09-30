const app = document.querySelector("#app");
const track = document.querySelector("#track");

const scenes = [...document.querySelectorAll(".scene")];            // 스토리 장면 (빨간 실)
const pages = [...track.querySelectorAll(".scene, .info-page, .back-page")];   // 넘기는 모든 장
const infoPages = [...track.querySelectorAll(".info-page")];
const prevBtn = document.querySelector("#prev");
const nextBtn = document.querySelector("#next");
const pageNow = document.querySelector("#pageNow");
document.querySelector("#pageTotal").textContent = pages.length;

const SVG_NS = "http://www.w3.org/2000/svg";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* 곡선의 둥근 정도 (0 = 직선, 1 = 기본 Catmull-Rom) */
const TENSION = 1;
/* 실이 그려지는 속도 (px / ms) — 장을 넘기면 이 속도로 그 장의 실이 그려진다 */
const DRAW_SPEED = 0.55;
/* 한 번에 그리는 시간의 최소·최대 (ms) */
const DRAW_MIN = 500;
const DRAW_MAX = 2800;
/* 마지막 하트가 그려지는 시간 (ms) */
const FINALE_DURATION = 1600;
/* 하트를 이루는 점 개수 (많을수록 매끈) */
const HEART_STEPS = 64;
/* 고리(loop)를 이루는 점 개수 */
const LOOP_STEPS = 14;


/* =========================================================
   1. 장면 레이어 만들기
   장면마다: 배경 → 뒤쪽 실 → 인물 → 앞쪽 실
   ========================================================= */
function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

const layers = scenes.map(scene => {
  const art = scene.querySelector(".scene-art");

  // 뒤쪽 실 (인물에 가려짐)
  const back = el("svg", { class: "thread thread--back", "aria-hidden": "true" });
  const backShadow = back.appendChild(el("path", { class: "thread-shadow" }));
  const backPath = back.appendChild(el("path", { class: "thread-path" }));
  const backTip = back.appendChild(el("circle", { class: "thread-tip", r: 2.6 }));

  // 인물 레이어 (배경과 같은 크기·위치)
  const charArt = document.createElement("div");
  charArt.className = "scene-art scene-art--char";
  charArt.style.cssText = art.style.cssText;
  const charImg = document.createElement("img");
  charImg.alt = "";
  charImg.setAttribute("data-anim", "");
  charArt.appendChild(charImg);

  // 앞쪽 실 (인물 위로 지나감) — 인물 "뒤"로 정해진 구간만 빼고 그린다
  const front = el("svg", { class: "thread thread--front", "aria-hidden": "true" });
  const frontShadow = front.appendChild(el("path", { class: "thread-shadow" }));
  const frontPath = front.appendChild(el("path", { class: "thread-path" }));
  const frontTip = front.appendChild(el("circle", { class: "thread-tip", r: 2.6 }));

  art.after(back, charArt, front);

  return { scene, art, back, backPath, backShadow, backTip, front, frontPath, frontShadow, frontTip, charImg };
});


// 인물 이미지 (section 의 data-fg)
layers.forEach(layer => {
  if (layer.scene.dataset.fg) layer.charImg.src = layer.scene.dataset.fg;
});


/* =========================================================
   2. 장면 등장 애니메이션
   ========================================================= */
const sceneObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      entry.target.classList.toggle("is-in", entry.isIntersecting);
    });
  },
  { root: track, threshold: 0.6 }
);

pages.forEach(page => sceneObserver.observe(page));


/* =========================================================
   3. 실이 지나갈 점 모으기
   - [data-thread] 요소 중심점을 DOM 순서대로 (왼쪽 → 오른쪽)
   - data-thread-finale : 마지막 장에서 여기까지 그린 뒤 하트를 그림
   - data-heart="N"     : 이 점을 아래 꼭짓점으로 하는 하트(이미지 폭 N%)로 펼침
     앞 점은 꼭짓점의 왼쪽 아래, 다음 점은 오른쪽 아래에 두면 실이 X자로 엇갈리며 자연스럽게 이어진다
     data-heart-tilt="-8" : 하트 기울기(도)
   - data-loop="N"      : 이 점에서 실이 한 바퀴 감기는 고리(지름 = 이미지 폭 N%)
     data-loop-dir="down" 이면 아래쪽으로 감긴다 (기본은 위쪽)
   - data-behind        : 이 점 → 다음 점 구간은 인물 뒤로 지나감
   - data-fg            : 인물 위의 점 (인물 크기 --fg-scale 을 바꾸면 같이 움직임)
     표시가 없는 점은 화면(최종 합성 이미지) 기준으로 제자리에 있다.
   ========================================================= */
function getFgTransform(scene) {
  const style = getComputedStyle(scene);
  const scale = parseFloat(style.getPropertyValue("--fg-scale")) || 1;
  const originY = parseFloat(style.getPropertyValue("--fg-origin-y"));
  const art = scene.querySelector(".scene-art").getBoundingClientRect();

  return {
    scale,
    ox: art.left + art.width / 2,
    oy: art.top + art.height * ((isNaN(originY) ? 100 : originY) / 100)
  };
}


function getLoopPoints(start, diameter, dir) {
  // 오른쪽으로 가던 실이 위(또는 아래)로 한 바퀴 돌아 다시 오른쪽으로 빠져나가는 고리.
  // 도는 동안 조금씩 앞으로 밀려서 필기체 'ℓ' 처럼 자연스럽게 겹친다.
  const r = diameter / 2;
  const sign = dir === "down" ? -1 : 1;
  const drift = r * 0.8;
  const points = [];

  for (let i = 1; i < LOOP_STEPS; i++) {
    const t = (2 * Math.PI * i) / LOOP_STEPS;
    points.push({
      x: start.x + r * Math.sin(t) + (drift * i) / LOOP_STEPS,
      y: start.y - sign * r * (1 - Math.cos(t)),
      page: start.page,
      behind: start.behind
    });
  }

  return points;
}


function getHeartPoints(bottom, width, tiltDeg = -8) {
  // 하트 곡선: x = 16sin³t, y = 13cos t − 5cos2t − 2cos3t − cos4t
  // 실이 왼쪽 아래에서 아래 꼭짓점을 지나 올라와 → 오른쪽 볼록 → 가운데 오목 → 왼쪽 볼록 →
  // 다시 아래 꼭짓점으로 내려와 처음 실과 X자로 엇갈리며 오른쪽 아래로 빠져나간다.
  // (t = π → 0 → −π 순서로 돌면 오른쪽부터 그려진다)
  const s = width / 32;
  const tilt = (tiltDeg * Math.PI) / 180;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const points = [];

  for (let i = 1; i <= HEART_STEPS; i++) {
    const t = Math.PI - (2 * Math.PI * i) / HEART_STEPS;
    const hx = 16 * Math.sin(t) ** 3 * s;
    const hy =
      -(13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t) + 17) * s;

    // 아래 꼭짓점을 중심으로 살짝 기울여 손으로 그린 느낌
    points.push({
      x: bottom.x + hx * cos - hy * sin,
      y: bottom.y + hx * sin + hy * cos,
      page: bottom.page,
      behind: bottom.behind,
      fixed: true
    });
  }

  return points;
}


function getThreadPoints() {
  const trackRect = track.getBoundingClientRect();
  const pageWidth = track.clientWidth;
  const fgTransforms = scenes.map(getFgTransform);
  const points = [];

  document.querySelectorAll("[data-thread]").forEach(el => {
    const rect = el.getBoundingClientRect();
    const page = scenes.indexOf(el.closest(".scene"));

    let cx = rect.left + rect.width / 2;
    let cy = rect.top + rect.height / 2;

    // data-fg 점은 인물이 줄어든 만큼 같이 옮긴다
    const onEdge = el.style.left === "0%" || el.style.left === "100%";
    const fg = fgTransforms[page];
    const followsFg = "fg" in el.dataset && !onEdge;
    if (followsFg) {
      cx = fg.ox + (cx - fg.ox) * fg.scale;
      cy = fg.oy + (cy - fg.oy) * fg.scale;
    }

    const point = {
      x:
        cx -
        trackRect.left +
        track.scrollLeft,

      y:
        cy -
        trackRect.top,

      page,
      behind: "behind" in el.dataset
    };
    const sizeScale = followsFg ? fg.scale : 1;

    // 장 경계 점(left:0% / 100%)은 화면 가장자리에 정확히 맞춘다 → 앞뒤 장의 실이 끊김 없이 이어짐
    // 그 밖의 점은 화면 밖(예: left:108%)에 둬도 된다. 실이 화면 밖에서 돌아 나오는 데 쓴다
    if (el.style.left === "0%") point.x = page * pageWidth;
    if (el.style.left === "100%") point.x = (page + 1) * pageWidth;
    // 장 경계 점, 화면 밖에서 돌아 나오는 점은 다듬지 않는다 (옮기면 도는 부분이 화면 안에 보임)
    const left = parseFloat(el.style.left);
    if (onEdge || left < 0 || left > 100) point.fixed = true;

    // 겹치는 점은 하나로 합친다
    const prev = points[points.length - 1];
    if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 2) {
      points.push(point);
    }

    if ("threadFinale" in el.dataset) {
      points[points.length - 1].finale = true;
    }

    if (el.dataset.loop) {
      const diameter = el.parentElement.clientWidth * (parseFloat(el.dataset.loop) / 100) * sizeScale;
      points.push(...getLoopPoints(point, diameter, el.dataset.loopDir));
    }

    if (el.dataset.heart) {
      const width = el.parentElement.clientWidth * (parseFloat(el.dataset.heart) / 100) * sizeScale;
      points[points.length - 1].fixed = true;
      const tilt = el.dataset.heartTilt !== undefined ? parseFloat(el.dataset.heartTilt) : -8;
      points.push(...getHeartPoints(point, width, tilt));
    }
  });

  return points;
}


/* =========================================================
   4. 점들을 부드러운 곡선으로 잇기
   ========================================================= */
/* 점 다듬기: 각 점을 이웃 점들의 가운데 쪽으로 조금씩 당겨 울퉁불퉁함을 편다.
   장 경계 점과 하트는 그대로 둔다. */
const SMOOTH_PASSES = 3;
const SMOOTH_AMOUNT = 0.35;

function smoothPoints(points) {
  let pts = points.map(p => ({ ...p }));

  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    pts = pts.map((p, i) => {
      const prev = pts[i - 1];
      const next = pts[i + 1];
      if (!prev || !next || p.fixed || p.finale || prev.fixed && next.fixed) return p;
      return {
        ...p,
        x: p.x + SMOOTH_AMOUNT * ((prev.x + next.x) / 2 - p.x),
        y: p.y + SMOOTH_AMOUNT * ((prev.y + next.y) / 2 - p.y)
      };
    });
  }

  return pts;
}


/* Centripetal Catmull-Rom → cubic bezier (i → i+1)
   점 간격이 들쭉날쭉해도 곡선이 튀거나 꺾이지 않는다. tension 으로 둥근 정도 조절 */
function getSegment(points, i, tension = TENSION) {
  const p1 = points[i];
  const p2 = points[i + 1];
  const p0 = points[i - 1] || { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
  const p3 = points[i + 2] || { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };

  const dist = (a, b) => Math.max(1e-3, Math.hypot(b.x - a.x, b.y - a.y)) ** 0.5;
  const d1 = dist(p0, p1);
  const d2 = dist(p1, p2);
  const d3 = dist(p2, p3);

  // 기본 Catmull-Rom 제어점에서 tension 만큼만 반영
  const c1 = k => {
    const full = (d1 * d1 * p2[k] - d2 * d2 * p0[k] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[k]) / (3 * d1 * (d1 + d2));
    return p1[k] + (full - p1[k]) * tension;
  };
  const c2 = k => {
    const full = (d3 * d3 * p1[k] - d2 * d2 * p3[k] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[k]) / (3 * d3 * (d3 + d2));
    return p2[k] + (full - p2[k]) * tension;
  };

  return `C ${c1("x")} ${c1("y")}, ${c2("x")} ${c2("y")}, ${p2.x} ${p2.y}`;
}


function createSmoothPath(points, tension = TENSION, from = 0, to = points.length - 1) {
  if (to - from < 1) return "";

  let d = `M ${points[from].x} ${points[from].y}`;

  for (let i = from; i < to; i++) {
    d += ` ${getSegment(points, i, tension)}`;
  }

  return d;
}


function buildThread() {
  const pageWidth = track.clientWidth;
  const height = track.clientHeight;

  const points = smoothPoints(getThreadPoints());

  const d = createSmoothPath(points);

  layers.forEach((layer, page) => {
    // 모든 장이 같은 경로를 갖고, viewBox 로 자기 장 부분만 보여준다
    const viewBox = `${page * pageWidth} 0 ${pageWidth} ${height}`;
    layer.back.setAttribute("viewBox", viewBox);
    layer.front.setAttribute("viewBox", viewBox);

    [layer.backPath, layer.backShadow, layer.frontPath, layer.frontShadow].forEach(p => {
      p.setAttribute("d", d);
    });
  });

  prepareAnimation(points);
}


/* =========================================================
   5. 장별로 "여기까지 그린다" 길이 준비
   장 i 를 보고 있으면 실은 장 i 의 오른쪽 가장자리까지 그려져 있다.
   ========================================================= */
let refPath = null;     // 길이·좌표 계산에 쓰는 전체 경로
let totalLength = 0;
let lens = [];          // 각 점까지의 실 길이
let pageEnds = [];      // 장마다 그 장이 맡은 실의 끝 길이 (장 i 는 pageEnds[i-1] ~ pageEnds[i] 만 그린다)
let finaleLen = 0;      // 마지막 장에서 하트를 그리기 전까지의 길이
let frontSpans = [];    // 실이 "앞"에 보이는 길이 구간들 [[시작, 끝], ...]
let current = 0;
let activePage = -1;
let anim = null;
let ticking = false;


/* ---------------------------------------------------------
   인물과 겹치는 구간 찾기
   실을 따라가며 인물 실루엣(js/masks.js) 위에 있는지 확인하고,
   인물과 겹치는 한 덩어리는 통째로 "앞" 또는 "뒤"로 정한다.
   → 인물 한가운데서 앞/뒤가 바뀌어 실이 몸을 뚫고 들어가 보이는 일이 없다.
   덩어리 안에서 data-behind 구간이 절반 이상이면 "뒤", 아니면 "앞".
   <section data-thread-layer="front|behind"> 이면 그 장은 통째로 앞 또는 뒤.
   --------------------------------------------------------- */
const MASK_STEP = 3;   // 몇 px 마다 확인할지

function decodeMask(mask) {
  const bin = atob(mask.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { w: mask.w, h: mask.h, bytes };
}

const masks = scenes.map(scene => {
  const mask = window.FG_MASKS && window.FG_MASKS[scene.dataset.fg];
  return mask ? decodeMask(mask) : null;
});


function getFgHitTest() {
  const trackRect = track.getBoundingClientRect();
  const pageWidth = track.clientWidth;

  const info = layers.map((layer, page) => {
    const rect = layer.art.getBoundingClientRect();
    const fg = getFgTransform(layer.scene);
    return {
      mask: masks[page],
      left: rect.left - trackRect.left + track.scrollLeft,
      top: rect.top - trackRect.top,
      width: rect.width,
      height: rect.height,
      scale: fg.scale,
      originY: (fg.oy - rect.top) / rect.height
    };
  });

  // 장 page 의 인물 위에 있으면 true (마스크가 없는 장면은 null)
  return (x, y, page) => {
    const it = info[page];
    if (!it.mask) return null;

    // 인물은 (가운데, originY) 기준으로 scale 만큼 줄어 있으므로 되돌려서 원본 좌표로
    const u = 0.5 + ((x - it.left) / it.width - 0.5) / it.scale;
    const v = it.originY + ((y - it.top) / it.height - it.originY) / it.scale;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;

    const i = Math.floor(v * it.mask.h) * it.mask.w + Math.floor(u * it.mask.w);
    return (it.mask.bytes[i >> 3] & (1 << (i & 7))) !== 0;
  };
}


function getFrontSpans(points) {
  const hit = getFgHitTest();
  const behindSpans = [];

  let seg = 0;
  let run = null;   // 인물과 겹치는 중인 덩어리 { start, total, behind }

  const closeRun = end => {
    if (run && run.behind * 2 >= run.total) behindSpans.push([run.start, end]);
    run = null;
  };

  for (let l = 0; l <= totalLength; l += MASK_STEP) {
    while (seg < lens.length - 2 && lens[seg + 1] <= l) seg++;
    const page = pageOf(l);

    // 장면에 data-thread-layer 가 있으면 그 장의 실은 통째로 앞/뒤
    const forced = scenes[page].dataset.threadLayer;
    if (forced === "front") {
      closeRun(l);
      continue;
    }
    if (forced === "behind") {
      if (!run) run = { start: l, total: 0, behind: 0 };
      run.total++;
      run.behind++;
      continue;
    }

    const p = refPath.getPointAtLength(l);
    let over = hit(p.x, p.y, page);

    // 인물 마스크가 없으면 data-behind 표시만 따른다
    if (over === null) over = points[seg].behind;

    if (over) {
      if (!run) run = { start: l, total: 0, behind: 0 };
      run.total++;
      if (points[seg].behind) run.behind++;
    } else {
      closeRun(l);
    }
  }
  closeRun(totalLength);

  // "뒤" 구간을 뺀 나머지가 "앞" 구간
  const spans = [];
  let cursor = 0;
  behindSpans.forEach(([a, b]) => {
    if (a > cursor) spans.push([cursor, a]);
    cursor = b;
  });
  if (cursor < totalLength) spans.push([cursor, totalLength]);
  return spans;
}


function prepareAnimation(points) {
  if (points.length < 2) return;
  refPath = layers[0].backPath;

  // 각 점까지의 실 길이 (세그먼트별로 재서 누적)
  const measure = el("path");
  layers[0].back.appendChild(measure);
  lens = [0];
  for (let i = 0; i < points.length - 1; i++) {
    measure.setAttribute("d", `M ${points[i].x} ${points[i].y} ${getSegment(points, i)}`);
    lens.push(lens[i] + measure.getTotalLength());
  }
  measure.remove();

  totalLength = refPath.getTotalLength();

  // 장 i 가 맡은 실: 앞 장의 끝 ~ 장 i 의 마지막 점(보통 오른쪽 경계 점)
  // 각 장은 자기 구간만 그리므로, 화면 밖에서 돌아 나오는 부분이 옆 장에 비치지 않는다
  pageEnds = scenes.map((_, page) => {
    if (page === scenes.length - 1) return totalLength;
    const a = points.findLastIndex(p => p.page === page);
    return a < 0 ? (page === 0 ? 0 : pageEnds[page - 1]) : lens[a];
  });

  frontSpans = getFrontSpans(points);

  const finaleIndex = points.findIndex(p => p.finale);
  finaleLen = finaleIndex > 0 ? lens[finaleIndex] : totalLength;

  // 리사이즈 등으로 다시 계산하면 애니메이션 없이 현재 장 상태로 맞춘다
  anim = null;
  current = activePage >= 0 ? targetFor(activePage) : 0;
  render();
}


function pageStart(page) {
  return page === 0 ? 0 : pageEnds[page - 1];
}

function pageOf(len) {
  const page = pageEnds.findIndex(end => len <= end);
  return page < 0 ? scenes.length - 1 : page;
}


function targetFor(page) {
  return page >= scenes.length - 1 ? totalLength : pageEnds[page];
}


/* =========================================================
   6. 그리기 (시간 기반 트윈)
   ========================================================= */
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function durationFor(distance) {
  return Math.min(DRAW_MAX, Math.max(DRAW_MIN, Math.abs(distance) / DRAW_SPEED));
}


function drawTo(len, duration, next) {
  anim = { from: current, to: len, duration, next, t0: null };
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(frame);
  }
}


function drawPage(page) {
  if (reduceMotion) {
    current = targetFor(Math.min(page, scenes.length - 1));
    render();
    return;
  }

  // 스토리 뒤의 정보 페이지에서는 실이 끝까지(하트까지) 그려진 상태
  page = Math.min(page, scenes.length - 1);
  const isLast = page === scenes.length - 1;

  if (isLast && current < finaleLen - 1) {
    // 마지막 장: 하트 앞까지 그린 뒤, 이어서 하트
    drawTo(finaleLen, durationFor(finaleLen - current), () => {
      drawTo(totalLength, FINALE_DURATION);
    });
  } else {
    const target = targetFor(page);
    drawTo(target, isLast ? FINALE_DURATION : durationFor(target - current));
  }
}


/* 보일 구간들 [[a, b], ...] → stroke-dasharray / dashoffset */
function dashFor(intervals) {
  const visible = intervals.filter(([a, b]) => b - a > 0.5);
  if (!visible.length) return null;

  const pattern = [];
  visible.forEach(([a, b], i) => {
    const next = visible[i + 1];
    pattern.push(b - a, next ? next[0] - b : totalLength * 2);
  });
  return { array: pattern.join(" "), offset: -visible[0][0] };
}


function applyDash(paths, dash) {
  paths.forEach(p => {
    p.style.display = dash ? "" : "none";
    if (dash) {
      p.style.strokeDasharray = dash.array;
      p.style.strokeDashoffset = dash.offset;
    }
  });
}


function render() {
  if (!refPath) return;
  const tipPoint = current > 1 ? refPath.getPointAtLength(current) : null;
  const tipPage = pageOf(current);
  const tipInFront = frontSpans.some(([a, b]) => current >= a && current <= b);

  layers.forEach((layer, page) => {
    // 이 장이 맡은 구간 중, 지금까지 그려진 부분
    const start = pageStart(page);
    const end = Math.min(pageEnds[page], current);

    // 뒤쪽 실: 구간 전체 (인물에 가려지는 부분은 인물 레이어가 덮는다)
    applyDash([layer.backPath, layer.backShadow], dashFor([[start, end]]));

    // 앞쪽 실: 그중 "앞" 구간만
    const front = frontSpans.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]);
    applyDash([layer.frontPath, layer.frontShadow], dashFor(front));

    const showTip = tipPoint && page === tipPage;
    if (showTip) {
      [layer.frontTip, layer.backTip].forEach(tip => {
        tip.setAttribute("cx", tipPoint.x);
        tip.setAttribute("cy", tipPoint.y);
      });
    }
    layer.frontTip.style.display = showTip && tipInFront ? "" : "none";
    layer.backTip.style.display = showTip && !tipInFront ? "" : "none";
  });

  track.classList.toggle("is-drawing", anim !== null && current > 1 && current < totalLength - 0.5);
  track.classList.toggle("is-complete", totalLength > 0 && current >= totalLength - 0.5);
}


function frame(now) {
  if (!anim) {
    ticking = false;
    render();
    return;
  }

  if (anim.t0 === null) anim.t0 = now;
  const p = Math.min(1, (now - anim.t0) / anim.duration);
  current = anim.from + (anim.to - anim.from) * easeInOut(p);

  if (p >= 1) {
    const next = anim.next;
    anim = null;
    if (next) next();
  }

  render();
  requestAnimationFrame(frame);
}


/* =========================================================
   7. 페이지 넘기기
   ========================================================= */
function currentPage() {
  return Math.round(track.scrollLeft / track.clientWidth);
}


function goTo(page) {
  page = Math.max(0, Math.min(pages.length - 1, page));
  track.scrollTo({
    left: page * track.clientWidth,
    behavior: reduceMotion ? "auto" : "smooth"
  });
}


function onPageChange() {
  if (!started) return;
  const page = currentPage();
  if (page === activePage) return;

  if (activePage >= 0) app.classList.add("has-moved");
  activePage = page;

  pageNow.textContent = page + 1;
  prevBtn.disabled = page === 0;
  nextBtn.disabled = page === pages.length - 1;
  app.classList.toggle("on-info", pages[page].classList.contains("info-page"));

  drawPage(page);
}


track.addEventListener("scroll", onPageChange, { passive: true });

// 스토리 장면 탭: 화면 오른쪽 2/3 → 다음 장, 왼쪽 1/3 → 이전 장 (스와이프도 그대로 가능)
// 손가락이 움직였으면(스와이프) 탭으로 치지 않는다
const TAP_MOVE_LIMIT = 10;
let tapStart = null;

track.addEventListener("pointerdown", e => {
  tapStart = e.target.closest(".scene") ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
});

track.addEventListener("pointerup", e => {
  if (!tapStart || !started || lightboxOpen) return;
  const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
  const quick = Date.now() - tapStart.t < 500;
  tapStart = null;
  if (moved > TAP_MOVE_LIMIT || !quick) return;

  const rect = track.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  goTo(activePage + (x < 1 / 3 ? -1 : 1));
});

track.addEventListener("pointercancel", () => (tapStart = null));

prevBtn.addEventListener("click", () => goTo(activePage - 1));
nextBtn.addEventListener("click", () => goTo(activePage + 1));

window.addEventListener("keydown", e => {
  if (!started || lightboxOpen) return;
  if (e.key === "ArrowRight") goTo(activePage + 1);
  if (e.key === "ArrowLeft") goTo(activePage - 1);
});

// 데스크톱: 마우스 휠(위아래)도 한 장씩 넘기기
let wheelLock = false;
track.addEventListener(
  "wheel",
  e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

    // 정보 페이지 내용이 길어 세로로 스크롤할 수 있으면 그쪽을 먼저
    const scroller = e.target.closest && e.target.closest(".info-scroll");
    if (scroller) {
      const canDown = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
      const canUp = scroller.scrollTop > 0;
      if ((e.deltaY > 0 && canDown) || (e.deltaY < 0 && canUp)) return;
    }

    e.preventDefault();
    if (wheelLock || Math.abs(e.deltaY) < 4) return;
    wheelLock = true;
    goTo(activePage + (e.deltaY > 0 ? 1 : -1));
    setTimeout(() => (wheelLock = false), 700);
  },
  { passive: false }
);


/* =========================================================
   8. 초기화 & 리사이즈
   ========================================================= */
let resizeTimer;

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // 화면 폭이 바뀌어도 보던 장에 머무르기
    if (activePage >= 0) track.scrollLeft = activePage * track.clientWidth;
    buildThread();
  }, 150);
});

/* =========================================================
   9. 표지 — 탭하면 표지가 넘어가고, 첫 장으로 확대되며 시작
   ========================================================= */
const cover = document.querySelector("#cover");
const book = document.querySelector("#book");
const bookPage = document.querySelector("#bookPage");
let started = !cover;
if (started) app.classList.add("is-started");

// 첫 장: 1장 장면을 그대로 복제해서, 확대가 끝났을 때 실제 1장과 정확히 겹치도록 크기를 맞춘다
function fillBookPage() {
  if (!cover) return;
  const art = scenes[0].querySelector(".scene-art");
  const charArt = scenes[0].querySelector(".scene-art--char");
  const artRect = art.getBoundingClientRect();
  const appRect = app.getBoundingClientRect();
  const bookW = book.offsetWidth;
  const bookH = book.offsetHeight;

  // 책이 화면을 꽉 채울 만큼의 확대 비율
  const zoom = Math.max(appRect.width / bookW, appRect.height / bookH);
  cover.style.setProperty("--zoom", zoom);

  // 인물 크기(--fg-scale) 도 1장과 똑같이
  const sceneStyle = getComputedStyle(scenes[0]);
  ["--fg-scale", "--fg-origin-y"].forEach(name => {
    bookPage.style.setProperty(name, sceneStyle.getPropertyValue(name));
  });

  bookPage.replaceChildren();
  [art, charArt].forEach(src => {
    if (!src) return;
    const copy = src.cloneNode(true);
    copy.querySelectorAll("[data-thread], .thread-point").forEach(n => n.remove());
    copy.querySelectorAll("[data-anim]").forEach(n => n.removeAttribute("data-anim"));
    copy.removeAttribute("style");
    copy.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      width: ${artRect.width / zoom}px;
      height: ${artRect.height / zoom}px;
      transform: translate(-50%, -50%);
      aspect-ratio: auto;
    `;
    bookPage.appendChild(copy);
  });
}


function openCover() {
  if (!cover || cover.classList.contains("is-opening")) return;

  if (reduceMotion) {
    cover.classList.add("is-done");
    startStory();
    return;
  }

  fillBookPage();
  cover.classList.add("is-opening");
  // 표지가 거의 다 넘어갈 즈음 첫 장으로 확대
  setTimeout(() => cover.classList.add("is-zooming"), 1050);
  setTimeout(() => {
    cover.classList.add("is-done");
    startStory();
  }, 2100);
}


function startStory() {
  started = true;
  app.classList.add("is-started");
  activePage = -1;
  onPageChange();
}


if (cover) {
  cover.addEventListener("click", openCover);
  cover.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCover();
    }
  });
  cover.focus({ preventScroll: true });
}


/* =========================================================
   10. 초대 정보 — 달력 / D-day / 참석 여부
   ========================================================= */
function renderCalendar() {
  const box = document.querySelector("#calendar");
  if (!box) return;
  const date = new Date(box.dataset.date);
  const y = date.getFullYear();
  const m = date.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  let html = `<p class="calendar-month">${monthNames[m]} ${y}</p><div class="calendar-grid">`;
  ["일", "월", "화", "수", "목", "금", "토"].forEach(d => (html += `<span class="calendar-head">${d}</span>`));
  for (let i = 0; i < first; i++) html += "<span></span>";
  for (let d = 1; d <= days; d++) {
    const dow = (first + d - 1) % 7;
    const cls = ["calendar-day", dow === 0 && "is-sun", dow === 6 && "is-sat", d === date.getDate() && "is-wedding"]
      .filter(Boolean)
      .join(" ");
    html += `<span class="${cls}">${d}</span>`;
  }
  box.innerHTML = html + "</div>";

  const dday = document.querySelector("#dday");
  if (dday) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(y, m, date.getDate());
    const diff = Math.round((target - today) / 86400000);
    dday.innerHTML =
      diff > 0 ? `우진 ♥ 주은의 결혼식이 <b>${diff}일</b> 남았습니다` :
      diff === 0 ? `<b>오늘</b>, 우진 ♥ 주은이 결혼합니다` :
      `우진 ♥ 주은이 함께한 지 <b>${-diff}일</b>`;
  }
}


/* 참석 여부 · 축하 메시지를 받을 구글 시트 (Apps Script 웹 앱 URL).
   설정 방법은 tools/google-apps-script.gs 맨 위 참고. 비워두면 이 기기에만 저장된다. */
const RSVP_ENDPOINT = "https://script.google.com/macros/s/AKfycbw6UxsRUEXEx-3xVXDpBfd2E-q5hU21yA1lqC-WSetzfkYPrZwMLrpkvHwri5WfoD8_/exec";
const RSVP_KEY = "rsvp-2027-10-10";

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function setupRsvp() {
  const form = document.querySelector("#rsvp");
  if (!form) return;
  const done = document.querySelector("#rsvpDone");
  const countField = form.querySelector(".rsvp-count");
  const countInput = form.elements.count;
  const countView = form.elements.countView;
  const error = form.querySelector(".rsvp-error");
  const submit = form.querySelector(".rsvp-submit");

  const messageBox = form.elements.message;
  const messageCount = form.elements.messageCount;
  const doneMessage = done.querySelector(".rsvp-done-message");
  messageBox.addEventListener("input", () => (messageCount.value = messageBox.value.length));

  // 휴대폰 키보드가 올라와도 입력칸이 가려지지 않게
  form.addEventListener("focusin", e => {
    if (e.target.matches("input[type=text], textarea")) {
      setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    }
  });

  const showDone = data => {
    // 남긴 메시지는 그대로 보여준다 (textContent 로 넣어 HTML 로 해석되지 않게)
    doneMessage.textContent = data.message || "";
    doneMessage.hidden = !data.message;
    done.querySelector(".rsvp-done-body").innerHTML =
      data.attend === "yes"
        ? `${escapeHtml(data.name)}님, ${data.count}명 참석으로 전달되었어요.<br />그날 뵙겠습니다.`
        : `${escapeHtml(data.name)}님의 축하하는 마음,<br />소중히 간직할게요.`;
    form.hidden = true;
    done.hidden = false;
  };

  form.addEventListener("change", () => {
    countField.hidden = form.elements.attend.value !== "yes";
    error.textContent = "";
  });

  form.querySelectorAll("[data-step]").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = Math.min(10, Math.max(1, Number(countInput.value) + Number(btn.dataset.step)));
      countInput.value = next;
      countView.value = next;
    });
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const data = {
      name: form.elements.name.value.trim(),
      attend: form.elements.attend.value,
      count: form.elements.attend.value === "yes" ? Number(countInput.value) : 0,
      message: messageBox.value.trim()
    };
    if (!data.name) return (error.textContent = "성함을 입력해주세요.");
    if (!data.attend) return (error.textContent = "참석 여부를 선택해주세요.");

    // 기기마다 하나의 응답 ID — 다시 작성하면 시트에서 같은 줄이 고쳐진다
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RSVP_KEY) || "null"); } catch {}
    data.id = (saved && saved.id) || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    submit.disabled = true;
    submit.textContent = "전달하는 중…";
    try {
      if (RSVP_ENDPOINT) {
        await fetch(RSVP_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          body: new URLSearchParams({ ...data, count: String(data.count) })
        });
      }
      try { localStorage.setItem(RSVP_KEY, JSON.stringify(data)); } catch {}
      showDone(data);
    } catch {
      error.textContent = "전송에 실패했어요. 잠시 후 다시 시도해주세요.";
    } finally {
      submit.disabled = false;
      submit.textContent = "전달하기";
    }
  });

  document.querySelector("#rsvpEdit").addEventListener("click", () => {
    done.hidden = true;
    form.hidden = false;
  });

  // 이미 응답한 적이 있으면 완료 화면부터
  try {
    const saved = JSON.parse(localStorage.getItem(RSVP_KEY) || "null");
    if (saved) {
      form.elements.name.value = saved.name;
      form.querySelector(`input[name="attend"][value="${saved.attend}"]`).checked = true;
      countInput.value = countView.value = saved.count || 1;
      countField.hidden = saved.attend !== "yes";
      messageBox.value = saved.message || "";
      messageCount.value = messageBox.value.length;
      showDone(saved);
    }
  } catch {}
}

/* 캘린더에 저장 — iPhone·PC 는 .ics 파일, Android 는 구글 캘린더 */
const WEDDING_EVENT = {
  title: "우진 ♥ 주은 결혼식",
  location: "한강버스 압구정선착장 루프탑",
  description: "이우진 · 홍주은의 결혼식에 초대합니다.",
  start: "2027-10-10T11:00:00+09:00",
  hours: 2
};

function setupCalendarSave() {
  const btn = document.querySelector("#calSave");
  const google = document.querySelector("#calSaveGoogle");
  if (!btn) return;

  const start = new Date(WEDDING_EVENT.start);
  const end = new Date(start.getTime() + WEDDING_EVENT.hours * 3600000);
  const utc = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(WEDDING_EVENT.title)}` +
    `&dates=${utc(start)}/${utc(end)}` +
    `&location=${encodeURIComponent(WEDDING_EVENT.location)}` +
    `&details=${encodeURIComponent(WEDDING_EVENT.description)}`;
  google.href = googleUrl;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//woojin-jueun//wedding//KO",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:wedding-${utc(start)}@woojin-jueun`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${WEDDING_EVENT.title}`,
    `LOCATION:${WEDDING_EVENT.location}`,
    `DESCRIPTION:${WEDDING_EVENT.description}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:내일은 ${WEDDING_EVENT.title}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  btn.addEventListener("click", () => {
    if (/Android/i.test(navigator.userAgent)) {
      window.open(googleUrl, "_blank", "noopener");
      return;
    }
    const url = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    const a = document.createElement("a");
    a.href = url;
    a.download = "woojin-jueun-wedding.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

/* 갤러리 — 누르면 크게, 좌우 스와이프·화살표로 넘기기 */
let lightboxOpen = false;

function setupGallery() {
  const items = [...document.querySelectorAll(".gallery-item")];
  const box = document.querySelector("#lightbox");
  if (!items.length || !box) return;
  const img = document.querySelector("#lightboxImg");
  const count = document.querySelector("#lightboxCount");
  const full = items.map(item => item.querySelector("img").src.replace("_s.jpg", ".jpg"));
  let index = 0;

  const show = i => {
    index = (i + full.length) % full.length;
    img.src = full[index];
    count.textContent = `${index + 1} / ${full.length}`;
    // 옆 사진 미리 불러오기
    [index - 1, index + 1].forEach(n => (new Image().src = full[(n + full.length) % full.length]));
  };
  const open = i => {
    show(i);
    box.hidden = false;
    lightboxOpen = true;
    app.classList.add("lightbox-open");
  };
  const close = () => {
    box.hidden = true;
    lightboxOpen = false;
    app.classList.remove("lightbox-open");
  };

  items.forEach((item, i) => item.addEventListener("click", () => open(i)));
  document.querySelector("#lightboxClose").addEventListener("click", close);
  document.querySelector("#lightboxPrev").addEventListener("click", () => show(index - 1));
  document.querySelector("#lightboxNext").addEventListener("click", () => show(index + 1));
  box.addEventListener("click", e => {
    if (e.target === box) close();
  });

  let startX = null;
  box.addEventListener("touchstart", e => (startX = e.touches[0].clientX), { passive: true });
  box.addEventListener("touchend", e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
  box.addEventListener("wheel", e => e.preventDefault(), { passive: false });

  window.addEventListener("keydown", e => {
    if (!lightboxOpen) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") show(index + 1);
    if (e.key === "ArrowLeft") show(index - 1);
  });
}

setupGallery();
renderCalendar();
setupCalendarSave();
setupRsvp();


buildThread();

window.addEventListener("load", () => {
  buildThread();
  if (started) setTimeout(onPageChange, 400);
});
