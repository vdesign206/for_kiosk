/* ---------- imports ---------- */
import * as THREE from "three";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

/* ---------- 슬라이드 데이터 ---------- */
const slides = [
  { title: "Cable Car", description: "A scenic cable car ride above the hills.", type: "Editorial", field: "transport, mountain, scenic, sky", date: "2025", image: "./images/img01.png" },
  { title: "Dino Fight", description: "Two dinosaurs locked in an epic battle.", type: "Editorial", field: "dinosaur, battle, prehistoric, wild", date: "2025", image: "./images/img02.png" },
  { title: "Bryce Canyon", description: "Vibrant red rock formations in a deep canyon.", type: "Detail Study", field: "desert, canyon, red-rock, landscape", date: "2025", image: "./images/img03.png" },
  { title: "Grand Canyon", description: "A rustic signpost marking a desert trail.", type: "Motion Still", field: "trail, signpost, desert, rustic", date: "2025", image: "./images/img04.png" },
  { title: "Golden Bridge", description: "A majestic golden bridge at sunset.", type: "Motion Still", field: "bridge, sunset, architecture, landmark", date: "2025", image: "./images/img05.png" },
  { title: "Yosemite Valley", description: "A panoramic view of Yosemite’s lush valley.", type: "Motion Still", field: "valley, forest, national park, scenic", date: "2025", image: "./images/img06.png" },
  { title: "San Diego Skyline", description: "A dazzling skyline lit up at night.", type: "Motion Still", field: "city, skyline, lights, urban", date: "2025", image: "./images/img07.png" },
];

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

  // CSS background-size: cover와 동일하게 보이도록 UV 변환
  vec2 getCoverUV(vec2 uv, vec2 textureSize) {
    vec2 s = uResolution / textureSize;
    float scale = max(s.x, s.y);
    vec2 scaledSize = textureSize * scale;
    vec2 offset = (uResolution - scaledSize) * 0.5;
    return (uv * uResolution - offset) / scaledSize;
  }

  vec2 getDistortedUv(vec2 uv, vec2 direction, float factor) {
    vec2 scaledDirection = direction;
    scaledDirection.y *= 2.0; // 수직 왜곡을 조금 더 강조
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
    float mask = step(bubbleRadius, dist); // 0: 안쪽, 1: 바깥쪽

    vec4 currentImg = texture2D(uTexture1, uv1);

    LensDistortion distortion = getLensDistortion(
      p, uv2, sphereCenter, bubbleRadius, focusFactor
    );

    vec4 newImg = texture2D(uTexture2, distortion.distortedUV);
    float finalMask = max(mask, 1.0 - distortion.inside);
    vec4 color = mix(newImg, currentImg, finalMask);
    gl_FragColor = color;
  }
