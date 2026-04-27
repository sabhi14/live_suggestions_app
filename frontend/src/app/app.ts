import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, ViewChild, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LiveSuggestionsStore, SuggestionCard } from './live-suggestions.store';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements AfterViewChecked {
  readonly store = inject(LiveSuggestionsStore);

  @ViewChild('transcriptScroll') private transcriptScroll?: ElementRef<HTMLDivElement>;

  private shouldAutoScrollTranscript = false;

  constructor() {
    effect(() => {
      this.store.transcriptChunks().length;
      this.shouldAutoScrollTranscript = true;
    });
  }

  async toggleRecording(): Promise<void> {
    if (this.store.isRecording()) {
      this.store.stopRecording();
      return;
    }
    await this.store.startRecording();
    this.shouldAutoScrollTranscript = true;
  }

  async refreshSuggestions(): Promise<void> {
    await this.store.refreshSuggestions();
  }

  async selectSuggestion(suggestion: SuggestionCard): Promise<void> {
    await this.store.useSuggestion(suggestion);
  }

  async sendChat(): Promise<void> {
    await this.store.sendChatMessage();
  }

  ngAfterViewChecked(): void {
    if (!this.shouldAutoScrollTranscript || !this.transcriptScroll) {
      return;
    }

    const element = this.transcriptScroll.nativeElement;
    element.scrollTop = element.scrollHeight;
    this.shouldAutoScrollTranscript = false;
  }
}
