/* global pdfjsLib, lucide */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const TAG_COLORS = [
  "#b02a37",
  "#0b6e4f",
  "#204e75",
  "#8d3f00",
  "#6f3fb3",
  "#00838f",
  "#a04415",
  "#2e7d32",
  "#ad1457",
  "#4e342e",
  "#00695c",
  "#1565c0",
];

const UNIT_TO_METER = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
};

const SNAP_EDGE_THRESHOLD = 75;
const SNAP_DISTANCE_WEIGHT = 3.6;
const DEFAULT_SNAP_RADIUS = 12;
const DEFAULT_DIMENSION_OFFSET = 18;

const TOOL_BORDER_CLASSES = [
  "tool-active-calibrate",
  "tool-active-distance",
  "tool-active-polygon",
  "tool-active-count",
  "tool-active-print-select",
];

const state = {
  pdfDoc: null,
  pageNum: 1,
  zoom: 1,
  currentTool: "none",
  unit: "m",
  scaleByPage: {},
  snapEnabled: true,
  snapRadius: DEFAULT_SNAP_RADIUS,
  dimensionOffset: DEFAULT_DIMENSION_OFFSET,
  pageImageData: null,
  lastCalibration: null,
  annotationsByPage: {},
  pageBaseSizes: {},
  currentViewSize: { width: 0, height: 0 },
  groupOpenByPage: {},
  hiddenTagsByPage: {},
  tagStyles: {},
  nextTagColorIndex: 0,
  marksPanelCollapsed: false,
  hintDismissed: false,
  selectedMarkId: null,
  countSession: {
    tag: "A",
    seq: 0,
  },
  nextId: 1,
  temp: {
    points: [],
    hover: null,
    snap: null,
    dragging: false,
    selection: null,
  },
};

