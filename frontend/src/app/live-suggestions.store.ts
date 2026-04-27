import { Injectable, computed, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: string;
  createdAtMs: number;
}

export interface SuggestionCard {
  id: string;
  type: string;
  title: string;
  preview: string;
  whyNow: string;
  timestamp: string;
  createdAtMs: number;
}

export interface SuggestionBatch {
  id: string;
  timestamp: string;
  createdAtMs: number;
  suggestions: SuggestionCard[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  createdAtMs: number;
}

export interface AppSettings {
  groqApiKey: string;
  liveSuggestionPrompt: string;
  detailedAnswerPrompt: string;
  chatPrompt: string;
  liveSuggestionContextWindowMinutes: number;
  detailedAnswerContextWindowMinutes: number;
  chatContextWindowMinutes: number;
  audioChunkSeconds: number;
}

@Injectable({ providedIn: 'root' })
export class LiveSuggestionsStore {
  private readonly sessionId = crypto.randomUUID();
  private readonly startedAtIso = new Date().toISOString();

  readonly apiBase = environment.apiUrl;
  private static readonly STORAGE_KEY = 'liveSuggestionsSettings';

  readonly isRecording = signal(false);
  readonly recordingStatus = signal('Idle');
  readonly transcriptChunks = signal<TranscriptChunk[]>([]);
  readonly suggestionBatches = signal<SuggestionBatch[]>([]);
  readonly chatMessages = signal<ChatMessage[]>([]);
  readonly pendingChatInput = signal('');
  readonly isRefreshingSuggestions = signal(false);
  readonly isTranscribing = signal(false);
  readonly isSendingChat = signal(false);
  readonly isSettingsOpen = signal(false);
  readonly errorMessage = signal('');

  readonly settings = signal<AppSettings>({
    groqApiKey: '',
    liveSuggestionPrompt: `You are a real-time meeting copilot.
Generate exactly 3 varied suggestions for what the speaker can say next.

Return valid JSON only in this exact schema:
{
  "suggestions": [
    "string",
    "string",
    "string"
  ]
}

Variation requirements:
1) One suggestion should be a concise answer, fact, or helpful explanation when relevant.
2) One suggestion should be a smart follow-up question or strategic talking point.
3) One suggestion should be a clarification, risk callout, or fact-check prompt when relevant.

Guidelines:
- Keep each suggestion short, natural, and directly speakable.
- Avoid repeating wording across suggestions.
- Use current meeting context and prior suggestions to stay fresh.
- No markdown, no extra keys, no prose outside JSON.`,
    detailedAnswerPrompt: `You are a high-clarity meeting assistant.
Provide a practical, detailed response that helps the user communicate clearly in a live meeting.
When useful, structure the answer into: key point, supporting rationale, and suggested phrasing.
Be concise but specific. Avoid fluff.`,
    chatPrompt: `You are a real-time meeting copilot in chat mode.
Help the user with clear, actionable wording, concise explanations, and next-step guidance.
Be context-aware, factual, and direct. If uncertain, suggest a safe clarification question.`,
    liveSuggestionContextWindowMinutes: 5,
    detailedAnswerContextWindowMinutes: 15,
    chatContextWindowMinutes: 15,
    audioChunkSeconds: 30
  });

  readonly hasApiKey = computed(() => this.settings().groqApiKey.trim().length > 0);

  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private chunkIntervalId: ReturnType<typeof setInterval> | null = null;
  private restartingRecorderForChunk = false;

  constructor(private readonly http: HttpClient) {
    this.loadSettingsFromStorage();
  }

  async startRecording(): Promise<void> {
    if (this.isRecording()) {
      return;
    }
    this.clearError();

    if (!this.hasApiKey()) {
      this.setError('Please set your Groq API key in Settings first.');
      return;
    }

    try {
      this.recordingStatus.set('Requesting microphone access...');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = this.createRecorder(this.mediaStream);
      this.mediaRecorder.start();
      this.startChunkRotation();
      this.isRecording.set(true);
      this.recordingStatus.set('Recording live...');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.setError('Microphone permission denied. Allow microphone access and try again.');
      } else {
        this.setError('Unable to access microphone.');
      }
      this.recordingStatus.set('Mic access failed');
    }
  }

  stopRecording(): void {
    if (!this.isRecording()) {
      return;
    }

    this.isRecording.set(false);
    this.restartingRecorderForChunk = false;
    this.clearChunkRotation();

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    } else {
      this.cleanupRecorderResources();
    }

