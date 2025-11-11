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

/* ---------- 상수 ---------- */
const THUMB_W = 150;
const THUMB_H = 200;
const CAPTION_H = 28;
const MARGIN = 20;

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

  struct LensDistortion {
    vec2 distortedUV;
    float inside;
  };

  LensDistortion getLensDistortion(
    vec2 p,
    vec2 uv,
    vec2 sphereCenter,
    float sphereRadius,
    float focusFactor
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
let galleryLayout = [];     // {x,y}
let galleryCanvas = null;   // Offscreen
let galleryTexture = null;  // THREE.CanvasTexture
let thumbsLayer = null;     // DOM overlay

/* ---------- 유틸 ---------- */
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/* =========================================================
 * 텍스트 애니메이션 – 단어/줄 단위(kerning 보존)
 * =======================================================*/
let titleSplit = null;
let descLineSplits = [];

const splitTitleAndDesc = (container) => {
  // 이전 split 정리
  if (titleSplit) { titleSplit.revert(); titleSplit = null; }
  descLineSplits.forEach(s => s.revert && s.revert());
  descLineSplits = [];

  const titleEl = container.querySelector(".slide-title h1");
  const descElList = container.querySelectorAll(".slide-description p, .slide-info");

  // 제목: 단어 단위만 분해(글자 kerning 유지)
  if (titleEl) {
    titleEl.style.letterSpacing = "normal";  // 이전 자간 유지
    titleEl.style.textRendering = "optimizeLegibility";
    titleSplit = new SplitText(titleEl, { type: "words", wordsClass: "word" });
  }
  // 설명: 줄 단위
  descElList.forEach(el => {
    const lineSplit = new SplitText(el, { type: "lines", linesClass: "line" });
    // 각 line 내부 텍스트를 span으로 감싸 translateY 애니메이션
    el.querySelectorAll(".line").forEach(line => {
      line.innerHTML = `<span>${line.textContent}</span>`;
    });
    descLineSplits.push(lineSplit);
  });
};

const introAnimate = (container) => {
  const words = container.querySelectorAll(".slide-title .word");
  const lines = container.querySelectorAll(".slide-description .line span");
  gsap.set(words, { yPercent: 100 });
  gsap.set(lines, { y: 14, opacity: 0 });
  gsap.to(words, { yPercent: 0, duration: 0.7, ease: "power2.out", stagger: 0.035 });
  gsap.to(lines,  { y: 0, opacity: 1, duration: 0.6, ease: "power2.out", stagger: 0.06, delay: 0.1 });
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

  const outWords = currentContent.querySelectorAll(".slide-title .word");
  const outLines = currentContent.querySelectorAll(".slide-description .line span");

  const tl = gsap.timeline();
  tl.to(outWords, { yPercent: -100, duration: 0.5, stagger: 0.03, ease: "power2.inOut" })
    .to(outLines, { y: -12, opacity: 0, duration: 0.4, stagger: 0.05, ease: "power2.inOut" }, 0.05)
    .call(() => {
      // 교체
      const newContent = createSlideElement(slides[nextIndex]);
      tl.kill();
      // 분해했던 것 되돌림
      if (titleSplit) { titleSplit.revert(); titleSplit = null; }
      descLineSplits.forEach(s => s.revert && s.revert());
      descLineSplits = [];

      currentContent.remove();
      slider.appendChild(newContent);

      splitTitleAndDesc(newContent);
      gsap.set(newContent, { opacity: 1 });
      introAnimate(newContent);

      isTransitioning = false;
      currentSlideIndex = nextIndex;
    }, null, 0.4);
};

/* ---------- Three.js 초기화 ---------- */
let canvasRes;
const initializeRenderer = async () => {
  scene  = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const canvas = document.querySelector("canvas");
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

  const render = () => {
    requestAnimationFrame(render);
    renderer.render(scene, camera);
  };
  render();
};

/* ---------- 공통 전환 ---------- */
const runLensTransition = ({ fromTex, toTex, fromSize, toSize, duration = 1.8, onComplete }) => {
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
    onComplete: () => {
      currentSlideIndex = nextIndex;
    },
  });
};

