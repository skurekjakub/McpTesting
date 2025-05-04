// src/server/agent/history/llm-analyzer-strategy.ts
import { Content } from '@google/generative-ai';
import { getGeminiClient } from '../../llm/gemini/client';
import { extractTextFromResult } from '../../llm/gemini/parsing';
import logger from '../../logger';
import { MessageUtils } from './message-utils';
import { 
  AnalysisOptions, 
  ConversationAnalysisResult, 
  IConversationAnalyzerStrategy 
} from './types';

/**
 * Implements conversation analysis using an LLM for deeper semantic understanding.
 * This provides deeper insight but is more expensive.
 */
export class LLMAnalyzerStrategy implements IConversationAnalyzerStrategy {
  async analyze(
    history: Content[], 
    options?: AnalysisOptions
  ): Promise<Partial<ConversationAnalysisResult>> {
    const maxMessages = options?.maxMessagesToAnalyze ?? 10;
    const temperature = options?.analysisTemperature ?? 0.1;

    // Limit to recent messages for analysis
    const recentHistory = history.slice(-maxMessages);
    
    // Prepare conversation digest for the LLM
    const conversationDigest = recentHistory.map(msg => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text = MessageUtils.getTextContent(msg);
      
      // Truncate very long messages for the digest
      const truncatedText = text.length > 500 
        ? `${text.substring(0, 500)}... [truncated, ${text.length} chars total]` 
        : text;
        
      return `${role}: ${truncatedText}`;
    }).join('\n\n');
    
    // Create analysis prompt
    const analysisPrompt = `
Analyze the following conversation and provide a structured assessment of its characteristics.
Focus on extracting these key attributes:

1. TECHNICAL CONTENT: Does the conversation contain technical discussions, code snippets, or programming concepts?
2. CODE BLOCKS: How many code blocks are present and what languages are used?
3. REFERENCES: Identify URLs, file paths, citations, or other references that should be preserved in context.
4. QUESTIONS: Identify open questions from the user that haven't been fully addressed yet.
5. VERBOSITY: Is the conversation particularly verbose or concise? Estimate average message length.
6. TOPICS: What are the primary and secondary topics of discussion?

Respond in JSON format with these fields:
{
  "hasTechnicalContent": boolean,
  "codeBlockCount": number,
  "containsCodeSnippets": boolean,
  "urlCount": number,
  "filePathCount": number,
  "containsReferences": boolean,
  "openQuestionCount": number,
  "answeredQuestionCount": number,
  "hasOpenQuestions": boolean,
  "averageMessageLength": number,
  "isVerbose": boolean,
  "primaryTopic": "string",
  "secondaryTopics": ["string", "string"]
}

CONVERSATION:
${conversationDigest}
`;

    try {
      // Get LLM client
      const client = getGeminiClient();
      const model = client.getGenerativeModel({ 
        model: "gemini-1.0-pro", // Consider making this configurable
        generationConfig: { temperature } 
      });
      
      // Call the LLM
      const result = await model.generateContent({ 
        contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }]
      });
      
      // Extract the JSON response
      const rawResponse = extractTextFromResult(result);
      
      // Parse the JSON
      try {
        // Extract just the JSON part, in case there's additional text
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse;
        const analysis = JSON.parse(jsonStr);
        
        return { ...analysis, rawAnalysis: rawResponse }; // Include raw response
      } catch (parseError) {
        logger.error(`LLMAnalyzerStrategy: Failed to parse LLM response as JSON: ${parseError}`);
        return { rawAnalysis: rawResponse }; // Return raw response even if parsing fails
      }
    } catch (error) {
      logger.error(`LLMAnalyzerStrategy: LLM analysis error: ${error}`);
      // Don't throw, return an empty object or minimal info
      return { rawAnalysis: `LLM analysis failed: ${error}` }; 
    }
  }
}
