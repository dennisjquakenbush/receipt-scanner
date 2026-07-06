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

    // trailing [A-Z*]{0,2} tolerates tax-code suffixes many receipts print after the
    // price (e.g. "3.49 T", "3.49F") — without it, every item line fails to match
    // while a bare "Total 12.81" line still does, so items silently come up empty.
    const priceAtEnd = /(-?[$€£¥]?\s?\d{1,4}[.,]\d{2})\s*[A-Z*]{0,2}\s*$/;
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

      items.push({ name: humanizeItemName(cleanItemName(namePart)), price });
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
      .replace(/^\d+\s*[xX]\s*/, "") // "2 x Milk" -> "Milk"
      .replace(/^\d{4,14}\s+(?=\S)/, "") // leading SKU/item/PLU code -> "1234567 Bacon" -> "Bacon"
      .split(/\s+/)
      .filter((word) => /[A-Za-z0-9]/.test(word)) // drop stray OCR noise tokens like "~~" or "--"
      .join(" ")
      .trim();
  }

  // Instead of a hand-maintained abbreviation -> expansion map, this figures shorthand out:
  // it reduces both a common-grocery-term vocabulary and the OCR'd word to a "skeleton"
  // (first letter + remaining consonants) and fuzzy-matches them. "SKMMLK" and "skim milk"
  // reduce to the same skeleton automatically, so unseen abbreviations still resolve as long
  // as the underlying word is in the vocabulary below.
  const VOCAB = [
    "milk", "skim milk", "whole milk", "2% milk", "1% milk", "buttermilk",
    "heavy cream", "half and half", "butter", "margarine",
    "sour cream", "cream cheese", "cottage cheese", "cheddar cheese", "mozzarella cheese",
    "swiss cheese", "shredded cheese", "yogurt", "greek yogurt",
    "eggs", "large eggs", "egg whites",
    "bread", "wheat bread", "white bread", "whole wheat bread", "sourdough bread", "rye bread",
    "bagel", "english muffin", "tortilla", "muffin", "dinner roll", "baguette",
    "banana", "bananas", "apple", "apples", "orange", "oranges", "grapes",
    "strawberries", "blueberries", "raspberries", "lemon", "lime", "avocado",
    "tomato", "tomatoes", "onion", "onions", "garlic", "potato", "potatoes",
    "sweet potato", "carrot", "carrots", "celery", "cucumber", "lettuce", "spinach",
    "broccoli", "cauliflower", "bell pepper", "mushroom", "mushrooms", "zucchini", "corn",
    "chicken breast", "chicken thigh", "chicken wings", "ground chicken", "whole chicken", "chicken",
    "ground beef", "ground turkey", "beef steak", "pork chop", "bacon", "sausage",
    "ham", "turkey breast", "turkey", "pork", "beef",
    "salmon", "shrimp", "tuna", "tilapia",
    "peanut butter", "jelly", "jam", "honey", "maple syrup",
    "cereal", "oatmeal", "granola", "white rice", "brown rice", "rice",
    "pasta", "spaghetti", "macaroni", "flour", "sugar", "brown sugar",
    "salt", "black pepper", "olive oil", "vegetable oil", "canola oil",
    "soy sauce", "ketchup", "mustard", "mayonnaise", "salsa", "hot sauce",
    "barbecue sauce", "pasta sauce", "chicken broth", "beef broth",
    "black beans", "chickpeas", "canned tomatoes", "peanuts", "almonds", "cashews",
    "orange juice", "apple juice", "grape juice", "water", "sparkling water",
    "soda", "ginger ale", "coffee", "ground coffee", "tea", "green tea",
    "beer", "red wine", "white wine",
    "ice cream", "frozen pizza", "frozen vegetables", "frozen fruit", "frozen waffles",
    "potato chips", "tortilla chips", "crackers", "pretzels", "popcorn",
    "cookies", "granola bar", "candy", "chocolate bar", "trail mix",
    "toilet paper", "paper towels", "napkins", "facial tissue", "dish soap",
    "laundry detergent", "fabric softener", "dryer sheets", "trash bags",
    "aluminum foil", "plastic wrap", "sponges", "shampoo", "conditioner",
    "body wash", "toothpaste", "toothbrush", "deodorant", "hand soap",
    "diapers", "baby wipes",
    // common descriptors, so lone abbreviated adjectives resolve too
    "large", "small", "medium", "regular", "organic", "natural", "fresh",
    "frozen", "boneless", "skinless", "ground", "whole", "wheat", "white",
    "dozen", "pack", "package", "gallon", "quart", "pint", "ounce", "pound",
    // hardware & home improvement (Lowe's, Home Depot, Ace, etc.)
    "plywood", "drywall", "joint compound", "spackle", "insulation",
    "lumber", "two by four", "stud", "plank", "particle board", "osb board", "mdf board",
    "trim", "baseboard", "crown molding", "molding", "subfloor", "joist", "beam", "rafter",
    "screw", "screws", "wood screw", "drywall screw", "nail", "nails", "finish nail",
    "bolt", "bolts", "nut", "washer", "anchor", "hinge", "bracket", "hook",
    "paint", "primer", "spray paint", "wood stain", "varnish", "polyurethane",
    "paint brush", "paint roller", "paint tray", "painters tape", "masking tape",
    "duct tape", "electrical tape", "caulk", "silicone caulk", "adhesive", "wood glue",
    "epoxy", "sealant", "sandpaper", "steel wool", "wire brush",
    "extension cord", "power strip", "outlet", "light switch", "wall plate",
    "light bulb", "led bulb", "flashlight", "battery", "batteries", "smoke detector",
    "circuit breaker", "wire", "electrical wire", "wire nut", "conduit",
    "pvc pipe", "copper pipe", "pipe fitting", "elbow fitting", "coupling", "valve",
    "hose bib", "shutoff valve", "faucet", "showerhead", "toilet", "toilet seat",
    "sink", "garbage disposal", "water heater", "water filter", "drain snake",
    "plunger", "garden hose", "sprinkler", "hose nozzle",
    "drill", "drill bit", "impact driver", "circular saw", "jigsaw", "reciprocating saw",
    "miter saw", "table saw", "angle grinder", "sander", "orbital sander",
    "hammer", "rubber mallet", "screwdriver", "screwdriver set", "wrench",
    "adjustable wrench", "socket set", "ratchet", "pliers", "wire cutter", "utility knife",
    "level", "tape measure", "chalk line", "stud finder", "safety glasses",
    "work gloves", "respirator mask", "dust mask", "ear protection", "hard hat",
    "ladder", "step ladder", "extension ladder", "tool box", "tool bag", "work bench",
    "shop vac", "air compressor", "generator", "propane tank", "fire extinguisher",
    "tarp", "plastic sheeting", "drop cloth", "bungee cord", "rope", "chain",
    "padlock", "door knob", "deadbolt", "door hinge", "weatherstripping", "door sweep",
    "window screen", "gutter", "downspout", "shingles", "roofing felt", "flashing",
    "fence post", "fence panel", "gate", "gate latch", "mailbox",
    "concrete mix", "mortar mix", "grout", "tile", "ceramic tile", "vinyl flooring",
    "laminate flooring", "hardwood flooring", "carpet", "carpet padding",
    "mulch", "topsoil", "potting soil", "fertilizer", "grass seed", "sod", "gravel", "sand",
    "shovel", "rake", "hoe", "wheelbarrow", "pruning shears", "lawn mower",
    "trimmer", "leaf blower", "chainsaw", "hose reel",
    "extension pole", "furnace filter", "air filter", "thermostat", "ceiling fan",
  ];

  function skeletonOf(str) {
    const letters = str.toUpperCase().replace(/[^A-Z]/g, "");
    if (!letters) return "";
    return letters[0] + letters.slice(1).replace(/[AEIOU]/g, "");
  }

  const ACRONYMS = new Set(["pvc", "led", "osb", "mdf"]);

  function titleCasePhrase(phrase) {
    return phrase
      .split(" ")
      .map((w) => {
        if (!w) return w;
        if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");
  }

  const VOCAB_INDEX = (() => {
    const seen = new Set();
    const entries = [];
    for (const phrase of VOCAB) {
      const skeleton = skeletonOf(phrase.replace(/\s+/g, ""));
      if (!skeleton || seen.has(skeleton)) continue; // first (most common) phrase wins ties
      seen.add(skeleton);
      entries.push({ skeleton, display: titleCasePhrase(phrase) });
    }
    return entries;
  })();

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }

  function maxFuzzyDistance(tokenLen, entryLen) {
    if (tokenLen <= 3) return 0; // too short to guess safely, require an exact skeleton match
    const basis = Math.max(tokenLen, entryLen);
    if (basis <= 5) return 1;
    if (basis <= 8) return 2;
    return 3;
  }

  function autoExpandToken(token) {
    const letters = token.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (letters.length < 2) return null;

    const sk = skeletonOf(letters);
    let best = null;
    let bestDist = Infinity;
    for (const entry of VOCAB_INDEX) {
      const dist = entry.skeleton === sk ? 0 : levenshtein(sk, entry.skeleton);
      const allowed = maxFuzzyDistance(sk.length, entry.skeleton.length);
      if (dist <= allowed && dist < bestDist) {
        bestDist = dist;
        best = entry;
        if (dist === 0) break;
      }
    }
    return best ? best.display : null;
  }

  function humanizeItemName(name) {
    const cleaned = name.trim();
    if (!cleaned) return cleaned;

    const parts = cleaned.split(/(\s+)/); // keep whitespace so spacing is preserved
    const expanded = parts.map((part) => {
      if (/^\s+$/.test(part) || part === "") return part;
      const auto = autoExpandToken(part);
      if (auto) return auto;
      return titleCaseWord(part);
    });

    return expanded.join("").replace(/\s{2,}/g, " ").trim();
  }

  function titleCaseWord(word) {
    // only re-case words that look like shouty OCR output (all letters, len > 1);
    // leave numbers, percentages, and already mixed-case brand names alone
    if (!/^[A-Z]{2,}$/.test(word)) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
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
      <td><button class="row-delete" title="Remove item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg></button></td>
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
