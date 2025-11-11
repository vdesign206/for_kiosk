/* ---------- imports ---------- */
import * as THREE from "three";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
gsap.registerPlugin(SplitText);

/* ---------- 슬라이드 데이터 ---------- */
const slides = [
  { title: "Cable Car",      description: "A scenic cable car ride above the hills.", type: "Editorial",    field: "transport, mountain, scenic, sky", date: "2025", image: "./images/img01.png" },
  { title: "Dino Fight",     description: "Two dinosaurs locked in an epic battle.",   type: "Editorial",    field: "dinosaur, battle, prehistoric, wild", date: "2025", image: "./images/img02.png" },
  { title: "Bryce Canyon",   description: "Vibrant red rock formations in a deep canyon.", type: "Detail Study", field: "desert, canyon, red-rock, landscape", date: "2025", image: "./images/img03.png" },
  { title: "Grand Canyon",   description: "A rustic signpost marking a desert trail.", type: "Motion Still", field: "trail, signpost, desert, rustic", date: "2025", image: "./images/img04.png" },
  { title: "Golden Bridge",  description: "A majestic golden bridge at sunset.",       type: "Motion Still", field: "bridge, sunset, architecture, landmark", date: "2025", image: "./images/img05.png" },
  { title: "Yosemite Valley",description: "A panoramic view of Yosemite’s lush valley.", type: "Motion Still", field: "valley, forest, national park, scenic", date: "2025", image: "./images/img06.png" },
  { title: "San Diego Skyline", description: "A dazzling skyline lit up at night.",    type: "Motion Still", field: "city, skyline, lights, urban", date: "2025", image: "./images/img07.png" },
];

/* ---------- 썸네일/레이아웃 상수 ---------- */
const THUMB_W = 150;
const THUMB_H = 200;
const CAPTION_H = 28;
const MARGIN = 20;
const THUMB_RADIUS = 12;

/* 갤러리 폰트/타이틀/그리드 공통 상수 (스냅샷/DOM 완전 일치) */
const CAPTION_FONT = "600 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const TITLE_TEXT   = "Welcome to Seoul Jungsu Visual Design";
const TITLE_FONT   = "800 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const TITLE_TOP    = 40;   // 타이틀 Y 위치
const TITLE_AREA_H = 96;   // 타이틀 전용 상단 영역(겹침 방지)
const GRID_GAP     = 24;   // 썸네일 그리드 간격(가로/세로)

/* ---------- 셰이더 ---------- */
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  precision highp float;

  uniform sampler2D uTexture1;
  uniform sampler2D uTexture2;
  uniform float uProgress;
  uniform vec2 uResolution;
  uniform vec2 uTexture1Size;
  uniform vec2 uTexture2Size;
  varying vec2 vUv;

  vec2 getCoverUV(vec2 uv, vec2 textureSize) {
    vec2 s = uResolution / textureSize;
    float scale = max(s.x, s.y);
    vec2 scaledSize = textureSize * scale;
    vec2 offset = (uResolution - scaledSize) * 0.5;
    return (uv * uResolution - offset) / scaledSize;
  }

  vec2 getDistortedUv(vec2 uv, vec2 direction, float factor) {
    vec2 scaledDirection = direction;
    scaledDirection.y *= 2.0;
    return uv - scaledDirection * factor;
  }

  struct LensDistortion { vec2 distortedUV; float inside; };

  LensDistortion getLensDistortion(
    vec2 p, vec2 uv, vec2 sphereCenter, float sphereRadius, float focusFactor
  ) {
    vec2 distortionDirection = normalize(p - sphereCenter);
    float focusRadius   = sphereRadius * focusFactor;
    float focusStrength = sphereRadius / 3000.0;

    float focusSdf  = length(sphereCenter - p) - focusRadius;
    float sphereSdf = length(sphereCenter - p) - sphereRadius;

    float inside = smoothstep(0.0, 1.0, -sphereSdf / (sphereRadius * 0.001));

    float magnifierFactor = focusSdf / (sphereRadius - focusRadius);
    float mFactor = clamp(magnifierFactor * inside, 0.0, 1.0);
          mFactor = pow(mFactor, 5.0);

    float distortionFactor = mFactor * focusStrength;

    vec2 distortedUV = getDistortedUv(uv, distortionDirection, distortionFactor);
    return LensDistortion(distortedUV, inside);
  }

  void main() {
    vec2 center = vec2(0.5, 0.5);
    vec2 p = vUv * uResolution;

    vec2 uv1 = getCoverUV(vUv, uTexture1Size);
    vec2 uv2 = getCoverUV(vUv, uTexture2Size);

    float maxRadius    = length(uResolution) * 1.5;
    float bubbleRadius = uProgress * maxRadius;
    vec2  sphereCenter = center * uResolution;
    float focusFactor  = 0.25;

    float dist = length(sphereCenter - p);
    float mask = step(bubbleRadius, dist);

    vec4 currentImg = texture2D(uTexture1, uv1);
    LensDistortion d = getLensDistortion(p, uv2, sphereCenter, bubbleRadius, focusFactor);
    vec4 newImg = texture2D(uTexture2, d.distortedUV);

    float finalMask = max(mask, 1.0 - d.inside);
    gl_FragColor = mix(newImg, currentImg, finalMask);
  }
