import { getDb } from '@/lib/db';

export interface ClassificationResult {
  primarySubject: string;
  secondarySubjects: string[];
  topic: string;
  confidence: number;
  matchedReferenceBookIds: string[];
}

/**
 * Dynamic subject classification heuristics based on comprehensive medical semantic ontology
 */
const MEDICAL_DISCIPLINE_ONTOLOGY: Record<string, {
  keywords: string[];
  weight: number;
}> = {
  'Pharmacology': {
    keywords: [
      'drug', 'receptor', 'agonist', 'antagonist', 'inhibition', 'half-life', 'clearance',
      'metabolism', 'cytochrome', 'p450', 'bioavailability', 'mechanism of action',
      'toxicity', 'adverse effect', 'dose', 'dosage', 'pharmacokinetics', 'pharmacodynamics',
      'antimicrobial', 'antibiotic', 'beta-lactam', 'imipenem', 'cilastatin', 'vancomycin',
      'penicillin', 'amoxicillin', 'clavulanic', 'hypolipidemic', 'statin', 'atorvastatin',
      'ezetimibe', 'niacin', 'gemfibrozil', 'colestipol', 'heparin', 'warfarin', 'anticoagulant',
      'alteplase', 'fibrinolytic', 'thrombolytic', 'nsaid', 'antidote', 'protamine', 'sulfamethoxazole',
      'rifampicin', 'co-trimoxazole', 'amphotericin', 'interferon', 'lamivudine'
    ],
    weight: 1.25
  },
  'Hematology': {
    keywords: [
      'anemia', 'thalassemia', 'spherocytosis', 'hemoglobin', 'hemoglobinopathy', 'sickle cell',
      'erythrocyte', 'rbc', 'reticulocyte', 'bilirubin', 'hemolysis', 'hemolytic', 'platelet',
      'thrombocytopenia', 'coagulation', 'clotting factor', 'inr', 'pt', 'aptt', 'dvt',
      'splenectomy', 'bone marrow', 'leukemia', 'lymphoma', 'hodgkin', 'myeloma', 'reed sternberg'
    ],
    weight: 1.3
  },
  'Physiology': {
    keywords: [
      'action potential', 'cardiac output', 'glomerular filtration', 'gfr', 'action potential',
      'membrane potential', 'depolarization', 'respiratory rate', 'ventilation-perfusion',
      'hormone feedback', 'homeostasis', 'endocrine regulation', 'compliance', 'cardiac cycle',
      'preload', 'afterload', 'renal clearance', 'osmolarity', 'acid-base balance', 'metabolic alkalosis'
    ],
    weight: 1.1
  },
  'Pathology': {
    keywords: [
      'necrosis', 'apoptosis', 'inflammation', 'granuloma', 'carcinoma', 'sarcoma',
      'biopsy', 'histopathology', 'metaplasia', 'dysplasia', 'ischemia', 'infarction',
      'thrombosis', 'embolism', 'atherosclerosis', 'hypertrophy', 'hyperplasia', 'caseous'
    ],
    weight: 1.15
  },
  'Anatomy': {
    keywords: [
      'artery', 'vein', 'nerve', 'plexus', 'foramen', 'muscle', 'tendon', 'ligament',
      'innervation', 'blood supply', 'origin', 'insertion', 'triangle', 'canal', 'fascia',
      'sulcus', 'gyrus', 'cranial nerve', 'brachial plexus', 'femoral triangle', 'mediastinum'
    ],
    weight: 1.1
  },
  'Microbiology': {
    keywords: [
      'gram-positive', 'gram-negative', 'bacteria', 'virus', 'fungus', 'culture',
      'virulence factor', 'endotoxin', 'exotoxin', 'staphylococcus', 'streptococcus',
      'escherichia coli', 'mycobacterium', 'capsule', 'spore', 'antigenic shift', 'bacillus'
    ],
    weight: 1.2
  },
  'Biochemistry': {
    keywords: [
      'enzyme', 'substrate', 'allosteric', 'glycolysis', 'krebs cycle', 'citric acid',
      'gluconeogenesis', 'fatty acid', 'amino acid', 'purine', 'pyrimidine', 'dna replication',
      'transcription', 'translation', 'atp', 'nadh', 'fadh2', 'coenzyme', 'vitamin deficiency'
    ],
    weight: 1.1
  },
  'Immunology': {
    keywords: [
      'antibody', 'antigen', 't-cell', 'b-cell', 'cd4', 'cd8', 'major histocompatibility',
      'mhc', 'hla', 'complement', 'cytokine', 'interleukin', 'interferon', 'hypersensitivity',
      'autoimmune', 'immunodeficiency', 'immunoglobulin', 'ige', 'igm', 'iga', 'igg'
    ],
    weight: 1.2
  },
  'Medicine (Internal)': {
    keywords: [
      'presentation', 'clinical vignette', 'management', 'diagnostic test', 'investigation',
      'first-line', 'syndrome', 'gold standard', 'prognosis', 'physical examination',
      'electrocardiogram', 'ecg', 'echocardiogram', 'hypertension', 'diabetes mellitus'
    ],
    weight: 1.0
  },
  'Surgery': {
    keywords: [
      'surgical', 'laparoscopic', 'incision', 'postoperative', 'anastomosis', 'resection',
      'wound healing', 'hernia', 'appendectomy', 'cholecystectomy', 'trauma', 'hemorrhage control'
    ],
    weight: 1.1
  },
  'Pediatrics': {
    keywords: [
      'infant', 'neonate', 'newborn', 'milestone', 'developmental', 'childhood',
      'congenital', 'vaccination', 'growth chart', 'pediatric', 'apgar', 'failure to thrive'
    ],
    weight: 1.25
  },
  'Obstetrics & Gynecology': {
    keywords: [
      'gestational', 'pregnancy', 'trimester', 'labor', 'delivery', 'cervical', 'ovary',
      'uterine', 'placenta', 'preeclampsia', 'amniotic', 'endometrium', 'amenorrhea', 'contraception'
    ],
    weight: 1.25
  },
  'Histology': {
    keywords: [
      'epithelium', 'stratified', 'squamous', 'cuboidal', 'columnar', 'basement membrane',
      'staining', 'hematoxylin', 'eosin', 'h&e', 'connective tissue', 'fibroblast', 'collagen',
      'tunica intima', 'tunica media', 'tunica adventitia', 'arteriole', 'capillary', 'sinusoid',
      'endothelium', 'elastic lamina', 'vasa vasorum', 'pericyte', 'fenestrated', 'intercalated disc',
      'purkinje fiber', 'cardiac muscle', 'myofibril'
    ],
    weight: 1.2
  },
  'Embryology': {
    keywords: [
      'ectoderm', 'mesoderm', 'endoderm', 'neural crest', 'pharyngeal arch', 'somite',
      'organogenesis', 'teratogen', 'ductus arteriosus', 'foramen ovale', 'vitelline',
      'aortic arch', 'truncus arteriosus', 'bulbus cordis', 'sinus venosus', 'septum primum',
      'septum secundum', 'endocardial cushion', 'cardinal vein', 'umbilical vein', 'ductus venosus'
    ],
    weight: 1.25
  },
  'Parasitology': {
    keywords: [
      'parasite', 'protozoa', 'helminth', 'nematode', 'trematode', 'cestode', 'trophozoite',
      'cyst', 'ova', 'vector', 'plasmodium', 'malaria', 'schistosoma', 'leishmania', 'giardia',
      'toxoplasma', 'trypanosoma', 'babesia', 'ancylostoma', 'taenia', 'echinococcus', 'filaria', 'fasciola', 'cercaria', 'katayama'
    ],
    weight: 1.3
  }
};

