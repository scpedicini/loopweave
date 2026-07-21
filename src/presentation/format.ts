export function formatDuration(seconds: number, precision = 1): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds - minutes * 60
    return `${minutes}:${remainder.toFixed(precision).padStart(precision > 0 ? 4 : 2, '0')}`
  }
  return `${seconds.toFixed(precision)}s`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KiB`
  }
  return `${(bytes / 1_048_576).toFixed(1)} MiB`
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatSampleRate(sampleRate: number): string {
  return `${(sampleRate / 1_000).toFixed(sampleRate % 1_000 === 0 ? 0 : 1)} kHz`
}
