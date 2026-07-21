import type { AudioFileSource } from '../../domain/audio'

export class BrowserAudioFileSource implements AudioFileSource {
  readonly name: string
  readonly mediaType: string
  readonly sizeBytes: number
  private readonly file: File

  constructor(file: File) {
    this.file = file
    this.name = file.name
    this.mediaType = file.type || 'application/octet-stream'
    this.sizeBytes = file.size
  }

  readBytes(): Promise<ArrayBuffer> {
    return this.file.arrayBuffer()
  }
}
