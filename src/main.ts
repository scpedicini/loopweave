import './style.css'
import { BrowserAudioDecoder } from './infrastructure/audio/BrowserAudioDecoder'
import { LocalWorkerLoopEngine } from './infrastructure/engine/LocalWorkerLoopEngine'
import { AudioTextureApp } from './presentation/AudioTextureApp'

const root = document.querySelector<HTMLDivElement>('#app')
if (root === null) {
  throw new Error('Application root #app was not found.')
}

const engine = new LocalWorkerLoopEngine(new BrowserAudioDecoder())
const application = new AudioTextureApp(root, engine)
application.mount()
