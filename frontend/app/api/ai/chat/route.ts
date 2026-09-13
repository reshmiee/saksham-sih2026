import { NextRequest, NextResponse } from 'next/server';

const LANGUAGE_PROMPTS: Record<string, string> = {
  en: 'simple, easy-to-understand English without complex academic or financial jargon',
  hi: 'simple, natural Hindi (सरल हिंदी) written in Devanagari script',
  mr: 'simple, natural Marathi (सोपी मराठी) written in Devanagari script',
  ta: 'simple, natural Tamil (எளிய தமிழ்) written in Tamil script',
  te: 'simple, natural Telugu (సరళమైన తెలుగు) written in Telugu script',
};

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

    const systemPrompt = `You are SAKSHAM AI, an expert rural enterprise and micro-business advisor for Indian entrepreneurs developed for Smart India Hackathon #91.

Project Background & Knowledge Base:
- What is SAKSHAM? SAKSHAM (Smart Advisory & Knowledge System for Holistic Assessment of Micro-enterprises) is an AI-powered enterprise viability, pre-feasibility, and priority credit assessment platform designed to eliminate rural business failure in India.
- Problem Solved: Rural entrepreneurs often lack formal credit history and viability data, leading to venture failure or predatory loans. SAKSHAM provides instant data-driven feasibility, financial modeling, and scheme matching.
- Architecture:
  1. 4-Factor Viability Engine: Evaluates Market Demand (30%), Local Competition & Catchment (25%), Capital Feasibility (25%), and Infrastructure & Logistics (20%) to produce a 0-100 Fit Score.
  2. Statutory Financing Structure: 10% borrower equity margin + 90% priority institutional bank loan (up to ₹10 Lakhs).
  3. Grounded Knowledge Base: Grounded in official Census 2011 demographics, One District One Product (ODOP) catalogs, Ministry of MSME Udyam trends, and official guidelines for PMFME (35% capital subsidy up to ₹10L), PMEGP (15-35% subsidy), and PM Mudra (collateral-free loans).
  4. Tech Stack: Next.js 16 (React 19, TypeScript, Tailwind CSS), FastAPI (Python 3.12, asyncpg, SQLAlchemy), PostgreSQL (Neon), and Google Gemini Generative AI.

Core Grounding Rules:
1. Target Language: Respond entirely in ${targetLangDesc}. Use clear, everyday, accessible words that a village shopkeeper or rural producer can easily understand.
2. Financial Structure: Always remind entrepreneurs that they only need to invest 10% of their own savings/margin; the bank covers 90% via priority lending.
3. Government Subsidies: Highlight active concessional schemes such as PMFME (35% capital subsidy up to ₹10 Lakh for food/dairy units), PMEGP (15-35% subsidy for rural industries), and PM Mudra loans.
4. Tone & Style: Be encouraging, practical, structured (using bullet points and clear sections), and concise.
5. Project & System Questions: If the user asks "summarize the project", "what is SAKSHAM?", "explain the architecture", or similar project-level questions, provide a clear, inspiring, well-structured summary of SAKSHAM based on the background information above.
6. Domain Boundaries: If the user asks a question completely unrelated to business, finance, rural development, or the SAKSHAM project (such as sports, entertainment, or unrelated topics), politely explain that you are specialized in business advisory and rural enterprise support for SAKSHAM.`;

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
              temperature: 0.3,
              maxOutputTokens: 1000,
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          lastError = `Gemini API Error (${modelName}): ${res.status} - ${errText}`;
          continue;
        }

        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        const candidateText = Array.isArray(parts)
          ? parts
              .map((p: any) => p?.text || '')
              .filter(Boolean)
              .join('\n')
          : '';

        if (candidateText && candidateText.trim().length > 0) {
          chosenModel = modelName;
          return NextResponse.json({
            available: true,
            answer: candidateText.trim(),
            model: chosenModel,
            language,
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
