// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Application State
let currentLang = 'en'; // 'en' | 'bn'
let tenderInfo = null;
let requirements = [];
let uploadedFiles = []; // [{ id, file, name, size, pages, hash }]
let matches = {}; // { reqId: fileId }
let expiryDates = {}; // { reqId: 'YYYY-MM-DD' }

// UI Elements
const jsonInput = document.getElementById('json-input');
const pdfInput = document.getElementById('pdf-input');
const langBtn = document.getElementById('lang-btn');
const generateBtn = document.getElementById('generate-btn');
const tenderInfoBox = document.getElementById('tender-info');
const uploadedFilesContainer = document.getElementById('uploaded-files-container');
const reqTableContainer = document.getElementById('requirements-table-container');
const blockingBox = document.getElementById('blocking-reasons');
const fileError = document.getElementById('file-error');

// Language switch
langBtn.addEventListener('click', () => {
  currentLang = currentLang === 'en' ? 'bn' : 'en';
  langBtn.innerText = currentLang === 'en' ? 'বাংলায় দেখুন' : 'Switch to English';
  
  // Header and section titles
  document.getElementById('app-title').innerText = currentLang === 'en' ? 'Tender Document Package Builder' : 'টেন্ডার ডকুমেন্ট প্যাকেজ বিল্ডার';
  document.getElementById('sec1-title').innerText = currentLang === 'en' ? '1. Load Tender Requirements (JSON)' : '১. টেন্ডারের শর্তাবলী লোড করুন (JSON)';
  document.getElementById('sec2-title').innerText = currentLang === 'en' ? '2. Upload Documents (PDF)' : '২. ফাইল আপলোড করুন (PDF)';
  document.getElementById('sec2-sub').innerText = currentLang === 'en' ? 'Max 30 files | Total max 50 MB' : 'সর্বোচ্চ ৩০টি ফাইল | মোট সাইজ সর্বোচ্চ ৫০ মেগাবাইট';
  document.getElementById('sec3-title').innerText = currentLang === 'en' ? '3. Document Matching & Verification' : '৩. ফাইল ম্যাপিং ও স্ট্যাটাস যাচাই';
  document.getElementById('sec4-title').innerText = currentLang === 'en' ? '4. Generate Final Package' : '৪. চূড়ান্ত প্যাকেজ তৈরি করুন';
  generateBtn.innerText = currentLang === 'en' ? 'Generate PDF Package' : 'পিডিএফ প্যাকেজ জেনারেট করুন';

  renderApp();
});

// Load requirements.json
jsonInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    tenderInfo = data.tender;
    requirements = data.requirements.sort((a, b) => a.order - b.order);
    matches = {};
    expiryDates = {};
    renderApp();
  } catch (err) {
    alert('Invalid JSON File!');
  }
});

// Calculate SHA-256 Hash for duplicate detection
async function calculateHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Upload PDFs
pdfInput.addEventListener('change', async (e) => {
  fileError.innerText = '';
  const files = Array.from(e.target.files);

  if (uploadedFiles.length + files.length > 30) {
    fileError.innerText = currentLang === 'en' ? 'Maximum 30 files allowed.' : 'সর্বোচ্চ ৩০টি ফাইল আপলোড করা যাবে।';
    return;
  }

  for (let file of files) {
    if (file.type !== 'application/pdf') {
      fileError.innerText = `${file.name} ${currentLang === 'en' ? 'is not a PDF file!' : 'পিডিএফ ফাইল নয়!'}`;
      continue;
    }

    let pages = 0;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pages = pdf.numPages;
    } catch (err) {
      alert(`Error reading ${file.name}: Password protected or corrupted PDF.`);
      continue;
    }

    const hash = await calculateHash(file);

    uploadedFiles.push({
      id: 'F_' + Math.random().toString(36).substr(2, 9),
      file: file,
      name: file.name,
      size: file.size,
      pages: pages,
      hash: hash
    });
  }

  const totalSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
  if (totalSize > 50 * 1024 * 1024) {
    fileError.innerText = currentLang === 'en' ? 'Total file size exceeds 50 MB limit!' : 'মোট ফাইল সাইজ ৫০ মেগাবাইটের বেশি হয়ে গেছে!';
  }

  renderApp();
});