const ui = {
  fileInput: document.getElementById("pdfFile"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageIndicator: document.getElementById("pageIndicator"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomIndicator: document.getElementById("zoomIndicator"),
  unitSelect: document.getElementById("unitSelect"),
  scaleValueInput: document.getElementById("scaleValueInput"),
  dimOffsetInput: document.getElementById("dimOffsetInput"),
  magnetToggle: document.getElementById("magnetToggle"),
  resetScale: document.getElementById("resetScale"),
  tools: Array.from(document.querySelectorAll(".tool")),
  countTag: document.getElementById("countTag"),
  finishPolygon: document.getElementById("finishPolygon"),
  cancelCurrent: document.getElementById("cancelCurrent"),
  clearPage: document.getElementById("clearPage"),
  printSelection: document.getElementById("printSelection"),
  saveSelection: document.getElementById("saveSelection"),
  statusText: document.getElementById("statusText"),
  scaleStateBadge: document.getElementById("scaleStateBadge"),
  magnetInfo: document.getElementById("magnetInfo"),
  scaleInfo: document.getElementById("scaleInfo"),
  calibrationInfo: document.getElementById("calibrationInfo"),
  summaryBody: document.getElementById("summaryBody"),
  marksPanelCard: document.getElementById("marksPanelCard"),
  marksPanelContent: document.getElementById("marksPanelContent"),
  toggleMarksPanel: document.getElementById("toggleMarksPanel"),
  marksGrouped: document.getElementById("marksGrouped"),
  pdfCanvas: document.getElementById("pdfCanvas"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  // New UI elements
  emptyState: document.getElementById("emptyState"),
  viewerContainer: document.getElementById("viewerContainer"),
  viewerShell: document.getElementById("viewerShell"),
  toastContainer: document.getElementById("toastContainer"),
  topbarSecondary: document.getElementById("topbarSecondary"),
  workflowHint: document.getElementById("workflowHint"),
  dismissHint: document.getElementById("dismissHint"),
  selectionActions: document.getElementById("selectionActions"),
  layout: document.querySelector(".layout"),
};

const pdfCtx = ui.pdfCanvas.getContext("2d");
const overlayCtx = ui.overlayCanvas.getContext("2d");

/* ============================================
   Utility functions
   ============================================ */

function getCurrentPageMarks() {
  if (!state.annotationsByPage[state.pageNum]) {
    state.annotationsByPage[state.pageNum] = [];
  }
  return state.annotationsByPage[state.pageNum];
}

function getCurrentPageGroupState() {
  if (!state.groupOpenByPage[state.pageNum]) {
    state.groupOpenByPage[state.pageNum] = {};
  }
  return state.groupOpenByPage[state.pageNum];
}

function getCurrentPageHiddenTags() {
  if (!state.hiddenTagsByPage[state.pageNum]) {
    state.hiddenTagsByPage[state.pageNum] = {};
  }
  return state.hiddenTagsByPage[state.pageNum];
}

function ensureTagStyle(tag) {
  if (!state.tagStyles[tag]) {
    const color = TAG_COLORS[state.nextTagColorIndex % TAG_COLORS.length];
    state.tagStyles[tag] = { color };
    state.nextTagColorIndex += 1;
  }
  return state.tagStyles[tag];
}

function getTagColor(tag) {
  return ensureTagStyle(tag).color;
}

function isTagVisible(tag) {
  const hidden = getCurrentPageHiddenTags();
  return hidden[tag] !== true;
}

function setTagVisible(tag, visible) {
  const hidden = getCurrentPageHiddenTags();
  hidden[tag] = !visible;
}

function normalizeCountTag(rawTag) {
  const cleaned = String(rawTag || "").trim();
  return cleaned || "A";
}

function syncCountTagInput() {
  const tag = normalizeCountTag(ui.countTag.value);
  ui.countTag.value = tag;
  return tag;
}

function parsePositiveNumber(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function syncDimensionOffsetInput() {
  const parsed = parsePositiveNumber(ui.dimOffsetInput.value, state.dimensionOffset);
  const clamped = clampNumber(parsed, 4, 80);
  state.dimensionOffset = clamped;
  ui.dimOffsetInput.value = String(Math.round(clamped));
}

/* ============================================
   Toast Notification System
   ============================================ */

const TOAST_ICONS = {
  info: "info",
  success: "check-circle-2",
  warning: "alert-triangle",
  error: "alert-circle",
};

function showToast(message, type = "info") {
  if (!ui.toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const iconName = TOAST_ICONS[type] || TOAST_ICONS.info;
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", iconName);
  icon.className = "toast-icon";

  const text = document.createElement("span");
  text.textContent = String(message);

  toast.appendChild(icon);
  toast.appendChild(text);

  ui.toastContainer.appendChild(toast);
  if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
    lucide.createIcons({ nodes: [toast] });
  }

  const dismissTimeout = setTimeout(() => {
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", () => toast.remove());
  }, 3500);

  toast.addEventListener("click", () => {
    clearTimeout(dismissTimeout);
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", () => toast.remove());
  });
}

/* ============================================
   UI State functions
   ============================================ */

function setMarksPanelCollapsed(collapsed) {
  state.marksPanelCollapsed = collapsed;
  ui.marksPanelCard.classList.toggle("collapsed", collapsed);
  ui.marksPanelContent.hidden = collapsed;
  if (ui.toggleMarksPanel) {
    const iconName = collapsed ? "chevron-down" : "chevron-up";
    ui.toggleMarksPanel.innerHTML = `<i data-lucide="${iconName}"></i>`;
    if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
      lucide.createIcons({ nodes: [ui.toggleMarksPanel] });
    }
  }
}

function updateMagnetUI() {
  ui.magnetToggle.classList.toggle("toggle-on", state.snapEnabled);
  const label = ui.magnetToggle.querySelector(".magnet-label");
  if (label) {
    label.textContent = state.snapEnabled ? "ON" : "OFF";
  }
  ui.magnetInfo.textContent = `Ima: ${state.snapEnabled ? "ON" : "OFF"} | Raio ${state.snapRadius}px`;
}

function selectCountTag(tag, options = {}) {
  const { activateTool = false } = options;
  const normalizedTag = normalizeCountTag(tag);
  ensureTagStyle(normalizedTag);
  setTagVisible(normalizedTag, true);
  ui.countTag.value = normalizedTag;

  if (normalizedTag !== state.countSession.tag) {
    state.countSession.tag = normalizedTag;
    state.countSession.seq = 0;
  }

  if (activateTool && state.pdfDoc) {
    state.currentTool = "count";
    updateToolUI();
  }

  setStatus(`Tag ${normalizedTag} selecionada para contagem.`);
  renderTables();
  drawOverlay();
}

function setStatus(text, type = "info") {
  void type;
  ui.statusText.textContent = text;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function getUnitFactor(unit) {
  return UNIT_TO_METER[unit] || UNIT_TO_METER.m;
}

function getCurrentPageScale() {
  return state.scaleByPage[state.pageNum] || null;
}

function hasCurrentPageScale() {
  return Boolean(getCurrentPageScale());
}

function syncCurrentPageScaleState() {
  const scale = getCurrentPageScale();
  state.lastCalibration = scale ? { ...scale, page: state.pageNum } : null;
}

function pxToCurrentUnitDistance(pxDistance) {
  const scale = getCurrentPageScale();
  if (!scale) return null;
  const unitMeters = getUnitFactor(state.unit);
  return (pxDistance * scale.metersPerPixel) / unitMeters;
}

function pxToCurrentUnitArea(pxArea) {
  const scale = getCurrentPageScale();
  if (!scale) return null;
  const unitMeters = getUnitFactor(state.unit);
  return (pxArea * scale.metersPerPixel * scale.metersPerPixel) / (unitMeters * unitMeters);
}

function formatDistance(pxDistance) {
  const converted = pxToCurrentUnitDistance(pxDistance);
  if (converted === null) {
    return `${formatNumber(pxDistance)} px`;
  }
  return `${formatNumber(converted)} ${state.unit}`;
}

function formatArea(pxArea) {
  const converted = pxToCurrentUnitArea(pxArea);
  if (converted === null) {
    return `${formatNumber(pxArea)} px2`;
  }
  return `${formatNumber(converted)} ${state.unit}2`;
}

function updateScaleInfo() {
  const scale = getCurrentPageScale();
  if (!scale) {
    ui.scaleInfo.textContent = `Escala pag ${state.pageNum}: nao calibrada`;
    ui.calibrationInfo.textContent = "Calibracao: nenhuma";
    ui.scaleStateBadge.textContent = "Nao calibrada";
    ui.scaleStateBadge.classList.remove("on");
    ui.scaleStateBadge.classList.add("off");
    return;
  }
  const currentUnitMeters = getUnitFactor(state.unit);
  const pxPerCurrentUnit = currentUnitMeters / scale.metersPerPixel;
  ui.scaleInfo.textContent = `Escala pag ${state.pageNum}: 1 ${state.unit} = ${formatNumber(
    pxPerCurrentUnit
  )} px`;
  ui.calibrationInfo.textContent = `Ref pag ${state.pageNum}: ${formatNumber(scale.realValue)} ${
    scale.calibrationUnit
  } em ${formatNumber(scale.pixelDistance)} px`;
  ui.scaleStateBadge.textContent = "Calibrada";
  ui.scaleStateBadge.classList.remove("off");
  ui.scaleStateBadge.classList.add("on");
}

function updateToolUI() {
  for (const button of ui.tools) {
    button.classList.toggle("active", button.dataset.tool === state.currentTool);
  }
  ui.finishPolygon.disabled = !(state.currentTool === "polygon" && state.temp.points.length >= 3);
  ui.cancelCurrent.disabled = state.temp.points.length === 0 && !state.temp.selection;

  // Update tool-active border on viewer shell
  if (ui.viewerShell) {
    for (const cls of TOOL_BORDER_CLASSES) {
      ui.viewerShell.classList.remove(cls);
    }
    if (state.currentTool !== "none") {
      const borderClass = `tool-active-${state.currentTool}`;
      if (TOOL_BORDER_CLASSES.includes(borderClass)) {
        ui.viewerShell.classList.add(borderClass);
      }
    }
  }
}

function hasValidSelection() {
  const selection = state.temp.selection;
  return Boolean(selection && selection.w >= 5 && selection.h >= 5);
}

function updateSelectionActionsState() {
  const enabled = Boolean(state.pdfDoc);
  if (ui.selectionActions) {
    ui.selectionActions.classList.toggle("visible", enabled);
  }
  ui.printSelection.disabled = !enabled || !hasValidSelection();
  ui.saveSelection.disabled = !enabled || !hasValidSelection();
}

function enableControls() {
  const enabled = Boolean(state.pdfDoc);
  ui.unitSelect.disabled = !enabled;
  ui.scaleValueInput.disabled = !enabled;
  ui.dimOffsetInput.disabled = !enabled;
  ui.magnetToggle.disabled = !enabled;
  ui.prevPage.disabled = !enabled;
  ui.nextPage.disabled = !enabled;
  ui.zoomIn.disabled = !enabled;
  ui.zoomOut.disabled = !enabled;
  ui.resetScale.disabled = !enabled;
  ui.clearPage.disabled = !enabled;
  ui.toggleMarksPanel.disabled = !enabled;
  for (const tool of ui.tools) {
    tool.disabled = !enabled;
  }
  updateSelectionActionsState();
}

function setPageIndicator() {
  const total = state.pdfDoc ? state.pdfDoc.numPages : 0;
  const current = state.pdfDoc ? state.pageNum : 0;
  ui.pageIndicator.textContent = `${current} / ${total}`;
  ui.prevPage.disabled = !state.pdfDoc || state.pageNum <= 1;
  ui.nextPage.disabled = !state.pdfDoc || state.pageNum >= total;
}

function setZoomIndicator() {
  ui.zoomIndicator.textContent = `${Math.round(state.zoom * 100)}%`;
}

/* ============================================
   Workflow Hint
   ============================================ */

function updateWorkflowHint() {
  if (!ui.workflowHint) return;
  if (state.hintDismissed || !state.pdfDoc || hasCurrentPageScale()) {
    ui.workflowHint.style.display = "none";
  } else {
    ui.workflowHint.style.display = "";
  }
}

/* ============================================
   Geometry helpers
   ============================================ */

function getMousePos(event) {
  const rect = ui.overlayCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getCurrentBaseSize() {
  return state.pageBaseSizes[state.pageNum] || {
    width: state.currentViewSize.width || ui.overlayCanvas.width || 1,
    height: state.currentViewSize.height || ui.overlayCanvas.height || 1,
  };
}

function viewToDocPoint(point) {
  const base = getCurrentBaseSize();
  const viewWidth = state.currentViewSize.width || ui.overlayCanvas.width || 1;
  const viewHeight = state.currentViewSize.height || ui.overlayCanvas.height || 1;
  return {
    x: (point.x / viewWidth) * base.width,
    y: (point.y / viewHeight) * base.height,
  };
}

function docToViewPoint(point) {
  const base = getCurrentBaseSize();
  const viewWidth = state.currentViewSize.width || ui.overlayCanvas.width || 1;
  const viewHeight = state.currentViewSize.height || ui.overlayCanvas.height || 1;
  return {
    x: (point.x / base.width) * viewWidth,
    y: (point.y / base.height) * viewHeight,
  };
}

function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function shouldUseSnapForTool(tool) {
  return tool === "calibrate" || tool === "distance" || tool === "polygon" || tool === "count";
}

function vectorBetween(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function normalizedPerpendicular(a, b) {
  const v = vectorBetween(a, b);
  const len = Math.hypot(v.x, v.y);
  if (len < 0.0001) {
    return { x: 0, y: -1 };
  }
  return { x: -v.y / len, y: v.x / len };
}

function addScaledVector(point, direction, factor) {
  return {
    x: point.x + direction.x * factor,
    y: point.y + direction.y * factor,
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function constrainToOrthogonal(origin, target) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: target.x, y: origin.y };
  }
  return { x: origin.x, y: target.y };
}

/* ============================================
   Snap system
   ============================================ */

function cachePageImageData() {
  try {
    state.pageImageData = pdfCtx.getImageData(0, 0, ui.pdfCanvas.width, ui.pdfCanvas.height);
  } catch (error) {
    console.warn("Nao foi possivel capturar imagem da pagina para ima.", error);
    state.pageImageData = null;
  }
}

function getLumaAt(imageData, x, y) {
  const xx = clampNumber(Math.round(x), 0, imageData.width - 1);
  const yy = clampNumber(Math.round(y), 0, imageData.height - 1);
  const index = (yy * imageData.width + xx) * 4;
  const data = imageData.data;
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function collectSnapAnchors() {
  const anchors = [];
  const marks = getCurrentPageMarks();
  for (const mark of marks) {
    if (mark.type === "count") {
      if (!isTagVisible(mark.tag)) continue;
      anchors.push(docToViewPoint(mark.point));
      continue;
    }
    if (mark.type === "distance" || mark.type === "calibration") {
      anchors.push(docToViewPoint(mark.p1));
      anchors.push(docToViewPoint(mark.p2));
      continue;
    }
    if (mark.type === "polygon") {
      for (const point of mark.points) {
        anchors.push(docToViewPoint(point));
      }
    }
  }
  return anchors;
}

function getAnchorSnap(viewPoint) {
  const anchors = collectSnapAnchors();
  let best = null;
  for (const anchor of anchors) {
    const dist = distance(anchor, viewPoint);
    if (dist > state.snapRadius) continue;
    if (!best || dist < best.distance) {
      best = { x: anchor.x, y: anchor.y, distance: dist, source: "marca" };
    }
  }
  return best;
}

function getEdgeSnap(viewPoint) {
  const imageData = state.pageImageData;
  if (!imageData) return null;

  const xMin = Math.max(1, Math.floor(viewPoint.x - state.snapRadius));
  const xMax = Math.min(imageData.width - 2, Math.ceil(viewPoint.x + state.snapRadius));
  const yMin = Math.max(1, Math.floor(viewPoint.y - state.snapRadius));
  const yMax = Math.min(imageData.height - 2, Math.ceil(viewPoint.y + state.snapRadius));

  let best = null;
  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      const dist = Math.hypot(x - viewPoint.x, y - viewPoint.y);
      if (dist > state.snapRadius) continue;

      const gx = Math.abs(getLumaAt(imageData, x + 1, y) - getLumaAt(imageData, x - 1, y));
      const gy = Math.abs(getLumaAt(imageData, x, y + 1) - getLumaAt(imageData, x, y - 1));
      const edgeStrength = gx + gy;
      if (edgeStrength < SNAP_EDGE_THRESHOLD) continue;

      const score = edgeStrength - dist * SNAP_DISTANCE_WEIGHT;
      if (!best || score > best.score) {
        best = {
          x,
          y,
          distance: dist,
          score,
          source: "borda",
        };
      }
    }
  }
  return best;
}

function getSnappedViewPoint(rawViewPoint, tool) {
  if (!state.snapEnabled || !shouldUseSnapForTool(tool)) {
    return { point: rawViewPoint, snapped: false, source: null };
  }

  const anchorCandidate = getAnchorSnap(rawViewPoint);
  const edgeCandidate = getEdgeSnap(rawViewPoint);
  let chosen = null;
  if (anchorCandidate && edgeCandidate) {
    chosen = anchorCandidate.distance <= edgeCandidate.distance ? anchorCandidate : edgeCandidate;
  } else {
    chosen = anchorCandidate || edgeCandidate;
  }

  if (!chosen) {
    return { point: rawViewPoint, snapped: false, source: null };
  }

  return {
    point: { x: chosen.x, y: chosen.y },
    snapped: true,
    source: chosen.source,
  };
}

/* ============================================
   Polygon helpers
   ============================================ */

function polygonMetrics(points) {
  if (points.length < 3) {
    return { area: 0, perimeter: 0 };
  }
  let areaSum = 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    areaSum += a.x * b.y - b.x * a.y;
    perimeter += distance(a, b);
  }
  return {
    area: Math.abs(areaSum / 2),
    perimeter,
  };
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, c) {
  return (
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(p1, p2, q1, q2) {
  const EPS = 1e-9;
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);

  if (Math.abs(o1) < EPS && onSegment(p1, p2, q1)) return true;
  if (Math.abs(o2) < EPS && onSegment(p1, p2, q2)) return true;
  if (Math.abs(o3) < EPS && onSegment(q1, q2, p1)) return true;
  if (Math.abs(o4) < EPS && onSegment(q1, q2, p2)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function polygonHasSelfIntersection(points) {
  if (points.length < 4) return false;

  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/* ============================================
   Mark management
   ============================================ */

function makeMark(type, payload) {
  return {
    id: state.nextId,
    type,
    ...payload,
  };
}

function commitMark(mark) {
  const marks = getCurrentPageMarks();
  marks.push(mark);
  state.nextId += 1;
  drawOverlay();
  renderTables();
}

function deleteMark(id) {
  const marks = getCurrentPageMarks();
  const index = marks.findIndex((item) => item.id === id);
  if (index >= 0) {
    marks.splice(index, 1);
    if (state.selectedMarkId === id) {
      state.selectedMarkId = null;
    }
    drawOverlay();
    renderTables();
  }
}

function clearTempDrawing() {
  state.temp.points = [];
  state.temp.hover = null;
  state.temp.snap = null;
  state.temp.selection = null;
  state.temp.dragging = false;
  state.selectedMarkId = null;
  updateSelectionActionsState();
  updateToolUI();
  enableControls();
  drawOverlay();
}

function toolLabel(type) {
  if (type === "calibration") return "Escala";
  if (type === "distance") return "Distancia";
  if (type === "polygon") return "Area";
  if (type === "count") return "Contagem";
  return type;
}

function markDetail(mark) {
  if (mark.type === "calibration") {
    if (mark.realValue) {
      return `Referencia: ${formatNumber(mark.realValue)} ${mark.unit || state.unit}`;
    }
    return `${formatDistance(mark.pixelDistance)} (base de escala)`;
  }
  if (mark.type === "distance") {
    return formatDistance(mark.pixelDistance);
  }
  if (mark.type === "polygon") {
    return `Area: ${formatArea(mark.area)} | Perimetro: ${formatDistance(mark.perimeter)}`;
  }
  if (mark.type === "count") {
    return `Tag ${mark.tag} | Contagem ${mark.sequence || 0}`;
  }
  return "";
}

function getMarkGroupMeta(mark) {
  if (mark.type === "count") {
    return {
      key: `count:${mark.tag}`,
      label: `Contagem - Tag ${mark.tag}`,
      priority: 0,
    };
  }

  return {
    key: `type:${mark.type}`,
    label: toolLabel(mark.type),
    priority: 1,
  };
}

/* ============================================
   Render tables & grouped marks
   ============================================ */

function renderGroupedMarks(marks) {
  const groupState = getCurrentPageGroupState();
  const activeDetails = ui.marksGrouped.querySelectorAll("details[data-group-key]");
  for (const detailsEl of activeDetails) {
    groupState[detailsEl.dataset.groupKey] = detailsEl.open;
  }

  ui.marksGrouped.innerHTML = "";
  if (!marks.length) {
    ui.marksGrouped.innerHTML = '<div class="group-empty">Sem marcacoes.</div>';
    return;
  }

  const groups = new Map();
  for (const mark of marks) {
    if (mark.type === "count" && !isTagVisible(mark.tag)) {
      continue;
    }
    const meta = getMarkGroupMeta(mark);
    if (!groups.has(meta.key)) {
      groups.set(meta.key, { ...meta, items: [] });
    }
    groups.get(meta.key).items.push(mark);
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.label.localeCompare(b.label, "pt-BR");
  });

  if (!sortedGroups.length) {
    ui.marksGrouped.innerHTML = '<div class="group-empty">Todas as tags de contagem estao ocultas.</div>';
    return;
  }

  for (const group of sortedGroups) {
    const detailsEl = document.createElement("details");
    detailsEl.className = "mark-group";
    detailsEl.dataset.groupKey = group.key;
    detailsEl.open = groupState[group.key] ?? true;
    detailsEl.addEventListener("toggle", () => {
      groupState[group.key] = detailsEl.open;
    });

    const summaryEl = document.createElement("summary");
    const summaryWrap = document.createElement("span");
    summaryWrap.className = "group-summary";

    if (group.key.startsWith("count:")) {
      const tag = group.key.slice("count:".length);
      const colorSwatch = document.createElement("span");
      colorSwatch.className = "tag-swatch";
      colorSwatch.style.backgroundColor = getTagColor(tag);
      summaryWrap.appendChild(colorSwatch);
    }

    const summaryText = document.createElement("span");
    summaryText.textContent = `${group.label} | Total: ${group.items.length}`;
    summaryWrap.appendChild(summaryText);
    summaryEl.appendChild(summaryWrap);
    detailsEl.appendChild(summaryEl);

    const tableEl = document.createElement("table");
    tableEl.className = "group-table";
    const theadEl = document.createElement("thead");
    theadEl.innerHTML = `
      <tr>
        <th>Item</th>
        <th>Detalhes</th>
        <th></th>
      </tr>
    `;
    tableEl.appendChild(theadEl);

    const tbodyEl = document.createElement("tbody");
    for (const mark of group.items) {
      const rowEl = document.createElement("tr");

      const itemCell = document.createElement("td");
      if (mark.type === "count") {
        itemCell.textContent = `${mark.tag}-${mark.sequence || 0}`;
      } else {
        itemCell.textContent = `#${mark.id}`;
      }

      const detailCell = document.createElement("td");
      detailCell.textContent = markDetail(mark);

      const actionCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-mark";
      deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
      deleteButton.title = "Excluir";
      deleteButton.addEventListener("click", () => deleteMark(mark.id));
      actionCell.appendChild(deleteButton);

      rowEl.appendChild(itemCell);
      rowEl.appendChild(detailCell);
      rowEl.appendChild(actionCell);
      tbodyEl.appendChild(rowEl);
    }

    tableEl.appendChild(tbodyEl);
    detailsEl.appendChild(tableEl);
    ui.marksGrouped.appendChild(detailsEl);
  }

  lucide.createIcons({ nodes: [ui.marksGrouped] });
}

function renderTables() {
  const marks = getCurrentPageMarks();
  renderGroupedMarks(marks);

  const summary = new Map();
  for (const mark of marks) {
    if (mark.type === "count") {
      ensureTagStyle(mark.tag);
      summary.set(mark.tag, (summary.get(mark.tag) || 0) + 1);
    }
  }

  ui.summaryBody.innerHTML = "";
  if (!summary.size) {
    ui.summaryBody.innerHTML = '<tr><td colspan="3" class="muted">Sem dados.</td></tr>';
    return;
  }

  const sortedSummary = Array.from(summary.entries()).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  for (const [tag, qty] of sortedSummary) {
    const visible = isTagVisible(tag);
    const color = getTagColor(tag);
    const row = document.createElement("tr");
    row.classList.toggle("summary-selected", tag === state.countSession.tag);
    row.classList.toggle("summary-hidden", !visible);

    const tagCell = document.createElement("td");
    const tagButton = document.createElement("button");
    tagButton.className = "tag-select";
    tagButton.classList.toggle("active", tag === state.countSession.tag);
    tagButton.title = "Selecionar tag";
    tagButton.addEventListener("click", () => selectCountTag(tag, { activateTool: true }));

    const colorSwatch = document.createElement("span");
    colorSwatch.className = "tag-swatch";
    colorSwatch.style.backgroundColor = color;

    const tagText = document.createElement("span");
    tagText.textContent = tag;

    tagButton.appendChild(colorSwatch);
    tagButton.appendChild(tagText);
    tagCell.appendChild(tagButton);

    const qtyCell = document.createElement("td");
    qtyCell.textContent = String(qty);

    const visibilityCell = document.createElement("td");
    const visibilityButton = document.createElement("button");
    visibilityButton.className = "tag-visibility-toggle";
    visibilityButton.innerHTML = visible
      ? '<i data-lucide="eye"></i>'
      : '<i data-lucide="eye-off"></i>';
    visibilityButton.title = visible ? "Ocultar" : "Mostrar";
    visibilityButton.addEventListener("click", () => {
      setTagVisible(tag, !visible);
      drawOverlay();
      renderTables();
      setStatus(`Tag ${tag} ${visible ? "ocultada" : "mostrada"}.`);
    });
    visibilityCell.appendChild(visibilityButton);

    row.appendChild(tagCell);
    row.appendChild(qtyCell);
    row.appendChild(visibilityCell);
    ui.summaryBody.appendChild(row);
  }

  lucide.createIcons({ nodes: [ui.summaryBody] });
}

/* ============================================
   Drawing functions
   ============================================ */

function drawCircle(point, color, radius = 4) {
  overlayCtx.beginPath();
  overlayCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  overlayCtx.fillStyle = color;
  overlayCtx.fill();
}

function drawLine(a, b, color, width = 2, dash = []) {
  overlayCtx.beginPath();
  overlayCtx.setLineDash(dash);
  overlayCtx.moveTo(a.x, a.y);
  overlayCtx.lineTo(b.x, b.y);
  overlayCtx.lineWidth = width;
  overlayCtx.strokeStyle = color;
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
}

function drawDimension(p1, p2, color, text, offsetPx) {
  const normal = normalizedPerpendicular(p1, p2);
  const q1 = addScaledVector(p1, normal, offsetPx);
  const q2 = addScaledVector(p2, normal, offsetPx);

  drawLine(p1, q1, color, 1, [4, 3]);
  drawLine(p2, q2, color, 1, [4, 3]);
  drawLine(q1, q2, color, 2);

  const direction = vectorBetween(q1, q2);
  const dirLen = Math.hypot(direction.x, direction.y) || 1;
  const tangent = { x: direction.x / dirLen, y: direction.y / dirLen };
  const tickSize = 5;
  drawLine(
    addScaledVector(q1, tangent, -tickSize),
    addScaledVector(q1, tangent, tickSize),
    color,
    1
  );
  drawLine(
    addScaledVector(q2, tangent, -tickSize),
    addScaledVector(q2, tangent, tickSize),
    color,
    1
  );

  const labelPoint = addScaledVector(midpoint(q1, q2), normal, 10);
  drawLabel(labelPoint, text, "#fdfdfd");
}

function drawPolygon(points, color, closePath = true, fill = "") {
  if (!points.length) return;
  overlayCtx.beginPath();
  overlayCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    overlayCtx.lineTo(points[i].x, points[i].y);
  }
  if (closePath && points.length > 2) {
    overlayCtx.closePath();
  }
  overlayCtx.lineWidth = 2;
  overlayCtx.strokeStyle = color;
  overlayCtx.stroke();
  if (fill) {
    overlayCtx.fillStyle = fill;
    overlayCtx.fill();
  }
}

function drawLabel(point, text, color) {
  overlayCtx.font = "12px sans-serif";
  overlayCtx.fillStyle = "rgba(0,0,0,0.7)";
  overlayCtx.fillRect(point.x + 8, point.y - 14, overlayCtx.measureText(text).width + 8, 16);
  overlayCtx.fillStyle = color;
  overlayCtx.fillText(text, point.x + 12, point.y - 2);
}

function drawSelectionRect(selection) {
  if (!selection) return;
  const { x, y, w, h } = selection;
  overlayCtx.fillStyle = "rgba(11, 110, 79, 0.15)";
  overlayCtx.fillRect(x, y, w, h);
  overlayCtx.strokeStyle = "#0b6e4f";
  overlayCtx.lineWidth = 2;
  overlayCtx.setLineDash([6, 4]);
  overlayCtx.strokeRect(x, y, w, h);
  overlayCtx.setLineDash([]);
}

function drawSnapIndicator(snap) {
  if (!snap || !snap.snapped) return;
  const point = snap.point;
  const color = snap.source === "marca" ? "#0b6e4f" : "#204e75";
  overlayCtx.beginPath();
  overlayCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = 2;
  overlayCtx.stroke();

  drawLine({ x: point.x - 8, y: point.y }, { x: point.x + 8, y: point.y }, color, 1);
  drawLine({ x: point.x, y: point.y - 8 }, { x: point.x, y: point.y + 8 }, color, 1);
}

function drawMark(mark) {
  const isSelected = state.selectedMarkId === mark.id;

  if (mark.type === "calibration") {
    const p1 = docToViewPoint(mark.p1);
    const p2 = docToViewPoint(mark.p2);
    drawCircle(p1, "#204e75");
    drawCircle(p2, "#204e75");
    const label = mark.realValue
      ? `Escala: ${formatNumber(mark.realValue)} ${mark.unit || state.unit}`
      : `Escala: ${formatDistance(mark.pixelDistance)}`;
    drawDimension(p1, p2, "#204e75", label, state.dimensionOffset);
    if (isSelected) {
      drawCircle(p1, "#1a1d26", 8);
      drawCircle(p2, "#1a1d26", 8);
    }
    return;
  }

  if (mark.type === "distance") {
    const p1 = docToViewPoint(mark.p1);
    const p2 = docToViewPoint(mark.p2);
    drawCircle(p1, "#8d3f00");
    drawCircle(p2, "#8d3f00");
    drawDimension(p1, p2, "#8d3f00", formatDistance(mark.pixelDistance), state.dimensionOffset);
    if (isSelected) {
      drawCircle(p1, "#1a1d26", 8);
      drawCircle(p2, "#1a1d26", 8);
    }
    return;
  }

  if (mark.type === "polygon") {
    const points = mark.points.map(docToViewPoint);
    drawPolygon(points, "#0b6e4f", true, "rgba(11,110,79,0.15)");
    const anchor = points[0];
    drawLabel(anchor, `A ${formatArea(mark.area)} | P ${formatDistance(mark.perimeter)}`, "#dcffea");
    if (isSelected) {
      drawPolygon(points, "#1a1d26", true, "");
    }
    return;
  }

  if (mark.type === "count") {
    if (!isTagVisible(mark.tag)) {
      return;
    }
    const color = getTagColor(mark.tag);
    const point = docToViewPoint(mark.point);
    drawCircle(point, color, 5);
    drawLabel(point, `${mark.tag}-${mark.sequence || 0}`, "#ffd9df");
    if (isSelected) {
      drawCircle(point, "#1a1d26", 9);
    }
  }
}

function drawTemp() {
  const points = state.temp.points;
  if (state.currentTool === "distance" || state.currentTool === "calibrate") {
    if (points.length === 1 && state.temp.hover) {
      drawLine(docToViewPoint(points[0]), docToViewPoint(state.temp.hover), "#666", 1, [5, 5]);
    }
    for (const point of points) {
      drawCircle(docToViewPoint(point), "#666");
    }
  }

  if (state.currentTool === "polygon") {
    if (points.length) {
      drawPolygon(points.map(docToViewPoint), "#666", false, "");
      for (const point of points) {
        drawCircle(docToViewPoint(point), "#666");
      }
      if (state.temp.hover) {
        drawLine(
          docToViewPoint(points[points.length - 1]),
          docToViewPoint(state.temp.hover),
          "#666",
          1,
          [5, 5]
        );
      }

      const previewPoints = state.temp.hover ? [...points, state.temp.hover] : [...points];
      if (previewPoints.length >= 3) {
        const previewAnchor = docToViewPoint(previewPoints[previewPoints.length - 1]);
        if (polygonHasSelfIntersection(previewPoints)) {
          drawLabel(previewAnchor, "Poligono invalido: cruzamento", "#fff2d6");
        } else {
          const previewMetrics = polygonMetrics(previewPoints);
          drawLabel(
            previewAnchor,
            `Prev A ${formatArea(previewMetrics.area)} | P ${formatDistance(previewMetrics.perimeter)}`,
            "#fff2d6"
          );
        }
      }

      if (state.temp.hover && points.length >= 3) {
        const firstView = docToViewPoint(points[0]);
        const hoverView = docToViewPoint(state.temp.hover);
        if (distance(firstView, hoverView) <= state.snapRadius + 2) {
          drawCircle(firstView, "#0b6e4f", 6);
          drawLabel(firstView, "Clique para fechar", "#dcffea");
        }
      }
    }
  }

  drawSelectionRect(state.temp.selection);
  drawSnapIndicator(state.temp.snap);
}

function drawOverlay(options = {}) {
  const includeTemp = options.includeTemp !== false;
  overlayCtx.clearRect(0, 0, ui.overlayCanvas.width, ui.overlayCanvas.height);
  const marks = getCurrentPageMarks();
  for (const mark of marks) {
    drawMark(mark);
  }
  if (includeTemp) {
    drawTemp();
  }
}

function distanceToSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return distance(point, a);
  const t = clampNumber(((point.x - a.x) * abx + (point.y - a.y) * aby) / len2, 0, 1);
  const projection = { x: a.x + t * abx, y: a.y + t * aby };
  return distance(point, projection);
}

function isPointInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function getMarkAtDocPoint(point) {
  const marks = getCurrentPageMarks();
  let best = null;
  const hitThreshold = 12 / Math.max(state.zoom, 0.4);

  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const mark = marks[i];

    if (mark.type === "count") {
      if (!isTagVisible(mark.tag)) continue;
      const d = distance(point, mark.point);
      if (d <= hitThreshold) return mark;
      continue;
    }

    if (mark.type === "distance" || mark.type === "calibration") {
      const d = distanceToSegment(point, mark.p1, mark.p2);
      if (d <= hitThreshold && (!best || d < best.distance)) {
        best = { mark, distance: d };
      }
      continue;
    }

    if (mark.type === "polygon" && mark.points.length >= 3) {
      if (isPointInPolygon(point, mark.points)) {
        return mark;
      }
      for (let p = 0; p < mark.points.length; p += 1) {
        const a = mark.points[p];
        const b = mark.points[(p + 1) % mark.points.length];
        const d = distanceToSegment(point, a, b);
        if (d <= hitThreshold && (!best || d < best.distance)) {
          best = { mark, distance: d };
        }
      }
    }
  }

  return best ? best.mark : null;
}

/* ============================================
   Polygon finish
   ============================================ */

function finishPolygon() {
  if (state.temp.points.length < 3) {
    return;
  }
  const points = state.temp.points.map((point) => ({ ...point }));
  if (polygonHasSelfIntersection(points)) {
    setStatus("Poligono invalido: segmentos se cruzam. Ajuste os pontos antes de fechar.", "warning");
    return;
  }
  const metrics = polygonMetrics(points);
  if (metrics.area < 1e-6) {
    setStatus("Poligono invalido: area muito pequena.", "warning");
    return;
  }
  commitMark(
    makeMark("polygon", {
      points,
      area: metrics.area,
      perimeter: metrics.perimeter,
    })
  );
  state.temp.points = [];
  state.temp.hover = null;
  state.temp.snap = null;
  updateToolUI();
  setStatus(`Area registrada: ${formatArea(metrics.area)} | Perimetro: ${formatDistance(metrics.perimeter)}`, "success");
}

/* ============================================
   Selection capture
   ============================================ */

function captureSelectionCanvas() {
  const selection = state.temp.selection;
  if (!selection || selection.w < 5 || selection.h < 5) {
    return null;
  }

  const sx = Math.max(0, Math.floor(selection.x));
  const sy = Math.max(0, Math.floor(selection.y));
  const sw = Math.min(ui.pdfCanvas.width - sx, Math.floor(selection.w));
  const sh = Math.min(ui.pdfCanvas.height - sy, Math.floor(selection.h));
  if (sw <= 0 || sh <= 0) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(
    ui.pdfCanvas,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    sw,
    sh
  );

  drawOverlay({ includeTemp: false });

  ctx.drawImage(
    ui.overlayCanvas,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    sw,
    sh
  );

  drawOverlay();

  return canvas;
}

function saveSelectionAsPng() {
  const selectionCanvas = captureSelectionCanvas();
  if (!selectionCanvas) {
    setStatus("Selecao invalida para salvar.", "warning");
    return;
  }
  const link = document.createElement("a");
  link.href = selectionCanvas.toDataURL("image/png");
  link.download = `selecao_pagina_${state.pageNum}.png`;
  link.click();
}

function printSelection() {
  const selectionCanvas = captureSelectionCanvas();
  if (!selectionCanvas) {
    setStatus("Selecao invalida para imprimir.", "warning");
    return;
  }
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    setStatus("Bloqueio de popup. Permita popups para imprimir.", "error");
    return;
  }

  const dataUrl = selectionCanvas.toDataURL("image/png");
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Impressao - Pagina ${state.pageNum}</title>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: center; }
          img { max-width: 100vw; max-height: 100vh; }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" alt="Selecao" onload="window.print(); setTimeout(() => window.close(), 300);" />
      </body>
    </html>
  `);
  printWindow.document.close();
}

/* ============================================
   Render & Load
   ============================================ */

async function renderPage() {
  if (!state.pdfDoc) return;

  // Page loading fade
  if (ui.viewerContainer) {
    ui.viewerContainer.classList.add("page-loading");
  }

  const page = await state.pdfDoc.getPage(state.pageNum);
  const baseViewport = page.getViewport({ scale: 1.25 });
  const viewport = page.getViewport({ scale: 1.25 * state.zoom });
  state.pageBaseSizes[state.pageNum] = {
    width: baseViewport.width,
    height: baseViewport.height,
  };
  state.currentViewSize = {
    width: viewport.width,
    height: viewport.height,
  };

  ui.pdfCanvas.width = viewport.width;
  ui.pdfCanvas.height = viewport.height;
  ui.overlayCanvas.width = viewport.width;
  ui.overlayCanvas.height = viewport.height;

  await page.render({ canvasContext: pdfCtx, viewport }).promise;
  cachePageImageData();

  state.temp.points = [];
  state.temp.hover = null;
  state.temp.snap = null;
  state.temp.selection = null;
  state.temp.dragging = false;

  syncCurrentPageScaleState();
  updateScaleInfo();
  setPageIndicator();
  setZoomIndicator();
  renderTables();
  updateToolUI();
  enableControls();
  drawOverlay();
  updateWorkflowHint();

  // Remove page loading fade
  if (ui.viewerContainer) {
    ui.viewerContainer.classList.remove("page-loading");
  }
}

async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  state.pdfDoc = await loadingTask.promise;
  state.pageNum = 1;
  state.zoom = 1;
  state.currentTool = "none";
  state.unit = ui.unitSelect.value || "m";
  state.scaleByPage = {};
  state.snapEnabled = true;
  state.snapRadius = DEFAULT_SNAP_RADIUS;
  syncDimensionOffsetInput();
  state.pageImageData = null;
  state.lastCalibration = null;
  state.annotationsByPage = {};
  state.pageBaseSizes = {};
  state.currentViewSize = { width: 0, height: 0 };
  state.groupOpenByPage = {};
  state.hiddenTagsByPage = {};
  state.tagStyles = {};
  state.nextTagColorIndex = 0;
  state.countSession.tag = syncCountTagInput();
  state.countSession.seq = 0;
  ensureTagStyle(state.countSession.tag);
  state.nextId = 1;
  state.hintDismissed = false;
  state.selectedMarkId = null;
  state.temp.points = [];
  state.temp.hover = null;
  state.temp.snap = null;
  state.temp.dragging = false;
  state.temp.selection = null;

  // Show viewer, hide empty state, show secondary bar
  if (ui.emptyState) ui.emptyState.style.display = "none";
  if (ui.viewerContainer) ui.viewerContainer.style.display = "";
  if (ui.topbarSecondary) ui.topbarSecondary.classList.add("visible");
  if (ui.layout) ui.layout.classList.add("has-secondary-bar");

  setStatus(`PDF carregado: ${file.name}`, "success");
  updateScaleInfo();
  updateMagnetUI();
  enableControls();
  await renderPage();
}

/* ============================================
   Pointer events
   ============================================ */

function normalizeSelectionRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

function pointerDown(event) {
  if (!state.pdfDoc) return;

  const rawViewPos = getMousePos(event);
  const tool = state.currentTool;
  const snapResult = getSnappedViewPoint(rawViewPos, tool);
  const viewPos = shouldUseSnapForTool(tool) ? snapResult.point : rawViewPos;
  const docPos = viewToDocPoint(viewPos);
  state.temp.snap = shouldUseSnapForTool(tool) ? snapResult : null;

  if (tool === "none") {
    const mark = getMarkAtDocPoint(docPos);
    state.selectedMarkId = mark ? mark.id : null;
    if (mark) {
      setStatus(`Selecionado: ${toolLabel(mark.type)} #${mark.id} | ${markDetail(mark)}`);
    } else {
      setStatus("Cursor ativo. Clique em uma marcacao para selecionar.");
    }
    drawOverlay();
    return;
  }

  if (tool === "polygon" && !hasCurrentPageScale()) {
    state.temp.snap = null;
    drawOverlay();
    setStatus(`Calibre a escala da pagina ${state.pageNum} antes de medir distancia/area.`, "warning");
    return;
  }

  if (tool === "calibrate" || tool === "distance") {
    let pointToStore = docPos;
    const isCalibrationMode = tool === "calibrate" || (tool === "distance" && !hasCurrentPageScale());
    if (isCalibrationMode && state.temp.points.length === 1) {
      pointToStore = constrainToOrthogonal(state.temp.points[0], docPos);
    }
    state.temp.points.push(pointToStore);
    if (state.temp.points.length === 2) {
      const p1 = state.temp.points[0];
      const p2 = state.temp.points[1];
      const pixelDistance = distance(p1, p2);

      if (pixelDistance < 0.5) {
        state.temp.points = [];
        state.temp.hover = null;
        state.temp.snap = null;
        setStatus("Pontos muito proximos. Marque dois pontos distintos.", "warning");
        drawOverlay();
        return;
      }

      if (tool === "calibrate" || (tool === "distance" && !hasCurrentPageScale())) {
        const realValue = Number(ui.scaleValueInput.value);
        if (Number.isFinite(realValue) && realValue > 0) {
          const calibrationUnit = ui.unitSelect.value || state.unit || "m";
          state.unit = calibrationUnit;
          const realMeters = realValue * getUnitFactor(calibrationUnit);
          const metersPerPixel = realMeters / pixelDistance;
          state.scaleByPage[state.pageNum] = {
            metersPerPixel,
            realValue,
            pixelDistance,
            calibrationUnit,
          };
          syncCurrentPageScaleState();
          updateScaleInfo();
          commitMark(
            makeMark("calibration", {
              p1,
              p2,
              pixelDistance,
              realValue,
              unit: calibrationUnit,
            })
          );
          setStatus(`Escala calibrada na pagina ${state.pageNum}: ${formatNumber(realValue)} ${calibrationUnit}`, "success");
          updateWorkflowHint();
        } else {
          setStatus("Valor da distancia real invalido. Ajuste o campo Dist. real.", "error");
        }
      } else {
        commitMark(makeMark("distance", { p1, p2, pixelDistance }));
        setStatus("Medicao de distancia registrada.", "success");
      }

      state.temp.points = [];
      state.temp.hover = null;
      state.temp.snap = null;
      updateToolUI();
    }
    drawOverlay();
    return;
  }

  if (tool === "polygon") {
    if (state.temp.points.length >= 3) {
      const firstPointView = docToViewPoint(state.temp.points[0]);
      if (distance(firstPointView, viewPos) <= state.snapRadius + 2) {
        finishPolygon();
        drawOverlay();
        return;
      }
    }
    state.temp.points.push(docPos);
    updateToolUI();
    drawOverlay();
    return;
  }

  if (tool === "count") {
    const tag = syncCountTagInput();
    ensureTagStyle(tag);
    if (tag !== state.countSession.tag) {
      state.countSession.tag = tag;
      state.countSession.seq = 0;
    }
    state.countSession.seq += 1;
    const sequence = state.countSession.seq;
    commitMark(makeMark("count", { point: docPos, tag, sequence }));
    state.temp.snap = null;
    setStatus(`Contagem ${tag}: ${sequence}`, "success");
    return;
  }

  if (tool === "print-select") {
    state.temp.dragging = true;
    state.temp.points = [viewPos];
    state.temp.selection = { x: viewPos.x, y: viewPos.y, w: 0, h: 0 };
    updateSelectionActionsState();
    updateToolUI();
    drawOverlay();
  }
}