`;

/* ---------- GSAP ---------- */
gsap.registerPlugin(SplitText);
gsap.config({ nullTargetWarn: false });

/* ---------- 상태 ---------- */
let currentSlideIndex = 0;
let isTransitioning = false;
let slideTextures = [];
let shaderMaterial, renderer;
let scene, camera;
let autoplayTimer = null;

const THUMB_W = 150;
const THUMB_H = 200;
let mode = "slide"; // 'slide' | 'gallery'

/* ---------- 텍스트 유틸 ---------- */
const createCharacterElements = (element) => {
  if (element.querySelectorAll(".char").length > 0) return;
  const words = element.textContent.split(" ");
  element.innerHTML = "";
  words.forEach((word, index) => {
    const wordDiv = document.createElement("div");
    wordDiv.className = "word";
    [...word].forEach((ch) => {
      const charDiv = document.createElement("div");
      charDiv.className = "char";
      charDiv.innerHTML = `<span>${ch}</span>`;
      wordDiv.appendChild(charDiv);
    });
    element.appendChild(wordDiv);
    if (index < words.length - 1) {
      const spaceChar = document.createElement("div");
      spaceChar.className = "word";
      spaceChar.innerHTML = `<div class="char"><span> </span></div>`;
      element.appendChild(spaceChar);
    }
  });
};

const createLineElements = (element) => {
  new SplitText(element, { type: "lines", linesClass: "line" });
  element.querySelectorAll(".line").forEach((line) => {
    line.innerHTML = `<span>${line.textContent}</span>`;
  });
};

const processTextElements = (container) => {
  const title = container.querySelector(".slide-title h1");
  if (title) createCharacterElements(title);
  container.querySelectorAll(".slide-description p").forEach(createLineElements);
};

/* ---------- 슬라이드 DOM ---------- */
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
  const tl = gsap.timeline();
  tl.to([...currentContent.querySelectorAll(".char span")], {
    y: "-100%",
    duration: 0.6,
    stagger: 0.025,
    ease: "power2.inOut",
  })
    .to(
      [...currentContent.querySelectorAll(".line span")],
      {
        y: "-100%",
        duration: 0.6,
        stagger: 0.025,
        ease: "power2.inOut",
      },
      0.1
    )
    .call(() => {
      const newContent = createSlideElement(slides[nextIndex]);
      tl.kill();
      currentContent.remove();
      slider.appendChild(newContent);
      processTextElements(newContent);
      const newChars = newContent.querySelectorAll(".char span");
      const newLines = newContent.querySelectorAll(".line span");
      gsap.set([newChars, newLines], { y: "100%" });
      gsap.set(newContent, { opacity: 1 });
      gsap.timeline({
        onComplete: () => {
          isTransitioning = false;
          currentSlideIndex = nextIndex;
        },
      })
        .to(newChars, {
          y: "0%",
          duration: 0.5,
          stagger: 0.025,
          ease: "power2.inOut",
        })
        .to(
          newLines,
          {
            y: "0%",
            duration: 0.5,
            stagger: 0.1,
            ease: "power2.inOut",
          },
          0.3
        );
    }, null, 0.5);
};

/* ---------- 초기 슬라이드 텍스트 인 ---------- */
const setupInitialSlide = () => {
  const content = document.querySelector(".slider-content");
  processTextElements(content);
  const chars = content.querySelectorAll(".char span");
  const lines = content.querySelectorAll(".line span");
  gsap.fromTo(chars, { y: "100%" }, { y: "0%", duration: 0.8, stagger: 0.025, ease: "power2.out" });
  gsap.fromTo(lines, { y: "100%" }, { y: "0%", duration: 0.8, stagger: 0.025, ease: "power2.out", delay: 0.2 });
};

/* ---------- Three.js 초기화 ---------- */
const initializeRenderer = async () => {
  scene  = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector("canvas"),
    antialias: true,
  });
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

  // 로더
  const loader = new THREE.TextureLoader();
  for (const slide of slides) {
    const texture = await new Promise((resolve) => loader.load(slide.image, resolve));
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.userData  = { size: new THREE.Vector2(texture.image.width, texture.image.height) };
    slideTextures.push(texture);
  }

  // 첫 두 장 세팅
  shaderMaterial.uniforms.uTexture1.value     = slideTextures[0];
  shaderMaterial.uniforms.uTexture2.value     = slideTextures[1];
  shaderMaterial.uniforms.uTexture1Size.value = slideTextures[0].userData.size;
  shaderMaterial.uniforms.uTexture2Size.value = slideTextures[1].userData.size;

  // 렌더 루프
  const render = () => {
    requestAnimationFrame(render);
    renderer.render(scene, camera);
  };
  render();
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
        // 최종 상태를 toTex로 고정
        shaderMaterial.uniforms.uTexture1.value     = toTex;
        shaderMaterial.uniforms.uTexture1Size.value = toSize;
        isTransitioning = false;
        onComplete && onComplete();
      },
    }
  );
};

/* ---------- 슬라이드 → 다음 슬라이드 ---------- */
const handleSlideChange = () => {
  if (isTransitioning || mode !== "slide") return;
  isTransitioning = true;

  const nextIndex = (currentSlideIndex + 1) % slides.length;

  // 텍스트 교체 애니메이션 (DOM)
  animateSlideTransition(nextIndex);

  // 셰이더 전환
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

/* ---------- 갤러리 오버레이/스냅샷 ---------- */
let galleryLayout = []; // {x,y,rot} 배열
let galleryCanvas = null; // 오프스크린 캔버스
let galleryTexture = null; // Three.CanvasTexture
let thumbsLayer = null; // DOM 클릭 레이어

const buildGalleryLayout = () => {
  const W = window.innerWidth;
  const H = window.innerHeight;
  galleryLayout = slides.map(() => {
    const margin = 20;
    const x = Math.random() * (W - THUMB_W - margin * 2) + margin;
    const y = Math.random() * (H - THUMB_H - margin * 2) + margin;
    const rot = (Math.random() - 0.5) * 0.35; // -20~+20도 사이(라디안)
    return { x, y, rot };
  });
};

const makeGallerySnapshot = async () => {
  // 오프스크린 캔버스에 썸네일 랜덤 배치 본을 그림
  const W = window.innerWidth;
  const H = window.innerHeight;
  galleryCanvas = document.createElement("canvas");
  galleryCanvas.width = W;
  galleryCanvas.height = H;
  const ctx = galleryCanvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // 흰 배경 또는 투명 배경 선택 – 전환 대비를 위해 약한 회색 권장
  ctx.fillStyle = "#f6f6f6";
  ctx.fillRect(0, 0, W, H);

  // 각 이미지 그리기
  for (let i = 0; i < slides.length; i++) {
    const img = await loadImage(slides[i].image);
    const { x, y, rot } = galleryLayout[i];
    ctx.save();
    ctx.translate(x + THUMB_W / 2, y + THUMB_H / 2);
    ctx.rotate(rot);
    ctx.drawImage(img, -THUMB_W / 2, -THUMB_H / 2, THUMB_W, THUMB_H);
    // 약한 그림자 효과
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.fillRect(-THUMB_W / 2, THUMB_H / 2 - 2, THUMB_W, 4);
    ctx.restore();
    ctx.globalAlpha = 1.0;
  }

  // Three 텍스처로 변환
  if (galleryTexture) galleryTexture.dispose();
  galleryTexture = new THREE.CanvasTexture(galleryCanvas);
  galleryTexture.minFilter = galleryTexture.magFilter = THREE.LinearFilter;
};

const ensureThumbOverlay = () => {
  if (thumbsLayer) return thumbsLayer;
  thumbsLayer = document.createElement("div");
  thumbsLayer.className = "thumbs-layer";
  Object.assign(thumbsLayer.style, {
    position: "fixed",
    left: "0", top: "0", width: "100vw", height: "100vh",
    pointerEvents: "none", // 전환 중 비활성화, 표시 시 활성화로 변경
    opacity: "0",
    zIndex: "10",
  });
  document.body.appendChild(thumbsLayer);
  return thumbsLayer;
};

const showThumbOverlay = () => {
  const layer = ensureThumbOverlay();
  layer.innerHTML = ""; // 초기화
  const W = window.innerWidth;
  const H = window.innerHeight;

  for (let i = 0; i < slides.length; i++) {
    const { x, y, rot } = galleryLayout[i];
    const img = document.createElement("img");
    img.src = slides[i].image;
    Object.assign(img.style, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      width: `${THUMB_W}px`,
      height: `${THUMB_H}px`,
      transform: `rotate(${rot}rad)`,
      objectFit: "cover",
      boxShadow: "0 6px 12px rgba(0,0,0,0.15)",
      cursor: "pointer",
      borderRadius: "8px",
      userSelect: "none",
      pointerEvents: "auto", // 클릭 가능
    });
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isTransitioning) return;
      goFromGalleryToSlide(i);
    });
    layer.appendChild(img);
  }

  layer.style.pointerEvents = "auto";
  gsap.to(layer, { opacity: 1, duration: 0.35, ease: "power2.out" });
};

const hideThumbOverlay = (immediate = false) => {
  if (!thumbsLayer) return;
  const layer = thumbsLayer;
  layer.style.pointerEvents = "none";
  if (immediate) {
    layer.style.opacity = "0";
  } else {
    gsap.to(layer, { opacity: 0, duration: 0.25, ease: "power2.in" });
  }
};

/* ---------- 유틸: 이미지 로드 ---------- */
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/* ---------- 모드 전환: 슬라이드 → 갤러리 ---------- */
const goFromSlideToGallery = async () => {
  if (isTransitioning || mode !== "slide") return;
  stopAutoplay();

  // 텍스트 UI 살짝 내려감
  const currentContent = document.querySelector(".slider-content");
  if (currentContent) {
    gsap.to(currentContent, { y: 20, opacity: 0.0, duration: 0.4, ease: "power2.in" });
  }

  buildGalleryLayout();
  await makeGallerySnapshot();

  // 셰이더 전환: 현재 슬라이드 → 갤러리 스냅샷
  runLensTransition({
    fromTex: slideTextures[currentSlideIndex],
    toTex: galleryTexture,
    fromSize: slideTextures[currentSlideIndex].userData.size,
    toSize: new THREE.Vector2(galleryCanvas.width, galleryCanvas.height),
    duration: 1.6,
    onComplete: () => {
      // 전환 완료 후 오버레이 표시
      mode = "gallery";
      showThumbOverlay();
    },
  });
};

/* ---------- 모드 전환: 갤러리 → 특정 슬라이드 ---------- */
const goFromGalleryToSlide = (targetIndex) => {
  if (isTransitioning || mode !== "gallery") return;

  // 셰이더 전환을 위해 갤러리 스냅샷을 from으로 유지하고, 오버레이는 숨김
  hideThumbOverlay();
  // 오버레이가 가려진 상태에서 셰이더만 보이도록
  runLensTransition({
    fromTex: galleryTexture,
    toTex: slideTextures[targetIndex],
    fromSize: new THREE.Vector2(galleryCanvas.width, galleryCanvas.height),
    toSize: slideTextures[targetIndex].userData.size,
    duration: 1.6,
    onComplete: () => {
      // 텍스트 DOM 교체 + 인 애니메이션
      animateSlideTransition(targetIndex);
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

  // 갤러리 모드라면 레이아웃 재계산 + 오버레이/스냅샷 갱신
  if (mode === "gallery") {
    buildGalleryLayout();
    makeGallerySnapshot().then(() => {
      // 오버레이도 새 좌표로 재구성
      showThumbOverlay();
      // 셰이더의 현재 프레임도 갱신
      shaderMaterial.uniforms.uTexture1.value     = galleryTexture;
      shaderMaterial.uniforms.uTexture1Size.value = new THREE.Vector2(galleryCanvas.width, galleryCanvas.height);
    });
  }
};

/* ---------- 이벤트 바인딩 ---------- */
const handleCanvasClick = () => {
  if (mode === "slide") {
    if (!isTransitioning) goFromSlideToGallery();
  } else if (mode === "gallery") {
    // 갤러리 빈 곳 클릭시 아무 동작 안 함 (썸네일은 각자 클릭 핸들러가 있음)
  }
};

window.addEventListener("load", () => {
  setupInitialSlide();
  initializeRenderer().then(() => {
    startAutoplay();
  });
});
window.addEventListener("resize", handleResize);
document.addEventListener("click", handleCanvasClick);
