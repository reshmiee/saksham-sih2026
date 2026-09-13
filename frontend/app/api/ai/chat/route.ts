import { NextRequest, NextResponse } from 'next/server';

const LANGUAGE_PROMPTS: Record<string, string> = {
  en: 'simple, easy-to-understand English without complex academic or financial jargon',
  hi: 'simple, natural Hindi (सरल हिंदी) written in Devanagari script',
  mr: 'simple, natural Marathi (सोपी मराठी) written in Devanagari script',
  ta: 'simple, natural Tamil (எளிய தமிழ்) written in Tamil script',
  te: 'simple, natural Telugu (సరళమైన తెలుగు) written in Telugu script',
};

// Grounded geographic & cluster knowledge for local micro-enterprise queries
interface LocationGrounding {
  name: string;
  households: number;
  population: number;
  district: string;
  notes: string;
  viableCategories: string[];
}

const LOCAL_GROUNDING_DATABASE: Record<string, LocationGrounding> = {
  jait: {
    name: 'Jait',
    households: 1528,
    population: 9287,
    district: 'Mathura',
    notes: 'Census 2011 verified. High daily commuter catchment along NH-19 highway corridor between Mathura and Vrindavan.',
    viableCategories: [
      'Dairy & Milk Processing (Milk chilling, paneer/ghee production for local & temple sweet markets)',
      'Grocery & Daily Provisions (Kirana store serving 1,500+ village households)',
      'Mobile Repair, Recharge & Solar Device Services (High rural utility demand)',
      'Flour Mill / Atta Chakki (Steady non-cyclical food grain processing)',
    ],
  },
  kamar: {
    name: 'Kamar',
    households: 2480,
    population: 14384,
    district: 'Mathura',
    notes: 'Large agricultural settlement in Chhata tehsil with strong dairy livestock density and daily mandi commerce.',
    viableCategories: [
      'Dairy Chilling & Animal Feed Depot',
      'Agri-input, Seeds & Bio-fertilizers Depot',
      'Kirana / General Retail Store',
      'Flour Mill & Spices Grinding Unit',
    ],
  },
  chhata: {
    name: 'Chhata',
    households: 3600,
    population: 21000,
    district: 'Mathura',
    notes: 'Sub-divisional headquarters with active rural grain mandi and industrial zone linkages along NH-19.',
    viableCategories: [
      'Agro-processing & Packaging',
      'Commercial Retail & Wholesale Kirana',
      'Dairy Value-Addition & Sweet Manufacturing',
      'Hardware, Electrical & Small Machinery Repair',
    ],
  },
  barsana: {
    name: 'Barsana',
    households: 1900,
    population: 11000,
    district: 'Mathura',
    notes: 'Pilgrimage cultural hub with heavy seasonal and religious tourist footfall.',
    viableCategories: [
      'Dairy Products (Peda, Khoya, Ghee for temple offerings)',
      'Handicrafts, Incense & Religious Tourism Retail',
      'Food & Beverage / Sweet Shop',
      'Eco-friendly Packaging & Cloth Bags',
    ],
  },
};

