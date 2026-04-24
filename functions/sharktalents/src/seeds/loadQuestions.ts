import * as path from 'path';
import * as fs from 'fs';

const seedsDir = path.join(__dirname, '..', 'seeds');

function loadJson(filename: string): any[] {
  const filePath = path.join(seedsDir, filename);
  if (!fs.existsSync(filePath)) {
    console.log('[SEEDS] File not found:', filePath);
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function getKudertSections(cognitiveLevel: string): any[] {
  const disc = loadJson('disc.json');
  const emotional = loadJson('emotional.json');

  const cogFile = cognitiveLevel === 'senior' ? 'cognitive_senior_v2.json'
    : cognitiveLevel === 'mid' ? 'cognitive_mid_v2.json'
    : 'cognitive_basic_v2.json';
  const cogQuestions = loadJson(cogFile);

  const verbal = cogQuestions.filter((q: any) => q.dimension === 'verbal');
  const espacial = cogQuestions.filter((q: any) => q.dimension === 'espacial');
  const logico = cogQuestions.filter((q: any) => q.dimension === 'logico');
  const numerico = cogQuestions.filter((q: any) => q.dimension === 'numerico');
  const abstracto = cogQuestions.filter((q: any) => q.dimension === 'abstracto');

  return [
    { name: 'DISC', questions: disc, timer: null },
    { name: 'Verbal', questions: verbal, timer: 300 },
    { name: 'Espacial', questions: espacial, timer: 300 },
    { name: 'Lógico', questions: logico, timer: 360 },
    { name: 'Numérico', questions: numerico, timer: 300 },
    { name: 'Abstracto', questions: abstracto, timer: 1200 },
    { name: 'Emoción', questions: emotional, timer: null },
  ];
}

export function getIntegrityQuestions(): any[] {
  return loadJson('integrity_v2.json');
}

export function getQuestionsForAssessment(type: string, cognitiveLevel: string): any {
  switch (type) {
    case 'kudert': return getKudertSections(cognitiveLevel);
    case 'integrity': return getIntegrityQuestions();
    case 'technical': return [];
    default: return [];
  }
}
