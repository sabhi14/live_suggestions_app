# Live Suggestions App — Flow Diagrams

How the project works end-to-end and how it fulfills the assignment requirements.

---

## 1. High-Level Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser (Angular SPA)"]
        UI["App Component<br/>3-column UI"]
        Store["LiveSuggestionsStore<br/>(Signals + localStorage)"]
        Mic["MediaRecorder<br/>audio chunks"]
        UI <--> Store
        Store --> Mic
    end

    subgraph Backend["Spring Boot API (port 8080)"]
        API["ApiController<br/>/api/*"]
        GroqSvc["GroqClient<br/>prompts + parsing"]
        API --> GroqSvc
    end

    subgraph Groq["Groq Cloud"]
        Whisper["whisper-large-v3<br/>speech-to-text"]
        GPT["gpt-oss-120b<br/>chat completions"]
    end

    Mic -->|"audio blob"| Store
    Store -->|"HTTP + X-Groq-Api-Key"| API
    GroqSvc --> Whisper
    GroqSvc --> GPT
    Store <-->|"settings persist"| LS[("localStorage")]
```

**Key design choices**

| Layer | Responsibility |
|-------|----------------|
| **Angular UI** | Transcript, suggestions, and chat columns; settings modal |
| **LiveSuggestionsStore** | All business logic: recording, API calls, state, export |
| **Spring Boot** | Stateless proxy — no database, no server-side sessions |
| **Groq** | ASR (Whisper) and LLM (GPT) via OpenAI-compatible APIs |

---

## 2. Assignment Requirements Map

```mermaid
flowchart LR
    subgraph Assignment["Assignment Requirements"]
        R1["Capture mic audio"]
        R2["Chunked transcription"]
        R3["Live suggestions (×3)"]
        R4["Contextual chat"]
        R5["Editable prompts"]
        R6["Context windows"]
        R7["localStorage settings"]
        R8["Session JSON export"]
    end

    subgraph Implementation["Implementation"]
        I1["MediaRecorder + getUserMedia"]
        I2["POST /api/transcribe → Whisper"]
        I3["POST /api/suggestions → GPT"]
        I4["POST /api/chat → GPT"]
        I5["AppSettings prompts in store"]
        I6["Filter transcript by minutes"]
        I7["liveSuggestionsSettings key"]
        I8["exportSession() → twinmind-session-*.json"]
    end

    R1 --> I1
    R2 --> I2
    R3 --> I3
    R4 --> I4
    R5 --> I5
    R6 --> I6
    R7 --> I7
    R8 --> I8
```

---

## 3. Main User Flow (End-to-End)

```mermaid
flowchart TD
    Start([User opens app]) --> LoadSettings[Load settings from localStorage]
    LoadSettings --> EnterKey{Groq API key set?}
    EnterKey -->|No| Settings[Open Settings → paste key → Done]
    Settings --> EnterKey
    EnterKey -->|Yes| StartMic[Click Start Mic]

    StartMic --> Permission[getUserMedia audio permission]
    Permission --> Record[MediaRecorder starts]
    Record --> ChunkLoop{Every N seconds<br/>default 30s}

    ChunkLoop --> StopRestart[Stop recorder → flush blob → restart]
    StopRestart --> Transcribe[POST /api/transcribe]
    Transcribe --> AppendTranscript[Append TranscriptChunk with timestamp]
    AppendTranscript --> AutoSuggest[Auto-trigger generateSuggestions]
    ChunkLoop -->|User clicks Stop| StopMic[Stop recording]

    AutoSuggest --> FilterCtx[Filter transcript by<br/>live context window 5 min]
    FilterCtx --> SuggestAPI[POST /api/suggestions]
    SuggestAPI --> Parse3[Parse exactly 3 suggestions]
    Parse3 --> RenderCards[Render SuggestionBatch in UI]

    RenderCards --> UserAction{User action}
    UserAction -->|Refresh| AutoSuggest
    UserAction -->|Click suggestion| ChatFlow
    UserAction -->|Type chat message| ChatFlow
    UserAction -->|Export JSON| Export[Download twinmind-session-*.json]
    UserAction -->|Keep recording| ChunkLoop

    ChatFlow[POST /api/chat with transcript + history]
    ChatFlow --> ShowReply[Append assistant ChatMessage]
    ShowReply --> UserAction
```

---

## 4. Recording & Transcription Pipeline

```mermaid
sequenceDiagram
    participant User
    participant Store as LiveSuggestionsStore
    participant MR as MediaRecorder
    participant API as Spring Boot /api/transcribe
    participant Groq as Groq Whisper

    User->>Store: startRecording()
    Store->>MR: getUserMedia + start()
    loop Every audioChunkSeconds (default 30s)
        Store->>MR: stop() → ondataavailable(blob)
        Store->>MR: start() again
        Store->>API: POST multipart audio file<br/>Header: X-Groq-Api-Key
        API->>Groq: whisper-large-v3 transcription
        Groq-->>API: text
        API-->>Store: { text }
        Store->>Store: transcriptChunks.push(chunk)
        Store->>Store: generateSuggestions() [auto]
    end
    User->>Store: stopRecording()
    Store->>MR: stop + release stream
