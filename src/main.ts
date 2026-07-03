import "./style.css";
import SignaturePad from "signature_pad";
import FORM_IMG from "./assets/form.png";

/* ------------------------------------------------------------------ *
 * Hydrox prescriber feedback form.
 * The form picture is the background; live inputs overlay it, then
 * everything is composited into one landscape JPEG on the client.
 * ------------------------------------------------------------------ */

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

let stream: MediaStream | null = null;
let photoData: string | null = null;

const video = $<HTMLVideoElement>("video");
const photoImg = $<HTMLImageElement>("photoImg");
const hint = $("hint");
const stage = $("stage");

stage.style.backgroundImage = `url('${FORM_IMG}')`;

/* ---------------- Name field: fit the whole sentence on one line ----------
   Short names shouldn't leave big gaps; long names shouldn't overflow the
   form. So: (1) grow the input to fit its text, then (2) shrink the whole
   "DR. <name> is a prescriber of CALBRIT 60K" line's font-size until it fits
   the available width. Because the input width is in `ch`, it scales with the
   font too, so everything stays proportional and centred. */
const nameInput = $<HTMLInputElement>("nameInput");
const nameRow = $("nameRow");
const NAME_MIN_PX = 7; // floor; below the small mobile base so long names can still shrink to fit

function fitNameRow() {
  const v = nameInput.value || nameInput.placeholder || "";
  nameInput.style.width = Math.max(v.length + 1, 5) + "ch";
  nameRow.style.fontSize = ""; // back to the CSS base (3cqw) before measuring
  let size = parseFloat(getComputedStyle(nameRow).fontSize);
  let guard = 0;
  while (nameRow.scrollWidth > nameRow.clientWidth + 1 && size > NAME_MIN_PX && guard < 120) {
    size -= 0.5;
    nameRow.style.fontSize = size + "px";
    guard++;
  }
}
nameInput.addEventListener("input", fitNameRow);
window.addEventListener("resize", fitNameRow);
window.addEventListener("orientationchange", fitNameRow);
fitNameRow();

function toast(m: string) {
  const t = $("toast");
  t.textContent = m;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}
function show(el: HTMLElement, on: boolean) {
  el.style.display = on ? "flex" : "none";
}

/* ---------------- Camera / photo ---------------- */
function openLive() {
  video.classList.add("show");
  photoImg.classList.remove("show");
  show($("grpStart"), false);
  show($("grpLive"), true);
  show($("grpRetake"), false);
}

$("openCam").addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Prefer the rear camera so it's easy to photograph the doctor.
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    video.srcObject = stream;
    openLive();
    hint.textContent = "Camera live — click “Capture photo” when ready.";
  } catch {
    hint.textContent =
      "In-browser camera unavailable here — opening upload / device camera.";
    $<HTMLInputElement>("fileInput").click();
  }
});

$("snap").addEventListener("click", () => {
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0);
  setPhoto(c.toDataURL("image/png"));
  stopStream();
});

$("cancelCam").addEventListener("click", () => {
  stopStream();
  resetPhotoUI();
  hint.textContent = "Camera closed.";
});

function stopStream() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.classList.remove("show");
}

$("uploadBtn").addEventListener("click", () => $<HTMLInputElement>("fileInput").click());
$<HTMLInputElement>("fileInput").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => setPhoto(ev.target!.result as string);
  r.readAsDataURL(f);
});

function setPhoto(url: string) {
  photoData = url;
  photoImg.src = url;
  photoImg.classList.add("show");
  video.classList.remove("show");
  show($("grpStart"), true);
  show($("grpLive"), false);
  show($("grpRetake"), true);
  hint.textContent = "Photo placed in the form ✓";
  toast("Photo added ✓");
}
function resetPhotoUI() {
  show($("grpStart"), true);
  show($("grpLive"), false);
  show($("grpRetake"), photoData ? true : false);
}

$("retake").addEventListener("click", () => {
  photoData = null;
  photoImg.classList.remove("show");
  show($("grpRetake"), false);
  hint.textContent = "Photo cleared — take a new one.";
});

/* ---------------- Signature (DPR-aware, crisp on mobile) ---------------- */
const pad = $<HTMLCanvasElement>("sigPad");
const signaturePad = new SignaturePad(pad, {
  penColor: "#13204a",
  backgroundColor: "rgba(0,0,0,0)", // transparent — overlays the printed line
  minWidth: 0.7,
  maxWidth: 2.2,
});

/**
 * Size the canvas backing store to the device pixel ratio so strokes are
 * captured at full physical resolution. This is what makes the exported
 * signature sharp on phones (DPR 2–3) instead of a blurry upscale.
 * Existing strokes are preserved across resizes via toData()/fromData().
 */
function resizeSignature() {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = pad.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const data = signaturePad.toData();
  pad.width = Math.round(rect.width * ratio);
  pad.height = Math.round(rect.height * ratio);
  pad.getContext("2d")!.scale(ratio, ratio);
  signaturePad.clear();
  if (data.length) signaturePad.fromData(data);
}

$("clearSig").addEventListener("click", () => signaturePad.clear());

