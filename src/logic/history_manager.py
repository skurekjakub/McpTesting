# history_manager.py

import traceback
from typing import List, Tuple, Optional

# --- Google Generative AI SDK Imports ---
from google import genai
from google.genai import types as genai_types

# --- Local Imports ---
# Assuming utils and config are accessible in the same parent directory level
import src.logic.utils as utils
import src.logic.config as config  # To get model names if needed, or pass them explicitly

# --- Constants ---
# Values moved from the main script
MAX_HISTORY_TOKENS = 10000
TARGET_SUMMARY_TOKENS = 2000
# Ensure this model is enabled for your API key.


# --- Helper Function for Token Counting ---
async def count_history_tokens(
    history: List[genai_types.Content],
    model_for_counting: genai_types.Model,  # Pass the model instance directly
) -> int:
    """Counts tokens in the conversation history using the provided Gemini model instance."""
    if not model_for_counting:
        utils.add_debug_log(
            "Warning: Token counting called without a valid model instance."
        )
        return 0

    try:
        if not history:
            return 0
        # count_tokens_async is a method of the GenerativeModel instance
        response = await model_for_counting.count_tokens_async(contents=history)
        utils.add_debug_log(
            f"Token count for history ({len(history)} messages): {response.total_tokens}"
        )
        return response.total_tokens
    except Exception as e:
        utils.add_debug_log(f"Error counting tokens: {e}")
        # Fallback: estimate based on characters (very rough)
        char_count = sum(
            part.text
            for content in history
            for part in content.parts
            if hasattr(part, "text") and part.text
        )
        estimated_tokens = char_count // 4  # Rough estimate
        utils.add_debug_log(
            f"Falling back to estimated token count: {estimated_tokens}"
        )
        return estimated_tokens


# --- Helper Function for Summarization ---
async def summarize_history(
    history: List[genai_types.Content],
    target_tokens: int,
    # Allow passing a specific client/model for summarization
    summarization_model: genai.Client,
) -> Optional[List[genai_types.Content]]:
    """Summarizes the history using the provided Gemini model instance."""
    if not summarization_model:
        utils.add_debug_log(
            "Error: Summarization attempted without a valid model instance."
        )
        return None

    utils.add_debug_log(
        f"Attempting to summarize history ({len(history)} messages) using model: {summarization_model.model_name}"
    )

    # Construct the summarization prompt
    history_text = "\n---\n".join(
        f"{content.role}: {part.text}"
        for content in history
        for part in content.parts
        if hasattr(part, "text") and part.text  # Ensure part.text exists
    )

    if not history_text.strip():
        utils.add_debug_log(
            "Warning: History text for summarization is empty. Skipping summarization."
        )
        return history  # Return original if nothing to summarize

    prompt = f"""Please summarize the following conversation history concisely. Focus on key topics, entities, decisions, user requests, and outcomes. Aim for a summary around {target_tokens} tokens or less. Preserve important context needed to understand the conversation's progression.

Conversation History:
--- START HISTORY ---
{history_text}
--- END HISTORY ---

Concise Summary:"""

    try:
        # Generate the summary
        response = await summarization_model.generate_content_async(
            contents=[prompt],
            generation_config=genai_types.GenerationConfig(
                temperature=0.5,  # Adjust as needed
                # Consider max_output_tokens close to target_tokens? Check API capabilities
                # max_output_tokens=target_tokens + 500 # Example buffer
            ),
        )

        if response and response.text:
            summary_text = response.text.strip()
            utils.add_debug_log(
                f"Summarization successful. Summary length: {len(summary_text)} chars."
            )

            # Create the summarized history representation
            summarized_history = [
                genai_types.Content(
                    parts=[
                        genai_types.Part(
                            text=f"The conversation history up to this point has been summarized to save space. Key points:\n{summary_text}"
                        )
                    ],
                    role="model",  # Use 'model' role to represent the summary insertion
                )
            ]
            # Optionally, count the tokens of the generated summary for verification
            try:
                summary_token_count = await count_history_tokens(
                    summarized_history, summarization_model
                )
                utils.add_debug_log(
                    f"Actual summary token count: {summary_token_count} (target was ~{target_tokens})"
                )
            except Exception as count_e:
                utils.add_debug_log(
                    f"Could not count tokens for the generated summary: {count_e}"
                )

            return summarized_history
        else:
            feedback = response.prompt_feedback if response else "N/A"
            utils.add_debug_log(
                f"Summarization failed: No text in response. Feedback: {feedback}"
            )
            # Consider safety ratings if available in response.candidates[0].safety_ratings
            if (
                response
                and response.candidates
                and response.candidates[0].finish_reason
                == genai_types.FinishReason.SAFETY
            ):
                utils.add_debug_log(
                    f"Summarization blocked by safety filter. Ratings: {response.candidates[0].safety_ratings}"
                )
            return None  # Indicate failure

    except Exception as e:
        error_trace = traceback.format_exc()
        utils.add_debug_log(
            f"Error during summarization API call with {summarization_model.model_name}: {e}\n{error_trace}"
        )
        return None  # Indicate failure


