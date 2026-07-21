import heroArtworkUrl from '../assets/brand/loopweave-hero.webp'
import brandMarkUrl from '../assets/brand/loopweave-mark.webp'
import type {
  AnalysisMode,
  EngineProgress,
  LoopAnalysisOptions,
  LoopAnalysisResult,
  LoopCandidate,
  RenderedLoop,
} from '../domain/analysis'
import type { AudioAssetMetadata, ExportedAudioFile } from '../domain/audio'
import type { LoopEngine } from '../domain/engine'
import { BrowserAudioFileSource } from '../infrastructure/audio/BrowserAudioFileSource'
import {
  LoopPlayer,
  type PlaybackMode,
  type PlaybackState,
  SEAM_AUDITION_FLANK_SECONDS,
} from '../infrastructure/playback/LoopPlayer'
import {
  durationRangeForSource,
  resolveMaximumDurationSeconds,
  SOURCE_MAXIMUM_DURATION,
} from './durationRange'
import { formatDuration, formatFileSize, formatPercent, formatSampleRate } from './format'
import { LoopProgressView } from './LoopProgressView'
import { needsViewportReveal, preferredScrollBehavior } from './viewportNavigation'
import { WaveformView } from './WaveformView'

interface AppElements {
  readonly fileInput: HTMLInputElement
  readonly dropZone: HTMLElement
  readonly dropTitle: HTMLElement
  readonly dropCopy: HTMLElement
  readonly chooseFileButton: HTMLButtonElement
  readonly workspace: HTMLElement
  readonly sourcePanel: HTMLElement
  readonly sourceName: HTMLElement
  readonly sourceMetadata: HTMLElement
  readonly sourcePlaybackButton: HTMLButtonElement
  readonly waveformCanvas: HTMLCanvasElement
  readonly waveformPlayhead: HTMLElement
  readonly analysisForm: HTMLFormElement
  readonly analysisFieldset: HTMLFieldSetElement
  readonly minimumDuration: HTMLInputElement
  readonly maximumDuration: HTMLInputElement
  readonly maximumDurationMax: HTMLButtonElement
  readonly candidateCount: HTMLSelectElement
  readonly qualityBias: HTMLInputElement
  readonly qualityBiasOutput: HTMLOutputElement
  readonly analysisMode: HTMLSelectElement
  readonly analyzeButton: HTMLButtonElement
  readonly progressPanel: HTMLElement
  readonly progressBar: HTMLElement
  readonly progressLabel: HTMLElement
  readonly progressValue: HTMLElement
  readonly errorPanel: HTMLElement
  readonly resultsEmpty: HTMLElement
  readonly resultsPanel: HTMLElement
  readonly resultEyebrow: HTMLElement
  readonly resultTitle: HTMLElement
  readonly resultDescription: HTMLElement
  readonly profileChips: HTMLElement
  readonly candidateList: HTMLElement
}

const ACCEPTED_EXTENSION = /\.(aac|aif|aiff|flac|m4a|mp3|mp4|oga|ogg|opus|wav|webm)$/i
const DEFAULT_DROP_TITLE = 'Drop an audio file'
const DEFAULT_DROP_COPY = 'WAV, MP3, FLAC, Ogg, M4A, AIFF, or anything your browser can decode.'

export class AudioTextureApp {
  private readonly root: HTMLElement
  private readonly engine: LoopEngine
  private readonly elements: AppElements
  private readonly waveform: WaveformView
  private readonly player: LoopPlayer
  private readonly loopProgress: LoopProgressView
  private readonly renderCache = new Map<string, RenderedLoop>()
  private metadata: AudioAssetMetadata | undefined
  private analysis: LoopAnalysisResult | undefined
  private sourceAudio: HTMLAudioElement | undefined
  private sourceAudioUrl: string | undefined
  private waveformAnimationFrameId: number | undefined
  private busy = false
  private hasConfiguredDurationRange = false

  constructor(root: HTMLElement, engine: LoopEngine) {
    this.root = root
    this.engine = engine
    this.root.innerHTML = this.template()
    this.elements = this.collectElements()
    this.waveform = new WaveformView(this.elements.waveformCanvas, this.elements.waveformPlayhead)
    this.player = new LoopPlayer((state) => this.updatePlaybackState(state))
    this.loopProgress = new LoopProgressView(
      this.elements.candidateList,
      () => this.player.playbackPosition,
    )
  }

