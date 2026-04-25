# Live Suggestions App

## Backend API

Base URL: `http://localhost:8080`

All backend endpoints require the header:

- `X-Groq-Api-Key: <your-groq-api-key>`

---

### POST `/api/transcribe`

Accepts a multipart audio file and returns transcription text.

Content type: `multipart/form-data`

Form fields:

- `file` (required): audio file (`.wav`, `.mp3`, `.webm`, etc.)

Response:

```json
{
  "text": "transcribed text here"
}
```

Example:

```bash
curl -X POST "http://localhost:8080/api/transcribe" \
  -H "X-Groq-Api-Key: $GROQ_API_KEY" \
  -F "file=@sample.webm"
```

---

### POST `/api/suggestions`

Generates exactly 3 suggestions based on transcript context.

Content type: `application/json`

Request body:

```json
{
  "transcriptChunks": [
    "We should align on deliverables for next week.",
    "I can take the API integration tasks."
  ],
  "previousSuggestionBatches": [
    [
      "Can we define a timeline for this?",
      "I can help with QA once backend is ready.",
      "Let us prioritize must-haves first."
    ]
  ],
  "settings": {
    "tone": "professional",
    "brevity": "short"
  }
}
```

Response:

```json
{
  "suggestions": [
    "I can share a concrete milestone breakdown by EOD.",
    "Let us confirm owners for each deliverable now.",
    "Should we lock scope before assigning timelines?"
  ]
}
```

Example:

```bash
curl -X POST "http://localhost:8080/api/suggestions" \
  -H "Content-Type: application/json" \
  -H "X-Groq-Api-Key: $GROQ_API_KEY" \
  -d @suggestions-request.json
```

---

### POST `/api/chat`

Returns a contextual assistant answer for the chat panel.

Content type: `application/json`

Request body:

```json
{
  "userMessage": "How should I respond to confirm next steps?",
  "transcriptChunks": [
    "Let us finalize owners today.",
    "We can start implementation Monday."
  ],
  "chatHistory": [
    {
      "role": "user",
      "content": "Help me sound concise."
    },
    {
      "role": "assistant",
      "content": "Sure, I will keep responses short and clear."
    }
  ],
  "clickedSuggestion": "Let us confirm owners for each deliverable now.",
  "settings": {
    "tone": "friendly",
    "brevity": "short"
  }
}
```

Response:

```json
{
  "answer": "Sounds good. Let us confirm owners now and I will share the implementation timeline by Monday."
}
```

Example:

```bash
curl -X POST "http://localhost:8080/api/chat" \
  -H "Content-Type: application/json" \
  -H "X-Groq-Api-Key: $GROQ_API_KEY" \
  -d @chat-request.json
```

---

## Run Backend

From `backend`:

```bash
mvn spring-boot:run
```

Backend CORS is configured for Angular dev server origin: `http://localhost:4200`.
