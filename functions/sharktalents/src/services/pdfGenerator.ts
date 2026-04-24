import PDFDocument from 'pdfkit';

const LIME = '#dafd6f';
const DARK = '#1f283d';
const DARK2 = '#161d2e';
const SLATE = '#515f61';
const MUTED = '#8a9bb0';
const CREAM = '#fefff5';
const DANGER = '#e74c3c';

const DISC_COLORS: Record<string, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
const DISC_LABELS: Record<string, string> = {
  D: 'Dominante — Directo, orientado a resultados',
  I: 'Influyente — Comunicativo, entusiasta',
  S: 'Sólido — Paciente, leal, busca estabilidad',
  C: 'Cumplidor — Analítico, metódico, orientado a calidad',
};
const INT_LABELS: Record<string, string> = {
  honestidad: 'Honestidad', hurto: 'Hurto', soborno: 'Soborno', alcohol: 'Alcohol',
  drogas: 'Drogas', confiabilidad: 'Confiabilidad', etica_profesional: 'Ética profesional', personalidad: 'Personalidad', apuestas: 'Apuestas',
};

export interface PDFData {
  reportText: string;
  candidateName: string;
  jobTitle: string;
  company: string;
  disc: { score: Record<string, number>; perfil_dominante: string; match_percentage: number } | null;
  cognitive: { score: Record<string, number>; match_percentage: number } | null;
  technical: { score: number | null; passed: boolean } | null;
  integrity: { overall: string; recomendacion: string; overall_pct: number; dimensiones: Record<string, { nivel: string; pct: number }> } | null;
  emotional: { score: number; perfil: string } | null;
}

let pageNum = 0;

export function generatePDF(data: PDFData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 60, left: 60, right: 60 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 120;
    const L = 60;
    pageNum = 1;

    // ── Page 1: Cover ──
    drawHeader(doc, W);
    let y = 100;

    // Candidate info card
    doc.roundedRect(L, y, W, 80, 6).fill('#f0f1ec');
    doc.fontSize(18).fill(DARK).font('Helvetica-Bold').text(data.candidateName, L + 16, y + 14, { width: W - 32 });
    doc.fontSize(11).fill(SLATE).font('Helvetica').text(`Puesto: ${data.jobTitle} — ${data.company}`, L + 16, y + 38, { width: W - 32 });
    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(9).fill(MUTED).text(`Fecha del informe: ${dateStr}`, L + 16, y + 58, { width: W - 32 });
    y = 200;

    // ── Resumen ejecutivo ──
    y = drawSectionTitle(doc, 'RESUMEN EJECUTIVO', y, W, L);
    y = drawReportText(doc, data.reportText, y, W, L);

    // ── DISC Chart ──
    if (data.disc) {
      y = ensureSpace(doc, y, 280, W);
      y = drawSectionTitle(doc, 'PERFIL CONDUCTUAL DISC', y, W, L);
      y = drawDiscChart(doc, data.disc, y, W, L);
    }

    // ── Cognitive VELNA ──
    if (data.cognitive) {
      y = ensureSpace(doc, y, 200, W);
      y = drawSectionTitle(doc, 'CAPACIDADES COGNITIVAS VELNA', y, W, L);
      y = drawCognitiveChart(doc, data.cognitive, y, W, L);
    }

    // ── Emotional ──
    if (data.emotional) {
      y = ensureSpace(doc, y, 120, W);
      y = drawSectionTitle(doc, 'INTELIGENCIA EMOCIONAL', y, W, L);
      y = drawEmotionChart(doc, data.emotional, y, W, L);
    }

    // ── Technical ──
    if (data.technical) {
      y = ensureSpace(doc, y, 100, W);
      y = drawSectionTitle(doc, 'EVALUACIÓN TÉCNICA', y, W, L);
      y = drawTechnical(doc, data.technical, y, L);
    }

    // ── Integrity ──
    if (data.integrity) {
      y = ensureSpace(doc, y, 200, W);
      y = drawSectionTitle(doc, 'INTEGRIDAD', y, W, L);
      y = drawIntegrity(doc, data.integrity, y, W, L);
    }

    // Footer on last page
    addFooter(doc, W);
    doc.end();
  });
}

function drawHeader(doc: PDFKit.PDFDocument, W: number): void {
  doc.rect(0, 0, doc.page.width, 75).fill(DARK);
  doc.fontSize(22).fill(LIME).font('Helvetica-Bold').text('SharkTalents', 60, 22, { width: W });
  doc.fontSize(9).fill(MUTED).font('Helvetica').text('by Kuno Digital', 60, 48, { width: W });
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, y: number, W: number, L: number): number {
  y += 8;
  doc.roundedRect(L, y, W, 26, 4).fill(DARK);
  doc.fontSize(10).fill(LIME).font('Helvetica-Bold').text(title, L + 12, y + 7, { width: W - 24 });
  return y + 38;
}

