# Medical Question Auditor & Validator
## Advanced AI-Powered Medical Examination Question Reviewing Platform

A production-ready, full-stack medical examination auditing platform designed to systematically verify the scientific accuracy of medical examination questions and answer keys against uploaded medical textbooks and reference literature as the primary and exclusive evidence sources.

---

## 🌟 Key Capabilities

1. **Exclusive Reference Evidence Ground Truth**:
   - Verification decisions are rooted exclusively in uploaded medical textbooks (Robbins Pathology, Katzung Pharmacology, Gray's Anatomy, Guyton Physiology, Clinical Practice Guidelines, etc.).
   - Explicitly refuses to fabricate quotations or page numbers.
   - Questions lacking adequate reference documentation are flagged as **`insufficient_evidence`** rather than receiving ungrounded AI hallucinations.

2. **Full-Book Ingestion Pipeline (No Manual Splitting)**:
   - Ingests large PDF documents (10–60+ MB) directly.
   - Dual-mode text extraction: native PDF digital text extraction with automatic fallback to **Tesseract.js OCR** for scanned pages or diagrams.
   - Medical vocabulary verification evaluating anatomical, pharmacological, and physiological prefixes/suffixes (`-itis`, `-ectomy`, `-emia`, `myo-`, `card-`, `neuro-`, `nephro-`, etc.).
   - Assigns a page-level OCR confidence score (0–100%) and preserves both printed textbook page numbers and physical PDF page indices.

3. **Multi-Discipline Dynamic Medical Subject Classification**:
   - Supports **ALL medical subjects dynamically** without hardcoded limitations (Anatomy, Histology, Embryology, Physiology, Biochemistry, Pharmacology, Pathology, Parasitology, Microbiology, Immunology, Internal Medicine, Surgery, Pediatrics, Obstetrics and Gynecology, Genetics, etc.).
   - Evaluates the complete question stem AND all answer choices before assigning primary and secondary subjects with confidence scoring.

4. **Multi-Stage Scientific Validation Engine**:
   - **Answer Key Audit**: Verifies whether the designated answer key is correct or erroneous.
   - **Multiple Correct Answers Detection**: Evaluates EVERY answer choice independently to identify questions with more than one defensible correct answer.
   - **No Correct Answer Detection**: Flags questions where all choices are incorrect or where the true scientific answer is absent.
   - **Question Stem Validation**: Identifies scientific errors, inaccurate anatomical descriptions, or ambiguous wording (e.g., missing age or clinical demographic parameters) and proposes corrected wording.
   - **Cross-Reference Conflict Detection**: Compares assertions across multiple textbooks and displays diverging statements side-by-side with exact page citations without inventing false consensus.

5. **Faculty Review & Correction Management**:
   - Interactive review workspace to inspect findings alongside exact reference quotes.
   - Human actions: **Approve Correction**, **Reject Correction**, **Postpone**, **Edit Proposed Answer**, and **Add Personal Faculty Notes**.
   - Original exam files remain immutable; audit findings are stored in normalized relational audit records.

6. **Professional Publication Exports**:
   - **Multi-Sheet Excel Workbook (`.xlsx`)**: Structured into 8 worksheets: *Overall Summary*, *All Questions*, *Confirmed Errors*, *Multiple Correct Answers*, *Incorrect Answer Keys*, *Ambiguous Questions*, *Reference Evidence*, and *Pending Human Review*.
   - **Printable PDF / HTML Audit Report**: Polished executive report with formal Cover Page, Statistics KPI cards, Subject Breakdown table, and detailed question-by-question citations.

---

## 🏗️ Architecture & Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **Framework** | Next.js 15 (App Router, TypeScript) | Unified high-performance server & client environment |
| **Styling** | Tailwind CSS + Lucide Icons | Clean, high-contrast, accessible medical technology visual identity |
| **Database** | Node 24 Built-in `node:sqlite` (`DatabaseSync`) | Zero external C++ compilation dependencies, persistent relational storage with WAL mode |
| **PDF Processing** | `pdf-parse` + `pdfjs-dist` | Page-by-page text extraction, coordinate tracking, and metadata parsing |
| **OCR Engine** | `tesseract.js` + Medical Vocabulary Lexicon | In-process WebAssembly OCR with confidence scoring and terminology validation |
| **Search Engine** | BM25 Term Frequency / Inverted Page Chunk Index | Sub-second contextual retrieval across hundreds of reference pages |
| **Excel Export** | `exceljs` | Multi-tab styled workbook generation with custom headers, borders, and column layouts |
| **AI Layer** | Configurable: Google Gemini API, OpenAI GPT-4o, Anthropic Claude, or Built-in Deterministic Auditor | 100% testable out-of-the-box with built-in medical validation rules or external LLM API keys |

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** v20+ or v24+ (Node v24 includes `node:sqlite` natively)
- **npm** v10+

### 2. Installation
```powershell
# Clone or navigate to the project directory
cd "d:\antigravity\WRONG QUESTION REVIEW"

# Install dependencies
npm install
```

### 3. Run the Development Server
```powershell
npm run dev
# The application will be available at http://localhost:3000
```

### 4. Production Build & Start
```powershell
npm run build
npm start
```

---

## 🧪 10 Representative Test Cases Suite

The platform includes a built-in automated test suite covering all 10 clinical scenarios mandated by the project specification:

| # | Scenario | Clinical Question Concept | Ingested Ground Truth Reference | Audited Finding |
|---|---|---|---|---|
| **1** | **Correct original answer** | Lisinopril mechanism of action in essential hypertension | *Katzung Pharmacology* (Page 742) | Confirmed: Option B (ACE inhibition) is correct. Designated key verified. |
| **2** | **Incorrect answer key** | Reversible change of one adult cell type to another (Designated: A - Hyperplasia) | *Robbins Pathology* (Page 38) | **Critical Error**: Original key A is wrong. True answer is Option C (Metaplasia). |
| **3** | **Multiple correct answers** | Pharmacological agents reducing mortality in HFrEF | *Katzung Pharmacology* (Page 245) | **Major Error**: Multiple correct answers. Both Option A (Metoprolol) and Option B (Spironolactone) confer proven mortality reduction. |
| **4** | **No correct answer** | Macrocytic anemia with subacute combined degeneration (Designated: C - Folate) | *Robbins Pathology* (Page 645) | **Major Error**: Folate causes NO neurological symptoms. The true scientific answer (Vitamin B12 deficiency) is absent from options. |
| **5** | **Ambiguous question** | "Most common cause of community-acquired bacterial pneumonia" | *Archives of Clinical Microbiology* (Page 19) | **Ambiguous Question**: Lacks age cohort parameter (Mycoplasma in young vs S. pneumoniae in elderly). Proposed stem correction provided. |
| **6** | **Scientific error in stem wording** | Femoral artery traversing adductor hiatus to become anterior tibial artery | *Gray's Anatomy* (Page 1340) | **Stem Inaccuracy**: Femoral artery becomes the *popliteal artery*, not anterior tibial. Corrected stem proposed. |
| **7** | **Scanned PDF requiring OCR** | Interstitial infiltrates and cold agglutinins in college student | *Scanned Microbiology Archive* (Page 19) | **OCR Verification**: Scanned page analyzed via OCR with 96% vocabulary confidence. Option A confirmed. |
| **8** | **Information in multiple books** | Phase 0 rapid depolarization ion current (INa) | *Guyton Physiology* (Page 112) & *Katzung Pharmacology* (Page 245) | **Multi-Book Agreement**: Both references concur on fast voltage-gated Na+ current influx. |
| **9** | **Conflicting reference guidelines** | Stage 1 hypertension pharmacotherapy initiation threshold | *ACC/AHA Guidelines* (Page e145) vs *ESC Guidelines* (Page 3042) | **Conflict Documented**: ACC/AHA mandates drug therapy if ASCVD risk ≥ 10%; ESC prioritizes lifestyle trial. Both cited side-by-side. |
| **10** | **Insufficient evidence in references** | Rare PEX1 c.2528G>A mutation in Zellweger spectrum | General medical library | **Refusal to Hallucinate**: PEX1 allele data absent in uploaded books. Flagged as `insufficient_evidence` (confidence 32%). |

### Running the Test Suite:
- **From UI**: Click **"Load Representative Test Suite (10 Cases)"** in the top navigation header, then navigate to `/audit/new` to run an audit.
- **From Terminal**:
  ```powershell
  npx tsx scripts/verify-system.ts
  ```

---

## ⚙️ AI Provider Configuration

The application is pre-configured to operate with the **Built-in Deterministic Medical Auditor** immediately without requiring third-party API keys or incurring costs.

To enable advanced generative LLM reasoning:
1. Navigate to **Settings & AI Config** (`/settings`).
2. Choose your preferred AI Provider:
   - **Google Gemini API** (`gemini-2.0-flash` or `gemini-1.5-pro`): Enter your Gemini API Key.
   - **OpenAI API** (`gpt-4o` or `gpt-4o-mini`): Enter your OpenAI API Key.
   - **Anthropic API** (`claude-3-5-sonnet-20241022`): Enter your Claude API Key.
3. Click **Save Configuration**. API keys are securely stored server-side and masked in the UI.

---

## 📄 License & Academic Integrity
Built for medical universities, examination review boards, and clinical education departments to safeguard examination scientific integrity.