# --- Main Orchestration Function ---
async def manage_history_tokens(
    gemini_history: List[genai_types.Content],
    # Allow providing a separate instance for summarization, otherwise fallback to creating one
    main_model_instance: genai.Client,
    summarization_model_instance: Optional[genai.Client] = None # Add the missing parameter
) -> Tuple[List[genai_types.Content], bool, int]:
    """
    Checks history token count and triggers summarization if needed.

    Args:
        gemini_history: The current conversation history.
        main_model_instance: The initialized GenerativeModel instance for the main chat.
        summarization_model_instance: Optional initialized instance for summarization.

    Returns:
        A tuple containing:
        - The potentially summarized history.
        - A boolean indicating if summarization was performed.
        - The final token count of the returned history.
    """
    was_summarized = False
    final_history = gemini_history  # Start with the original history

    try:
        current_token_count = await count_history_tokens(
            gemini_history, main_model_instance
        )
        utils.add_debug_log(
            f"History token count check: {current_token_count}/{MAX_HISTORY_TOKENS}"
        )

        if current_token_count > MAX_HISTORY_TOKENS:
            utils.add_debug_log(
                f"Token count ({current_token_count}) exceeds limit ({MAX_HISTORY_TOKENS}). Triggering summarization."
            )

            # Get the summarization model instance
            summary_model_to_use = summarization_model_instance
            if not summary_model_to_use:
                try:
                    utils.add_debug_log(
                        f"Initializing dedicated summarization model: {config.SUMMARIZATION_MODEL_NAME}"
                    )
                    # Assumes genai is configured (API key) in the main script
                    summary_model_to_use = genai.GenerativeModel(
                        config.SUMMARIZATION_MODEL_NAME
                    )
                except Exception as model_init_e:
                    utils.add_debug_log(
                        f"Failed to initialize summarization model {config.SUMMARIZATION_MODEL_NAME}: {model_init_e}"
                    )
                    # Proceed without summarization if model can't be initialized
                    final_token_count = current_token_count  # Return original count
                    return final_history, was_summarized, final_token_count

            summarized_history_result = await summarize_history(
                gemini_history, TARGET_SUMMARY_TOKENS, summary_model_to_use
            )

            if summarized_history_result is not None:
                utils.add_debug_log("History successfully summarized.")
                final_history = summarized_history_result  # Update history
                was_summarized = True
                # Recalculate token count after summarization
                final_token_count = await count_history_tokens(
                    final_history, main_model_instance
                )
                utils.add_debug_log(
                    f"Token count after summarization: {final_token_count}"
                )
            else:
                utils.add_debug_log(
                    "Summarization failed. Proceeding with original (long) history."
                )
                # Optional: Implement fallback like truncation here if desired
                final_token_count = current_token_count  # Return original count
        else:
            # No summarization needed
            final_token_count = current_token_count

    except Exception as hist_mgmt_e:
        utils.add_debug_log(
            f"Error during history token management logic: {hist_mgmt_e}"
        )
        # Return original history and its count on error
        final_token_count = await count_history_tokens(
            gemini_history, main_model_instance
        )  # Recount just in case
        was_summarized = False  # Ensure flag is false on error
        final_history = gemini_history  # Ensure original history is returned

    return final_history, was_summarized, final_token_count
