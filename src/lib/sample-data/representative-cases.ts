export interface SeedBook {
  id: string;
  title: string;
  subject: string;
  category: string;
  authors: string;
  edition: string;
  pages: Array<{
    pdfPageIndex: number;
    printedPageNumber: string;
    text: string;
    pageType: 'digital' | 'scanned' | 'mixed';
    ocrConfidence: number;
  }>;
}

export interface SeedExamQuestion {
  questionNumber: number;
  stem: string;
  options: Array<{ label: string; text: string }>;
  designatedAnswer: string;
  expectedSubject: string;
  topic: string;
  scenarioType: string;
}

export const SEED_BOOKS: SeedBook[] = [
  {
    id: 'ref-pharmacology-katzung',
    title: 'Basic and Clinical Pharmacology (Katzung)',
    subject: 'Pharmacology',
    category: 'Therapeutics',
    authors: 'Bertram G. Katzung, Todd W. Vanderah',
    edition: '15th Edition',
    pages: [
      {
        pdfPageIndex: 1,
        printedPageNumber: '742',
        pageType: 'digital',
        ocrConfidence: 99.2,
        text: `CHAPTER 11: ANTIHYPERTENSIVE AGENTS
ACE INHIBITORS AND ANGIOTENSIN RECEPTOR BLOCKERS

Lisinopril, enalapril, and captopril are competitive inhibitors of angiotensin-converting enzyme (ACE), the peptidyl dipeptidase that catalyzes the conversion of angiotensin I to the potent vasoconstrictor angiotensin II. ACE is identical to kininase II, the enzyme that inactivates bradykinin.

Mechanism of Action:
By inhibiting angiotensin-converting enzyme, lisinopril lowers systemic vascular resistance without a reflex increase in heart rate. Lisinopril does not directly block angiotensin II AT1 receptors; rather, receptor blockade is the characteristic mechanism of angiotensin receptor blockers (ARBs) such as losartan and valsartan. Lisinopril has no direct effect on voltage-gated calcium channels or beta-1 adrenergic receptors.`
      },
      {
        pdfPageIndex: 2,
        printedPageNumber: '245',
        pageType: 'digital',
        ocrConfidence: 98.8,
        text: `CHAPTER 14: DRUGS USED IN HEART FAILURE

Beta-Receptor Blockers:
Clinical trials with bisoprolol, carvedilol, and sustained-release metoprolol succinate showed a statistically significant reduction in mortality in patients with chronic stable heart failure with reduced ejection fraction (HFrEF).

Aldosterone Receptor Antagonists:
Spironolactone and eplerenone are mineralocorticoid receptor antagonists. The RALES trial demonstrated that spironolactone produces a substantial 30% reduction in all-cause mortality and hospitalizations in patients with severe systolic heart failure (HFrEF).

Diuretics:
Loop diuretics like furosemide are first-line for symptomatic relief of pulmonary and peripheral edema. However, loop diuretics have never demonstrated a statistically significant reduction in long-term mortality in clinical heart failure trials.`
      }
    ]
  },
  {
    id: 'ref-pathology-robbins',
    title: 'Robbins & Cotran Pathologic Basis of Disease',
    subject: 'Pathology',
    category: 'General Pathology',
    authors: 'Vinay Kumar, Abul K. Abbas, Jon C. Aster',
    edition: '10th Edition',
    pages: [
      {
        pdfPageIndex: 1,
        printedPageNumber: '38',
        pageType: 'digital',
        ocrConfidence: 99.0,
        text: `CHAPTER 1: CELLULAR RESPONSES TO STRESS AND TOXIC INSULTS

Cellular Adaptations to Stress:
Metaplasia is a reversible change in which one differentiated cell type (epithelial or mesenchymal) is replaced by another cell type. In Barrett esophagus, stratified squamous epithelium is replaced by intestinal-like columnar cells under the influence of refluxed gastric acid.

Hyperplasia is an increase in the number of cells in an organ or tissue resulting in increased mass, usually driven by hormones or growth factors.
Hypertrophy is an increase in the size of cells resulting in an overall increase in the size of the affected organ, without an increase in cell number.
Dysplasia refers to disordered cellular growth and maturation, often recognized as pre-neoplastic atypia with loss of tissue architecture.`
      },
      {
        pdfPageIndex: 2,
        printedPageNumber: '645',
        pageType: 'digital',
        ocrConfidence: 98.5,
        text: `CHAPTER 14: RED BLOOD CELL AND BLEEDING DISORDERS

Megaloblastic Anemias:
Megaloblastic anemias are caused by deficiencies of either vitamin B12 (cobalamin) or folate. Both vitamins are required for the synthesis of thymidine, a building block of DNA.

Neurological Manifestations:
A critical distinction between the two deficiencies is that vitamin B12 deficiency leads to subacute combined degeneration (SCD) of the spinal cord, characterized by loss of vibration sense, proprioception, and spastic paraparesis, secondary to demyelination of the posterior and lateral columns.
In contrast, pure folate deficiency causes macrocytic megaloblastic anemia without neurological manifestations or spinal cord degeneration.`
      }
    ]
  },
  {
    id: 'ref-anatomy-grays',
    title: "Gray's Anatomy: The Anatomical Basis of Clinical Practice",
    subject: 'Anatomy',
    category: 'Gross Anatomy',
    authors: 'Susan Standring',
    edition: '42nd Edition',
    pages: [
      {
        pdfPageIndex: 1,
        printedPageNumber: '1340',
        pageType: 'digital',
        ocrConfidence: 99.1,
        text: `SECTION 8: LOWER LIMB - FEMORAL TRIANGLE AND ADDUCTOR CANAL

Femoral Triangle:
The femoral artery enters the femoral triangle deep to the midpoint of the inguinal ligament, lying immediately lateral to the femoral vein and medial to the femoral nerve.
The femoral artery travels inferiorly through the adductor canal and passes through the adductor hiatus (an opening in the adductor magnus tendon) to become the POPLITEAL ARTERY in the popliteal fossa. It does not directly become the anterior tibial artery, which is a terminal division of the popliteal artery.

Innervation:
The femoral nerve (L2, L3, L4) innervates the muscles of the anterior compartment of the thigh, including the quadriceps femoris, sartorius, and pectineus.`
      }
    ]
  },
  {
    id: 'ref-physiology-guyton',
    title: 'Guyton and Hall Textbook of Medical Physiology',
    subject: 'Physiology',
    category: 'Medical Physiology',
    authors: 'John E. Hall, Michael E. Hall',
    edition: '14th Edition',
    pages: [
      {
        pdfPageIndex: 1,
        printedPageNumber: '112',
        pageType: 'digital',
        ocrConfidence: 98.9,
        text: `CHAPTER 9: CARDIAC MUSCLE; THE HEART AS A PUMP

Action Potential of Ventricular Muscle:
Phase 0 (Rapid Depolarization): When the cardiac ventricular muscle fiber is stimulated, voltage-gated fast sodium channels (INa) open rapidly, allowing a massive influx of sodium ions into the cell down the electrical and concentration gradient. This brings the membrane potential from approximately -90 mV to positive values (+20 mV).
Phase 1 (Initial Repolarization): Fast sodium channels close, and transient outward potassium currents (Ito) initiate brief repolarization.
Phase 2 (Plateau): L-type calcium channels (ICa-L) open, causing inward calcium flux that balances outward potassium flux.`
      }
    ]
  },
  {
    id: 'ref-guidelines-cardiology-aha',
    title: 'ACC/AHA Guideline for the Prevention and Management of High Blood Pressure',
    subject: 'Medicine (Internal)',
    category: 'Clinical Guidelines',
    authors: 'Paul K. Whelton et al.',
    edition: '2017 Guidelines',
    pages: [
      {
        pdfPageIndex: 1,
        printedPageNumber: 'e145',
        pageType: 'digital',
        ocrConfidence: 98.4,
        text: `SECTION 4: TREATMENT OF HIGH BLOOD PRESSURE

Stage 1 Hypertension (BP 130-139 / 80-89 mm Hg):
For adults with confirmed Stage 1 hypertension:
- If 10-year ASCVD risk is >= 10%, initiate first-line antihypertensive medication in addition to nonpharmacological therapy.
- If 10-year ASCVD risk is < 10%, management consists solely of nonpharmacological therapy (lifestyle modification) with repeat blood pressure evaluation in 3 to 6 months.
Immediate pharmacotherapy is NOT universally indicated for all Stage 1 hypertension patients without ASCVD risk assessment.`
      }
    ]
  },
  {
    id: 'ref-guidelines-esc-hypertension',
    title: 'ESC/ESH Guidelines for the Management of Arterial Hypertension',
    subject: 'Medicine (Internal)',
    category: 'European Clinical Guidelines',
    authors: 'Bryan Williams et al.',
    edition: 'European Practice Consensus',
    pages: [
      {
        pdfPageIndex: 1,
        printedPageNumber: '3042',
        pageType: 'digital',
        ocrConfidence: 98.1,
        text: `SECTION 5: THRESHOLDS AND TARGETS FOR DRUG TREATMENT

Grade 1 Hypertension (BP 140-159 / 90-99 mm Hg):
In patients with Grade 1 hypertension at low-to-moderate cardiovascular risk and without evidence of hypertension-mediated organ damage, lifestyle intervention is recommended for a prolonged duration (up to 3-6 months) before drug therapy is considered.
In patients with high-normal blood pressure (130-139 / 85-89 mm Hg), drug treatment is not recommended unless very high cardiovascular risk with established cardiovascular disease is present.`
      }
    ]
  },
  {
    id: 'ref-scanned-archive-ocr',
    title: 'Archives of Clinical Microbiology and Infectious Diseases (Scanned Record)',
    subject: 'Microbiology',
    category: 'Historical Archive',
    authors: 'Medical Pathology Board Archive',
    edition: 'Facsimile Edition',
    pages: [
      {
        pdfPageIndex: 1,
        printedPageNumber: '19',
        pageType: 'scanned',
        ocrConfidence: 81.5,
        text: `CLINICAL MICROBIOLOGY REVIEW - ACUTE LOWER RESPIRATORY TRACT INFECTIONS
Community-acquired pneumonia (CAP) epidemiology exhibits distinct bimodal etiology:
In immunocompetent older adults (>65 years) and hospitalized adults, Streptococcus pneumoniae remains the single most common bacterial isolate, responsible for typical lobar consolidation.
Conversely, in school-age children, adolescents, and college-age young adults (ages 5 to 35), Mycoplasma pneumoniae represents the predominant causative pathogen, presenting as atypical or walking pneumonia with bilateral interstitial infiltrates.`
      }
    ]
  }
];