function drawReportText(doc: PDFKit.PDFDocument, text: string, y: number, W: number, L: number): number {
  const paragraphs = text.split('\n').filter(p => p.trim());
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    const isTitle = /^\d+[\.\)]?\s/.test(trimmed) || /^(RESUMEN|ANÁLISIS|EVALUACIÓN|CAPACIDADES|COMPATIBILIDAD|RECOMENDACIÓN|PERFIL)/i.test(trimmed);

    if (isTitle) {
      doc.fontSize(10).fill(DARK).font('Helvetica-Bold');
      y += 6;
    } else {
      doc.fontSize(9.5).fill('#333333').font('Helvetica');
    }

    y = ensureSpace(doc, y, 40, W);
    const h = doc.heightOfString(trimmed, { width: W, lineGap: 2.5 });
    doc.text(trimmed, L, y, { width: W, lineGap: 2.5 });
    y += h + 6;
  }
  return y + 4;
}

function drawDiscChart(doc: PDFKit.PDFDocument, disc: PDFData['disc'], y: number, W: number, L: number): number {
  if (!disc) return y;
  const chartW = 300;
  const chartH = 160;
  const chartX = L + (W - chartW) / 2;
  const chartY = y;
  const dims: ('D' | 'I' | 'S' | 'C')[] = ['D', 'I', 'S', 'C'];
  const total = dims.reduce((s, d) => s + (disc.score[d] || 0), 0) || 1;

  // Background
  doc.roundedRect(chartX, chartY, chartW, chartH, 4).fill(DARK);

  // Grid lines
  for (let i = 0; i <= 5; i++) {
    const gy = chartY + chartH - 10 - (i * (chartH - 30) / 5);
    doc.moveTo(chartX + 10, gy).lineTo(chartX + chartW - 10, gy).stroke('#2e3a4a');
    if (i % 2 === 0) {
      doc.fontSize(7).fill(MUTED).text(`${i * 20}`, chartX - 2, gy - 4, { width: 12, align: 'right' });
    }
  }

  // Points and line
  const points: { x: number; y: number }[] = [];
  dims.forEach((dim, i) => {
    const pct = Math.round((disc.score[dim] / total) * 100);
    const x = chartX + 40 + i * ((chartW - 80) / 3);
    const py = chartY + chartH - 10 - (pct / 100) * (chartH - 30);
    points.push({ x, y: py });

    // Label on top
    doc.fontSize(12).fill(DISC_COLORS[dim]).font('Helvetica-Bold').text(dim, x - 6, chartY + 4, { width: 12, align: 'center' });
    // Value
    doc.fontSize(8).fill(CREAM).font('Helvetica').text(`${pct}%`, x - 12, py - 14, { width: 24, align: 'center' });
  });

  // Line connecting points
  if (points.length > 1) {
    doc.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      doc.lineTo(points[i].x, points[i].y);
    }
    doc.strokeColor(LIME).lineWidth(2.5).stroke();
  }

  // Dots
  points.forEach((p, i) => {
    doc.circle(p.x, p.y, 5).fill(DISC_COLORS[dims[i]]);
  });

  doc.lineWidth(1);
  y = chartY + chartH + 12;

  // Profile description
  doc.roundedRect(L, y, W, 30, 4).fill('#f0f1ec');
  doc.fontSize(9).fill(DARK).font('Helvetica-Bold')
    .text(`Perfil: ${DISC_LABELS[disc.perfil_dominante] || disc.perfil_dominante}`, L + 12, y + 9, { width: W - 24 });
  y += 40;

  doc.fontSize(9).fill(MUTED).font('Helvetica')
    .text(`Compatibilidad con perfil ideal: ${disc.match_percentage}%`, L, y, { width: W });
  return y + 20;
}

function drawCognitiveChart(doc: PDFKit.PDFDocument, cog: PDFData['cognitive'], y: number, W: number, L: number): number {
  if (!cog) return y;
  const dims = [
    { key: 'verbal', label: 'Verbal', short: 'V' },
    { key: 'espacial', label: 'Espacial', short: 'E' },
    { key: 'logica', label: 'Lógica', short: 'L' },
    { key: 'numerica', label: 'Numérica', short: 'N' },
    { key: 'abstracta', label: 'Abstracta', short: 'A' },
  ];
  const maxPerDim = Math.max(1, Math.round(cog.score.max / 5));
  const barMaxW = 250;

  dims.forEach(d => {
    const val = (cog.score as any)[d.key] || 0;
    const pct = Math.round((val / maxPerDim) * 100);
    const barW = (pct / 100) * barMaxW;

    doc.fontSize(9).fill(DARK).font('Helvetica').text(`${d.short}  ${d.label}`, L, y + 2, { width: 90 });

    // Track
    const barX = L + 95;
    doc.roundedRect(barX, y, barMaxW, 14, 3).fill('#e8e9e4');
    // Fill
    if (barW > 0) doc.roundedRect(barX, y, Math.max(barW, 6), 14, 3).fill(LIME);
    // Score
    doc.fontSize(8).fill(DARK).font('Helvetica-Bold').text(`${val}/${maxPerDim}`, barX + barMaxW + 8, y + 2, { width: 40 });

    y += 22;
  });

  y += 4;
  doc.fontSize(9).fill(MUTED).font('Helvetica')
    .text(`Total: ${cog.score.total}/${cog.score.max} (${Math.round((cog.score.total / cog.score.max) * 100)}%) — Compatibilidad: ${cog.match_percentage}%`, L, y, { width: W });
  return y + 20;
}