function pointerMove(event) {
  if (!state.pdfDoc) return;
  const rawViewPos = getMousePos(event);
  const tool = state.currentTool;
  const snapResult = getSnappedViewPoint(rawViewPos, tool);
  const viewPos = shouldUseSnapForTool(tool) ? snapResult.point : rawViewPos;
  state.temp.snap = shouldUseSnapForTool(tool) ? snapResult : null;

  if (state.currentTool === "calibrate" || state.currentTool === "distance" || state.currentTool === "polygon") {
    let hoverDoc = viewToDocPoint(viewPos);
    const isCalibrationMode =
      (state.currentTool === "distance" && !hasCurrentPageScale()) || state.currentTool === "calibrate";
    if (isCalibrationMode && state.temp.points.length === 1) {
      hoverDoc = constrainToOrthogonal(state.temp.points[0], hoverDoc);
    }
    state.temp.hover = hoverDoc;
  } else {
    state.temp.hover = viewPos;
  }

  if (state.currentTool === "print-select" && state.temp.dragging && state.temp.points.length === 1) {
    state.temp.selection = normalizeSelectionRect(state.temp.points[0], rawViewPos);
  }

  drawOverlay();
}

function pointerUp(event) {
  if (!state.pdfDoc) return;

  if (state.currentTool === "print-select" && state.temp.dragging && state.temp.points.length === 1) {
    const viewPos = getMousePos(event);
    state.temp.selection = normalizeSelectionRect(state.temp.points[0], viewPos);
    state.temp.dragging = false;
    state.temp.points = [];
    state.temp.snap = null;
    updateSelectionActionsState();
    setStatus("Area selecionada. Use os botoes para imprimir ou salvar.");
    updateToolUI();
    drawOverlay();
  }
}

