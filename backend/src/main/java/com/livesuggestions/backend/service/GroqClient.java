package com.livesuggestions.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.livesuggestions.backend.dto.ChatRequest;
import com.livesuggestions.backend.dto.SuggestionsRequest;
import com.livesuggestions.backend.exception.ApiException;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class GroqClient {

    private static final String TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
    private static final String CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
    private static final String TRANSCRIBE_MODEL = "whisper-large-v3";
    private static final String CHAT_MODEL = "openai/gpt-oss-120b";

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public GroqClient(ObjectMapper objectMapper) {
        this.restTemplate = new RestTemplate();
        this.objectMapper = objectMapper;
    }

    public String transcribe(MultipartFile file, String groqApiKey) {
        try {
            HttpHeaders headers = authHeaders(groqApiKey);
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("model", TRANSCRIBE_MODEL);
            body.add("file", new NamedByteArrayResource(file.getBytes(), file.getOriginalFilename()));

            HttpEntity<MultiValueMap<String, Object>> entity = new HttpEntity<>(body, headers);
            ResponseEntity<Map> response = restTemplate.exchange(
                    TRANSCRIBE_URL,
                    HttpMethod.POST,
                    entity,
                    Map.class
            );

            Object text = response.getBody() != null ? response.getBody().get("text") : null;
            if (text == null) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq transcription response missing text");
            }
            return text.toString();
        } catch (IOException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Unable to read uploaded audio file");
        } catch (HttpStatusCodeException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq transcription request failed: " + e.getResponseBodyAsString());
        } catch (Exception e) {
            if (e instanceof ApiException) {
                throw (ApiException) e;
            }
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected transcription error");
        }
    }

    public List<String> generateSuggestions(SuggestionsRequest request, String groqApiKey) {
        String prompt = buildSuggestionsPrompt(request);
        String content = callChatCompletion(prompt, groqApiKey);

        try {
            return parseSuggestions(content);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Model returned invalid JSON for suggestions");
        }
    }

    public String chat(ChatRequest request, String groqApiKey) {
        String prompt = buildChatPrompt(request);
        return callChatCompletion(prompt, groqApiKey);
    }

    private String callChatCompletion(String userPrompt, String groqApiKey) {
        try {
            HttpHeaders headers = authHeaders(groqApiKey);
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("model", CHAT_MODEL);
            payload.put("temperature", 0.3);

            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of(
                    "role", "system",
                    "content", "You are a concise assistant. Follow output format instructions exactly."
            ));
            messages.add(Map.of(
                    "role", "user",
                    "content", userPrompt
            ));
            payload.put("messages", messages);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<Map> response = restTemplate.exchange(CHAT_URL, HttpMethod.POST, entity, Map.class);
            return extractContent(response.getBody());
        } catch (HttpStatusCodeException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq chat request failed: " + e.getResponseBodyAsString());
        } catch (Exception e) {
            if (e instanceof ApiException) {
                throw (ApiException) e;
            }
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected chat error");
        }
    }

    private String buildSuggestionsPrompt(SuggestionsRequest request) {
        return """
                Generate exactly 3 short next-sentence suggestions for a live conversation assistant.
                Return ONLY valid JSON in one of these forms:
                - ["...", "...", "..."]
                - {"suggestions":["...", "...", "..."]}
                No markdown, no explanation.

                transcriptChunks:
                %s

                previousSuggestionBatches:
                %s

                settings:
                %s
                """.formatted(request.transcriptChunks(), request.previousSuggestionBatches(), request.settings());
    }

    private List<String> parseSuggestions(String content) throws IOException {
        List<String> suggestions = null;

        if (content.trim().startsWith("[")) {
            suggestions = objectMapper.readValue(content, new TypeReference<>() {
            });
        } else if (content.trim().startsWith("{")) {
            Map<String, Object> payload = objectMapper.readValue(content, new TypeReference<>() {
            });
            Object rawSuggestions = payload.get("suggestions");
            if (rawSuggestions instanceof List<?> list) {
                suggestions = list.stream().map(String::valueOf).toList();
            }
        }

        if (suggestions == null) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Model returned null suggestions payload");
        }
        if (suggestions.size() != 3) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Model did not return exactly 3 suggestions");
        }
        return suggestions;
    }

    private String buildChatPrompt(ChatRequest request) {
        String clickedSuggestion = request.clickedSuggestion() == null ? "" : request.clickedSuggestion();

        return """
                Respond to the user using the conversation context below. Keep answer clear and concise.

                userMessage:
                %s

                transcriptChunks:
                %s

                chatHistory:
                %s

                clickedSuggestion:
                %s

                settings:
                %s
                """.formatted(
                request.userMessage(),
                request.transcriptChunks(),
                request.chatHistory(),
                clickedSuggestion,
                request.settings()
        );
    }

    private String extractContent(Map<?, ?> responseBody) {
        if (responseBody == null || !responseBody.containsKey("choices")) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq response missing choices");
        }

        List<?> choices = (List<?>) responseBody.get("choices");
        if (choices == null) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq response choices is null");
        }
        if (choices.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq response has no choices");
        }

        Object first = choices.get(0);
        if (!(first instanceof Map<?, ?> firstChoice) || !(firstChoice.get("message") instanceof Map<?, ?> message)) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq response missing message content");
        }

        Object content = message.get("content");
        if (content == null) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Groq response content is empty");
        }

        return content.toString().trim();
    }

    private HttpHeaders authHeaders(String groqApiKey) {
        if (groqApiKey == null || groqApiKey.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "X-Groq-Api-Key header is required");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(groqApiKey.trim());
        return headers;
    }

    private static final class NamedByteArrayResource extends ByteArrayResource {
        private final String filename;

        private NamedByteArrayResource(byte[] byteArray, String filename) {
            super(byteArray);
            this.filename = filename == null || filename.isBlank() ? "audio.webm" : filename;
        }

        @Override
        public String getFilename() {
            return filename;
        }
    }
}
