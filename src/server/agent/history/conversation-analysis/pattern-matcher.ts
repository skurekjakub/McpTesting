// src/server/agent/history/pattern-matcher.ts
import { 
  ConversationAnalysisResult, 
  ConversationPattern, 
  PatternCharacteristics 
} from './types';

/**
 * Analyzes conversation patterns based on pre-defined characteristics 
 * and adjusts optimization recommendations.
 */
export class PatternMatcher {
  // Pattern definitions used for pattern matching
  private static readonly PATTERN_DEFINITIONS: Record<ConversationPattern, PatternCharacteristics> = {
    [ConversationPattern.GENERAL_CHAT]: {
      hasTechnicalContent: false,
      codeBlockThreshold: 0,
      questionThreshold: 0,
      referenceThreshold: 0,
      patternDescription: 'General conversational chat'
    },
    [ConversationPattern.CODE_DEVELOPMENT]: {
      hasTechnicalContent: true,
      codeBlockThreshold: 2,
      questionThreshold: 0,
      referenceThreshold: 0,
      patternDescription: 'Code development with multiple code blocks'
    },
    [ConversationPattern.DEBUGGING_SESSION]: {
      hasTechnicalContent: true,
      codeBlockThreshold: 1,
      questionThreshold: 1,
      referenceThreshold: 0,
      patternDescription: 'Debugging session with code and questions'
    },
    [ConversationPattern.RESEARCH_FOCUSED]: {
      hasTechnicalContent: true,
      codeBlockThreshold: 0,
      questionThreshold: 0,
      referenceThreshold: 2,
      patternDescription: 'Research with multiple references or citations'
    },
    [ConversationPattern.QUESTION_ANSWERING]: {
      hasTechnicalContent: false,
      codeBlockThreshold: 0,
      questionThreshold: 2,
      referenceThreshold: 0,
      patternDescription: 'Question-answering session'
    },
    [ConversationPattern.TASK_BASED]: {
      hasTechnicalContent: true,
      codeBlockThreshold: 1,
      questionThreshold: 0,
      referenceThreshold: 1,
      patternDescription: 'Task-based interaction with code and references'
    },
    [ConversationPattern.EXPLORATION]: {
      hasTechnicalContent: true,
      codeBlockThreshold: 0,
      questionThreshold: 3,
      referenceThreshold: 0,
      patternDescription: 'Exploratory conversation with multiple questions'
    }
  };

  /**
   * Identifies the conversation pattern based on analysis metrics.
   * 
   * @param analysis The result of previous analysis steps.
   * @returns The identified ConversationPattern.
   */
  identifyConversationPattern(analysis: Partial<ConversationAnalysisResult>): ConversationPattern {
    // Simple pattern scoring - can be expanded with more sophisticated algorithms
    const scores = new Map<ConversationPattern, number>();
    
    // Calculate scores for each pattern
    for (const [pattern, characteristics] of Object.entries(PatternMatcher.PATTERN_DEFINITIONS)) {
      let score = 0;
      
      // Technical content match
      if (analysis.hasTechnicalContent === characteristics.hasTechnicalContent) {
        score += 1;
      }
      
      // Code blocks threshold
      if ((analysis.codeBlockCount ?? 0) >= characteristics.codeBlockThreshold) {
        score += 2;
      }
      
      // Question threshold
      if ((analysis.openQuestionCount ?? 0) >= characteristics.questionThreshold) {
        score += 1;
      }
      
      // Reference threshold
      const referenceCount = (analysis.urlCount ?? 0) + (analysis.filePathCount ?? 0);
      if (referenceCount >= characteristics.referenceThreshold) {
        score += 1;
      }
      
      // Store pattern score
      scores.set(pattern as ConversationPattern, score);
    }
    
    // Select the pattern with the highest score
    let highestScore = -1;
    let bestPattern = ConversationPattern.GENERAL_CHAT;
    
    scores.forEach((score, pattern) => {
      if (score > highestScore) {
        highestScore = score;
        bestPattern = pattern;
      }
    });
    
    return bestPattern;
  }
  
  /**
   * Adjusts optimization recommendations based on the identified conversation pattern.
   * Modifies the `recommendedOptimizations` property of the provided analysis result object.
   * 
   * @param result The conversation analysis result object (will be modified).
   */
  adjustRecommendationsBasedOnPattern(result: ConversationAnalysisResult): void {
    const patternDefinition = PatternMatcher.PATTERN_DEFINITIONS[result.conversationPattern];
    const optimizations = result.recommendedOptimizations;
    
    if (!patternDefinition || !optimizations) return; // Safety check

    switch (result.conversationPattern) {
      case ConversationPattern.CODE_DEVELOPMENT:
        // Always preserve code for code development
        optimizations.preserveCode = true;
        break;
        
      case ConversationPattern.DEBUGGING_SESSION:
        // Always preserve code and questions for debugging
        optimizations.preserveCode = true;
        optimizations.trackOpenQuestions = true;
        break;
        
      case ConversationPattern.RESEARCH_FOCUSED:
        // Always preserve references for research
        optimizations.preserveReferences = true;
        break;
        
      case ConversationPattern.QUESTION_ANSWERING:
        // Always track open questions for Q&A sessions
        optimizations.trackOpenQuestions = true;
        break;
        
      case ConversationPattern.EXPLORATION:
        // Track questions but allow verbosity reduction for exploratory conversations
        optimizations.trackOpenQuestions = true;
        optimizations.reduceVerbosity = result.isVerbose;
        break;
        
      // No special adjustments for GENERAL_CHAT or TASK_BASED
    }
  }

  /**
   * Gets a description of the identified conversation pattern.
   * 
   * @param pattern The ConversationPattern enum value.
   * @returns A human-readable description of the pattern.
   */
  getPatternDescription(pattern: ConversationPattern): string {
    return PatternMatcher.PATTERN_DEFINITIONS[pattern]?.patternDescription || 
      'Unknown conversation pattern';
  }
}
