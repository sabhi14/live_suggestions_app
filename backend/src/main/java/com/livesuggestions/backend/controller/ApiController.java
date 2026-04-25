package com.livesuggestions.backend.controller;

import com.livesuggestions.backend.dto.ChatRequest;
import com.livesuggestions.backend.dto.ChatResponse;
import com.livesuggestions.backend.dto.SuggestionsRequest;
import com.livesuggestions.backend.dto.SuggestionsResponse;
import com.livesuggestions.backend.dto.TranscriptionResponse;
import com.livesuggestions.backend.exception.ApiException;
import com.livesuggestions.backend.service.GroqClient;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api")
public class ApiController {

    private final GroqClient groqClient;

    public ApiController(GroqClient groqClient) {
        this.groqClient = groqClient;
    }

    @PostMapping("/transcribe")
    public TranscriptionResponse transcribe(
            @RequestParam("file") MultipartFile file,
            @RequestHeader("X-Groq-Api-Key") String groqApiKey
    ) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Audio file is required");
        }
        String text = groqClient.transcribe(file, groqApiKey);
        return new TranscriptionResponse(text);
    }

    @PostMapping("/suggestions")
    public SuggestionsResponse suggestions(
            @Valid @RequestBody SuggestionsRequest request,
            @RequestHeader("X-Groq-Api-Key") String groqApiKey
    ) {
        List<String> suggestions = groqClient.generateSuggestions(request, groqApiKey);
        return new SuggestionsResponse(suggestions);
    }

    @PostMapping("/chat")
    public ChatResponse chat(
            @Valid @RequestBody ChatRequest request,
            @RequestHeader("X-Groq-Api-Key") String groqApiKey
    ) {
        String answer = groqClient.chat(request, groqApiKey);
        return new ChatResponse(answer);
    }
}