function pointerDblClick(event) {
  if (state.currentTool !== "polygon") return;
  event.preventDefault();
  finishPolygon();
}

/* ============================================
   Event listeners
   ============================================ */

ui.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await loadPdf(file);
  } catch (error) {
    console.error(error);
    setStatus("Erro ao carregar PDF.", "error");
  }
});

ui.prevPage.addEventListener("click", async () => {
  if (!state.pdfDoc || state.pageNum <= 1) return;
  state.pageNum -= 1;
  await renderPage();
});

ui.nextPage.addEventListener("click", async () => {
  if (!state.pdfDoc || state.pageNum >= state.pdfDoc.numPages) return;
  state.pageNum += 1;
  await renderPage();
});

ui.zoomIn.addEventListener("click", async () => {
  if (!state.pdfDoc) return;
  state.zoom = Math.min(4, state.zoom + 0.1);
  await renderPage();
});

ui.zoomOut.addEventListener("click", async () => {
  if (!state.pdfDoc) return;
  state.zoom = Math.max(0.4, state.zoom - 0.1);
  await renderPage();
});

ui.unitSelect.addEventListener("change", () => {
  state.unit = ui.unitSelect.value || "m";
  updateScaleInfo();
  renderTables();
  drawOverlay();
});

ui.dimOffsetInput.addEventListener("change", () => {
  syncDimensionOffsetInput();
  drawOverlay();
});