window.removeFile = function(fileId) {
  uploadedFiles = uploadedFiles.filter(f => f.id !== fileId);
  for (let reqId in matches) {
    if (matches[reqId] === fileId) delete matches[reqId];
  }
  renderApp();
};

function getDuplicateHashes() {
  const counts = {};
  uploadedFiles.forEach(f => {
    counts[f.hash] = (counts[f.hash] || 0) + 1;
  });
  return Object.keys(counts).filter(h => counts[h] > 1);
}

function getReqStatus(req) {
  const matchedFileId = matches[req.id];

  if (!matchedFileId) {
    return req.mandatory ? 'Missing' : 'Not provided';
  }

  if (req.has_expiry) {
    const expDate = expiryDates[req.id];
    if (!expDate) return 'Expiry date needed';

    if (expDate < tenderInfo.submission_deadline) {
      return 'Expired';
    }
  }

  return 'OK';
}

function renderApp() {
  if (tenderInfo) {
    tenderInfoBox.classList.remove('hidden');
    tenderInfoBox.innerHTML = `
      <strong>Tender ID:</strong> ${tenderInfo.tender_id} | 
      <strong>Title:</strong> ${tenderInfo.title}<br>
      <strong>Procuring Entity:</strong> ${tenderInfo.procuring_entity} | 
      <strong>Submission Deadline:</strong> ${tenderInfo.submission_deadline}
    `;
  }

  const duplicateHashes = getDuplicateHashes();

  if (uploadedFiles.length > 0) {
    uploadedFilesContainer.innerHTML = `<h3>${currentLang === 'en' ? 'Uploaded Files:' : 'আপলোডকৃত ফাইলগুলো:'}</h3>` + uploadedFiles.map(f => {
      const isDuplicate = duplicateHashes.includes(f.hash);
      return `
        <div class="file-item">
          <span>
            📄 <strong>${f.name}</strong> (${f.pages} ${currentLang === 'en' ? 'pages' : 'পেজ'})
            ${isDuplicate ? `<span class="badge badge-Duplicate">${currentLang === 'en' ? 'DUPLICATE CONTENT' : 'ডুপ্লিকেট কন্টেন্ট'}</span>` : ''}
          </span>
          <button onclick="removeFile('${f.id}')" class="btn-remove">X</button>
        </div>
      `;
    }).join('');
  } else {
    uploadedFilesContainer.innerHTML = '';
  }

  if (!tenderInfo) {
    reqTableContainer.innerHTML = `<p class="placeholder-text">${currentLang === 'en' ? 'Please upload requirements.json first.' : 'প্রথমে requirements.json আপলোড করুন।'}</p>`;
    return;
  }

  let blockingReasons = [];

  let tableHtml = `
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Document Title</th>
          <th>Type</th>
          <th>Matched File</th>
          <th>Expiry Date</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;

  requirements.forEach(req => {
    const status = getReqStatus(req);
    const title = currentLang === 'en' ? req.title_en : req.title_bn;
    const isMatched = matches[req.id];

    if (status === 'Missing') blockingReasons.push(`${title}: File Missing`);
    if (status === 'Expiry date needed') blockingReasons.push(`${title}: Expiry Date Required`);
    if (status === 'Expired') blockingReasons.push(`${title}: Expired Document`);

    const matchedFileObj = uploadedFiles.find(f => f.id === isMatched);
    if (matchedFileObj && duplicateHashes.includes(matchedFileObj.hash)) {
      blockingReasons.push(`${title}: Matches a duplicate content file`);
    }

    tableHtml += `
      <tr>
        <td>${req.order}</td>
        <td><strong>${title}</strong> ${req.mandatory ? '<span style="color:red">*</span>' : ''}</td>
        <td>${req.mandatory ? (currentLang === 'en' ? 'Mandatory' : 'আবশ্যক') : (currentLang === 'en' ? 'Optional' : 'ঐচ্ছিক')}</td>
        <td>
          <select onchange="matchFile('${req.id}', this.value)">
            <option value="">-- ${currentLang === 'en' ? 'Select File' : 'ফাইল সিলেক্ট করুন'} --</option>
            ${uploadedFiles.map(f => `
              <option value="${f.id}" ${matches[req.id] === f.id ? 'selected' : ''}>
                ${f.name}${duplicateHashes.includes(f.hash) ? '(Duplicate)' : ''}
              </option>
            `).join('')}
          </select>
        </td>
        <td>
          ${req.has_expiry ? `
            <input type="date" value="${expiryDates[req.id] || ''}" 
                   onchange="setExpiry('${req.id}', this.value)" 
                   ${!isMatched ? 'disabled' : ''}>
          ` : 'N/A'}
        </td>
        <td><span class="badge badge-${status.replace(/\s+/g, '')}">${status}</span></td>
      </tr>
    `;
  });

  tableHtml += '</tbody></table>';
  reqTableContainer.innerHTML = tableHtml;

  if (blockingReasons.length > 0) {
    blockingBox.classList.remove('hidden');
    blockingBox.innerHTML = `<strong>${currentLang === 'en' ? 'Cannot Generate Package:' : 'প্যাকেজ তৈরি করা সম্ভব নয়:'}</strong><ul>` + blockingReasons.map(r => `<li>${r}</li>`).join('') + '</ul>';
    generateBtn.disabled = true;
  } else {
    blockingBox.classList.add('hidden');
    generateBtn.disabled = false;
  }
}

window.matchFile = function(reqId, fileId) {
  if (fileId) {
    for (let id in matches) {
      if (matches[id] === fileId) delete matches[id];
    }
    matches[reqId] = fileId;
  } else {
    delete matches[reqId];
  }
  renderApp();
};

window.setExpiry = function(reqId, dateStr) {
  expiryDates[reqId] = dateStr;
  renderApp();
};

// Generate Package PDF
generateBtn.addEventListener('click', async () => {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const mergedPdf = await PDFDocument.create();
  const font = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

  // 1. Cover Page (English only)
  const coverPage = mergedPdf.addPage([595.28, 841.89]);
  const { width, height } = coverPage.getSize();

  coverPage.drawText('TENDER DOCUMENT PACKAGE', {
    x: 50, y: height - 80, size: 20, font: boldFont, color: rgb(0, 0.2, 0.6)
  });

  coverPage.drawText(`Tender ID: ${tenderInfo.tender_id}`, { x: 50, y: height - 120, size: 12, font });
  coverPage.drawText(`Tender Title: ${tenderInfo.title}`, { x: 50, y: height - 140, size: 12, font });
  coverPage.drawText(`Procuring Entity: ${tenderInfo.procuring_entity}`, { x: 50, y: height - 160, size: 12, font });
  coverPage.drawText(`Bidder Name: ${tenderInfo.bidder}`, { x: 50, y: height - 180, size: 12, font });
  coverPage.drawText(`Submission Deadline: ${tenderInfo.submission_deadline}`, { x: 50, y: height - 200, size: 12, font });
  coverPage.drawText(`Package Created On: ${new Date().toISOString().split('T')[0]}`, { x: 50, y: height - 220, size: 12, font });

  let yPos = height - 270;
  coverPage.drawText('Included Documents:', { x: 50, y: yPos, size: 14, font: boldFont });
  yPos -= 22;

  requirements.forEach(req => {
    const fileId = matches[req.id];
    if (fileId) {
      const fileObj = uploadedFiles.find(f => f.id === fileId);
      if (fileObj) {
        coverPage.drawText(`${req.order}. ${req.title_en} (${fileObj.name})`, { x: 60, y: yPos, size: 10, font });
        yPos -= 18;
      }
    }
  });

  // 2. Append PDFs in order
  for (let req of requirements) {
    const fileId = matches[req.id];
    if (fileId) {
      const fileObj = uploadedFiles.find(f => f.id === fileId);
      if (fileObj) {
        const fileBytes = await fileObj.file.arrayBuffer();
        const doc = await PDFDocument.load(fileBytes);
        const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
        copiedPages.forEach(p => mergedPdf.addPage(p));
      }
    }
  }

  // 3. Footer on ALL Pages: <tender_id> | Page X of Y
  const totalPages = mergedPdf.getPageCount();
  const allPages = mergedPdf.getPages();

  allPages.forEach((page, index) => {
    const footerText = `${tenderInfo.tender_id} | Page ${index + 1} of ${totalPages}`;
    page.drawText(footerText, {
      x: 50,
      y: 20,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3)
    });
  });

  // Download Output PDF
  const pdfBytes = await mergedPdf.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${tenderInfo.tender_id}_Package.pdf`;
  a.click();
});