import { Content } from '@google/generative-ai';
import {
  AnalysisOptions,
  ConversationAnalysisResult,
  IConversationAnalyzerStrategy,
  ConversationPattern,
} from '../types';
import logger from '../../../logger';
import { agentConfig } from '../../agent-config';
import { embeddingClient, cosineSimilarity } from '../../../llm/embeddings/embedding-client';
import { EmbeddingVector } from '@/server/llm/embeddings/types';
import { MessageUtils } from '../message-utils';

// --- Constants for Semantic Analysis ---
const SIMILARITY_THRESHOLD_TECHNICAL = 0.65; // Adjust as needed
const SIMILARITY_THRESHOLD_CODE = 0.75;      // Adjust as needed
const SIMILARITY_THRESHOLD_REFERENCE = 0.70; // Adjust as needed
const SIMILARITY_THRESHOLD_QUESTION = 0.60;  // Adjust as needed
const SIMILARITY_THRESHOLD_CASUAL = 0.70;    // Added - Adjust as needed
const SIMILARITY_THRESHOLD_ASSISTANT = 0.68; // Added - Adjust as needed

/**
 * Analyzes conversation history using embeddings to detect semantic characteristics.
 */
export class SemanticAnalyzerStrategy implements IConversationAnalyzerStrategy {
  private referenceEmbeddings: Record<string, EmbeddingVector> = {};

  constructor() {
    // Pre-compute reference embeddings upon initialization
    this.initializeReferenceEmbeddings();
  }

  private async initializeReferenceEmbeddings() {
    logger.debug(`${agentConfig.logging.historyManager} Initializing reference embeddings for Semantic Analyzer...`);
    // Define reference texts representing key concepts
    const referenceTexts = {
      technical: 'Software development, programming concepts, algorithms, data structures, API usage, technical errors, system design. Debugging stack traces, performance optimization, database schemas, network protocols, cloud infrastructure configuration, dependency management issues.',
      code: '```typescript\nfunction example(arg: string): void { console.log(arg); }\n```\nPython code snippet, Java class definition, SQL query, HTML structure. ```javascript\nconst x = 10;\n```\n```python\ndef greet(name):\n  print(f"Hello, {name}")\n```\nCSS selectors, JSON objects, YAML configuration.',
      reference: 'See the documentation at https://example.com, check the file /path/to/config.yaml, refer to the specification document. According to the Javadoc for `MyClass`. The relevant section in `CONTRIBUTING.md`. Look at the example on Stack Overflow: https://stackoverflow.com/q/12345. The error occurs in `src/utils/helper.js` line 42.',
      question: 'How do I implement this? What is the best approach? Can you explain this error? Why is this happening? What does this code do? Could you provide an example? Is there a better way to structure this? Where can I find more information?',
      casual: 'Hey, how\'s it going? Just chatting about the weather. What did you do this weekend? That sounds fun! LOL. See you later.', // Added
      assistant: 'How can I help you today? Is there anything else I can assist with? Please let me know if you have more questions. I can perform tasks like summarizing text or answering questions.', // Added
    };

    // Ensure all keys are included in the loop
    const keys = Object.keys(referenceTexts) as Array<keyof typeof referenceTexts>;
    for (const key of keys) {
      // Check if embedding already exists to avoid recomputing if possible (e.g., if called again after failure)
      if (!this.referenceEmbeddings[key]) {
        this.referenceEmbeddings[key] = await embeddingClient.embedText(referenceTexts[key]);
      }
    }
    logger.debug(`${agentConfig.logging.historyManager} Reference embeddings initialized.`);
  }

