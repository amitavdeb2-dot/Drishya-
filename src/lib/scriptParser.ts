import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Use local worker from node_modules via Vite URL
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ParsedScene {
  number: string;
  intExt: string;
  location: string;
  dayNight: string;
  content: string;
}

export async function parseScript(file: File): Promise<ParsedScene[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  console.log(`[Parser] Starting extraction for: ${file.name} (${extension})`);

  try {
    let scenes: ParsedScene[] = [];
    switch (extension) {
      case 'pdf':
        scenes = await parseScriptPDF(file);
        break;
      case 'fdx':
        scenes = await parseFDX(file);
        break;
      case 'fountain':
      case 'txt':
        scenes = await parseFountain(file);
        break;
      case 'docx':
        scenes = await parseDOCX(file);
        break;
      case 'rtf':
        scenes = await parseRTF(file);
        break;
      default:
        throw new Error(`Unsupported file format: .${extension}`);
    }
    
    console.log(`[Parser] Successfully extracted ${scenes.length} scenes.`);
    return scenes;
  } catch (err) {
    console.error(`[Parser] Critical Failure:`, err);
    throw err;
  }
}

async function parseScriptPDF(file: File): Promise<ParsedScene[]> {
  console.log(`[Parser] Initializing PDF.js loading task...`);
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ 
    data: arrayBuffer,
    useWorkerFetch: false
  });
  
  const pdf = await loadingTask.promise;
  console.log(`[Parser] PDF loaded. Pages: ${pdf.numPages}`);
  
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Sort items by vertical position (Y), then horizontal (X)
    const items = textContent.items as any[];
    
    // Group items by their vertical position (allowing some tolerance for minor misalignments)
    const linesMap: Map<number, any[]> = new Map();
    const tolerance = 5; // Balanced tolerance for line grouping in PDFs
    
    items.forEach(item => {
      const y = item.transform[5];
      let found = false;
      for (const key of linesMap.keys()) {
        if (Math.abs(key - y) < tolerance) {
          linesMap.get(key)!.push(item);
          found = true;
          break;
        }
      }
      if (!found) {
        linesMap.set(y, [item]);
      }
    });

    // Sort y-coordinates from top to bottom
    const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
    
    let pageText = '';
    sortedY.forEach(y => {
      const lineItems = linesMap.get(y)!;
      // Sort items within a line from left to right
      lineItems.sort((a, b) => a.transform[4] - b.transform[4]);
      const lineStr = lineItems.map(item => item.str).join(' ');
      pageText += lineStr + '\n';
    });
    
    fullText += pageText + '\n';
  }

  return parseScriptText(fullText);
}

async function parseFDX(file: File): Promise<ParsedScene[]> {
  console.log(`[Parser] Parsing Final Draft XML (.fdx)...`);
  const text = await file.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "text/xml");
  
  const paragraphs = xmlDoc.getElementsByTagName("Paragraph");
  const scenes: ParsedScene[] = [];
  let currentScene: Partial<ParsedScene> & { textContent: string[] } | null = null;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const type = p.getAttribute("Type");
    const textElements = p.getElementsByTagName("Text");
    const pText = Array.from(textElements).map(t => t.textContent).join(" ");

    if (type === "Scene Heading") {
      if (currentScene) {
        scenes.push(finalizeScene(currentScene, scenes.length + 1));
      }
      
      const headingParts = parseHeading(pText);
      currentScene = {
        ...headingParts,
        textContent: [pText]
      };
    } else if (currentScene) {
      currentScene.textContent.push(pText);
    }
  }

  if (currentScene) {
    scenes.push(finalizeScene(currentScene, scenes.length + 1));
  }

  return scenes;
}

async function parseFountain(file: File): Promise<ParsedScene[]> {
  console.log(`[Parser] Parsing Plain Text / Fountain script...`);
  const text = await file.text();
  return parseScriptText(text);
}

async function parseDOCX(file: File): Promise<ParsedScene[]> {
  console.log(`[Parser] Extracting text from DOCX using Mammoth...`);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return parseScriptText(result.value);
}

async function parseRTF(file: File): Promise<ParsedScene[]> {
  console.log(`[Parser] Primitive RTF extraction...`);
  const text = await file.text();
  const plainText = text.replace(/\\([a-z]{1,32})(-?\d+)? ?/g, "")
                        .replace(/\{[^}]+\}/g, "")
                        .trim();
  return parseScriptText(plainText);
}

