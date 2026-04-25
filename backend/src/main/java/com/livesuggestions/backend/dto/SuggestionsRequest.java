package com.livesuggestions.backend.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

public record SuggestionsRequest(
        @NotNull List<String> transcriptChunks,
        @NotNull List<List<String>> previousSuggestionBatches,
        @NotNull Map<String, Object> settings
) {
}