/**
 * Classify a question dynamically based on stem, all options, and library context
 */
export async function classifyQuestionSubject(
  stem: string,
  options: Array<{ label: string; text: string }>,
  allAvailableBooks?: Array<{ id: string; title: string; subject: string }>
): Promise<ClassificationResult> {
  // Combine stem and all options to analyze complete scientific context
  const fullText = `${stem} ${options.map(o => `${o.label}: ${o.text}`).join(' ')}`.toLowerCase();

  // Score candidate subjects
  const scoredSubjects: Array<{ subject: string; score: number }> = [];

  for (const [discipline, data] of Object.entries(MEDICAL_DISCIPLINE_ONTOLOGY)) {
    let score = 0;
    for (const kw of data.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}s?\\b`, 'gi');
      const matches = fullText.match(regex);
      if (matches) {
        score += matches.length * data.weight;
      }
    }

    if (score > 0) {
      scoredSubjects.push({ subject: discipline, score });
    }
  }

  scoredSubjects.sort((a, b) => b.score - a.score);

  let primarySubject = 'General Medical Sciences';
  let secondarySubjects: string[] = [];
  let confidence = 50;

  if (scoredSubjects.length > 0) {
    primarySubject = scoredSubjects[0].subject;
    const topScore = scoredSubjects[0].score;

    // Check secondary subjects that scored at least 35% of top score
    secondarySubjects = scoredSubjects
      .slice(1)
      .filter(s => s.score >= topScore * 0.35)
      .map(s => s.subject);

    // Confidence is proportional to top score and separation from second subject
    const runnerUpScore = scoredSubjects[1]?.score || 0;
    const dominance = topScore / (topScore + runnerUpScore || 1);
    confidence = Math.min(98, Math.max(60, Math.round(55 + dominance * 30 + Math.min(topScore, 10))));
  }

  // Derive specific topic ignoring generic question starters
  const ignoredTopicWords = new Set(['Which', 'What', 'When', 'Where', 'Why', 'How', 'Choose', 'Following', 'Regarding', 'Statement', 'Identify', 'Mention', 'Compare', 'Enumerate', 'Discuss', 'Differentiate', 'Explain', 'Describe', 'Give', 'The', 'In', 'If', 'All', 'His', 'Her', 'Patient']);
  const topicKeywords = (stem.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [])
    .filter(w => !ignoredTopicWords.has(w));
  const topic = topicKeywords.length > 0 ? topicKeywords.slice(0, 2).join(' ') : primarySubject;

  // Match available reference books in database (supports full subject names and common abbreviations like histo/embryo/patho/physio/pharma)
  const subjectAliases: Record<string, string[]> = {
    'histology': ['histo'],
    'embryology': ['embryo'],
    'pathology': ['patho'],
    'physiology': ['physio'],
    'pharmacology': ['pharma'],
    'microbiology': ['micro'],
    'parasitology': ['para'],
    'hematology': ['hema', 'haem'],
    'anatomy': ['anat'],
    'biochemistry': ['biochem']
  };
  const matchesSubject = (haystack: string, subj: string): boolean => {
    const s = subj.toLowerCase();
    if (!s || s === 'general medical sciences') return false;
    if (haystack.includes(s) || s.includes(haystack)) return true;
    const aliases = subjectAliases[s] || [];
    return aliases.some(alias => haystack.includes(alias));
  };

  const matchedReferenceBookIds: string[] = [];
  if (allAvailableBooks && allAvailableBooks.length > 0) {
    for (const book of allAvailableBooks) {
      const bookSubLower = (book.subject || '').toLowerCase();
      const bookTitleLower = book.title.toLowerCase();
      const combinedBook = `${bookSubLower} ${bookTitleLower}`;

      if (
        matchesSubject(combinedBook, primarySubject) ||
        secondarySubjects.some(sec => matchesSubject(combinedBook, sec))
      ) {
        matchedReferenceBookIds.push(book.id);
      }
    }

    // If no direct subject match, include all ready books to avoid missing critical references
    if (matchedReferenceBookIds.length === 0) {
      matchedReferenceBookIds.push(...allAvailableBooks.map(b => b.id));
    }
  }

  return {
    primarySubject,
    secondarySubjects,
    topic,
    confidence,
    matchedReferenceBookIds
  };
}