function normalizeText(text: string): string {
  console.log("[Parser] Normalizing text structure...");
  
  // 1. Spacing after periods if missing (e.g. "17.INT." -> "17. INT.")
  // and ensure INT./EXT. are separated from numbers
  let normalized = text
    .replace(/\.([A-Z])/g, '. $1')
    .replace(/(\d+)([A-Z])/g, '$1 $2') // "17INT" -> "17 INT"
    .replace(/(\d+)\.([A-Z])/g, '$1. $2'); // "17.INT" -> "17. INT"

  // 2. Spacing around dashes in potential headers (e.g. ROOM-DAY -> ROOM - DAY)
  normalized = normalized.replace(/([A-Z0-9])-(?=[A-Z0-9])/g, '$1 - ');

  // 3. Normalize multiple spaces
  normalized = normalized.replace(/[ \t]+/g, ' ');

  const rawLines = normalized.split(/\r?\n/);
  const resultLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i].trim();
    if (!line) continue;

    // 4. Handle Split Headings: If a line is just a number (e.g. "17.") and next starts with INT/EXT
    const numberOnlyMatch = line.match(/^(\d+\.?)$/);
    if (numberOnlyMatch && i + 1 < rawLines.length) {
      const nextLine = rawLines[i+1].trim();
      const headerStartRegex = /^(INT|EXT|I\/E|INT\/EXT|EXT\/INT)/i;
      
      if (headerStartRegex.test(nextLine)) {
        line = line + " " + nextLine;
        i++; // Skip the next line as it's now merged
      }
    }
    
    resultLines.push(line);
  }

  return resultLines.join('\n');
}

function parseScriptText(text: string): ParsedScene[] {
  console.log(`[Parser] Running scene segmentation on ${text.length} characters...`);
  
  const normalizedText = normalizeText(text);
  
  // DEBUG LOGGING: First 20 lines of normalized text
  const debugLines = normalizedText.split('\n').slice(0, 20);
  console.log("[Parser] --- DEBUG: FIRST 20 LINES OF NORMALIZED TEXT ---");
  debugLines.forEach((l, i) => console.log(`${i+1}: ${l}`));
  console.log("[Parser] -----------------------------------------------");

  const scenes = parseScenes(normalizedText);

  // DEBUG LOGGING: Number of detected scenes
  console.log(`[Parser] Total detected scenes: ${scenes.length}`);
  
  return scenes;
}

/**
 * Extract clean scene heading parts using established parsing logic.
 */
function extractSceneHeading(line: string) {
  // Try to cut after DAY / NIGHT
  const match = line.match(/^(.*?\b(DAY|NIGHT)\b)/i)

  if (match) {
    return match[1].trim()
  }

  // fallback: return full line
  return line
}

/**
 * Fallback parser to handle text that doesn't follow standard screenplay formatting.
 * Splits by double-newlines and creates generic scene descriptors.
 */
function fallbackParse(scriptText: string): ParsedScene[] {
  const blocks = scriptText.split(/\n\s*\n/)

  return blocks
    .filter(b => b.trim().length > 0)
    .map((block, index) => ({
      number: (index + 1).toString(),
      intExt: 'INT',
      location: `SCENE ${index + 1}`,
      dayNight: 'DAY',
      content: block.trim(),
    }))
}

/**
 * Line-by-line screenplay parser for higher precision.
 */
export function parseScenes(scriptText: string): ParsedScene[] {
  const lines = scriptText.split("\n")

  const scenes: any[] = []
  let currentScene: any = null
  let sceneCounter = 1

  // Better regex for flexible scene detection
  const sceneRegex = /^\s*(?:\d+[\.\s]*)?(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.|INT|EXT|I\/E)[\.\s]/i

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (!line) continue

    if (sceneRegex.test(line)) {
      if (currentScene) {
        scenes.push(currentScene)
      }

      const typeMatch = line.match(/INT|EXT|I\/E/i)
      const timeMatch = line.match(/(?:(?!\b(INT|EXT)\b)\b(DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|LATER|CONTINUOUS|MOMENTS LATER|SUNRISE|SUNSET)\b)/i)

      currentScene = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
        sceneNumber: sceneCounter++,
        scriptNumber: extractSceneNumber(line),
        heading: cleanHeading(line),
        location: extractLocation(line),
        type: typeMatch ? typeMatch[0].toUpperCase() : "INT",
        time: timeMatch ? timeMatch[0].toUpperCase() : "DAY",
        content: [],
      }

    } else if (currentScene) {
      currentScene.content.push(line)
    }
  }

  if (currentScene) {
    scenes.push(currentScene)
  }

  console.log("FINAL SCENES DETECTED:", scenes.length)
  
  // ✅ FALLBACK ONLY IF ZERO
  if (scenes.length === 0) {
    console.log("[Parser] No scenes detected, triggering fallback parse...");
    return fallbackParse(scriptText)
  }

  // Map back to ParsedScene interface
  return scenes.map((s) => {
    return {
      number: s.scriptNumber || s.sceneNumber.toString(),
      intExt: s.type,
      location: s.location,
      dayNight: s.time,
      content: s.content.join("\n")
    };
  });
}