  async analyze(
    history: Content[],
    options?: AnalysisOptions
  ): Promise<Partial<ConversationAnalysisResult>> {
    logger.debug(`${agentConfig.logging.historyManager} Running Semantic Conversation Analyzer...`);

    // Ensure embeddings are initialized
    if (Object.keys(this.referenceEmbeddings).length < 6) { // Check for all expected keys now
        logger.warn(`${agentConfig.logging.historyManager} Reference embeddings might be incomplete. Attempting initialization...`);
        await this.initializeReferenceEmbeddings();
        if (Object.keys(this.referenceEmbeddings).length < 6) {
             logger.error(`${agentConfig.logging.historyManager} Failed to initialize reference embeddings. Aborting semantic analysis.`);
             return { recommendedOptimizations: { preserveCode: true, preserveReferences: true, trackOpenQuestions: true, reduceVerbosity: false } };
        }
    }

    const historyToAnalyze = options?.maxMessagesToAnalyze
      ? history.slice(-options.maxMessagesToAnalyze)
      : history;

    if (historyToAnalyze.length === 0) {
        return { recommendedOptimizations: undefined }; // Nothing to analyze
    }

    // Get embeddings for the relevant history messages
    const messageEmbeddings = await embeddingClient.embedMessages(historyToAnalyze);

    let technicalMessageCount = 0;
    let codeMessageCount = 0;
    let referenceMessageCount = 0;
    let questionMessageCount = 0;
    let casualMessageCount = 0; // Added
    let assistantMessageCount = 0; // Added
    let totalMessageLength = 0;

    for (let i = 0; i < historyToAnalyze.length; i++) {
      const message = historyToAnalyze[i];
      const embedding = messageEmbeddings[i];
      // Handle potential missing embeddings if embedMessages returned fewer than expected
      if (!embedding) {
          logger.warn(`${agentConfig.logging.historyManager} Missing embedding for message index ${i}. Skipping analysis for this message.`);
          continue;
      }
      const textContent = MessageUtils.getTextContent(message);
      totalMessageLength += textContent.length;

      // Compare message embedding with reference embeddings
      const techSimilarity = cosineSimilarity(embedding, this.referenceEmbeddings.technical);
      const codeSimilarity = cosineSimilarity(embedding, this.referenceEmbeddings.code);
      const refSimilarity = cosineSimilarity(embedding, this.referenceEmbeddings.reference);
      const questionSimilarity = cosineSimilarity(embedding, this.referenceEmbeddings.question);
      const casualSimilarity = cosineSimilarity(embedding, this.referenceEmbeddings.casual); // Added
      const assistantSimilarity = cosineSimilarity(embedding, this.referenceEmbeddings.assistant); // Added

      // Basic Regex checks can complement embedding analysis
      const hasCodeBlock = textContent.includes('```');
      const hasURL = /\bhttps?:\/\/\S+/gi.test(textContent);
      const hasPath = /(\/[^\/\s\n]+|[a-zA-Z]:\\[^\/\s\n]+)/g.test(textContent);

      if (techSimilarity > SIMILARITY_THRESHOLD_TECHNICAL) {
        technicalMessageCount++;
      }
      if (codeSimilarity > SIMILARITY_THRESHOLD_CODE || hasCodeBlock) {
        codeMessageCount++;
      }
      if (refSimilarity > SIMILARITY_THRESHOLD_REFERENCE || hasURL || hasPath) {
        referenceMessageCount++;
      }
      if (message.role === 'user' && questionSimilarity > SIMILARITY_THRESHOLD_QUESTION) {
        questionMessageCount++;
      }
      // Count casual messages (can be user or model)
      if (casualSimilarity > SIMILARITY_THRESHOLD_CASUAL) { // Added
        casualMessageCount++;
      }
      // Count assistant-like messages (typically model role)
      if (message.role === 'model' && assistantSimilarity > SIMILARITY_THRESHOLD_ASSISTANT) { // Added
        assistantMessageCount++;
      }
    }

    const numMessagesAnalyzed = historyToAnalyze.length;
    const hasTechnicalContent = numMessagesAnalyzed > 0 && technicalMessageCount / numMessagesAnalyzed > 0.2;
    const containsCodeSnippets = codeMessageCount > 0;
    const containsReferences = referenceMessageCount > 0;
    const hasOpenQuestions = questionMessageCount > 0;
    const isCasual = numMessagesAnalyzed > 0 && casualMessageCount / numMessagesAnalyzed > 0.3; // Example: > 30% casual messages
    const isAssistantLike = numMessagesAnalyzed > 0 && assistantMessageCount / numMessagesAnalyzed > 0.2; // Example: > 20% assistant messages
    const averageMessageLength = numMessagesAnalyzed > 0 ? totalMessageLength / numMessagesAnalyzed : 0;
    const isVerbose = averageMessageLength > 500;

    // Determine a simple pattern based on counts
    let pattern = ConversationPattern.GENERAL_CHAT;
    if (containsCodeSnippets && hasTechnicalContent) { // Require both for code dev pattern
        pattern = ConversationPattern.CODE_DEVELOPMENT;
    } else if (hasOpenQuestions && questionMessageCount / numMessagesAnalyzed > 0.25) {
        pattern = ConversationPattern.QUESTION_ANSWERING;
    } else if (containsReferences && hasTechnicalContent) { // Require both for research pattern
        pattern = ConversationPattern.RESEARCH_FOCUSED;
    } else if (hasTechnicalContent) {
        pattern = ConversationPattern.TASK_BASED;
    } else if (isCasual) { // Added pattern check
        pattern = ConversationPattern.CASUAL_CONVERSATION;
    }

    const result: Partial<ConversationAnalysisResult> = {
      hasTechnicalContent: hasTechnicalContent,
      codeBlockCount: codeMessageCount,
      containsCodeSnippets: containsCodeSnippets,
      urlCount: -1, // Not directly counted via embeddings
      filePathCount: -1, // Not directly counted via embeddings
      containsReferences: containsReferences,
      openQuestionCount: questionMessageCount,
      hasOpenQuestions: hasOpenQuestions,
      averageMessageLength: averageMessageLength,
      isVerbose: isVerbose,
      isCasual: isCasual, // Added
      isAssistantLike: isAssistantLike, // Added
      conversationPattern: pattern,
      recommendedOptimizations: {
        preserveCode: containsCodeSnippets || hasTechnicalContent,
        preserveReferences: containsReferences,
        trackOpenQuestions: hasOpenQuestions,
        reduceVerbosity: isVerbose && pattern !== ConversationPattern.CODE_DEVELOPMENT && !isCasual,
        summarizationAggressiveness: isCasual ? 'high' : 'normal', // Set aggressiveness based on casual flag
      },
      rawAnalysis: `Semantic Analysis: Tech=${technicalMessageCount}, Code=${codeMessageCount}, Ref=${referenceMessageCount}, Qst=${questionMessageCount}, Casual=${casualMessageCount}, Assist=${assistantMessageCount}, Pattern=${pattern}, Verbose=${isVerbose}`,
    }; // Fixed potential syntax error here

    logger.debug(`${agentConfig.logging.historyManager} Semantic Analysis Result: ${JSON.stringify(result.recommendedOptimizations)}`);
    return result;
  }
}