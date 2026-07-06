(() => {
  const cameraInput = document.getElementById("camera-input");
  const fileInput = document.getElementById("file-input");
  const previewWrap = document.getElementById("preview-wrap");
  const preview = document.getElementById("preview");
  const scanBtn = document.getElementById("scan-btn");
  const progressWrap = document.getElementById("progress-wrap");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");
  const captureSection = document.getElementById("capture-section");
  const resultsSection = document.getElementById("results-section");
  const itemsBody = document.getElementById("items-body");
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

  let currentImageDataUrl = null;

  cameraInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
  fileInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));

  function handleFileSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      currentImageDataUrl = e.target.result;
      preview.src = currentImageDataUrl;
      previewWrap.classList.remove("hidden");
      resultsSection.classList.add("hidden");
      errorSection.classList.add("hidden");
    };
    reader.readAsDataURL(file);
  }

  scanBtn.addEventListener("click", () => {
    if (!currentImageDataUrl) return;
    runOcr(currentImageDataUrl);
  });

  errorRetryBtn.addEventListener("click", () => {
    errorSection.classList.add("hidden");
    captureSection.classList.remove("hidden");
  });

  async function runOcr(imageDataUrl) {
    progressWrap.classList.remove("hidden");
    scanBtn.disabled = true;
    progressFill.style.width = "0%";
    progressLabel.textContent = "Loading OCR engine…";

    try {
      const result = await Tesseract.recognize(imageDataUrl, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            const pct = Math.round((m.progress || 0) * 100);
            progressFill.style.width = pct + "%";
            progressLabel.textContent = `Reading text… ${pct}%`;
          } else if (m.status) {
            progressLabel.textContent = m.status;
          }
        },
      });

      const text = result.data.text || "";
      rawTextEl.textContent = text;
      const { items, total } = parseReceipt(text);

      renderItems(items);
      detectedTotalEl.textContent = total !== null ? formatMoney(total) : "—";

      captureSection.classList.add("hidden");
      resultsSection.classList.remove("hidden");
      errorSection.classList.add("hidden");
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
    /\border\b#?/i,
    /\bqty\b/i,
    /^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/, // date
    /^\s*\d{1,2}:\d{2}/, // time
    /www\.|http/i,
  ];

  const TOTAL_LINE_PATTERN = /^(grand\s+)?total\b(?!.*sub)/i;

  function parseReceipt(rawText) {
    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const priceAtEnd = /(-?\$?\s?\d{1,4}[.,]\d{2})\s*$/;
    const items = [];
    let total = null;

    for (const line of lines) {
      const match = line.match(priceAtEnd);
      if (!match) continue;

      const priceStr = match[1].replace(/\s/g, "").replace(",", ".").replace("$", "");
      const price = parseFloat(priceStr);
      if (Number.isNaN(price)) continue;

      const namePart = line.slice(0, match.index).trim().replace(/[.\-*]+$/, "").trim();

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

  function cleanItemName(name) {
    return name
      .replace(/^\d+\s*[xX]\s*/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function formatMoney(n) {
    return "$" + n.toFixed(2);
  }

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
    itemsBody.querySelectorAll("tr").forEach((tr) => {
      const val = parseFloat(tr.querySelector(".price-input").value);
      if (!Number.isNaN(val)) sum += val;
    });
    computedTotalEl.textContent = formatMoney(sum);
  }

  addRowBtn.addEventListener("click", () => addItemRow());

  rescanBtn.addEventListener("click", () => {
    resultsSection.classList.add("hidden");
    captureSection.classList.remove("hidden");
    previewWrap.classList.add("hidden");
    currentImageDataUrl = null;
    cameraInput.value = "";
    fileInput.value = "";
  });

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
  });

  copyBtn.addEventListener("click", async () => {
    const rows = getItemsData();
    const text = rows.map((r) => `${r.name}\t$${r.price}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy as Text"), 1500);
    } catch {
      alert("Could not copy to clipboard.");
    }
  });
})();
