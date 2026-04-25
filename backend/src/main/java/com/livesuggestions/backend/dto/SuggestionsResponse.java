package com.livesuggestions.backend.dto;

import jakarta.validation.constraints.Size;

import java.util.List;

public record SuggestionsResponse(
        @Size(min = 3, max = 3) List<String> suggestions
) {
}
