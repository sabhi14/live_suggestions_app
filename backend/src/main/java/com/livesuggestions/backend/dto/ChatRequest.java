package com.livesuggestions.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

public record ChatRequest(
        @NotBlank String userMessage,
        @NotNull List<String> transcriptChunks,
        @NotNull List<Map<String, String>> chatHistory,
        String clickedSuggestion,
        @NotNull Map<String, Object> settings
) {
}
