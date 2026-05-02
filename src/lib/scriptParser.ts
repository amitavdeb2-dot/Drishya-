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

function parseScriptText(text: string): ParsedScene[] {
  console.log(`[Parser] Running scene segmentation on ${text.length} characters...`);
  const scenes = parseScenes(text);
  console.log("Scenes found:", scenes.length);
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

  const sceneRegex = /^\s*(?:\d+[\.\s]*)?(INT|EXT|I\/E|INT\/EXT|EXT\/INT)[\.\s]/i

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (!line) continue

    if (sceneRegex.test(line)) {
      console.log("NEW SCENE DETECTED:", line)

      if (currentScene) {
        scenes.push(currentScene)
      }

      const typeMatch = line.match(/INT|EXT/i)
      const timeMatch = line.match(/DAY|NIGHT/i)

      currentScene = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),

        sceneNumber: sceneCounter++,          // ✅ important
        scriptNumber: extractSceneNumber(line),

        heading: cleanHeading(line),
        location: extractLocation(line),

        type: typeMatch ? typeMatch[0].toUpperCase() : "INT",
        time: timeMatch ? timeMatch[0].toUpperCase() : "DAY",

        content: [],
      }

    } else if (currentScene) {
      // Add content to current scene
      currentScene.content.push(line)
    }
  }

  // 🧠 VERY IMPORTANT: push last scene
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