  mount(): void {
    const { elements } = this
    elements.chooseFileButton.addEventListener('click', this.openFilePicker)
    elements.dropZone.addEventListener('click', this.handleDropZoneClick)
    elements.dropZone.addEventListener('keydown', this.handleDropZoneKeydown)
    elements.dropZone.addEventListener('dragenter', this.handleDragEnter)
    elements.dropZone.addEventListener('dragover', this.handleDragOver)
    elements.dropZone.addEventListener('dragleave', this.handleDragLeave)
    elements.dropZone.addEventListener('drop', this.handleDrop)
    elements.fileInput.addEventListener('change', this.handleFileInput)
    elements.sourcePlaybackButton.addEventListener('click', this.toggleSourcePlayback)
    elements.analysisForm.addEventListener('submit', this.handleAnalysisSubmit)
    elements.maximumDuration.addEventListener('input', this.updateMaximumDurationMode)
    elements.maximumDurationMax.addEventListener('click', this.useSourceMaximumDuration)
    elements.qualityBias.addEventListener('input', this.updateQualityOutput)
    elements.candidateList.addEventListener('click', this.handleCandidateClick)
    window.addEventListener('beforeunload', this.handleBeforeUnload)
    this.updateMaximumDurationMode()
    this.updateQualityOutput()
  }

  private readonly openFilePicker = (event: Event): void => {
    event.stopPropagation()
    if (!this.busy) {
      this.elements.fileInput.click()
    }
  }

  private readonly handleDropZoneClick = (event: MouseEvent): void => {
    if (event.target === this.elements.chooseFileButton) {
      return
    }
    if (!this.busy) {
      this.elements.fileInput.click()
    }
  }

  private readonly handleDropZoneKeydown = (event: KeyboardEvent): void => {
    if ((event.key === 'Enter' || event.key === ' ') && !this.busy) {
      event.preventDefault()
      this.elements.fileInput.click()
    }
  }

  private readonly handleDragEnter = (event: DragEvent): void => {
    event.preventDefault()
    if (!this.busy) {
      this.elements.dropZone.classList.add('is-dragging')
    }
  }

