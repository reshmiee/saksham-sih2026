// tests/aiKnowledgeBase.test.ts
import { describe, it, expect } from 'vitest';
import {
  validateAIResponseCompleteness,
  extractKeyPointsFromAnswer,
  analyzeQuery,
  querySakshamAI,
} from '@/lib/aiKnowledgeBase';

describe('AI Knowledge Base & Response Completeness', () => {
  describe('validateAIResponseCompleteness', () => {
    it('rejects empty or whitespace-only answers', () => {
      expect(validateAIResponseCompleteness('').isValid).toBe(false);
      expect(validateAIResponseCompleteness('   ').isValid).toBe(false);
    });

    it('rejects answers that end with an unclosed opening bracket or parenthesis', () => {
      const truncated1 = 'Here is how SAKSHAM calculates viability (';
      const truncated2 = 'The top categories in Mathura include [';
      expect(validateAIResponseCompleteness(truncated1).isValid).toBe(false);
      expect(validateAIResponseCompleteness(truncated2).isValid).toBe(false);
    });

    it('rejects answers with unclosed markdown bold formatting', () => {
      const unclosedBold = 'We recommend **Dairy Processing and Kirana shops.';
      expect(validateAIResponseCompleteness(unclosedBold).isValid).toBe(false);
    });

    it('rejects answers ending with dangling connector words', () => {
      const dangling = 'The key government schemes for micro-enterprises include such as';
      expect(validateAIResponseCompleteness(dangling).isValid).toBe(false);
    });

    it('rejects cut-off answers without terminal punctuation', () => {
      const cutOff = 'Rural micro-entrepreneurs in Mathura require priority sector lending to expand their';
      expect(validateAIResponseCompleteness(cutOff).isValid).toBe(false);
    });

    it('accepts complete answers with proper terminal punctuation', () => {
      const completeAnswer =
        'Here is the complete analysis for starting a dairy unit in Mathura.\n\n• Capital required: ₹3.5 Lakhs.\n• Bank loan covers 90% priority credit.\n• PMFME subsidy provides 35% cash grant.';
      expect(validateAIResponseCompleteness(completeAnswer).isValid).toBe(true);
    });
  });

  describe('extractKeyPointsFromAnswer', () => {
    it('extracts substantive bullet points without boilerplate', () => {
      const answer = `
Here is the summary of the scheme:
• PMFME gives 35% capital subsidy up to ₹10 Lakhs.
• Borrower needs 10% own equity margin.
• Powered by SAKSHAM AI (Gemini 3.6 flash)
• Bank covers 90% priority loan.
`;
      const points = extractKeyPointsFromAnswer(answer);
      expect(points).toContain('PMFME gives 35% capital subsidy up to ₹10 Lakhs.');
      expect(points).toContain('Borrower needs 10% own equity margin.');
      expect(points).toContain('Bank covers 90% priority loan.');
      expect(points.some((p) => p.toLowerCase().includes('powered by'))).toBe(false);
    });

    it('extracts bold headers when bullet points are missing', () => {
      const answer = `
**Dairy Chilling Unit**: Best suited for Mathura milk corridor with 22-32% gross margins.
**Modern Kirana Store**: High daily cash flow serving village households.
`;
      const points = extractKeyPointsFromAnswer(answer);
      expect(points.length).toBeGreaterThanOrEqual(1);
      expect(points.some((p) => p.toLowerCase().includes('dairy chilling unit'))).toBe(true);
    });
  });

  describe('analyzeQuery', () => {
    it('detects location, capital, categories, and schemes in complex multi-intent query', () => {
      const query =
        'What is best categories to open a business in Jait Mathura with capital of 2 lakhs also list the schemes provided by the government related to it';
      const analysis = analyzeQuery(query);

      expect(analysis.isJait).toBe(true);
      expect(analysis.isMathura).toBe(true);
      expect(analysis.hasCapital).toBe(true);
      expect(analysis.capitalAmount).toMatch(/2\s*lakhs?/i);
      expect(analysis.hasCategoryRequest).toBe(true);
      expect(analysis.hasSchemeRequest).toBe(true);
    });

    it('detects competitor queries', () => {
      const query = 'Why does market summary show Competitors 0 OSM Mapped?';
      const analysis = analyzeQuery(query);
      expect(analysis.hasCompetitorRequest).toBe(true);
    });

    it('detects scheme comparison queries', () => {
      const query = 'Compare PMFME and PMEGP schemes';
      const analysis = analyzeQuery(query);
      expect(analysis.hasComparisonRequest).toBe(true);
      expect(analysis.hasSchemeRequest).toBe(true);
    });
  });

  describe('querySakshamAI Fallback Engine', () => {
    it('resolves multi-intent Jait Mathura query with grounded data and 2L capital leverage', async () => {
      const result = await querySakshamAI(
        'What is best categories to open a business in Jait Mathura with capital of 2 lakhs also list the schemes provided by the government related to it'
      );

      expect(result.is_valid).toBe(true);
      expect(result.grounding_status).toBe('fully_grounded');
      expect(result.answer).toContain('1,528 households');
      expect(result.answer).toContain('9,287 residents');
      expect(result.answer).toContain('₹20 Lakh total project cost');
      expect(result.answer).toContain('Dairy Value-Addition & Milk Chilling Unit');
      expect(result.answer).toContain('Modern Kirana');
      expect(result.answer).toContain('PMFME');
      expect(result.answer).toContain('PMEGP');
      expect(result.answer).toContain('PM Mudra');
      expect(result.citations.some((c) => c.document_id === 'census_2011_and_odop')).toBe(true);
      expect(result.citations.some((c) => c.document_id === 'mathura_district_industrial_profile')).toBe(true);
    });
  });
});
