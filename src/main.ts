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

/* ---------------- ERP (Forms Pro) submission config ----------------
 * The composed JPEG is submitted into the "Prescribtion form" in ERPNext
 * (Forms Pro). We replicate exactly what the public form does:
 *   1) POST the image to /api/method/upload_file  → returns a /files/… URL
 *   2) POST that URL to submit_form_response       → creates the submission
 * The rep is identified by ?emp=<employee id> in this page's URL; that id is
 * sent as an extra field so ERP can group submissions by employee/HQ/team.  */
const ERP_BASE = "https://erp.elbrit.org";
const FORM_ID = "cdggrub9kd"; // Forms Pro Form record for "Prescribtion form"
const IMAGE_FIELDNAME = "doctor_image"; // the Attach field on that form

/* Employee context is baked into each rep's link and passed straight through
 * to matching hidden fields on the form, so every submission (and the exported
 * sheet) is self-contained: who submitted, their HQ and department. Each entry
 * maps a URL query param → the Forms Pro fieldname it fills. Values that aren't
 * present in the link are simply skipped, so a plain link still works.
 * Example link: https://…/?emp=E00826&name=Praveen%20M&hq=HQ-Chennai&dept=CND%20Chennai%20-%20ELPL */
const LINK_FIELDS: { param: string; fieldname: string }[] = [
  { param: "emp", fieldname: "emp_id" },
  { param: "name", fieldname: "employee_name" },
  { param: "hq", fieldname: "hq" },
  { param: "dept", fieldname: "department" },
];

/** Employee id from the link, e.g. https://…/?emp=E00826 (used for the filename). */
function getEmpId(): string {
  return (new URLSearchParams(location.search).get("emp") || "").trim();
}

/** The employee context fields present in the link, as Forms Pro {fieldname,value} pairs. */
function linkFields(): { fieldname: string; value: string }[] {
  const p = new URLSearchParams(location.search);
  return LINK_FIELDS.map(({ param, fieldname }) => ({
    fieldname,
    value: (p.get(param) || "").trim(),
  })).filter((f) => f.value);
}

/** Turn a data: URL (from canvas.toDataURL) into a Blob for multipart upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/:(.*?);/)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Upload the JPEG to Frappe; returns the stored file_url (e.g. "/files/x.jpg"). */
async function uploadImage(blob: Blob, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", blob, filename);
  fd.append("is_private", "0");
  fd.append("folder", "Home");
  const res = await fetch(`${ERP_BASE}/api/method/upload_file`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`upload_file HTTP ${res.status}`);
  const url = (await res.json())?.message?.file_url;
  if (!url) throw new Error("upload_file returned no file_url");
  return url;
}

/** Create the Forms Pro submission with the uploaded image + employee context. */
async function submitToErp(fileUrl: string): Promise<void> {
  const form_data: { fieldname: string; value: string }[] = [
    { fieldname: IMAGE_FIELDNAME, value: fileUrl },
    ...linkFields(),
  ];
  const res = await fetch(
    `${ERP_BASE}/api/method/forms_pro.api.submission.submit_form_response`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        form_id: FORM_ID,
        form_data,
        submission_status: "Submitted",
      }),
    },
  );
  if (!res.ok) throw new Error(`submit_form_response HTTP ${res.status}`);
}

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
  const btn = $<HTMLButtonElement>("downloadBtn");
  btn.disabled = true;
  hint.textContent = "Building image…";
  try {
    const empId = getEmpId();
    const blob = dataUrlToBlob(await buildJpeg());
    const filename = `prescription-${empId || "form"}-${Date.now()}.jpg`;

    hint.textContent = "Uploading to ERP…";
    const fileUrl = await uploadImage(blob, filename);

    hint.textContent = "Saving submission…";
    await submitToErp(fileUrl);

    hint.textContent = "Submitted to ERP ✓";
    toast("Submitted to ERP ✓");

    // Clear for the next entry (form stays on-page). Photo/signature reset;
    // the name is kept since the same rep often submits several in a row.
    $<HTMLTextAreaElement>("feedback").value = "";
    signaturePad.clear();
    photoData = null;
    photoImg.classList.remove("show");
    stopStream();
    resetPhotoUI();
    show($("grpRetake"), false);
  } catch (e) {
    // Keep the form intact so the rep can retry without re-entering anything.
    hint.textContent = `Could not submit to ERP — ${(e as Error).message}. Please try again.`;
    toast("Submit failed");
  } finally {
    btn.disabled = false;
  }
});