    this.recordingStatus.set('Stopped');
  }

  async refreshSuggestions(): Promise<void> {
    await this.generateSuggestions(true);
  }

  async useSuggestion(suggestion: SuggestionCard): Promise<void> {
    this.chatMessages.update((messages) => [
      ...messages,
      {
        id: this.id('m'),
        role: 'user',
        text: suggestion.preview,
        timestamp: this.timeNow(),
        createdAtMs: Date.now()
      }
    ]);
    await this.fetchAssistantAnswer('', suggestion.preview);
  }

  async sendChatMessage(): Promise<void> {
    const text = this.pendingChatInput().trim();
    if (!text) {
      return;
    }

    this.pendingChatInput.set('');
    this.chatMessages.update((messages) => [
      ...messages,
      { id: this.id('m'), role: 'user', text, timestamp: this.timeNow(), createdAtMs: Date.now() }
    ]);
    await this.fetchAssistantAnswer(text, null);
  }

  setChatInput(value: string): void {
    this.pendingChatInput.set(value);
  }

  updateSettings(update: Partial<AppSettings>): void {
    this.settings.update((current) => {
      const merged = { ...current, ...update };
      return {
        ...merged,
        liveSuggestionContextWindowMinutes: this.clampMinutes(merged.liveSuggestionContextWindowMinutes),
        detailedAnswerContextWindowMinutes: this.clampMinutes(merged.detailedAnswerContextWindowMinutes),
        chatContextWindowMinutes: this.clampMinutes(merged.chatContextWindowMinutes),
        audioChunkSeconds: this.clampAudioSeconds(merged.audioChunkSeconds)
      };
    });
    this.persistSettings();
  }

  toggleSettings(): void {
    this.isSettingsOpen.update((open) => !open);
  }

  closeSettings(): void {
    this.isSettingsOpen.set(false);
  }

  exportStateAsJson(): void {
    const safeSettings = { ...this.settings() };
    safeSettings.groqApiKey = '';

    const payload = {
      sessionId: this.sessionId,
      startedAt: this.startedAtIso,
      exportedAt: new Date().toISOString(),
      settings: safeSettings,
      transcriptChunks: this.transcriptChunks(),
      suggestionBatches: this.suggestionBatches(),
      chatHistory: this.chatMessages()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `twinmind-session-${this.formatFileDate(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private async handleAudioChunk(blob: Blob): Promise<void> {
    if (!this.hasApiKey()) {
      this.recordingStatus.set('Recording paused: API key missing');
      return;
    }

    this.isTranscribing.set(true);
    this.recordingStatus.set('Transcribing latest chunk...');
    try {
      const formData = new FormData();
      formData.append('file', blob, `chunk-${Date.now()}.webm`);

      const response = await firstValueFrom(
        this.http.post<{ text: string }>(`${this.apiBase}/transcribe`, formData, {
          headers: this.authHeaders()
        })
      );

      const text = (response.text ?? '').trim();
      if (!text) {
        return;
      }

      this.transcriptChunks.update((chunks) => [
        ...chunks,
        { id: this.id('t'), text, timestamp: this.timeNow(), createdAtMs: Date.now() }
      ]);
      this.recordingStatus.set('Recording live...');
      await this.generateSuggestions(false);
    } catch (error) {
      this.setError(this.extractHttpError(error, 'Transcription failed.'));
      this.recordingStatus.set('Recording live (transcription failed)');
    } finally {
      this.isTranscribing.set(false);
    }
  }

  private async generateSuggestions(fromManualRefresh: boolean): Promise<void> {
    this.clearError();
    if (!this.hasApiKey()) {
      this.setError('Please set your Groq API key in Settings first.');
      return;
    }
    if (this.transcriptChunks().length === 0) {
      if (fromManualRefresh) {
        this.setError('Transcript is empty. Start recording first.');
      }
      return;
    }
    if (this.isRefreshingSuggestions()) {
      return;
    }

    this.isRefreshingSuggestions.set(true);
    try {
      const response = await firstValueFrom(
        this.http.post<{ suggestions: string[] }>(
          `${this.apiBase}/suggestions`,
          {
            transcriptChunks: this.getTranscriptTextsWithinMinutes(
              this.settings().liveSuggestionContextWindowMinutes
            ),
            previousSuggestionBatches: this.suggestionBatches().map((batch) =>
              batch.suggestions.map((suggestion) => suggestion.preview)
            ),
            settings: {
              prompt: this.settings().liveSuggestionPrompt,
              contextWindowMinutes: this.settings().liveSuggestionContextWindowMinutes
            }
          },
          { headers: this.authHeaders() }
        )
      );

      const cards = (response.suggestions ?? []).slice(0, 3).map((text, index) => ({
        id: this.id('s'),
        type: `Option ${index + 1}`,
        title: this.toTitle(text),
        preview: text,
        whyNow: `Based on latest transcript chunk at ${this.latestTimestamp()}`,
        timestamp: this.timeNow(),
        createdAtMs: Date.now()
      }));

      if (cards.length !== 3) {
        throw new Error('Invalid suggestions payload');
      }

      const batch: SuggestionBatch = {
        id: this.id('b'),
        timestamp: this.timeNow(),
        createdAtMs: Date.now(),
        suggestions: cards
      };
      this.suggestionBatches.update((existing) => [batch, ...existing]);
    } catch (error) {
      this.setError(this.extractHttpError(error, 'Failed to generate suggestions.'));
    } finally {
      this.isRefreshingSuggestions.set(false);
    }
  }

  private async fetchAssistantAnswer(userMessage: string, clickedSuggestion: string | null): Promise<void> {
    if (!this.hasApiKey()) {
      this.setError('Please set your Groq API key in Settings first.');
      return;
    }

    this.clearError();
    this.isSendingChat.set(true);
    try {
      const response = await firstValueFrom(
        this.http.post<{ answer: string }>(
          `${this.apiBase}/chat`,
          {
            userMessage,
            transcriptChunks: this.getTranscriptTextsWithinMinutes(
              this.settings().chatContextWindowMinutes
            ),
            chatHistory: this.chatMessages().map((message) => ({
              role: message.role,
              content: message.text
            })),
            clickedSuggestion,
            settings: {
              detailedAnswerPrompt: this.settings().detailedAnswerPrompt,
              chatPrompt: this.settings().chatPrompt,
              detailedAnswerContextWindowMinutes: this.settings().detailedAnswerContextWindowMinutes,
              chatContextWindowMinutes: this.settings().chatContextWindowMinutes
            }
          },
          { headers: this.authHeaders() }
        )
      );

      this.chatMessages.update((messages) => [
        ...messages,
        {
          id: this.id('m'),
          role: 'assistant',
          text: response.answer ?? 'No answer returned.',
          timestamp: this.timeNow(),
          createdAtMs: Date.now()
        }
      ]);
    } catch (error) {
      this.setError(this.extractHttpError(error, 'Failed to get assistant response.'));
    } finally {
      this.isSendingChat.set(false);
    }
  }

  private createRecorder(stream: MediaStream): MediaRecorder {
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        void this.handleAudioChunk(event.data);
      }
    };

    recorder.onstop = () => {
      if (this.isRecording() && this.restartingRecorderForChunk) {
        this.restartingRecorderForChunk = false;
        this.mediaRecorder?.start();
        this.recordingStatus.set('Recording live...');
        return;
      }
      this.cleanupRecorderResources();
    };

    return recorder;
  }

  private startChunkRotation(): void {
    this.clearChunkRotation();
    this.chunkIntervalId = setInterval(() => {
      if (!this.isRecording() || !this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
        return;
      }
      this.restartingRecorderForChunk = true;
      this.mediaRecorder.stop();
    }, this.settings().audioChunkSeconds * 1000);
  }

  private clearChunkRotation(): void {
    if (this.chunkIntervalId) {
      clearInterval(this.chunkIntervalId);
      this.chunkIntervalId = null;
    }
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({
      'X-Groq-Api-Key': this.settings().groqApiKey.trim()
    });
  }

  private stopMediaStream(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  private cleanupRecorderResources(): void {
    this.mediaRecorder = null;
    this.stopMediaStream();
    this.clearChunkRotation();
    this.restartingRecorderForChunk = false;
  }

  private toTitle(text: string): string {
    const words = text.trim().split(/\s+/).slice(0, 7);
    return words.join(' ') || 'Suggestion';
  }

  private latestTimestamp(): string {
    const chunks = this.transcriptChunks();
    return chunks.length ? chunks[chunks.length - 1].timestamp : this.timeNow();
  }

  private id(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private timeNow(): string {
    return new Date().toLocaleTimeString();
  }

  private setError(message: string): void {
    this.errorMessage.set(message);
  }

  private clearError(): void {
    this.errorMessage.set('');
  }

  private extractHttpError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error?.error === 'string' && error.error.error.trim()) {
        return error.error.error;
      }
      if (typeof error.error === 'string' && error.error.trim()) {
        return error.error;
      }
      if (error.message) {
        return `${fallback} ${error.message}`;
      }
    }
    return fallback;
  }

  private formatFileDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}-${hh}-${min}`;
  }

  private getTranscriptTextsWithinMinutes(minutes: number): string[] {
    const windowMs = this.clampMinutes(minutes) * 60_000;
    const cutoff = Date.now() - windowMs;
    const filtered = this.transcriptChunks()
      .filter((chunk) => chunk.createdAtMs >= cutoff)
      .map((chunk) => chunk.text);

    return filtered.length > 0 ? filtered : this.transcriptChunks().map((chunk) => chunk.text);
  }

  private clampMinutes(value: number): number {
    const numeric = Number.isFinite(value) ? value : 5;
    return Math.min(120, Math.max(1, Math.floor(numeric)));
  }

  private clampAudioSeconds(value: number): number {
    const numeric = Number.isFinite(value) ? value : 30;
    return Math.min(120, Math.max(5, Math.floor(numeric)));
  }

  private loadSettingsFromStorage(): void {
    try {
      const raw = localStorage.getItem(LiveSuggestionsStore.STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.updateSettings(parsed);
    } catch {
      this.setError('Failed to load saved settings. Using defaults.');
    }
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(LiveSuggestionsStore.STORAGE_KEY, JSON.stringify(this.settings()));
    } catch {
      this.setError('Failed to save settings to localStorage.');
    }
  }
}