`;

/* ---------- 전역 상태 ---------- */
let currentSlideIndex = 0;
let isTransitioning = false;
let slideTextures = [];
let shaderMaterial, renderer, scene, camera;
let autoplayTimer = null;
let mode = "slide"; // "slide" | "gallery"

/* 갤러리 관련 */
let galleryLayout = [];
let galleryCanvas = null;
let galleryTexture = null;
let thumbsLayer = null;

/* ---------- 유틸 ---------- */
const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

/* canvas: 둥근 사각형 경로 */
const roundRectPath = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
};

/* canvas: cover 크롭 + 둥근모서리 */
const drawRoundedImageCover = (ctx, img, x, y, w, h, r) => {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s  = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  const sx = (iw - sw) * 0.5;
  const sy = (ih - sh) * 0.5;

  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
};

/* =========================================================
 * 텍스트 애니메이션 – SplitText (words, chars) + 마스크
 * =======================================================*/
let titleSplit = null;
let titleCharSplit = null;  // chars 전용 분해 객체
let descSplits = [];

const applyMaskToWords = (container) => {
  const words = container.querySelectorAll(".slide-title .word");
  words.forEach(w => {
    Object.assign(w.style, {
      display: "inline-block",
      overflow: "hidden",
      verticalAlign: "bottom",
    });
  });
};

const applyMaskToChars = (container) => {
  const chars = container.querySelectorAll(".slide-title .char");
  chars.forEach(c => {
    if (!c.querySelector(".char-inner")) {
      const inner = document.createElement("span");
      inner.className = "char-inner";
      inner.textContent = c.textContent;
      c.textContent = "";
      c.appendChild(inner);
    }
    Object.assign(c.style, {
      display: "inline-block",
      overflow: "hidden",     // 문자 마스크
      verticalAlign: "bottom",
    });
    Object.assign(c.firstElementChild.style, {
      display: "inline-block",
      willChange: "transform",
    });
  });
};

const applyMaskToLines = (container) => {
  const lines = container.querySelectorAll(".slide-description .line");
  lines.forEach(line => {
    if (line.children.length === 0) {
      const inner = document.createElement("span");
      inner.textContent = line.textContent;
      line.textContent = "";
      line.appendChild(inner);
    }
    Object.assign(line.style, {
      display: "block",
      overflow: "hidden",   // 줄 마스크
    });
    Object.assign(line.firstElementChild.style, {
      display: "inline-block",
      willChange: "transform",
    });
  });
};

const splitTitleAndDesc = (container) => {
  if (titleCharSplit) { titleCharSplit.revert(); titleCharSplit = null; }
  if (titleSplit)     { titleSplit.revert();     titleSplit     = null; }
  descSplits.forEach(s => s.revert && s.revert());
  descSplits = [];

  const titleEl = container.querySelector(".slide-title h1");
  const descEls = container.querySelectorAll(".slide-description p, .slide-info");

  // 제목: words → chars 분해
  if (titleEl) {
    titleEl.style.letterSpacing = "normal";
    titleEl.style.textRendering = "optimizeLegibility";

    titleSplit = new SplitText(titleEl, { type: "words", wordsClass: "word" });
    applyMaskToWords(container);

    titleCharSplit = new SplitText(titleEl, { type: "chars", charsClass: "char" });
    applyMaskToChars(container);
  }

  // 설명: 줄 분해
  descEls.forEach(el => {
    const s = new SplitText(el, { type: "lines", linesClass: "line" });
    el.querySelectorAll(".line").forEach(line => {
      line.innerHTML = `<span>${line.textContent}</span>`;
    });
    descSplits.push(s);
  });
  applyMaskToLines(container);
};

const introAnimate = (container) => {
  const charInners = container.querySelectorAll(".slide-title .char-inner");
  const lineInners = container.querySelectorAll(".slide-description .line > span");

  gsap.set(charInners, { yPercent: 100 });
  gsap.set(lineInners, { y: 14, opacity: 0 });

  gsap.to(charInners, {
    yPercent: 0,
    duration: 0.65,
    ease: "power2.out",
    stagger: { amount: 0.75, from: "start" },
  });

  gsap.to(lineInners,  {
    y: 0, opacity: 1,
    duration: 0.6,
    ease: "power2.out",
    stagger: 0.06,
    delay: 0.1
  });
};

/* ---------- 초기 슬라이드 텍스트 ---------- */
const setupInitialSlide = () => {
  const content = document.querySelector(".slider-content");
  if (!content) return;
  splitTitleAndDesc(content);
  introAnimate(content);
};

/* ---------- 슬라이드 DOM 교체 ---------- */
const createSlideElement = (slideData) => {
  const content = document.createElement("div");
  content.className = "slider-content";
  content.style.opacity = "0";
  content.innerHTML = `
    <div class="slide-title"><h1>${slideData.title}</h1></div>
    <div class="slide-description">
      <p>${slideData.description}</p>
      <div class="slide-info">
        <p>Type. ${slideData.type}</p>
        <p>Field. ${slideData.field}</p>
        <p>Date.  ${slideData.date}</p>
      </div>
    </div>
  `;
  return content;
};

const animateSlideTransition = (nextIndex) => {
  const currentContent = document.querySelector(".slider-content");
  if (!currentContent) return;
  const slider = document.querySelector(".slider");

  const outCharInners = currentContent.querySelectorAll(".slide-title .char-inner");
  const outLineInners = currentContent.querySelectorAll(".slide-description .line > span");

  const tl = gsap.timeline();
  tl.to(outCharInners, { yPercent: -100, duration: 0.45, stagger: { amount: 0.5, from: "start" }, ease: "power2.inOut" })
    .to(outLineInners, { y: -12, opacity: 0, duration: 0.35, stagger: 0.05, ease: "power2.inOut" }, 0.05)
    .call(() => {
      const newContent = createSlideElement(slides[nextIndex]);
      tl.kill();

      if (titleCharSplit) { titleCharSplit.revert(); titleCharSplit = null; }
      if (titleSplit)     { titleSplit.revert();     titleSplit     = null; }
      descSplits.forEach(s => s.revert && s.revert());
      descSplits = [];

      currentContent.remove();
      slider.appendChild(newContent);

      splitTitleAndDesc(newContent);
      gsap.set(newContent, { opacity: 1 });
      introAnimate(newContent);

      isTransitioning = false;
      currentSlideIndex = nextIndex;
    }, null, 0.35);
};

/* ---------- Three.js 초기화 ---------- */
const initializeRenderer = async () => {
  scene  = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const canvas = document.querySelector("#stage") || document.querySelector("canvas");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);

  shaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTexture1:     { value: null },
      uTexture2:     { value: null },
      uProgress:     { value: 0.0 },
      uResolution:   { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uTexture1Size: { value: new THREE.Vector2(1, 1) },
      uTexture2Size: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader,
    fragmentShader,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shaderMaterial));

  const loader = new THREE.TextureLoader();
  for (const slide of slides) {
    const texture = await new Promise((resolve) => loader.load(slide.image, resolve));
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.userData  = { size: new THREE.Vector2(texture.image.width, texture.image.height) };
    slideTextures.push(texture);
  }

  shaderMaterial.uniforms.uTexture1.value     = slideTextures[0];
  shaderMaterial.uniforms.uTexture2.value     = slideTextures[1];
  shaderMaterial.uniforms.uTexture1Size.value = slideTextures[0].userData.size;
  shaderMaterial.uniforms.uTexture2Size.value = slideTextures[1].userData.size;

  const render = () => { requestAnimationFrame(render); renderer.render(scene, camera); };
  render();
};

/* ---------- 유리굴절 공통 전환 ---------- */
const runLensTransition = ({ fromTex, toTex, fromSize, toSize, duration = 1.6, onComplete }) => {
  isTransitioning = true;
  shaderMaterial.uniforms.uTexture1.value     = fromTex;
  shaderMaterial.uniforms.uTexture2.value     = toTex;
  shaderMaterial.uniforms.uTexture1Size.value = fromSize;
  shaderMaterial.uniforms.uTexture2Size.value = toSize;

  gsap.fromTo(
    shaderMaterial.uniforms.uProgress,
    { value: 0 },
    {
      value: 1,
      duration,
      ease: "power2.inOut",
      onComplete: () => {
        shaderMaterial.uniforms.uProgress.value = 0;
        shaderMaterial.uniforms.uTexture1.value     = toTex;
        shaderMaterial.uniforms.uTexture1Size.value = toSize;
        isTransitioning = false;
        onComplete && onComplete();
      },
    }
  );
};

/* ---------- 슬라이드 자동 전환 ---------- */
const startAutoplay = () => {
  stopAutoplay();
  autoplayTimer = setInterval(() => {
    if (mode === "slide") handleSlideChange();
  }, 5000);
};
const stopAutoplay = () => {
  if (autoplayTimer) clearInterval(autoplayTimer);
  autoplayTimer = null;
};

/* ---------- 슬라이드 → 다음 슬라이드 ---------- */
const handleSlideChange = () => {
  if (isTransitioning || mode !== "slide") return;
  isTransitioning = true;

  const nextIndex = (currentSlideIndex + 1) % slides.length;
  animateSlideTransition(nextIndex);

  runLensTransition({
    fromTex: slideTextures[currentSlideIndex],
    toTex: slideTextures[nextIndex],
    fromSize: slideTextures[currentSlideIndex].userData.size,
    toSize: slideTextures[nextIndex].userData.size,
    duration: 2.4,
    onComplete: () => { currentSlideIndex = nextIndex; },
  });
};

/* ---------- 갤러리 레이아웃(균일 그리드 + 타이틀 영역 확보) ---------- */
const buildGalleryLayout = () => {
  const W = window.innerWidth;
  const H = window.innerHeight;

  const cellW = THUMB_W;
  const cellH = THUMB_H + CAPTION_H;

  // 한 줄에 들어갈 컬럼 수 (최소 1)
  const cols = Math.max(1, Math.floor((W - 2 * MARGIN + GRID_GAP) / (cellW + GRID_GAP)));

  // 그리드 전체 폭 및 시작 X (가운데 정렬)
  const gridW = cols * cellW + (cols - 1) * GRID_GAP;
  const startX = Math.max(MARGIN, Math.floor((W - gridW) / 2));

  // 타이틀 영역을 확보한 뒤 시작 Y
  const startY = TITLE_AREA_H + MARGIN;

  galleryLayout = [];
  for (let i = 0; i < slides.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = startX + col * (cellW + GRID_GAP);
    const y = startY + row * (cellH + GRID_GAP);
    // 화면 하단 보호 (넘어갈 경우 배치 중단)
    if (y + cellH > H - MARGIN) break;
    galleryLayout.push({ x, y });
  }
};

/* ---------- 갤러리 스냅샷(Canvas) – 타이틀/줄간격 완전 일치 ---------- */
const makeGallerySnapshot = async () => {
  const W = window.innerWidth;
  const H = window.innerHeight;

  galleryCanvas = document.createElement("canvas");
  galleryCanvas.width = W;
  galleryCanvas.height = H;
  const ctx = galleryCanvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // 배경
  ctx.fillStyle = "skyblue";
  ctx.fillRect(0, 0, W, H);

  // 타이틀 (스냅샷과 DOM 동일 좌표/스타일)
  ctx.font = TITLE_FONT;
  ctx.fillStyle = "#0d1b2a";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(TITLE_TEXT, W / 2, TITLE_TOP);

  // 캡션 폰트 (스냅샷/DOM 동일)
  ctx.font = CAPTION_FONT;
  ctx.fillStyle = "#0d1b2a";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i < slides.length; i++) {
    const img = await loadImage(slides[i].image);
    const { x, y } = galleryLayout[i];

    // 이미지 (둥근 모서리 + cover)
    drawRoundedImageCover(ctx, img, x, y, THUMB_W, THUMB_H, THUMB_RADIUS);

    // 얕은 그림자
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y + THUMB_H - 2, THUMB_W, 4);
    ctx.restore();

    // 캡션 (좌우 5px 패딩 기준으로 줄임표 처리)
    const captionY = y + THUMB_H + 4;
    const centerX  = x + THUMB_W / 2;
    const maxPx    = THUMB_W - 10;
    let drawTitle  = slides[i].title;
    if (ctx.measureText(drawTitle).width > maxPx) {
      while (drawTitle.length > 1 && ctx.measureText(drawTitle + "…").width > maxPx) {
        drawTitle = drawTitle.slice(0, -1);
      }
      drawTitle += "…";
    }
    ctx.fillText(drawTitle, centerX, captionY);
  }

  if (galleryTexture) galleryTexture.dispose();
  galleryTexture = new THREE.CanvasTexture(galleryCanvas);
  galleryTexture.minFilter = galleryTexture.magFilter = THREE.LinearFilter;
};

/* ---------- 갤러리 오버레이(DOM) – 타이틀/캡션을 스냅샷과 동일 스타일 ---------- */
const ensureThumbOverlay = () => {
  if (thumbsLayer) return thumbsLayer;
  thumbsLayer = document.createElement("div");
  thumbsLayer.className = "thumbs-layer";
  Object.assign(thumbsLayer.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "100vw",
    height: "100vh",
    background: "skyblue",
    zIndex: "10",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(thumbsLayer);
  return thumbsLayer;
};

const showThumbOverlay = () => {
  const layer = ensureThumbOverlay();
  layer.innerHTML = "";
  layer.style.background = "skyblue";

  // 타이틀 (스냅샷과 완전 일치)
  const title = document.createElement("div");
  title.textContent = TITLE_TEXT;
  Object.assign(title.style, {
    position: "absolute",
    top: `${TITLE_TOP}px`,
    left: "50%",
    transform: "translateX(-50%)",
    fontSize: "28px",
    fontWeight: "800",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    color: "#0d1b2a",
    textShadow: "0 2px 4px rgba(0,0,0,0.2)",
    letterSpacing: "1px",
    pointerEvents: "none",
    lineHeight: "1.2",
  });
  layer.appendChild(title);

  // 썸네일 카드(스냅샷과 동일 좌표/크기/줄간격)
  for (let i = 0; i < slides.length; i++) {
    const { x, y } = galleryLayout[i];

    const card = document.createElement("div");
    Object.assign(card.style, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      width: `${THUMB_W}px`,
      height: `${THUMB_H + CAPTION_H}px`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      pointerEvents: "auto",
      cursor: "pointer",
      userSelect: "none",
    });

    const img = document.createElement("img");
    img.src = slides[i].image;
    Object.assign(img.style, {
      width: `${THUMB_W}px`,
      height: `${THUMB_H}px`,
      objectFit: "cover",
      borderRadius: `${THUMB_RADIUS}px`,
      boxShadow: "0 6px 12px rgba(0,0,0,0.15)",
      display: "block",
    });
    card.appendChild(img);

    const caption = document.createElement("div");
    caption.textContent = slides[i].title;
    Object.assign(caption.style, {
      width: "100%",
      height: `${CAPTION_H}px`,
      lineHeight: `${CAPTION_H}px`,         // 줄간격 일치
      textAlign: "center",
      fontWeight: "600",
      fontSize: "16px",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      color: "#0d1b2a",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      marginTop: "4px",
      padding: "0 5px",                     // 좌우 5px (캔버스 maxPx와 매칭)
      letterSpacing: "normal",
    });
    card.appendChild(caption);

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isTransitioning) return;
      hideThumbOverlay();
      goFromGalleryToSlide(i);
    });

    layer.appendChild(card);
  }

  layer.style.pointerEvents = "auto";
  gsap.to(layer, { opacity: 1, duration: 0.35, ease: "power2.out" });
};

const hideThumbOverlay = (immediate = false) => {
  if (!thumbsLayer) return;
  thumbsLayer.style.pointerEvents = "none";
  if (immediate) thumbsLayer.style.opacity = "0";
  else gsap.to(thumbsLayer, { opacity: 0, duration: 0.25, ease: "power2.in" });
};

/* ---------- 모드 전환 ---------- */
const goFromSlideToGallery = async () => {
  if (isTransitioning || mode !== "slide") return;
  stopAutoplay();

  const currentContent = document.querySelector(".slider-content");
  if (currentContent) {
    gsap.to(currentContent, { y: 20, opacity: 0.0, duration: 0.4, ease: "power2.in" });
  }

  buildGalleryLayout();
  await makeGallerySnapshot();

  runLensTransition({
    fromTex: slideTextures[currentSlideIndex],
    toTex: galleryTexture,
    fromSize: slideTextures[currentSlideIndex].userData.size,
    toSize: new THREE.Vector2(galleryCanvas.width, galleryCanvas.height),
    duration: 1.6,
    onComplete: () => {
      mode = "gallery";
      showThumbOverlay();
    },
  });
};

const goFromGalleryToSlide = (targetIndex) => {
  if (isTransitioning || mode !== "gallery") return;

  hideThumbOverlay();

  runLensTransition({
    fromTex: galleryTexture,
    toTex: slideTextures[targetIndex],
    fromSize: new THREE.Vector2(galleryCanvas.width, galleryCanvas.height),
    toSize: slideTextures[targetIndex].userData.size,
    duration: 1.6,
    onComplete: () => {
      const slider = document.querySelector(".slider");
      const old = document.querySelector(".slider-content");
      if (old) {
        if (titleCharSplit) { titleCharSplit.revert(); titleCharSplit = null; }
        if (titleSplit)     { titleSplit.revert();     titleSplit     = null; }
        descSplits.forEach(s => s.revert && s.revert());
        descSplits = [];
        old.remove();
      }
      const newContent = createSlideElement(slides[targetIndex]);
      slider.appendChild(newContent);
      splitTitleAndDesc(newContent);
      gsap.set(newContent, { opacity: 1 });
      introAnimate(newContent);

      currentSlideIndex = targetIndex;
      mode = "slide";
      startAutoplay();
    },
  });
};

/* ---------- 리사이즈 ---------- */
const handleResize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  shaderMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

  if (mode === "gallery") {
    buildGalleryLayout();        // 타이틀 영역/균일 그리드 재계산
    makeGallerySnapshot().then(() => {
      showThumbOverlay();
      shaderMaterial.uniforms.uTexture1.value     = galleryTexture;
      shaderMaterial.uniforms.uTexture1Size.value = new THREE.Vector2(galleryCanvas.width, galleryCanvas.height);
    });
  }
};

/* ---------- 클릭 ---------- */
const handleCanvasClick = () => {
  if (mode === "slide") {
    if (!isTransitioning) goFromSlideToGallery();
  }
};

/* ---------- 부트스트랩 ---------- */
window.addEventListener("load", () => {
  setupInitialSlide();
  initializeRenderer().then(() => startAutoplay());
});
window.addEventListener("resize", handleResize);
document.addEventListener("click", handleCanvasClick);