/* ---------- 갤러리 레이아웃(겹치지 않게) ---------- */
const buildGalleryLayout = () => {
  const W = window.innerWidth;
  const H = window.innerHeight;

  const boxes = []; // {x,y,w,h}
  const boxW = THUMB_W;
  const boxH = THUMB_H + CAPTION_H;

  const maxTriesPerItem = 500;

  const overlaps = (a, b) => {
    const pad = 8;
    return !(
      a.x + a.w + pad < b.x ||
      b.x + b.w + pad < a.x ||
      a.y + a.h + pad < b.y ||
      b.y + b.h + pad < a.y
    );
  };

  galleryLayout = [];

  for (let i = 0; i < slides.length; i++) {
    let placed = false;
    for (let t = 0; t < maxTriesPerItem; t++) {
      const x = Math.random() * (W - boxW - MARGIN * 2) + MARGIN;
      const y = Math.random() * (H - boxH - MARGIN * 2) + MARGIN;
      const candidate = { x, y, w: boxW, h: boxH };
      let ok = true;
      for (const b of boxes) {
        if (overlaps(candidate, b)) { ok = false; break; }
      }
      if (!ok) continue;
      boxes.push(candidate);
      galleryLayout.push({ x, y });
      placed = true;
      break;
    }
    if (!placed) {
      const cols = Math.max(1, Math.floor((W - MARGIN * 2) / (boxW + MARGIN)));
      const row = Math.floor(i / cols);
      const col = i % cols;
      const gx = MARGIN + col * (boxW + MARGIN);
      const gy = MARGIN + row * (boxH + MARGIN);
      galleryLayout.push({ x: gx, y: gy });
    }
  }
};

/* ---------- 갤러리 스냅샷(오프스크린 캔버스) ---------- */
const makeGallerySnapshot = async () => {
  const W = window.innerWidth;
  const H = window.innerHeight;

  galleryCanvas = document.createElement("canvas");
  galleryCanvas.width = W;
  galleryCanvas.height = H;
  const ctx = galleryCanvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // skyblue 배경
  ctx.fillStyle = "skyblue";
  ctx.fillRect(0, 0, W, H);

  // 텍스트 스타일
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#0d1b2a";

  for (let i = 0; i < slides.length; i++) {
    const img = await loadImage(slides[i].image);
    const { x, y } = galleryLayout[i];
    ctx.drawImage(img, x, y, THUMB_W, THUMB_H);

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y + THUMB_H - 2, THUMB_W, 4);
    ctx.restore();

    const captionY = y + THUMB_H + 4;
    const centerX  = x + THUMB_W / 2;
    const title    = slides[i].title;
    const maxPx    = THUMB_W - 10;
    let drawTitle  = title;
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

/* ---------- 갤러리 오버레이 ---------- */
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
      borderRadius: "8px",
      boxShadow: "0 6px 12px rgba(0,0,0,0.15)",
      display: "block",
    });
    card.appendChild(img);

    const caption = document.createElement("div");
    caption.textContent = slides[i].title;
    Object.assign(caption.style, {
      width: "100%",
      height: `${CAPTION_H}px`,
      lineHeight: `${CAPTION_H}px`,
      textAlign: "center",
      fontWeight: "600",
      fontSize: "14px",
      color: "#0d1b2a",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      marginTop: "4px",
      letterSpacing: "normal",
    });
    card.appendChild(caption);

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isTransitioning) return;
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
      // 슬라이드 텍스트 교체
      const slider = document.querySelector(".slider");
      const newContent = createSlideElement(slides[targetIndex]);
      const old = document.querySelector(".slider-content");
      if (old) old.remove();
      slider.appendChild(newContent);
      splitTitleAndDesc(newContent);
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
    buildGalleryLayout();
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
  // gallery 모드에선 썸네일만 반응
};

/* ---------- 부트스트랩 ---------- */
window.addEventListener("load", () => {
  setupInitialSlide();
  initializeRenderer().then(() => startAutoplay());
});
window.addEventListener("resize", handleResize);
document.addEventListener("click", handleCanvasClick);