  private readonly handleDragOver = (event: DragEvent): void => {
    event.preventDefault()
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = this.busy ? 'none' : 'copy'
    }
  }

  private readonly handleDragLeave = (event: DragEvent): void => {
    if (!this.elements.dropZone.contains(event.relatedTarget as Node | null)) {
      this.elements.dropZone.classList.remove('is-dragging')
    }
  }

  private readonly handleDrop = (event: DragEvent): void => {
    event.preventDefault()
    this.elements.dropZone.classList.remove('is-dragging')
    const file = event.dataTransfer?.files[0]
    if (file !== undefined && !this.busy) {
      void this.loadFile(file)
    }
  }

  private readonly handleFileInput = (): void => {
    const file = this.elements.fileInput.files?.[0]
    this.elements.fileInput.value = ''
    if (file !== undefined) {
      void this.loadFile(file)
    }
  }

  private readonly handleAnalysisSubmit = (event: SubmitEvent): void => {
    event.preventDefault()
    if (!this.busy && this.metadata !== undefined) {
      void this.analyze()
    }
  }

  private readonly toggleSourcePlayback = async (): Promise<void> => {
    const audio = this.sourceAudio
    if (audio === undefined) {
      return
    }
    if (!audio.paused) {
      this.stopSourcePlayback()
      return
    }

    this.player.stop()
    try {
      this.elements.sourcePlaybackButton.disabled = true
      await audio.play()
    } catch (error) {
      this.showError(error)
    } finally {
      this.elements.sourcePlaybackButton.disabled = this.busy || this.sourceAudio === undefined
      this.updateSourcePlaybackState()
    }
  }

  private readonly handleSourcePlaybackChange = (): void => {
    this.updateSourcePlaybackState()
  }

  private readonly updateQualityOutput = (): void => {
    const value = Number.parseInt(this.elements.qualityBias.value, 10)
    this.elements.qualityBiasOutput.value = `${value}% seam quality`
  }

  private readonly useSourceMaximumDuration = (): void => {
    this.elements.maximumDuration.value = String(SOURCE_MAXIMUM_DURATION)
    this.updateMaximumDurationMode()
  }

  private readonly updateMaximumDurationMode = (): void => {
    const usesSourceMaximum =
      Number.parseFloat(this.elements.maximumDuration.value) === SOURCE_MAXIMUM_DURATION
    this.elements.maximumDurationMax.classList.toggle('is-active', usesSourceMaximum)
    this.elements.maximumDurationMax.setAttribute('aria-pressed', String(usesSourceMaximum))
  }

  private readonly handleCandidateClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }
    const card = target.closest<HTMLElement>('[data-candidate-id]')
    if (card === null) {
      return
    }
    const candidateId = card.dataset.candidateId
    if (candidateId === undefined) {
      return
    }
    this.selectCandidate(candidateId)

    const actionButton = target.closest<HTMLButtonElement>('button[data-action]')
    if (actionButton === null) {
      return
    }
    const action = actionButton.dataset.action
    if (action === 'preview') {
      void this.togglePlayback(candidateId, actionButton, 'loop')
    } else if (action === 'seam') {
      void this.togglePlayback(candidateId, actionButton, 'seam')
    } else if (action === 'download') {
      void this.downloadCandidate(candidateId, actionButton)
    }
  }

  private readonly handleBeforeUnload = (): void => {
    void this.close()
  }

  private async loadFile(file: File): Promise<void> {
    try {
      this.validateFile(file)
      this.setBusy(true)
      this.clearError()
      this.player.stop()
      this.clearSourceAudio()
      this.renderCache.clear()
      this.analysis = undefined
      this.elements.resultsPanel.hidden = true
      this.elements.resultsEmpty.hidden = false
      this.elements.workspace.hidden = true
      this.waveform.setAudio(undefined)

      if (this.metadata !== undefined) {
        await this.engine.disposeSession(this.metadata.sessionId)
        this.metadata = undefined
      }

      this.showProgress({ stage: 'decoding', fraction: 0, message: 'Opening local audio' })
      this.revealWhenOffscreen(this.elements.progressPanel, Math.min(320, window.innerHeight * 0.4))
      const metadata = await this.engine.load(new BrowserAudioFileSource(file), (progress) =>
        this.showProgress(progress),
      )
      this.metadata = metadata
      this.setSourceAudio(file)
      this.renderSourceMetadata(metadata)
      this.configureDurationBounds(metadata.durationSeconds)
      this.waveform.setAudio(metadata)
      this.elements.workspace.hidden = false
      await this.analyze(true)
      this.revealWhenOffscreen(this.elements.sourcePanel)
    } catch (error) {
      this.showError(error)
      this.revealWhenOffscreen(this.elements.errorPanel)
    } finally {
      this.setBusy(false)
    }
  }

  private async analyze(parentOwnsBusyState = false): Promise<void> {
    const metadata = this.metadata
    if (metadata === undefined) {
      return
    }
    try {
      if (!parentOwnsBusyState) {
        this.setBusy(true)
      }
      this.clearError()
      this.player.stop()
      this.stopSourcePlayback()
      this.renderCache.clear()
      this.elements.resultsPanel.hidden = true
      this.elements.resultsEmpty.hidden = false
      this.showProgress({ stage: 'features', fraction: 0, message: 'Starting analysis' })
      const result = await this.engine.analyze(
        metadata.sessionId,
        this.readAnalysisOptions(),
        (progress) => this.showProgress(progress),
      )
      this.analysis = result
      this.hideProgress()
      this.renderAnalysis(result)
      const firstCandidate = result.candidates[0]
      if (firstCandidate !== undefined) {
        this.selectCandidate(firstCandidate.candidateId)
      } else {
        this.waveform.setCandidate(undefined)
      }
    } catch (error) {
      this.showError(error)
    } finally {
      if (!parentOwnsBusyState) {
        this.setBusy(false)
      }
    }
  }

  private async togglePlayback(
    candidateId: string,
    button: HTMLButtonElement,
    mode: PlaybackMode,
  ): Promise<void> {
    const metadata = this.metadata
    if (metadata === undefined) {
      return
    }
    this.stopSourcePlayback()
    const playbackState = this.player.playbackState
    if (
      playbackState.playing &&
      playbackState.candidateId === candidateId &&
      playbackState.mode === mode
    ) {
      this.player.stop()
      return
    }

    try {
      button.disabled = true
      button.classList.add('is-rendering')
      button.textContent = 'Rendering…'
      let rendered = this.renderCache.get(candidateId)
      if (rendered === undefined) {
        rendered = await this.engine.render(metadata.sessionId, candidateId)
        this.renderCache.clear()
        this.renderCache.set(candidateId, rendered)
      }
      await this.player.play(rendered, mode)
    } catch (error) {
      this.showError(error)
    } finally {
      button.disabled = button.dataset.unavailable === 'true'
      button.classList.remove('is-rendering')
      this.updatePlaybackState(this.player.playbackState)
    }
  }

  private async downloadCandidate(candidateId: string, button: HTMLButtonElement): Promise<void> {
    const metadata = this.metadata
    if (metadata === undefined) {
      return
    }
    try {
      button.disabled = true
      button.textContent = 'Encoding…'
      const exported = await this.engine.export(metadata.sessionId, candidateId, {
        encoding: 'pcm24',
      })
      this.saveExport(exported)
    } catch (error) {
      this.showError(error)
    } finally {
      button.disabled = false
      button.textContent = '↓ 24-bit WAV'
    }
  }

  private renderSourceMetadata(metadata: AudioAssetMetadata): void {
    this.elements.sourceName.textContent = metadata.fileName
    this.elements.sourceMetadata.innerHTML = [
      formatDuration(metadata.durationSeconds),
      `${metadata.numberOfChannels === 1 ? 'Mono' : `${metadata.numberOfChannels} channels`}`,
      formatSampleRate(metadata.sampleRate),
      formatFileSize(metadata.sourceSizeBytes),
    ]
      .map((value) => `<span>${value}</span>`)
      .join('')
  }

  private renderAnalysis(result: LoopAnalysisResult): void {
    this.elements.resultsEmpty.hidden = true
    this.elements.resultsPanel.hidden = false
    const verdict = this.verdictCopy(result)
    this.elements.resultEyebrow.textContent = verdict.eyebrow
    this.elements.resultTitle.textContent = verdict.title
    this.elements.resultDescription.textContent = verdict.description
    this.elements.profileChips.innerHTML = [
      `<span class="profile-chip profile-chip--primary">${this.titleCase(result.profile.regime)}</span>`,
      `<span class="profile-chip">${formatPercent(result.profile.stationarity)} stationary</span>`,
      `<span class="profile-chip">${formatPercent(result.profile.tonality)} tonal</span>`,
      `<span class="profile-chip">${Math.round(result.elapsedMilliseconds)} ms analysis</span>`,
    ].join('')
    this.elements.candidateList.innerHTML = result.candidates
      .map((candidate) => this.candidateTemplate(candidate))
      .join('')
  }

  private candidateTemplate(candidate: LoopCandidate): string {
    const seamAuditionFlankSeconds = Math.min(
      SEAM_AUDITION_FLANK_SECONDS,
      candidate.loopDurationSeconds / 2,
    )
    const seamAuditionTitle = `Loop ${formatDuration(seamAuditionFlankSeconds)} before and after the seam`
    const renderer =
      candidate.renderer.kind === 'hard-cut'
        ? 'Aligned hard cut'
        : `${Math.round(candidate.renderer.fadeSeconds * 1_000)} ms ${candidate.renderer.curve.replace('-', ' ')}`
    const diagnostics = candidate.diagnostics
      .map(
        (diagnostic) =>
          `<li class="diagnostic diagnostic--${diagnostic.tone}"><span></span>${diagnostic.message}</li>`,
      )
      .join('')
    return `
      <article class="candidate-card" data-candidate-id="${candidate.candidateId}">
        <button class="candidate-select" type="button" aria-label="Select ${candidate.label}"></button>
        <div class="candidate-rank">${String(candidate.rank).padStart(2, '0')}</div>
        <div class="candidate-body">
          <header class="candidate-header">
            <div>
              <p class="candidate-kicker">${candidate.label}</p>
              <h3>${formatDuration(candidate.loopDurationSeconds)} loop</h3>
              <p class="candidate-playback-status" data-loop-status>↻ LOOP 1 · 0.0s / ${formatDuration(candidate.loopDurationSeconds)}</p>
            </div>
            <div class="quality-score quality-score--${candidate.confidence}" style="--quality: ${candidate.qualityScore}%">
              <div class="quality-score-copy">
                <strong>${candidate.qualityScore}</strong>
                <span>quality</span>
              </div>
              <div class="loop-meter" data-loop-meter data-loop-duration="${candidate.loopDurationSeconds}" role="progressbar" aria-label="Loop playback position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <span class="loop-seam-label">START / SEAM</span>
                <svg class="loop-meter-svg" viewBox="0 0 80 80" aria-hidden="true">
                  <circle class="loop-meter-track" cx="40" cy="40" r="33"></circle>
                  <circle class="loop-meter-progress" data-loop-progress cx="40" cy="40" r="33" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"></circle>
                  <g data-loop-seam-marker>
                    <line class="loop-seam-tick" x1="40" y1="0" x2="40" y2="5"></line>
                    <circle class="loop-seam-pulse" cx="40" cy="7" r="5"></circle>
                  </g>
                  <g class="loop-playhead" data-loop-playhead transform="rotate(0 40 40)">
                    <circle class="loop-playhead-halo" cx="40" cy="7" r="6"></circle>
                    <path class="loop-playhead-arrow" d="M 35 3 L 46 7 L 35 11 Z"></path>
                  </g>
                </svg>
                <div class="loop-time" aria-hidden="true">
                  <strong data-loop-elapsed>0.0s</strong>
                  <span data-loop-total>of ${formatDuration(candidate.loopDurationSeconds)}</span>
                </div>
              </div>
            </div>
          </header>
          <div class="candidate-facts">
            <span><b>${formatDuration(candidate.startSeconds)}</b> in</span>
            <span><b>${formatDuration(candidate.endSeconds)}</b> out</span>
            <span><b>${renderer}</b> seam</span>
          </div>
          <ul class="diagnostics">${diagnostics}</ul>
          <div class="candidate-actions">
            <button class="button button--preview" type="button" data-action="preview" aria-pressed="false">▶ Preview loop</button>
            <button class="button button--seam" type="button" data-action="seam" aria-pressed="false" aria-label="${seamAuditionTitle}" title="${seamAuditionTitle}">◎ Audition seam</button>
            <button class="button button--download" type="button" data-action="download">↓ 24-bit WAV</button>
          </div>
        </div>
      </article>
    `
  }

  private selectCandidate(candidateId: string): void {
    const candidate = this.analysis?.candidates.find((item) => item.candidateId === candidateId)
    if (candidate === undefined) {
      return
    }
    for (const card of this.elements.candidateList.querySelectorAll<HTMLElement>(
      '[data-candidate-id]',
    )) {
      card.classList.toggle('is-selected', card.dataset.candidateId === candidateId)
    }
    this.waveform.setCandidate(candidate)
  }

  private updatePlaybackState(state: PlaybackState): void {
    for (const button of this.elements.candidateList.querySelectorAll<HTMLButtonElement>(
      'button[data-action="preview"], button[data-action="seam"]',
    )) {
      const card = button.closest<HTMLElement>('[data-candidate-id]')
      const mode: PlaybackMode = button.dataset.action === 'seam' ? 'seam' : 'loop'
      const isPlaying =
        state.playing && card?.dataset.candidateId === state.candidateId && state.mode === mode
      if (!button.classList.contains('is-rendering')) {
        button.textContent = isPlaying
          ? mode === 'seam'
            ? '■ Stop seam'
            : '■ Stop preview'
          : mode === 'seam'
            ? '◎ Audition seam'
            : '▶ Preview loop'
      }
      button.classList.toggle('is-playing', isPlaying)
      button.setAttribute('aria-pressed', String(isPlaying))
    }
    for (const card of this.elements.candidateList.querySelectorAll<HTMLElement>(
      '[data-candidate-id]',
    )) {
      const isPlaying = state.playing && card.dataset.candidateId === state.candidateId
      card.classList.toggle('is-playing', isPlaying)
    }
    this.loopProgress.setPlaybackState(state)
    this.syncWaveformPlayback()
  }

  private setSourceAudio(file: File): void {
    this.clearSourceAudio()
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.loop = true
    audio.preload = 'auto'
    audio.addEventListener('play', this.handleSourcePlaybackChange)
    audio.addEventListener('pause', this.handleSourcePlaybackChange)
    this.sourceAudioUrl = url
    this.sourceAudio = audio
    this.elements.sourcePlaybackButton.disabled = this.busy
    this.updateSourcePlaybackState()
  }

  private stopSourcePlayback(): void {
    const audio = this.sourceAudio
    if (audio === undefined) {
      return
    }
    audio.pause()
    if (audio.readyState > 0) {
      audio.currentTime = 0
    }
    this.updateSourcePlaybackState()
  }

  private clearSourceAudio(): void {
    const audio = this.sourceAudio
    this.sourceAudio = undefined
    if (audio !== undefined) {
      audio.removeEventListener('play', this.handleSourcePlaybackChange)
      audio.removeEventListener('pause', this.handleSourcePlaybackChange)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (this.sourceAudioUrl !== undefined) {
      URL.revokeObjectURL(this.sourceAudioUrl)
      this.sourceAudioUrl = undefined
    }
    this.elements.sourcePlaybackButton.disabled = true
    this.updateSourcePlaybackState()
  }

  private updateSourcePlaybackState(): void {
    const isPlaying = this.sourceAudio !== undefined && !this.sourceAudio.paused
    this.elements.sourcePlaybackButton.textContent = isPlaying ? '■ Stop source' : '▶ Play source'
    this.elements.sourcePlaybackButton.classList.toggle('is-playing', isPlaying)
    this.elements.sourcePlaybackButton.setAttribute('aria-pressed', String(isPlaying))
    this.syncWaveformPlayback()
  }

  private syncWaveformPlayback(): void {
    if (this.waveformAnimationFrameId !== undefined) {
      cancelAnimationFrame(this.waveformAnimationFrameId)
      this.waveformAnimationFrameId = undefined
    }
    this.waveform.setPlayhead(undefined)
    if (this.waveformPlaybackSourceTime() !== undefined) {
      this.drawWaveformPlayback()
    }
  }

  private readonly drawWaveformPlayback = (): void => {
    this.waveformAnimationFrameId = undefined
    const sourceTimeSeconds = this.waveformPlaybackSourceTime()
    this.waveform.setPlayhead(sourceTimeSeconds)
    if (sourceTimeSeconds !== undefined) {
      this.waveformAnimationFrameId = requestAnimationFrame(this.drawWaveformPlayback)
    }
  }

  private waveformPlaybackSourceTime(): number | undefined {
    const sourceAudio = this.sourceAudio
    if (sourceAudio !== undefined && !sourceAudio.paused) {
      return sourceAudio.currentTime
    }
    const position = this.player.playbackPosition
    if (position === undefined || position.mode !== 'loop') {
      return undefined
    }
    const candidate = this.analysis?.candidates.find(
      (item) => item.candidateId === position.candidateId,
    )
    if (candidate === undefined) {
      return undefined
    }
    return (
      candidate.startSeconds + (candidate.endSeconds - candidate.startSeconds) * position.progress
    )
  }

  private showProgress(progress: EngineProgress): void {
    const percentage = Math.round(progress.fraction * 100)
    this.elements.progressPanel.hidden = false
    this.elements.progressBar.style.width = `${percentage}%`
    this.elements.progressLabel.textContent = progress.message
    this.elements.progressValue.textContent = `${percentage}%`
    this.elements.dropTitle.textContent =
      progress.stage === 'decoding' || progress.stage === 'preparing'
        ? 'Opening audio locally…'
        : 'Finding seamless loops…'
    this.elements.dropCopy.textContent = `${progress.message} · ${percentage}%`
  }

  private hideProgress(): void {
    this.elements.progressPanel.hidden = true
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    this.elements.analysisFieldset.disabled = busy
    this.elements.chooseFileButton.disabled = busy
    this.elements.sourcePlaybackButton.disabled = busy || this.sourceAudio === undefined
    this.elements.dropZone.classList.toggle('is-busy', busy)
    this.elements.dropZone.setAttribute('aria-busy', String(busy))
    this.elements.chooseFileButton.textContent = busy
      ? 'Working locally…'
      : this.metadata === undefined
        ? 'Choose local file'
        : 'Choose another file'
    if (!busy) {
      this.resetDropZoneStatus()
    }
  }

  private resetDropZoneStatus(): void {
    const metadata = this.metadata
    this.elements.dropTitle.textContent =
      metadata === undefined ? DEFAULT_DROP_TITLE : 'Drop another audio file'
    this.elements.dropCopy.textContent =
      metadata === undefined
        ? DEFAULT_DROP_COPY
        : `${metadata.fileName} is loaded. Drop or choose a different source to replace it.`
  }

  private revealWhenOffscreen(element: HTMLElement, trailingSpace = 0): void {
    requestAnimationFrame(() => {
      if (
        element.hidden ||
        !needsViewportReveal(element.getBoundingClientRect(), window.innerHeight, 16, trailingSpace)
      ) {
        return
      }
      element.scrollIntoView({
        behavior: preferredScrollBehavior(
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        ),
        block: 'start',
      })
    })
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.hideProgress()
    this.elements.errorPanel.hidden = false
    this.elements.errorPanel.textContent = message
  }

  private clearError(): void {
    this.elements.errorPanel.hidden = true
    this.elements.errorPanel.textContent = ''
  }

  private configureDurationBounds(durationSeconds: number): void {
    const previousRange = this.hasConfiguredDurationRange
      ? {
          minimumSeconds: Number.parseFloat(this.elements.minimumDuration.value),
          maximumSeconds: Number.parseFloat(this.elements.maximumDuration.value),
        }
      : undefined
    const range = durationRangeForSource(durationSeconds, previousRange)
    const maximumAttribute = String(range.availableMaximumSeconds)

    this.elements.minimumDuration.max = maximumAttribute
    this.elements.maximumDuration.max = maximumAttribute
    this.elements.minimumDuration.value = String(range.minimumSeconds)
    this.elements.maximumDuration.value = String(range.maximumSeconds)
    this.hasConfiguredDurationRange = true
    this.updateMaximumDurationMode()
  }

  private readAnalysisOptions(): LoopAnalysisOptions {
    const minimumDurationSeconds = Number.parseFloat(this.elements.minimumDuration.value)
    const selectedMaximumDurationSeconds = Number.parseFloat(this.elements.maximumDuration.value)
    const maximumDurationSeconds = resolveMaximumDurationSeconds(
      selectedMaximumDurationSeconds,
      Number.parseFloat(this.elements.maximumDuration.max),
    )
    const candidateCount = Number.parseInt(this.elements.candidateCount.value, 10)
    const qualityBias = Number.parseInt(this.elements.qualityBias.value, 10) / 100
    const modeValue = this.elements.analysisMode.value
    if (!this.isAnalysisMode(modeValue)) {
      throw new Error('Unknown analysis mode.')
    }
    if (!Number.isFinite(minimumDurationSeconds) || !Number.isFinite(maximumDurationSeconds)) {
      throw new Error('Enter valid minimum and maximum loop durations.')
    }
    if (maximumDurationSeconds < minimumDurationSeconds) {
      throw new Error('Maximum loop duration must be greater than the minimum duration.')
    }
    return {
      minimumDurationSeconds,
      maximumDurationSeconds,
      candidateCount,
      qualityBias,
      mode: modeValue,
    }
  }

  private isAnalysisMode(value: string): value is AnalysisMode {
    return value === 'balanced' || value === 'cleanest' || value === 'longest'
  }

  private validateFile(file: File): void {
    if (file.size === 0) {
      throw new Error('The selected file is empty.')
    }
    if (!file.type.startsWith('audio/') && !ACCEPTED_EXTENSION.test(file.name)) {
      throw new Error('Choose a WAV, MP3, FLAC, Ogg, Opus, AAC, AIFF, M4A, or WebM audio file.')
    }
  }

  private saveExport(exported: ExportedAudioFile): void {
    const url = URL.createObjectURL(new Blob([exported.bytes], { type: exported.mediaType }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exported.fileName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  private verdictCopy(result: LoopAnalysisResult): {
    readonly eyebrow: string
    readonly title: string
    readonly description: string
  } {
    if (result.verdict === 'excellent') {
      return {
        eyebrow: 'Strong recurrence found',
        title: `${result.candidates.length} high-potential seams`,
        description:
          'The strongest boundaries are acoustically similar and required modest treatment.',
      }
    }
    if (result.verdict === 'usable') {
      return {
        eyebrow: 'Usable candidates found',
        title: `${result.candidates.length} rendered alternatives`,
        description:
          'Audition several repetitions; the best choice depends on which interior events you notice.',
      }
    }
    if (result.verdict === 'experimental') {
      return {
        eyebrow: 'Difficult source material',
        title: 'Experimental seams to audition',
        description:
          'Local joins were repaired, but changes inside the recording may reveal the repetition.',
      }
    }
    return {
      eyebrow: 'No confident contiguous loop',
      title: 'The source resists a clean loop',
      description:
        'The alternatives below are exploratory. A future compound-texture mode may fit this source better.',
    }
  }

  private titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1)
  }

  private async close(): Promise<void> {
    this.clearSourceAudio()
    this.waveform.destroy()
    await Promise.all([this.player.close(), this.engine.close()])
  }

  private collectElements(): AppElements {
    return {
      fileInput: this.required('#audio-file'),
      dropZone: this.required('#drop-zone'),
      dropTitle: this.required('#drop-title'),
      dropCopy: this.required('#drop-copy'),
      chooseFileButton: this.required('#choose-file'),
      workspace: this.required('#workspace'),
      sourcePanel: this.required('#source-panel'),
      sourceName: this.required('#source-name'),
      sourceMetadata: this.required('#source-metadata'),
      sourcePlaybackButton: this.required('#source-playback'),
      waveformCanvas: this.required('#waveform'),
      waveformPlayhead: this.required('#waveform-playhead'),
      analysisForm: this.required('#analysis-form'),
      analysisFieldset: this.required('#analysis-fieldset'),
      minimumDuration: this.required('#minimum-duration'),
      maximumDuration: this.required('#maximum-duration'),
      maximumDurationMax: this.required('#maximum-duration-max'),
      candidateCount: this.required('#candidate-count'),
      qualityBias: this.required('#quality-bias'),
      qualityBiasOutput: this.required('#quality-bias-output'),
      analysisMode: this.required('#analysis-mode'),
      analyzeButton: this.required('#analyze-button'),
      progressPanel: this.required('#progress-panel'),
      progressBar: this.required('#progress-bar'),
      progressLabel: this.required('#progress-label'),
      progressValue: this.required('#progress-value'),
      errorPanel: this.required('#error-panel'),
      resultsEmpty: this.required('#results-empty'),
      resultsPanel: this.required('#results-panel'),
      resultEyebrow: this.required('#result-eyebrow'),
      resultTitle: this.required('#result-title'),
      resultDescription: this.required('#result-description'),
      profileChips: this.required('#profile-chips'),
      candidateList: this.required('#candidate-list'),
    }
  }

  private required<ElementType extends Element>(selector: string): ElementType {
    const element = this.root.querySelector<ElementType>(selector)
    if (element === null) {
      throw new Error(`Required UI element ${selector} was not found.`)
    }
    return element
  }

  private template(): string {
    return `
      <div class="app-shell">
        <header class="topbar">
          <a class="brand" href="#top" aria-label="Loopweave home">
            <img class="brand-mark" src="${brandMarkUrl}" width="38" height="38" alt="">
            <span>Loopweave</span>
          </a>
          <div class="local-badge"><span></span> Local DSP · nothing uploaded</div>
        </header>

        <main id="top">
          <section class="hero-section">
            <div class="hero-copy">
              <p class="eyebrow">For ambient recordings</p>
              <h1>Create a<br><em>seamless loop.</em></h1>
              <p class="hero-description">Load a longer recording-crackling fire, rain, running water, or another steady sound. Loopweave finds a natural place to repeat, blends the transition, and exports a loop for games, soundscapes, or other projects.</p>
              <div class="capability-list" aria-label="Capabilities">
                <span>Recurrence search</span><span>Phase-aware refinement</span><span>Lossless WAV</span>
              </div>
            </div>

            <div id="drop-zone" class="drop-zone" role="button" tabindex="0" aria-label="Choose or drop an audio file">
              <input id="audio-file" type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.oga,.opus,.m4a,.aac,.aif,.aiff,.webm" hidden>
              <img class="drop-artwork" src="${heroArtworkUrl}" width="1600" height="854" alt="">
              <div class="drop-content">
                <div class="drop-visual" aria-hidden="true">
                  <img src="${brandMarkUrl}" width="96" height="96" alt="">
                </div>
                <p id="drop-title" class="drop-title">${DEFAULT_DROP_TITLE}</p>
                <p id="drop-copy" class="drop-copy">${DEFAULT_DROP_COPY}</p>
                <button id="choose-file" class="button button--primary" type="button">Choose local file</button>
                <p class="drop-footnote">Analyzed in this tab · Desktop-first · Source remains private</p>
              </div>
            </div>
          </section>

          <div id="error-panel" class="error-panel" role="alert" hidden></div>
          <section id="progress-panel" class="progress-panel" role="status" aria-live="polite" aria-atomic="true" hidden>
            <div class="progress-copy"><span id="progress-label">Preparing analysis</span><span id="progress-value">0%</span></div>
            <div class="progress-track"><span id="progress-bar"></span></div>
          </section>

          <section id="workspace" class="workspace" hidden>
            <div id="source-panel" class="source-panel panel">
              <header class="source-header">
                <div>
                  <p class="panel-label">Source recording</p>
                  <h2 id="source-name">Audio file</h2>
                </div>
                <div class="source-tools">
                  <div id="source-metadata" class="source-metadata"></div>
                  <button id="source-playback" class="button button--source" type="button" aria-pressed="false" title="Loop the untouched source recording" disabled>▶ Play source</button>
                </div>
              </header>
              <div class="waveform-frame">
                <div class="waveform-stage">
                  <canvas id="waveform" aria-label="Waveform, selected loop boundaries, and playback position"></canvas>
                  <span id="waveform-playhead" class="waveform-playhead" aria-hidden="true" hidden></span>
                </div>
                <div class="waveform-legend"><span><i class="legend-source"></i>Source</span><span><i class="legend-loop"></i>Selected loop</span><span><i class="legend-fade"></i>Overlap region</span></div>
              </div>
            </div>

            <div class="work-grid">
              <aside class="controls-panel panel">
                <div class="panel-heading">
                  <p class="panel-label">Search constraints</p>
                  <h2>Shape the result</h2>
                </div>
                <form id="analysis-form">
                  <fieldset id="analysis-fieldset">
                    <div class="control-row control-row--split">
                      <div class="duration-field">
                        <label for="minimum-duration">Minimum length</label><span>seconds</span>
                        <input id="minimum-duration" type="number" min="0.4" step="0.1" value="2.0">
                      </div>
                      <div class="duration-field">
                        <label for="maximum-duration">Maximum length</label><span id="maximum-duration-help">0 = source max</span>
                        <span class="duration-input"><input id="maximum-duration" type="number" min="0" step="0.1" value="30" aria-describedby="maximum-duration-help"><button id="maximum-duration-max" class="duration-max-button" type="button" aria-pressed="false" title="Use the longest loop this source can support">MAX</button></span>
                      </div>
                    </div>
                    <label class="control-row">Objective<select id="analysis-mode"><option value="balanced">Balanced</option><option value="cleanest">Cleanest seam</option><option value="longest">Prefer length</option></select></label>
                    <label class="control-row">Alternatives<select id="candidate-count"><option value="3">3 candidates</option><option value="5" selected>5 candidates</option><option value="8">8 candidates</option></select></label>
                    <label class="control-row control-row--range">
                      <span>Quality vs. length</span>
                      <input id="quality-bias" type="range" min="0" max="100" value="75">
                      <output id="quality-bias-output" for="quality-bias">75% seam quality</output>
                    </label>
                    <button id="analyze-button" class="button button--analyze" type="submit"><span>Analyze again</span><b>→</b></button>
                  </fieldset>
                </form>
                <div class="method-note">
                  <span class="method-icon">◎</span>
                  <p><strong>Renderer-conditioned search</strong>The engine ranks endpoints after testing the cut or crossfade-not before.</p>
                </div>
              </aside>

              <section class="results-column">
                <div id="results-empty" class="results-empty panel">
                  <div class="analysis-orbit" aria-hidden="true"><i></i><i></i><span></span></div>
                  <h2>Listening for recurrence</h2>
                  <p>Candidates will appear after acoustic states, interior stability, and boundary treatments have been compared.</p>
                </div>
                <div id="results-panel" hidden>
                  <header class="results-header">
                    <p id="result-eyebrow" class="eyebrow">Analysis complete</p>
                    <h2 id="result-title">Loop candidates</h2>
                    <p id="result-description"></p>
                    <div id="profile-chips" class="profile-chips"></div>
                  </header>
                  <div id="candidate-list" class="candidate-list"></div>
                </div>
              </section>
            </div>
          </section>
        </main>

        <footer>
          <p class="footer-copy">Source-preserving by design. A smooth seam is not a promise that every recording is semantically loopable.</p>
          <span class="footer-stack">Vite · TypeScript · Web Workers · Web Audio</span>
        </footer>
      </div>
    `
  }
}