export const SEED_EXAMINATION_QUESTIONS: SeedExamQuestion[] = [
  {
    questionNumber: 1,
    stem: 'A 45-year-old male with essential hypertension is prescribed Lisinopril. Which of the following is the primary mechanism of action of this medication?',
    options: [
      { label: 'A', text: 'Direct inhibition of angiotensin II AT1 receptors' },
      { label: 'B', text: 'Inhibition of angiotensin-converting enzyme (ACE)' },
      { label: 'C', text: 'Blockade of L-type voltage-gated calcium channels' },
      { label: 'D', text: 'Selective beta-1 adrenergic receptor antagonism' }
    ],
    designatedAnswer: 'B',
    expectedSubject: 'Pharmacology',
    topic: 'Antihypertensive Mechanisms',
    scenarioType: 'Correct original answer'
  },
  {
    questionNumber: 2,
    stem: 'Which of the following cellular adaptations is characterized by a reversible change in which one adult cell type is replaced by another adult cell type?',
    options: [
      { label: 'A', text: 'Hyperplasia' },
      { label: 'B', text: 'Hypertrophy' },
      { label: 'C', text: 'Metaplasia' },
      { label: 'D', text: 'Dysplasia' }
    ],
    designatedAnswer: 'A', // INCORRECT KEY!
    expectedSubject: 'Pathology',
    topic: 'Cellular Adaptations',
    scenarioType: 'Incorrect answer key (Designated A, true answer C)'
  },
  {
    questionNumber: 3,
    stem: 'Which of the following pharmacological agents produce a statistically significant mortality reduction in patients with chronic heart failure with reduced ejection fraction (HFrEF)?',
    options: [
      { label: 'A', text: 'Metoprolol succinate' },
      { label: 'B', text: 'Spironolactone' },
      { label: 'C', text: 'Furosemide' },
      { label: 'D', text: 'Digoxin' }
    ],
    designatedAnswer: 'A',
    expectedSubject: 'Pharmacology',
    topic: 'Heart Failure Therapeutics',
    scenarioType: 'Multiple correct answers (Both A and B reduce mortality)'
  },
  {
    questionNumber: 4,
    stem: 'A patient with macrocytic anemia presents with neurological symptoms including loss of vibration sense and proprioception. What is the most likely initial biochemical defect?',
    options: [
      { label: 'A', text: 'Ascorbic acid deficiency' },
      { label: 'B', text: 'Iron deficiency' },
      { label: 'C', text: 'Folate deficiency leading to subacute combined degeneration' },
      { label: 'D', text: 'Glucose-6-phosphate dehydrogenase deficiency' }
    ],
    designatedAnswer: 'C',
    expectedSubject: 'Pathology',
    topic: 'Megaloblastic Anemia & Neurology',
    scenarioType: 'No correct answer among choices (Folate causes NO neurological disease; B12 is missing)'
  },
  {
    questionNumber: 5,
    stem: 'What is the most common cause of community-acquired bacterial pneumonia?',
    options: [
      { label: 'A', text: 'Streptococcus pneumoniae' },
      { label: 'B', text: 'Mycoplasma pneumoniae' },
      { label: 'C', text: 'Haemophilus influenzae' },
      { label: 'D', text: 'Chlamydia pneumoniae' }
    ],
    designatedAnswer: 'A',
    expectedSubject: 'Microbiology',
    topic: 'Pneumonia Epidemiology',
    scenarioType: 'Scientifically ambiguous question (Unspecified demographic: Mycoplasma in young vs S. pneumoniae in elderly)'
  },
  {
    questionNumber: 6,
    stem: 'The femoral artery enters the femoral triangle lateral to the femoral vein and passes inferiorly through the adductor hiatus to become the anterior tibial artery in the popliteal fossa. Which nerve innervates the anterior compartment of the thigh?',
    options: [
      { label: 'A', text: 'Obturator nerve' },
      { label: 'B', text: 'Femoral nerve' },
      { label: 'C', text: 'Sciatic nerve' },
      { label: 'D', text: 'Tibial nerve' }
    ],
    designatedAnswer: 'B',
    expectedSubject: 'Anatomy',
    topic: 'Femoral Triangle & Thigh Innervation',
    scenarioType: 'Stem contains scientific error (Femoral becomes popliteal artery, not anterior tibial)'
  },
  {
    questionNumber: 7,
    stem: 'In a scanned clinical pathology report, a college student presents with bilateral interstitial infiltrates and cold agglutinins. Which organism is most likely responsible?',
    options: [
      { label: 'A', text: 'Mycoplasma pneumoniae' },
      { label: 'B', text: 'Streptococcus pneumoniae' },
      { label: 'C', text: 'Klebsiella pneumoniae' },
      { label: 'D', text: 'Pseudomonas aeruginosa' }
    ],
    designatedAnswer: 'A',
    expectedSubject: 'Microbiology',
    topic: 'Atypical Bacterial Pneumonia',
    scenarioType: 'Scanned document requiring OCR'
  },
  {
    questionNumber: 8,
    stem: 'In normal cardiac electrophysiology, which ion channel current is primarily responsible for Phase 0 rapid depolarization of ventricular cardiomyocytes?',
    options: [
      { label: 'A', text: 'Inward L-type calcium current (ICa-L)' },
      { label: 'B', text: 'Rapid inward sodium current (INa)' },
      { label: 'C', text: 'Delayed rectifier potassium current (IKr)' },
      { label: 'D', text: 'Transient outward potassium current (Ito)' }
    ],
    designatedAnswer: 'B',
    expectedSubject: 'Physiology',
    topic: 'Cardiac Electrophysiology',
    scenarioType: 'Appears in multiple reference books (Guyton & Katzung both document Phase 0 Na+ influx)'
  },
  {
    questionNumber: 9,
    stem: 'A 58-year-old patient with stage 1 uncomplicated essential hypertension has a blood pressure of 134/86 mmHg. According to official clinical practice guidelines, should pharmacological therapy be initiated immediately alongside lifestyle modifications?',
    options: [
      { label: 'A', text: 'Yes, immediate pharmacotherapy is indicated for all stage 1 hypertension patients' },
      { label: 'B', text: 'No, pharmacotherapy is only recommended if 10-year ASCVD risk is >= 10% (ACC/AHA) or after lifestyle trial (ESC)' },
      { label: 'C', text: 'Pharmacotherapy is strictly contraindicated' },
      { label: 'D', text: 'Immediate surgical intervention is indicated' }
    ],
    designatedAnswer: 'A',
    expectedSubject: 'Medicine (Internal)',
    topic: 'Hypertension Management Guidelines',
    scenarioType: 'Conflicting references (ACC/AHA vs European ESC threshold discrepancies)'
  },
  {
    questionNumber: 10,
    stem: 'Which of the following rare genetic mutations in the PEX1 gene is most frequently associated with the adult-onset milder variant of Zellweger spectrum peroxisomal biogenesis disorder?',
    options: [
      { label: 'A', text: 'c.2097dupT' },
      { label: 'B', text: 'c.2528G>A' },
      { label: 'C', text: 'c.1245delC' },
      { label: 'D', text: 'c.874G>T' }
    ],
    designatedAnswer: 'B',
    expectedSubject: 'Medical Genetics',
    topic: 'Peroxisomal Biogenesis Disorders',
    scenarioType: 'Insufficient evidence in uploaded references'
  }
];