function parseHeading(text: string) {
  const cleanText = text.trim();
  // Remove leading numbers if present (e.g. "123. INT. KITCHEN")
  const withoutNumbers = cleanText.replace(/^\d+\.?\s*/, '');
  
  const headingRegex = /^(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.|INT|EXT|I\/E)[\.\s]+(.+)/i;
  const match = withoutNumbers.match(headingRegex);
  
  if (match) {
    const prefix = match[1].toUpperCase().replace('.', '').trim();
    let remainder = match[2].trim();
    
    // Try to extract time of day from the end
    const timeRegex = /[\s-]+(DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|LATER|CONTINUOUS|MOMENTS LATER|SUNRISE|SUNSET)$/i;
    const timeMatch = remainder.match(timeRegex);
    
    let timeOfDay = 'DAY';
    let location = remainder;
    
    if (timeMatch) {
      const rawTime = timeMatch[1].toUpperCase();
      location = remainder.replace(timeRegex, '').trim();
      
      if (rawTime.includes('NIGHT')) timeOfDay = 'NIGHT';
      else if (['DAWN', 'SUNRISE'].some(t => rawTime.includes(t))) timeOfDay = 'DAWN';
      else if (['DUSK', 'SUNSET'].some(t => rawTime.includes(t))) timeOfDay = 'DUSK';
      else if (rawTime.includes('EVENING')) timeOfDay = 'EVENING';
      else if (rawTime.includes('MORNING')) timeOfDay = 'MORNING';
    }
    
    // Strip trailing dashes or dots from location
    location = location.replace(/[-.\s]+$/, '').trim();

    return {
      intExt: prefix,
      location: location || 'UNKNOWN',
      dayNight: timeOfDay
    };
  }
  
  // Final fallback for identifying type if regex fails but line was identified as scene
  const type = cleanText.toUpperCase().includes('INT') ? 'INT' : (cleanText.toUpperCase().includes('EXT') ? 'EXT' : 'INT');
  const time = cleanText.toUpperCase().includes('NIGHT') ? 'NIGHT' : 'DAY';

  return {
    intExt: type,
    location: cleanText,
    dayNight: time
  };
}

function extractSceneNumber(line: string) {
  const match = line.match(/^\s*(\d+)[\.\s]/)
  return match ? Number(match[1]) : null
}

function cleanHeading(line: string) {
  return line.replace(/^\s*\d+[\.\s]*/, "").trim()
}

function extractLocation(line: string) {
  let cleaned = line
    .replace(/^\d+\.\s*/, "")
    .replace(/INT\.|EXT\.|INT\/EXT\.|EXT\/INT\./i, "")
    .replace(/\(.*?\)/g, "") // remove (VIDEO / MEMORY)

  // Split by dash but safely
  const parts = cleaned.split(" - ")

  if (parts.length > 1) {
    return parts[0].trim()
  }

  // fallback: first 3–4 words
  const words = cleaned.trim().split(" ")
  return words.slice(0, 3).join(" ").toUpperCase()
}

function finalizeScene(temp: any, index: number): ParsedScene {
  return {
    number: index.toString(),
    intExt: temp.intExt,
    location: temp.location,
    dayNight: temp.dayNight,
    content: temp.textContent.join("\n")
  };
}

function parseMeta(heading: string) {
  const isInterior = heading.includes("INT.")
  const isExterior = heading.includes("EXT.")

  const timeMatch = heading.match(/DAY|NIGHT/i)

  return {
    type: isInterior ? "INT" : isExterior ? "EXT" : "UNKNOWN",
    time: timeMatch ? timeMatch[0] : "UNKNOWN",
  }
}