ui.magnetToggle.addEventListener("click", () => {
  state.snapEnabled = !state.snapEnabled;
  updateMagnetUI();
  state.temp.snap = null;
  drawOverlay();
  setStatus(`Ima ${state.snapEnabled ? "ligado" : "desligado"}.`);
});

ui.countTag.addEventListener("change", () => {
  const nextTag = syncCountTagInput();
  selectCountTag(nextTag, { activateTool: false });
});

ui.resetScale.addEventListener("click", () => {
  delete state.scaleByPage[state.pageNum];
  syncCurrentPageScaleState();
  updateScaleInfo();
  renderTables();
  drawOverlay();
  setStatus(`Escala da pagina ${state.pageNum} resetada.`);
  updateWorkflowHint();
});

ui.toggleMarksPanel.addEventListener("click", () => {
  setMarksPanelCollapsed(!state.marksPanelCollapsed);
});

for (const toolButton of ui.tools) {
  toolButton.addEventListener("click", () => {
    state.currentTool = toolButton.dataset.tool;
    state.temp.points = [];
    state.temp.hover = null;
    state.temp.snap = null;
    if (state.currentTool !== "print-select") {
      state.temp.selection = null;
      updateSelectionActionsState();
    }
    updateToolUI();
    drawOverlay();
    const toolName = toolButton.dataset.tooltip || toolButton.dataset.tool;
    if (
      state.currentTool === "polygon" &&
      !hasCurrentPageScale()
    ) {
      setStatus(`Ferramenta ativa: ${toolName}. Calibre a escala da pagina primeiro.`, "warning");
    } else {
      setStatus(`Ferramenta ativa: ${toolName}`);
    }
  });
}