// Dev-only handle for automated verification; stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __sp: SignaturePad }).__sp = signaturePad;

// Recompute after layout settles. rAF avoids sizing to a transitional
// (mid-reflow) rect, which would leave the backing store under-resolved.
let resizeQueued = false;
function queueResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resizeSignature();
  });
}
new ResizeObserver(queueResize).observe(pad);
window.addEventListener("resize", queueResize);
window.addEventListener("orientationchange", queueResize);
resizeSignature();

/* ---------------- Reset ---------------- */
$("resetAll").addEventListener("click", () => {
  $<HTMLTextAreaElement>("feedback").value = "";
  signaturePad.clear();
  photoData = null;
  photoImg.classList.remove("show");
  stopStream();
  resetPhotoUI();
  show($("grpRetake"), false);
  hint.textContent = "Form reset.";
});

/* ---------------- Compose one landscape JPEG ---------------- */
const W = 1402,
  H = 1122;
const FB = { x: 745, maxW: 545, firstBaseline: 405, step: 32, lastY: 565, font: 22 };
const PHOTO = { x: 95, y: 305, w: 605, h: 600 };
const SIG = { x: 732, y: 675, w: 576, h: 160 };

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  text.split("\n").forEach((para) => {
    if (para === "") {
      out.push("");
      return;
    }
    let line = "";
    para.split(/\s+/).forEach((word) => {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    });
    out.push(line);
  });
  return out;
}

async function buildJpeg(): Promise<string> {
  try {
    await document.fonts.load("46px 'Sofia'");
    await document.fonts.ready;
  } catch {
    /* fonts optional */
  }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // 1) original form as the base
  const base = await loadImg(FORM_IMG);
  ctx.drawImage(base, 0, 0, W, H);

  // editable prescriber sentence under the logo — scaled to stay within the
  // form margins so a long name never runs off the edge (mirrors the on-screen fit).
  const nm = $<HTMLInputElement>("nameInput").value.trim();
  const pre = "DR. ",
    post = " is a prescriber of CALBRIT 60K";
  const NAME_FONT = "'Lucida Calligraphy','Lucida Handwriting','Sofia',cursive";
  const maxLineW = W - 130; // side margins
  const measureAt = (px: number) => {
    ctx.font = px + "px " + NAME_FONT;
    const preW = ctx.measureText(pre).width;
    const postW = ctx.measureText(post).width;
    const nameW = Math.max(ctx.measureText(nm).width + 16, (180 * px) / 46);
    return { preW, postW, nameW, total: preW + nameW + postW };
  };
  let fontPx = 46;
  let m = measureAt(fontPx);
  if (m.total > maxLineW) {
    fontPx = Math.max((fontPx * maxLineW) / m.total, 18);
    m = measureAt(fontPx);
  }
  ctx.font = fontPx + "px " + NAME_FONT;
  ctx.textBaseline = "alphabetic";
  const sx = (W - m.total) / 2;
  const yb = 248;
  ctx.fillStyle = "#0a1f5c";
  ctx.fillText(pre, sx, yb);
  ctx.fillStyle = "#13204a";
  ctx.fillText(nm, sx + m.preW + (m.nameW - ctx.measureText(nm).width) / 2, yb);
  ctx.fillStyle = "#0a1f5c";
  ctx.fillText(post, sx + m.preW + m.nameW, yb);

  // 2) feedback text on the ruled lines
  const txt = $<HTMLTextAreaElement>("feedback").value;
  if (txt.trim()) {
    ctx.fillStyle = "#13204a";
    ctx.font = FB.font + 'px "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = "alphabetic";
    const lines = wrapLines(ctx, txt, FB.maxW);
    let y = FB.firstBaseline;
    for (const ln of lines) {
      if (y > FB.lastY) break;
      ctx.fillText(ln, FB.x, y);
      y += FB.step;
    }
  }

  // 3) captured photo into YOUR PHOTO box (cover-crop, like the live preview)
  if (photoData) {
    const p = await loadImg(photoData);
    const scale = Math.max(PHOTO.w / p.width, PHOTO.h / p.height);
    const sw = PHOTO.w / scale,
      sh = PHOTO.h / scale;
    const psx = (p.width - sw) / 2,
      psy = (p.height - sh) / 2;
    ctx.drawImage(p, psx, psy, sw, sh, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
  }

  // 4) signature above the printed line — the high-res canvas downscales
  //    cleanly into the box, so it stays crisp.
  if (!signaturePad.isEmpty()) {
    ctx.drawImage(pad, SIG.x, SIG.y, SIG.w, SIG.h);
  }

  return c.toDataURL("image/jpeg", 0.95);
}

$("downloadBtn").addEventListener("click", async () => {
  hint.textContent = "Building image…";
  try {
    const url = await buildJpeg();
    const a = document.createElement("a");
    a.href = url;
    a.download = "hydrox-feedback-form.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    hint.textContent = "Downloaded hydrox-feedback-form.jpg ✓";
    toast("JPEG downloaded ✓");
  } catch {
    hint.textContent =
      "Could not build the image here — open this file directly in your browser to download.";
  }
});