```

---

## 5. Live Suggestions Flow

```mermaid
sequenceDiagram
    participant Store as LiveSuggestionsStore
    participant API as Spring Boot /api/suggestions
    participant Groq as GroqClient
    participant LLM as gpt-oss-120b
    participant UI as Suggestions Column

    Note over Store: Triggered after each transcription<br/>or manual Refresh click

    Store->>Store: Filter chunks by liveSuggestionContextWindowMinutes
    Store->>API: POST { transcriptChunks, previousSuggestionBatches, settings }
    API->>Groq: buildSuggestionsPrompt()
    Groq->>LLM: chat completion (temp 0.3)
    LLM-->>Groq: JSON with 3 strings
    Groq->>Groq: parseSuggestions() — enforce exactly 3
    Groq-->>API: List<String> (size 3)
    API-->>Store: { suggestions: [...] }
    Store->>Store: Create SuggestionBatch (3 SuggestionCards)
    Store->>UI: Render newest batch first
```

**Suggestion variety (prompt strategy)**

| # | Intent |
|---|--------|
| 1 | Answer / fact / explanation |
| 2 | Follow-up question / talking point |
| 3 | Clarification / risk / fact-check |

---

## 6. Chat & Detailed Answer Flow

```mermaid
sequenceDiagram
    participant User
    participant Store as LiveSuggestionsStore
    participant API as Spring Boot /api/chat
    participant Groq as GroqClient
    participant LLM as gpt-oss-120b

    alt User clicks a suggestion card
        User->>Store: onSuggestionClick(card)
        Store->>Store: Add user message (suggestion text)
        Store->>API: POST { clickedSuggestion, transcriptChunks, chatHistory, settings }
    else User types in chat input
        User->>Store: sendChatMessage()
        Store->>Store: Add user message
        Store->>API: POST { userMessage, transcriptChunks, chatHistory, settings }
    end

    API->>Groq: buildChatPrompt() with chat context window (default 15 min)
    Groq->>LLM: chat completion
    LLM-->>Groq: answer text
    Groq-->>API: answer
    API-->>Store: { answer }
    Store->>Store: Append assistant ChatMessage
    Store->>User: Display in chat column
```

---

## 7. Session Export Flow

```mermaid
flowchart LR
    ExportBtn[Export JSON button] --> Build[Build export object]
    Build --> Strip[Strip groqApiKey from settings]
    Strip --> Include[Include sessionId, startedAt, exportedAt]
    Include --> Data[transcriptChunks + suggestionBatches + chatHistory]
    Data --> Download["Download twinmind-session-YYYY-MM-DD-HH-mm.json"]
```

---

## 8. Frontend State Model

```mermaid
flowchart TB
    subgraph Store["LiveSuggestionsStore (Angular Signals)"]
        direction TB
        Rec["isRecording, recordingStatus"]
        Trans["transcriptChunks[]"]
        Sug["suggestionBatches[]"]
        Chat["chatMessages[]"]
        Set["settings (prompts, windows, chunk size, API key)"]
        Flags["isTranscribing, isRefreshingSuggestions, isSendingChat"]
        Err["errorMessage"]
    end

    subgraph UI["3-Column App UI"]
        Col1["Transcript column"]
        Col2["Suggestions column"]
        Col3["Chat column"]
        Modal["Settings modal"]
    end

    Trans --> Col1
    Sug --> Col2
    Chat --> Col3
    Set --> Modal
    Rec --> Col1
```

---

## 9. Backend API Surface

```mermaid
flowchart LR
    subgraph Endpoints["POST /api/*"]
        T["/transcribe<br/>multipart file → { text }"]
        S["/suggestions<br/>JSON body → { suggestions[3] }"]
        C["/chat<br/>JSON body → { answer }"]
    end

    subgraph Headers["Required Header"]
        Key["X-Groq-Api-Key"]
    end

    Key --> T
    Key --> S
    Key --> C

    T --> GroqClient
    S --> GroqClient
    C --> GroqClient
```

---

## 10. Deployment Topology

```mermaid
flowchart LR
    User([User browser]) --> Vercel["Frontend<br/>Vercel (Angular)"]
    Vercel -->|"HTTPS /api calls"| Render["Backend<br/>Render (Docker)"]
    Render --> Groq["Groq API"]
    User -->|"Mic access requires HTTPS in prod"| Vercel
```

| Environment | Frontend | Backend API |
|-------------|----------|-------------|
| Development | `http://localhost:4200` | `http://localhost:8080/api` |
| Production | Vercel | `https://live-suggestions-backend.onrender.com/api` |

---

## Related Files

| File | Role |
|------|------|
| `frontend/src/app/live-suggestions.store.ts` | Core logic: recording, API, state, export |
| `frontend/src/app/app.html` | 3-column UI layout |
| `backend/.../controller/ApiController.java` | REST endpoints |
| `backend/.../service/GroqClient.java` | Groq integration, prompts, JSON parsing |
| `README.md` | Run instructions + assignment checklist |