ui.finishPolygon.addEventListener("click", finishPolygon);

ui.cancelCurrent.addEventListener("click", () => {
  clearTempDrawing();
  setStatus("Desenho atual cancelado.");
});

ui.clearPage.addEventListener("click", () => {
  if (!state.pdfDoc) return;
  state.annotationsByPage[state.pageNum] = [];
  delete state.groupOpenByPage[state.pageNum];
  delete state.hiddenTagsByPage[state.pageNum];
  state.temp.selection = null;
  state.temp.snap = null;
  updateSelectionActionsState();
  renderTables();
  drawOverlay();
  setStatus("Marcacoes da pagina removidas.");
});

ui.printSelection.addEventListener("click", printSelection);
ui.saveSelection.addEventListener("click", saveSelectionAsPng);

// Workflow hint dismiss
if (ui.dismissHint) {
  ui.dismissHint.addEventListener("click", () => {
    state.hintDismissed = true;
    updateWorkflowHint();
  });
}

// Canvas events
ui.overlayCanvas.addEventListener("mousedown", pointerDown);
ui.overlayCanvas.addEventListener("mousemove", pointerMove);
ui.overlayCanvas.addEventListener("mouseup", pointerUp);
ui.overlayCanvas.addEventListener("dblclick", pointerDblClick);
ui.overlayCanvas.addEventListener("contextmenu", (event) => {
  if (state.currentTool === "polygon" && state.temp.points.length >= 3) {
    event.preventDefault();
    finishPolygon();
    drawOverlay();
  }
});
ui.overlayCanvas.addEventListener("mouseleave", () => {
  state.temp.hover = null;
  state.temp.snap = null;
  if (state.currentTool !== "print-select") {
    drawOverlay();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.currentTool === "none") {
      if (state.selectedMarkId !== null) {
        state.selectedMarkId = null;
        drawOverlay();
        setStatus("Selecao limpa.");
      }
      return;
    }

    const hasOngoingAction =
      state.temp.points.length > 0 || state.temp.selection !== null || state.temp.dragging;
    if (hasOngoingAction) {
      clearTempDrawing();
      setStatus("Acao cancelada.");
    }
    return;
  }

  if ((event.key === "Delete" || event.key === "Backspace") && state.currentTool === "none") {
    if (state.selectedMarkId !== null) {
      event.preventDefault();
      const id = state.selectedMarkId;
      deleteMark(id);
      setStatus(`Marcacao #${id} removida.`);
    }
    return;
  }

  if (event.key === "Enter" && state.currentTool === "polygon" && state.temp.points.length >= 3) {
    event.preventDefault();
    finishPolygon();
    drawOverlay();
  }
});

/* ============================================
   Drag and drop
   ============================================ */

if (ui.viewerShell) {
  ui.viewerShell.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.viewerShell.classList.add("drag-over");
  });

  ui.viewerShell.addEventListener("dragleave", () => {
    ui.viewerShell.classList.remove("drag-over");
  });

  ui.viewerShell.addEventListener("drop", async (event) => {
    event.preventDefault();
    ui.viewerShell.classList.remove("drag-over");
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type === "application/pdf") {
      try {
        await loadPdf(file);
      } catch (error) {
        console.error(error);
        setStatus("Erro ao carregar PDF.", "error");
      }
    } else if (file) {
      setStatus("Apenas arquivos PDF sao suportados.", "warning");
    }
  });
}

/* ============================================
   Initialization
   ============================================ */

state.unit = ui.unitSelect.value || "m";
syncDimensionOffsetInput();
state.countSession.tag = syncCountTagInput();
state.countSession.seq = 0;
ensureTagStyle(state.countSession.tag);
setMarksPanelCollapsed(false);
updateScaleInfo();
updateMagnetUI();
setPageIndicator();
setZoomIndicator();
renderTables();
updateToolUI();
enableControls();

// Initialize Lucide icons
lucide.createIcons();