function drawEmotionChart(doc: PDFKit.PDFDocument, emo: PDFData['emotional'], y: number, W: number, L: number): number {
  if (!emo) return y;
  const barW = 300;
  const barX = L + (W - barW) / 2;
  const barH = 12;

  // Gradient simulation: 3 colored rectangles
  const third = barW / 3;
  doc.roundedRect(barX, y, barW, barH, 4).fill('#e8e9e4');
  doc.rect(barX, y, third, barH).fill('#f39c12');
  doc.rect(barX + third, y, third, barH).fill('#3498db');
  doc.rect(barX + third * 2, y, third, barH).fill('#9b59b6');
  // Round corners overlay
  doc.roundedRect(barX, y, barW, barH, 4).lineWidth(0.5).strokeColor('#ccc').stroke();

  // Indicator dot
  const indicatorX = barX + (emo.score / 100) * barW;
  doc.circle(indicatorX, y + barH / 2, 7).fill('#fff');
  doc.circle(indicatorX, y + barH / 2, 5).fill(DARK);

  y += barH + 8;
  doc.fontSize(8).fill('#f39c12').font('Helvetica').text('Espontáneo', barX, y, { width: third, align: 'left' });
  doc.fontSize(8).fill('#3498db').text('Mesura', barX + third, y, { width: third, align: 'center' });
  doc.fontSize(8).fill('#9b59b6').text('Reflexivo', barX + third * 2, y, { width: third, align: 'right' });

  y += 16;
  const perfilLabel = emo.perfil === 'espontaneo' ? 'Espontáneo' : emo.perfil === 'mesura' ? 'Mesura' : 'Reflexivo';
  doc.fontSize(10).fill(DARK).font('Helvetica-Bold').text(`Perfil: ${perfilLabel} (${emo.score}/100)`, L, y, { width: W });
  return y + 20;
}

function drawTechnical(doc: PDFKit.PDFDocument, tech: PDFData['technical'], y: number, L: number): number {
  if (!tech || tech.score == null) return y;
  const color = tech.passed ? '#2ecc71' : DANGER;
  const label = tech.passed ? 'APROBADO' : 'NO APROBADO';

  doc.fontSize(28).fill(color).font('Helvetica-Bold').text(`${tech.score}%`, L, y);
  doc.fontSize(11).fill(color).font('Helvetica-Bold').text(label, L + 80, y + 8);
  return y + 40;
}

function drawIntegrity(doc: PDFKit.PDFDocument, int: PDFData['integrity'], y: number, W: number, L: number): number {
  if (!int) return y;

  const overallColor = int.overall === 'bajo' ? '#2ecc71' : int.overall === 'medio' ? '#f39c12' : DANGER;
  doc.fontSize(11).fill(overallColor).font('Helvetica-Bold').text(`Nivel general: ${int.overall.toUpperCase()} — ${int.recomendacion}`, L, y, { width: W });
  y += 22;

  const alerts: string[] = [];

  for (const [dim, d] of Object.entries(int.dimensiones)) {
    const color = d.nivel === 'bajo' ? '#2ecc71' : d.nivel === 'medio' ? '#f39c12' : DANGER;
    // Circle indicator
    doc.circle(L + 6, y + 5, 5).fill(color);
    doc.fontSize(9).fill(DARK).font('Helvetica').text(INT_LABELS[dim] || dim, L + 18, y, { width: 140 });
    doc.fontSize(9).fill(color).font('Helvetica-Bold').text(d.nivel.charAt(0).toUpperCase() + d.nivel.slice(1), L + 160, y, { width: 60 });
    doc.fontSize(8).fill(MUTED).text(`${d.pct}%`, L + 220, y + 1, { width: 30 });
    y += 16;

    if (d.nivel === 'alto' || d.nivel === 'medio') {
      alerts.push(`${INT_LABELS[dim] || dim} (${d.nivel})`);
    }
  }

  if (alerts.length > 0) {
    y += 8;
    doc.roundedRect(L, y, W, 28, 4).fill('#fef3e6');
    doc.fontSize(9).fill('#856404').font('Helvetica-Bold').text('Áreas de observación: ', L + 10, y + 8, { width: W - 20, continued: true });
    doc.font('Helvetica').text(alerts.join(', '));
    y += 36;
  }

  return y + 8;
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number, W: number): number {
  if (y + needed > doc.page.height - 80) {
    addFooter(doc, W);
    doc.addPage();
    pageNum++;
    drawHeader(doc, W);
    return 90;
  }
  return y;
}

function addFooter(doc: PDFKit.PDFDocument, W: number): void {
  const footerY = doc.page.height - 40;
  doc.fontSize(8).fill(MUTED).font('Helvetica');
  doc.text(`Confidencial — SharkTalents by Kuno Digital`, 60, footerY, { width: W - 40, align: 'left', continued: false });
  doc.text(`Página ${pageNum}`, 60, footerY, { width: W, align: 'right' });
}