function getGroundedContextForQuery(query: string): { contextText: string; citations: Array<{ document_id: string; source: string; excerpt?: string }>; isGrounded: boolean } {
  const lower = query.toLowerCase();
  const matchedLocations: LocationGrounding[] = [];

  for (const [key, loc] of Object.entries(LOCAL_GROUNDING_DATABASE)) {
    if (lower.includes(key) || (key === 'jait' && lower.includes('जैत'))) {
      matchedLocations.push(loc);
    }
  }

  const isMathuraMentioned = lower.includes('mathura') || lower.includes('मथुरा');
  const citations: Array<{ document_id: string; source: string; excerpt?: string }> = [];
  const lines: string[] = [];

  if (matchedLocations.length > 0) {
    for (const loc of matchedLocations) {
      lines.push(`- Location Grounding (${loc.name}, ${loc.district}): Households: ${loc.households.toLocaleString('en-IN')}, Population: ${loc.population.toLocaleString('en-IN')} (Census 2011). Context: ${loc.notes}. Top viable micro-enterprise categories: ${loc.viableCategories.join('; ')}.`);
      citations.push({
        document_id: 'census_2011_mathura_villages',
        source: `Census 2011 Village Directory (Mathura District, UP)`,
        excerpt: `${loc.name} Village: ${loc.households} households, ${loc.population} population.`,
      });
    }
  } else if (isMathuraMentioned) {
    lines.push(`- District Grounding: Mathura District, Uttar Pradesh. Known for prominent Dairy cluster (milk, ghee, peda), ODOP Sanitary fittings manufacturing, and religious tourism corridors.`);
    citations.push({
      document_id: 'mathura_district_industrial_profile',
      source: 'MSME Development Institute: Mathura District Industrial Profile',
      excerpt: 'Industrial profile and ODOP priority clusters for Mathura district, Uttar Pradesh.',
    });
  }

  // Scheme guidelines grounding
  if (lower.includes('scheme') || lower.includes('subsidy') || lower.includes('pmfme') || lower.includes('pmegp') || lower.includes('mudra') || lower.includes('योजना') || lower.includes('सब्सिडी')) {
    lines.push(`- Government Concessional Schemes Grounding:
  1. PMFME (PM Formalisation of Micro Food Processing Enterprises): 35% credit-linked capital subsidy up to ₹10 Lakhs for food and dairy processing micro-units.
  2. PMEGP (Prime Minister's Employment Generation Programme): 25% (general) to 35% (special categories: rural, women, SC/ST, OBC) margin money capital subsidy for rural micro-enterprises.
  3. PM Mudra Yojana: Collateral-free institutional debt up to ₹10 Lakhs (Shishu up to ₹50k, Kishor ₹50k-₹5L, Tarun ₹5L-₹10L).`);
    citations.push({
      document_id: 'pmfme_scheme_guidelines',
      source: 'Ministry of Food Processing Industries (MoFPI): PMFME Operational Guidelines',
      excerpt: '35% capital subsidy up to ₹10 Lakhs for micro food and dairy processing.',
    });
  }

  return {
    contextText: lines.length > 0 ? `\nVerified Grounded Data Available for this Query:\n${lines.join('\n')}\n` : '',
    citations,
    isGrounded: citations.length > 0,
  };
}

function isResponseIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 20) return true;

  // Check if text ends abruptly with dangling punctuation or incomplete opening structures
  const danglingEndings = ['(', '[', '{', ':', '---', '***', '>', 'Key Points:', 'How SAKSHAM evaluates it:'];
  for (const ending of danglingEndings) {
    if (trimmed.endsWith(ending)) return true;
  }

  // Check unclosed opening parenthesis or bracket at the very end
  if (/\(\s*$/.test(trimmed) || /\[\s*$/.test(trimmed)) return true;

  // Check unclosed markdown formatting tag at the end (e.g. text ending in incomplete '**')
  if (trimmed.endsWith('**') && (trimmed.match(/\*\*/g) || []).length % 2 === 1) return true;

  // Check if ending sentence was abruptly truncated without terminal punctuation or closing quote/paren
  const lastChar = trimmed.slice(-1);
  const validPunctuation = ['.', '!', '?', '।', '"', "'", ')', ']', '}', '*'];
  if (!validPunctuation.includes(lastChar)) {
    // If the last line is a list bullet or header that got cut off mid-thought
    const lines = trimmed.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine.length > 30 && !/[.!?।]$/.test(lastLine)) {
      return true;
    }
  }

  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, language = 'en', userApiKey } = body;

    const apiKey =
      (typeof userApiKey === 'string' && userApiKey.trim()) ||
      req.headers.get('x-gemini-api-key') ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { available: false, error: 'NO_GEMINI_API_KEY' },
        { status: 200 }
      );
    }

    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery) {
      return NextResponse.json(
        { available: false, error: 'EMPTY_QUERY' },
        { status: 400 }
      );
    }

    const targetLangDesc = LANGUAGE_PROMPTS[language] || LANGUAGE_PROMPTS.en;
    const grounding = getGroundedContextForQuery(cleanQuery);

    const systemPrompt = `You are SAKSHAM AI, an expert rural enterprise and micro-business advisor for Indian entrepreneurs developed for Smart India Hackathon #91.

Core Directives:
1. Target Language: Respond entirely in ${targetLangDesc}. Use clear, everyday, accessible words that a village shopkeeper or rural producer can easily understand.
2. Direct Relevance: Answer the user's specific question directly and completely. Do NOT prepend generic introductory greetings (such as "Hello! Welcome to SAKSHAM AI. I am here to help you plan...").
3. Multi-Intent Coverage: If the user asks for multiple things (e.g. suitable business categories for a specific place and capital, AND government schemes), address ALL requested components thoroughly using clear markdown headings (##). Never omit requested information.
4. Financial Structuring Context: Only explain the SAKSHAM financing structure (10% borrower margin + 90% priority bank loan) when the user asks about startup costs, financing, capital, or business viability. Do NOT inject it into simple factual queries.
5. Grounded Factual Integrity: Use the verified grounded facts provided below where available. Do not hallucinate subsidies, interest rates, or population numbers.
6. Domain Boundaries: If the user asks about unrelated non-business topics (sports, cinema, etc.), politely decline as an enterprise advisor.
${grounding.contextText}`;

    const candidateModels = [
      process.env.GEMINI_MODEL,
      'gemini-3.6-flash',
      'gemini-2.5-flash-lite',
      'gemini-flash-latest',
    ].filter(Boolean) as string[];

    let lastError = 'No response candidate';
    let chosenModel = 'gemini-3.6-flash';

    for (const modelName of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey.trim()}`;

        // Initial Generation Attempt
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `${systemPrompt}\n\nUser Question: ${cleanQuery}` },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2500,
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          lastError = `Gemini API Error (${modelName}): ${res.status} - ${errText}`;
          continue;
        }

        const data = await res.json();
        const candidate = data?.candidates?.[0];
        const finishReason = candidate?.finishReason;
        const parts = candidate?.content?.parts;
        let candidateText = Array.isArray(parts)
          ? parts
              .map((p: any) => p?.text || '')
              .filter(Boolean)
              .join('\n')
          : '';

        // Check if response was truncated by MAX_TOKENS or ended incompletely
        if (finishReason === 'MAX_TOKENS' || isResponseIncomplete(candidateText)) {
          // Attempt a single bounded retry with concise corrective instructions
          try {
            const retryRes = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: `${systemPrompt}\n\nUser Question: ${cleanQuery}\n\nCRITICAL INSTRUCTION: Previous generation was truncated. Please provide a complete, well-structured answer addressing all requested parts concisely without filler or preambles. Ensure all sentences and markdown tags are completely closed.`,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.1,
                  maxOutputTokens: 2500,
                },
              }),
            });

            if (retryRes.ok) {
              const retryData = await retryRes.json();
              const retryParts = retryData?.candidates?.[0]?.content?.parts;
              const retryCandidateText = Array.isArray(retryParts)
                ? retryParts.map((p: any) => p?.text || '').filter(Boolean).join('\n')
                : '';
              if (retryCandidateText && !isResponseIncomplete(retryCandidateText)) {
                candidateText = retryCandidateText;
              }
            }
          } catch {
            // Keep original candidate text if retry network fails
          }
        }

        if (candidateText && candidateText.trim().length > 0 && !isResponseIncomplete(candidateText)) {
          chosenModel = modelName;
          return NextResponse.json({
            available: true,
            answer: candidateText.trim(),
            model: chosenModel,
            language,
            grounding_status: grounding.isGrounded ? 'fully_grounded' : 'domain_knowledge',
            citations: grounding.citations,
          });
        }
      } catch (err: any) {
        lastError = err?.message || 'Network error';
      }
    }

    return NextResponse.json(
      { available: false, error: lastError },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { available: false, error: err?.message || 'INTERNAL_ERROR' },
      { status: 200 }
    );
  }
}
