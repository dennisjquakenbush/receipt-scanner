(() => {
  const cameraInput = document.getElementById("camera-input");
  const fileInput = document.getElementById("file-input");
  const dropzone = document.getElementById("dropzone");
  const previewWrap = document.getElementById("preview-wrap");
  const preview = document.getElementById("preview");
  const scanBtn = document.getElementById("scan-btn");
  const clearPreviewBtn = document.getElementById("clear-preview-btn");
  const progressWrap = document.getElementById("progress-wrap");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");
  const captureSection = document.getElementById("capture-section");
  const resultsSection = document.getElementById("results-section");
  const itemsBody = document.getElementById("items-body");
  const itemsCountEl = document.getElementById("items-count");
  const mismatchBanner = document.getElementById("mismatch-banner");
  const addRowBtn = document.getElementById("add-row-btn");
  const computedTotalEl = document.getElementById("computed-total");
  const detectedTotalEl = document.getElementById("detected-total");
  const rescanBtn = document.getElementById("rescan-btn");
  const exportCsvBtn = document.getElementById("export-csv-btn");
  const copyBtn = document.getElementById("copy-btn");
  const rawTextEl = document.getElementById("raw-text");
  const errorSection = document.getElementById("error-section");
  const errorMessage = document.getElementById("error-message");
  const errorRetryBtn = document.getElementById("error-retry-btn");
  const toast = document.getElementById("toast");

  let currentImageDataUrl = null;
  let detectedTotalValue = null;
  let toastTimer = null;

  // ---------- file intake ----------

  cameraInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
  fileInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));

  dropzone.addEventListener("click", () => fileInput.click());

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-active");
    });
  });

  ["dragleave", "dragend", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-active");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) handleFileSelect(file);
  });

  clearPreviewBtn.addEventListener("click", () => {
    currentImageDataUrl = null;
    previewWrap.classList.add("hidden");
    cameraInput.value = "";
    fileInput.value = "";
  });

  function handleFileSelect(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("That doesn't look like an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      currentImageDataUrl = e.target.result;
      preview.src = currentImageDataUrl;
      previewWrap.classList.remove("hidden");
      resultsSection.classList.add("hidden");
      errorSection.classList.add("hidden");
      previewWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    reader.readAsDataURL(file);
  }

  // ---------- OCR ----------

  scanBtn.addEventListener("click", () => {
    if (!currentImageDataUrl) return;
    runOcr(currentImageDataUrl);
  });

  errorRetryBtn.addEventListener("click", () => {
    errorSection.classList.add("hidden");
    captureSection.classList.remove("hidden");
  });

  async function preprocessImage(dataUrl) {
    const img = await loadImage(dataUrl);

    const MAX_DIM = 1800;
    const MIN_DIM = 1000;
    let scale = 1;
    const longest = Math.max(img.width, img.height);
    if (longest > MAX_DIM) scale = MAX_DIM / longest;
    else if (longest < MIN_DIM) scale = MIN_DIM / longest;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // grayscale + contrast stretch, helps Tesseract on photographed (not scanned) receipts
    let min = 255, max = 0;
    const gray = new Uint8ClampedArray(data.length / 4);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      gray[j] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = Math.max(max - min, 1);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const stretched = ((gray[j] - min) / range) * 255;
      data[i] = data[i + 1] = data[i + 2] = stretched;
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function runOcr(imageDataUrl) {
    progressWrap.classList.remove("hidden");
    scanBtn.disabled = true;
    progressFill.style.width = "0%";
    progressLabel.textContent = "Preparing image…";

    try {
      const processedUrl = await preprocessImage(imageDataUrl);

      progressLabel.textContent = "Loading OCR engine…";
      const result = await Tesseract.recognize(processedUrl, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            const pct = Math.round((m.progress || 0) * 100);
            progressFill.style.width = pct + "%";
            progressLabel.textContent = `Reading text… ${pct}%`;
          } else if (m.status) {
            progressLabel.textContent = capitalize(m.status);
          }
        },
      });

      const text = result.data.text || "";
      rawTextEl.textContent = text;
      const { items, total } = parseReceipt(text);
      detectedTotalValue = total;

      renderItems(items);
      detectedTotalEl.textContent = total !== null ? formatMoney(total) : "—";

      captureSection.classList.add("hidden");
      resultsSection.classList.remove("hidden");
      errorSection.classList.add("hidden");

      if (items.length === 0) {
        showToast("Couldn't find clear line items — check the raw text below, or add items manually.");
      }
    } catch (err) {
      console.error(err);
      errorMessage.textContent =
        "Something went wrong reading that image. Try a clearer, well-lit photo of the receipt.";
      errorSection.classList.remove("hidden");
      captureSection.classList.add("hidden");
    } finally {
      progressWrap.classList.add("hidden");
      scanBtn.disabled = false;
    }
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- parsing ----------

  const SKIP_LINE_PATTERNS = [
    /subtotal/i,
    /\btotal\b/i,
    /\btax\b/i,
    /\bchange\b/i,
    /\bcash\b/i,
    /\bcredit\b/i,
    /\bdebit\b/i,
    /\bvisa\b/i,
    /\bmastercard\b/i,
    /\bamex\b/i,
    /\btender\b/i,
    /\bbalance\b/i,
    /\bdue\b/i,
    /\bcashier\b/i,
    /\bthank you\b/i,
    /\bstore\b/i,
    /\breceipt\b/i,
    /\border\s*#?\d*\b/i,
    /\bqty\b/i,
    /^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/, // date
    /^\s*\d{1,2}:\d{2}/, // time
    /www\.|http|\.com\b/i,
    /^\s*[#*=~_-]{3,}\s*$/, // separator lines
  ];

  const TOTAL_LINE_PATTERN = /^(grand\s+)?total\b(?!.*sub)/i;
  const CURRENCY_SYMBOLS = /[$€£¥]/g;

  function parseReceipt(rawText) {
    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const priceAtEnd = /(-?[$€£¥]?\s?\d{1,4}[.,]\d{2})\s*$/;
    const items = [];
    let total = null;

    for (const line of lines) {
      const match = line.match(priceAtEnd);
      if (!match) continue;

      const price = normalizePrice(match[1]);
      if (price === null) continue;

      const namePart = line
        .slice(0, match.index)
        .trim()
        .replace(/[.\-*]+$/, "")
        .trim();

      if (TOTAL_LINE_PATTERN.test(namePart) && total === null) {
        total = price;
        continue;
      }

      if (SKIP_LINE_PATTERNS.some((re) => re.test(namePart))) continue;
      if (!namePart || namePart.length < 2) continue;
      if (/^\d+$/.test(namePart)) continue;

      items.push({ name: cleanItemName(namePart), price });
    }

    return { items, total };
  }

  function normalizePrice(raw) {
    let s = raw.replace(/\s/g, "").replace(CURRENCY_SYMBOLS, "");
    const negative = s.startsWith("-");
    s = s.replace("-", "");
    // last separator (, or .) before exactly 2 digits is the decimal point
    s = s.replace(",", ".");
    const price = parseFloat(s);
    if (Number.isNaN(price)) return null;
    return negative ? -price : price;
  }

  function cleanItemName(name) {
    return name
      .replace(/^\d+\s*[xX]\s*/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function formatMoney(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toFixed(2);
  }

  // ---------- rendering ----------

  function renderItems(items) {
    itemsBody.innerHTML = "";
    if (items.length === 0) {
      addItemRow("", "");
    } else {
      items.forEach((item) => addItemRow(item.name, item.price.toFixed(2)));
    }
    updateComputedTotal();
  }

  function addItemRow(name = "", price = "") {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="name-input" value="${escapeHtml(name)}" placeholder="Item name" /></td>
      <td><input type="text" inputmode="decimal" class="price-input" value="${escapeHtml(price)}" placeholder="0.00" /></td>
      <td><button class="row-delete" title="Remove item">✕</button></td>
    `;
    itemsBody.appendChild(tr);

    tr.querySelector(".price-input").addEventListener("input", updateComputedTotal);
    tr.querySelector(".row-delete").addEventListener("click", () => {
      tr.remove();
      updateComputedTotal();
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateComputedTotal() {
    let sum = 0;
    let count = 0;
    itemsBody.querySelectorAll("tr").forEach((tr) => {
      const nameVal = tr.querySelector(".name-input").value.trim();
      const val = parseFloat(tr.querySelector(".price-input").value);
      if (!Number.isNaN(val)) sum += val;
      if (nameVal || tr.querySelector(".price-input").value.trim()) count++;
    });
    computedTotalEl.textContent = formatMoney(sum);
    itemsCountEl.textContent = count === 1 ? "1 item" : `${count} items`;

    if (detectedTotalValue !== null && Math.abs(sum - detectedTotalValue) > 0.015) {
      const diff = sum - detectedTotalValue;
      mismatchBanner.textContent =
        diff > 0
          ? `Items add up to ${formatMoney(diff)} more than the detected total — check for a duplicate or misread line.`
          : `Items add up to ${formatMoney(Math.abs(diff))} less than the detected total — a line (or tax) may be missing.`;
      mismatchBanner.classList.remove("hidden");
    } else {
      mismatchBanner.classList.add("hidden");
    }
  }

  addRowBtn.addEventListener("click", () => {
    addItemRow();
    const inputs = itemsBody.querySelectorAll(".name-input");
    inputs[inputs.length - 1]?.focus();
  });

  rescanBtn.addEventListener("click", () => {
    resultsSection.classList.add("hidden");
    captureSection.classList.remove("hidden");
    previewWrap.classList.add("hidden");
    currentImageDataUrl = null;
    detectedTotalValue = null;
    cameraInput.value = "";
    fileInput.value = "";
  });

  // ---------- export ----------

  function getItemsData() {
    const rows = [];
    itemsBody.querySelectorAll("tr").forEach((tr) => {
      const name = tr.querySelector(".name-input").value.trim();
      const price = tr.querySelector(".price-input").value.trim();
      if (name || price) rows.push({ name, price });
    });
    return rows;
  }

  exportCsvBtn.addEventListener("click", () => {
    const rows = getItemsData();
    if (rows.length === 0) {
      showToast("Nothing to export yet.");
      return;
    }
    let csv = "Item,Price\n";
    rows.forEach((r) => {
      csv += `"${r.name.replace(/"/g, '""')}",${r.price}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "receipt-items.csv";
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV downloaded.");
  });

  copyBtn.addEventListener("click", async () => {
    const rows = getItemsData();
    if (rows.length === 0) {
      showToast("Nothing to copy yet.");
      return;
    }
    const text = rows.map((r) => `${r.name}\t$${r.price}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard.");
    } catch {
      showToast("Could not copy — clipboard access blocked.");
    }
  });

  // ---------- toast ----------

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 250);
    }, 3000);
  }
})();
